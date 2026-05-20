// Sec-ops installer — detects the host's OS + package manager(s), resolves
// per-tool install commands, and feeds the approval-gated execution flow.
//
// Surfaces:
//   detectHost()                — { os, distro, isDocker, packageManagers, preferred }
//   resolveInstallPlan(toolIds) — picks the best backend per tool and
//                                  returns ordered [{ tool, backend, command, args }]
//   summarizePlan(plan)         — human-readable summary for the approval card
//
// The exec side lives in server/routes/api.js so the file stays
// dependency-light and easy to test in isolation.

import { existsSync, readFileSync } from 'fs';
import { platform } from 'os';
import { hasCommand } from '../utils/has-command.js';
import { getCatalog, getToolById, getToolsByTier, TIERS } from './installer-catalog.js';

const POSIX_MANAGERS = ['apt', 'dnf', 'pacman', 'brew', 'pipx', 'go'];
const WIN_MANAGERS   = ['winget', 'choco', 'scoop', 'pipx', 'go'];

// ── Detection ────────────────────────────────────────────────────────────
function detectDistro() {
  if (platform() !== 'linux') return null;
  try {
    // /etc/os-release is the canonical source for Linux distro id. We read
    // it synchronously because detection runs once and is small.
    const text = readFileSync('/etc/os-release', 'utf8');
    const id = /^ID=(.*)$/m.exec(text)?.[1]?.replace(/"/g, '').toLowerCase() || null;
    const idLike = /^ID_LIKE=(.*)$/m.exec(text)?.[1]?.replace(/"/g, '').toLowerCase() || null;
    return { id, idLike };
  } catch {
    return null;
  }
}

function detectIsDocker() {
  try {
    if (existsSync('/.dockerenv')) return true;
    return /docker|containerd|kubepods/.test(readFileSync('/proc/1/cgroup', 'utf8'));
  } catch {
    return false;
  }
}

function detectPackageManagers() {
  const os = platform();
  const candidates = os === 'win32' ? WIN_MANAGERS : POSIX_MANAGERS;
  const result = {};
  for (const mgr of candidates) {
    result[mgr] = !!hasCommand(mgr);
  }
  // On Windows, surface WSL as a fallback path even when the *Linux*
  // managers aren't reachable from the Windows-side PATH.
  if (os === 'win32') {
    result.wsl = !!hasCommand('wsl');
  }
  return result;
}

export function detectHost() {
  // Container-internal escape hatch: when PHANTOM_BACKEND is set (the
  // Dockerfile bakes it to "apt"), skip OS sniffing and trust the
  // build-time choice. Keeps detection deterministic inside the image.
  const envBackend = process.env.PHANTOM_BACKEND;
  if (envBackend) {
    return {
      os: platform(),
      distro: detectDistro(),
      isDocker: detectIsDocker(),
      packageManagers: { [envBackend]: true },
      preferred: envBackend,
    };
  }
  const os = platform();
  const distro = detectDistro();
  const isDocker = detectIsDocker();
  const packageManagers = detectPackageManagers();
  // Pick the operator's preferred backend in a deterministic order.
  let preferred = null;
  if (os === 'win32') {
    for (const mgr of ['winget', 'choco', 'scoop']) {
      if (packageManagers[mgr]) { preferred = mgr; break; }
    }
    if (!preferred && packageManagers.wsl) preferred = 'wsl-apt';
  } else if (os === 'darwin') {
    if (packageManagers.brew) preferred = 'brew';
  } else if (os === 'linux') {
    const idAll = `${distro?.id || ''} ${distro?.idLike || ''}`;
    if (/debian|ubuntu|kali/.test(idAll) && packageManagers.apt) preferred = 'apt';
    else if (/fedora|rhel|centos/.test(idAll) && packageManagers.dnf) preferred = 'dnf';
    else if (/arch/.test(idAll) && packageManagers.pacman) preferred = 'pacman';
    else if (packageManagers.apt) preferred = 'apt';
    else if (packageManagers.dnf) preferred = 'dnf';
    else if (packageManagers.pacman) preferred = 'pacman';
  }
  return { os, distro, isDocker, packageManagers, preferred };
}

// ── Plan resolution ──────────────────────────────────────────────────────
//
// For each tool, walks the preferred-manager list and returns the first
// backend that has a package id. `wsl-apt` is treated as a special backend
// that runs `wsl -e apt-get install ...` on Windows hosts.

function backendOrder(host) {
  if (host.os === 'win32') {
    const order = [];
    if (host.packageManagers.winget) order.push('winget');
    if (host.packageManagers.choco)  order.push('choco');
    if (host.packageManagers.scoop)  order.push('scoop');
    if (host.packageManagers.pipx)   order.push('pipx');
    if (host.packageManagers.go)     order.push('go');
    if (host.packageManagers.wsl)    order.push('wsl-apt');
    return order;
  }
  if (host.os === 'darwin') {
    return ['brew', 'pipx', 'go'].filter(m => host.packageManagers[m]);
  }
  // linux
  const distro = host.distro?.id || '';
  const idLike = host.distro?.idLike || '';
  const idAll = `${distro} ${idLike}`;
  const native = [];
  if (/debian|ubuntu|kali/.test(idAll))  native.push('apt');
  if (/fedora|rhel|centos/.test(idAll))  native.push('dnf');
  if (/arch/.test(idAll))                native.push('pacman');
  // Fallback to any detected manager so unusual distros still work.
  for (const m of ['apt', 'dnf', 'pacman']) {
    if (host.packageManagers[m] && !native.includes(m)) native.push(m);
  }
  return [...native, 'pipx', 'go'].filter(m => m === 'wsl-apt' || host.packageManagers[m]);
}

function buildCommand(backend, packageId) {
  switch (backend) {
    case 'winget':  return { command: 'winget',  args: ['install', '--id', packageId, '--silent', '--accept-package-agreements', '--accept-source-agreements'] };
    case 'choco':   return { command: 'choco',   args: ['install', packageId, '-y'] };
    case 'scoop':   return { command: 'scoop',   args: ['install', packageId] };
    case 'apt':     return { command: 'sudo',    args: ['apt-get', 'install', '-y', packageId] };
    case 'dnf':     return { command: 'sudo',    args: ['dnf', 'install', '-y', packageId] };
    case 'pacman':  return { command: 'sudo',    args: ['pacman', '-S', '--noconfirm', packageId] };
    case 'brew':    return { command: 'brew',    args: ['install', packageId] };
    case 'pipx':    return { command: 'pipx',    args: ['install', packageId] };
    case 'go':      return { command: 'go',      args: ['install', packageId] };
    case 'wsl-apt': return { command: 'wsl',     args: ['-e', 'sudo', 'apt-get', 'install', '-y', packageId] };
    default:        return null;
  }
}

/**
 * Resolve an install plan for the given tool ids against the given host.
 * Returns one entry per tool. `backend === null` means we couldn't find
 * any available package manager that ships this tool.
 */
export function resolveInstallPlan(toolIds, hostOverride = null) {
  const host = hostOverride || detectHost();
  const order = backendOrder(host);
  const plan = [];
  for (const id of toolIds) {
    const tool = getToolById(id);
    if (!tool) {
      plan.push({ id, tool: null, backend: null, command: null, args: null, reason: 'unknown tool id' });
      continue;
    }
    let resolved = null;
    for (const backend of order) {
      const packageId = backend === 'wsl-apt'
        ? tool.packages.apt
        : tool.packages[backend];
      if (!packageId) continue;
      const cmd = buildCommand(backend, packageId);
      if (!cmd) continue;
      resolved = {
        id: tool.id,
        tool,
        backend,
        packageId,
        command: cmd.command,
        args: cmd.args,
      };
      break;
    }
    if (resolved) plan.push(resolved);
    else plan.push({
      id, tool, backend: null, command: null, args: null,
      reason: `no package available for ${host.os}${host.distro?.id ? `/${host.distro.id}` : ''}`,
    });
  }
  return plan;
}

export function summarizePlan(plan) {
  const ok = plan.filter(p => p.backend);
  const skip = plan.filter(p => !p.backend);
  return {
    total: plan.length,
    installable: ok.length,
    skipped: skip.length,
    backends: [...new Set(ok.map(p => p.backend))],
    bySkipReason: skip.reduce((acc, p) => { acc[p.reason] = (acc[p.reason] || 0) + 1; return acc; }, {}),
  };
}

// ── Catalog / status / availability ─────────────────────────────────────
export function getInstallerStatus({ commandExists = hasCommand } = {}) {
  const host = detectHost();
  const catalog = getCatalog();
  const tools = catalog.map((tool) => ({
    id: tool.id,
    command: tool.command,
    tier: tool.tier,
    summary: tool.summary,
    docs: tool.docs,
    available: !!commandExists(tool.command),
    hasPackage: !!Object.keys(tool.packages || {}).length,
  }));
  const byTier = {};
  for (const tier of TIERS) {
    const subset = tools.filter(t => t.tier === tier);
    byTier[tier] = {
      total: subset.length,
      installed: subset.filter(t => t.available).length,
    };
  }
  return { host, tools, byTier };
}

export function toolIdsForTier(tier) {
  return getToolsByTier(tier).map(t => t.id);
}

export { TIERS };
