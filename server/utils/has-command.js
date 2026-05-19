/**
 * Cross-platform "is this binary on PATH" check that DOES NOT spawn a
 * subprocess. Required because on Windows, when `bash.exe` (or any other
 * missing binary) is invoked via Node's child_process, libuv's
 * CreateProcess failure writes "The system cannot find the path
 * specified." to the parent's stderr *before* the thrown JS error
 * reaches our try/catch. `stdio:'ignore'` does not suppress this — it
 * muffles the child's stdio, but the child never starts. The cleanest
 * fix is to never spawn at all: walk process.env.PATH in JS.
 *
 * Honors PATHEXT on Windows so `where`-style lookups find .exe / .bat /
 * .cmd / .com. Cached so repeated callers (system prompt build, toolpack
 * availability probes, package-manager detection) get O(1) lookups.
 */
import { existsSync, statSync } from 'fs';
import { join, delimiter } from 'path';
import { platform } from 'os';

const IS_WIN = platform() === 'win32';
const PATH_EXTS = IS_WIN
  ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
  : [''];

const _cache = new Map();

export function hasCommand(name) {
  const safe = String(name || '').replace(/[^a-zA-Z0-9._+-]/g, '');
  if (!safe) return false;
  if (_cache.has(safe)) return _cache.get(safe);

  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of PATH_EXTS) {
      const candidate = join(dir, safe + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          _cache.set(safe, true);
          return true;
        }
      } catch { /* permission errors / symlink loops — skip */ }
    }
  }
  _cache.set(safe, false);
  return false;
}

/** Test-only — clears the lookup cache so unit tests can re-probe. */
export function _resetHasCommandCache() {
  _cache.clear();
}
