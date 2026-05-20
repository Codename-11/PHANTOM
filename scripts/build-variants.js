#!/usr/bin/env node
// PHANTOM image variant builder — Phase 6 of the containerization rollout.
//
// Why a script (mirrors scripts/run-tests.js / scripts/smoke-docker.js):
//   - The variant matrix is data, not a shell loop. Keeping it here means
//     the docker-server operator and the dev box agree on exactly which
//     tags exist, and a future profile-resolver can import the same export
//     instead of grepping the README.
//   - --dry-run gives the Windows author a way to validate the resolved
//     `docker build` commands without docker installed locally; the user
//     copy-pastes the printed lines on the Linux docker-server.
//   - --only / --keep-going keep the script useful for one-off rebuilds
//     (e.g. after editing scripts/install-profile.sh for a single profile)
//     without forcing the full matrix every time.
//
// Variants (data lives in VARIANTS below):
//   base       — apt: curl git nmap jq dnsutils
//   offensive  — base + nikto whatweb gobuster hydra
//   blue       — base + tshark tcpdump chkrootkit rkhunter
//   full       — offensive + blue
//   full-msf   — full + Metasploit Framework (separate Dockerfile layer)
//
// Usage:
//   node scripts/build-variants.js                      # build all five
//   node scripts/build-variants.js --only blue          # build one
//   node scripts/build-variants.js --dry-run            # print only
//   node scripts/build-variants.js --keep-going         # don't stop on failure
//
// Exit codes:
//   0 — every requested variant built successfully (or --dry-run finished).
//   non-zero — first failing variant's exit code (or 1 for arg errors).
//
// Important: this script does not run `docker pull` or `docker push`. The
// docker-server operator is expected to push tags manually after a successful
// run, matching the "Image registry push automation. Manual `docker push` for
// now." line in ai_sync/containerization.md.

import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Variant matrix. Exported so future code (e.g. a CI matrix generator or a
// profile-resolver driving the same set of tags) can consume the canonical
// list without duplicating it. Order matters — `node scripts/build-variants.js`
// builds them in this order, and the summary table renders in the same order.
export const VARIANTS = {
  base:       { PROFILE: 'base' },
  offensive:  { PROFILE: 'offensive' },
  blue:       { PROFILE: 'blue' },
  full:       { PROFILE: 'full' },
  'full-msf': { PROFILE: 'full', INCLUDE_MSF: '1' },
};

const argv = process.argv.slice(2);
const flags = {
  only: null,
  dryRun: false,
  keepGoing: false,
};

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--dry-run') flags.dryRun = true;
  else if (arg === '--keep-going') flags.keepGoing = true;
  else if (arg === '--only') {
    flags.only = argv[i + 1];
    i += 1;
  } else if (arg.startsWith('--only=')) {
    flags.only = arg.slice('--only='.length);
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: node scripts/build-variants.js [--only <name>] [--dry-run] [--keep-going]');
    console.log(`Variants: ${Object.keys(VARIANTS).join(', ')}`);
    process.exit(0);
  } else {
    console.error(`build-variants: unknown argument '${arg}'`);
    process.exit(1);
  }
}

if (flags.only && !VARIANTS[flags.only]) {
  console.error(`build-variants: unknown variant '${flags.only}' (expected one of: ${Object.keys(VARIANTS).join(', ')})`);
  process.exit(1);
}

const targets = flags.only
  ? [[flags.only, VARIANTS[flags.only]]]
  : Object.entries(VARIANTS);

function buildArgsFor(variantName, buildArgs) {
  // Resolve a variant entry into the argv we'd pass to `docker build`.
  // Tag is always `phantom:<variant-name>` to match docker-compose.yml's
  // `image: phantom:base` default and the README install table.
  const args = ['build'];
  for (const [k, v] of Object.entries(buildArgs)) {
    args.push('--build-arg', `${k}=${v}`);
  }
  args.push('-t', `phantom:${variantName}`);
  args.push('.');
  return args;
}

function banner(variantName, tag) {
  // Two-line banner so it stands out in interleaved `docker build` output —
  // same arrow + label format as scripts/smoke-docker.js.
  console.log(`\n▶ build ${variantName} → ${tag}`);
}

function run(cmd, args) {
  // Inherit stdio so the operator sees layer caches / pulls / errors live.
  // shell:false matches scripts/smoke-docker.js — no shell injection surface.
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', (err) => resolve({ code: 1, error: err }));
    child.on('exit', (code) => resolve({ code: code ?? 1 }));
  });
}

function formatCommand(args) {
  // Render `docker build ...` as the operator would copy-paste it. Quote any
  // argument with whitespace (the matrix doesn't currently produce any, but
  // future additions might). PROFILE values stay un-quoted because they're
  // identifier-like.
  return ['docker', ...args].map((a) => /\s/.test(a) ? JSON.stringify(a) : a).join(' ');
}

async function main() {
  const summary = [];
  let firstFailure = 0;

  for (const [variantName, buildArgs] of targets) {
    const tag = `phantom:${variantName}`;
    const args = buildArgsFor(variantName, buildArgs);

    banner(variantName, tag);
    console.log(`  $ ${formatCommand(args)}`);

    if (flags.dryRun) {
      summary.push({ variant: variantName, tag, durationMs: 0, code: 0, skipped: true });
      continue;
    }

    const started = Date.now();
    const { code } = await run('docker', args);
    const durationMs = Date.now() - started;
    summary.push({ variant: variantName, tag, durationMs, code, skipped: false });

    if (code !== 0) {
      console.error(`  ✗ ${variantName} failed (exit ${code})`);
      if (!firstFailure) firstFailure = code;
      if (!flags.keepGoing) break;
    } else {
      console.log(`  ✓ ${variantName} built in ${Math.round(durationMs / 1000)}s`);
    }
  }

  // Summary table — variant → tag → duration → exit. Kept compact so the
  // tail of a long `docker build` log doesn't bury it.
  console.log('\n── summary ──────────────────────────────');
  console.log('variant       tag                    duration   exit');
  for (const row of summary) {
    const variant = row.variant.padEnd(13);
    const tag = row.tag.padEnd(22);
    const duration = row.skipped ? '(dry-run)' : `${Math.round(row.durationMs / 1000)}s`;
    const dur = duration.padEnd(10);
    const exit = row.skipped ? '—' : String(row.code);
    console.log(`${variant} ${tag} ${dur} ${exit}`);
  }

  if (flags.dryRun) {
    console.log('\n(dry-run — no docker invocations executed)');
    process.exit(0);
  }

  if (firstFailure) {
    console.error(`\n✗ build-variants failed (first exit ${firstFailure})`);
    process.exit(firstFailure);
  }

  console.log('\n✓ all variants built');
  process.exit(0);
}

main().catch((err) => {
  console.error('! build-variants crashed:', err);
  process.exit(1);
});
