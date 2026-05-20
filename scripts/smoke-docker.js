#!/usr/bin/env node
// PHANTOM Docker smoke target — Phase 2 of the containerization rollout.
//
// Why a script (mirrors scripts/run-tests.js):
//   - We want one cross-shell command (`npm run smoke:docker`) that works
//     identically on the Windows dev box and the Linux docker-server. Inline
//     bash chains in npm scripts hit the same glob/quoting issues that
//     pushed run-tests.js into its own file.
//   - The smoke needs orderly teardown on every exit path, including
//     SIGINT and probe failures. A script can register a single shutdown
//     hook; an inline pipeline cannot.
//
// Stages (printed as banners so the operator can follow tail -f output):
//   ▶ build   — docker compose build
//   ▶ up      — docker compose up -d
//   ▶ poll installer/status — wait up to 60s for HTTP 200
//   ▶ probe endpoints       — onboarding/status, runs, toolpacks
//   ▶ teardown — docker compose down  (skip with --no-down)
//
// Exit codes:
//   0 — every stage succeeded.
//   non-zero — first failing stage; later stages skipped. Teardown still
//   runs unless --no-down was passed (operator wants the container left
//   running so they can `docker compose logs` it).
//
// Important: this script must not touch the host DB or workspace. The named
// volumes declared in docker-compose.yml (`phantom-db`, `phantom-workspace`)
// keep state inside Docker. The host's repo-root `phantom.db` is the dev
// SQLite file — leave it alone.

import { spawn } from 'node:child_process';
import http from 'node:http';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const args = new Set(process.argv.slice(2));
const NO_DOWN = args.has('--no-down');

const BASE = 'http://localhost:1337';
const POLL_PATH = '/api/installer/status';
const PROBE_PATHS = ['/api/onboarding/status', '/api/runs', '/api/toolpacks'];
const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

function banner(label) {
  // Two-line banner so it stands out in interleaved docker-compose output.
  // The arrow + label format matches what `npm test` prints, keeping the
  // operator's eye trained on the same column.
  console.log(`\n▶ ${label}`);
}

function run(cmd, argv, { capture = false } = {}) {
  // Use `docker compose` (v2 plugin) not `docker-compose`. Compose v1 is EOL;
  // every supported docker-server has v2. stdio inherits so the operator sees
  // the build output live — important when a base-image pull stalls.
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, {
      cwd: ROOT,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    }
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: stderr + String(err) }));
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function httpGet(path) {
  // node:http instead of fetch keeps this script dep-free and immune to the
  // global-fetch DNS quirks that bit us on the Windows dev box.
  return new Promise((resolve) => {
    const req = http.get(`${BASE}${path}`, (res) => {
      // Drain the response so the socket frees up — we only care about the
      // status code for the smoke. Body content is not validated here on
      // purpose; that's the job of the unit tests in server/routes/api.test.js.
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode || 0 }));
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.setTimeout(5_000, () => { req.destroy(new Error('http timeout')); });
  });
}

async function pollInstallerStatus() {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const { status, error } = await httpGet(POLL_PATH);
    if (status === 200) {
      console.log(`  ✓ ${POLL_PATH} → 200 (attempt ${attempt})`);
      return true;
    }
    const elapsed = Math.round((POLL_TIMEOUT_MS - (deadline - Date.now())) / 1000);
    console.log(`  · attempt ${attempt} (${elapsed}s elapsed): ${error || `status ${status}`}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.error(`  ✗ ${POLL_PATH} did not return 200 within ${POLL_TIMEOUT_MS / 1000}s`);
  return false;
}

async function probeEndpoints() {
  let ok = true;
  for (const path of PROBE_PATHS) {
    const { status, error } = await httpGet(path);
    if (status === 200) {
      console.log(`  ✓ ${path} → 200`);
    } else {
      console.error(`  ✗ ${path} → ${error || `status ${status}`}`);
      ok = false;
    }
  }
  return ok;
}

async function teardown() {
  if (NO_DOWN) {
    console.log('  · --no-down set; leaving stack running. Inspect with `docker compose logs -f`.');
    return;
  }
  banner('teardown');
  await run('docker', ['compose', 'down']);
}

async function main() {
  // Graceful Ctrl-C: still tear the stack down so the operator's docker-server
  // doesn't accumulate orphaned containers between smoke runs.
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) return;
    interrupted = true;
    console.error('\n! SIGINT — tearing down');
    teardown().finally(() => process.exit(130));
  });

  banner('build');
  const build = await run('docker', ['compose', 'build']);
  if (build.code !== 0) {
    console.error(`✗ build failed (exit ${build.code})`);
    await teardown();
    process.exit(build.code);
  }

  banner('up');
  const up = await run('docker', ['compose', 'up', '-d']);
  if (up.code !== 0) {
    console.error(`✗ up failed (exit ${up.code})`);
    await teardown();
    process.exit(up.code);
  }

  banner(`poll ${POLL_PATH}`);
  const ready = await pollInstallerStatus();
  if (!ready) {
    await teardown();
    process.exit(1);
  }

  banner('probe endpoints');
  const probed = await probeEndpoints();
  if (!probed) {
    await teardown();
    process.exit(1);
  }

  await teardown();
  console.log('\n✓ docker smoke passed');
  process.exit(0);
}

main().catch((err) => {
  console.error('! smoke crashed:', err);
  teardown().finally(() => process.exit(1));
});
