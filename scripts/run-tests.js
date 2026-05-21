#!/usr/bin/env node
// PHANTOM test runner.
//
// Why a script instead of an inline `node --test 'server/**/*.test.js' ...`?
//   - Glob expansion in npm scripts depends on the shell. PowerShell on
//     Windows does not expand `**`; bash on macOS/Linux does. The literal
//     `**` getting passed through to `node --test` caused silent
//     "0 tests found" runs on the Windows dev box for at least a session.
//   - We want three orthogonal modes (unit / e2e / watch) without
//     duplicating glob patterns three times.
//
// Modes:
//   default → run every test file under server/ (Node's test runner).
//             The React bundle has its own runner: `npm run test:frontend`
//             (Vitest). The legacy frontend/js suites were removed in A8.5b.
//   --unit  → only unit + integration tests (excludes server/e2e/**)
//   --e2e   → only the end-to-end smoke under server/e2e/**
//   --watch → keep node --test running in watch mode (auto-reruns on save)
//
// Combine: `--unit --watch` watches only unit tests (skips slow e2e).

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const args = new Set(process.argv.slice(2));
const wantUnit  = args.has('--unit');
const wantE2E   = args.has('--e2e');
const wantWatch = args.has('--watch');
// Default mode = both unit + e2e (preserves the historical `npm test`
// scope so CI behavior is unchanged).
const all = !wantUnit && !wantE2E;

function walk(dir, found = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return found; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip vendored deps and build artifacts. The walker doesn't
      // follow symlinks so worktrees stay isolated.
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      walk(full, found);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      found.push(full);
    }
  }
  return found;
}

const serverTests = walk(join(ROOT, 'server'));

const isE2E = (path) => relative(ROOT, path).split(sep)[1] === 'e2e';

let selected = [];
if (all) {
  selected = [...serverTests];
} else {
  if (wantUnit) {
    selected.push(...serverTests.filter(p => !isE2E(p)));
  }
  if (wantE2E) {
    selected.push(...serverTests.filter(isE2E));
  }
}

if (!selected.length) {
  console.error('No test files matched. Looked under server/.');
  process.exit(1);
}

const nodeArgs = ['--test'];
if (wantWatch) nodeArgs.push('--watch');
nodeArgs.push(...selected);

const mode = all ? 'all' : [wantUnit && 'unit', wantE2E && 'e2e', wantWatch && 'watch'].filter(Boolean).join('+');
console.log(`PHANTOM tests · ${mode} · ${selected.length} files`);

const child = spawn(process.execPath, nodeArgs, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
