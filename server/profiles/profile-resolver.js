// Profile resolver — the dual-mode bridge between the `profiles` table
// and the two surfaces it feeds:
//
//   • build-time → renderProfileAsDockerfile(id) emits a `RUN` fragment
//                  that defers to scripts/install-profile.sh (Phase 3 owns
//                  the actual install logic; we just call into it).
//   • runtime    → resolveProfileAsInstallPlan(id) delegates to the
//                  existing approval-gated installer in
//                  server/tools/installer.js so there's exactly one
//                  install plan resolver in the codebase.
//
// `expandProfile(id)` is the shared primitive — the parsed `tool_ids`
// list from the profile row.

import { getProfile } from './profile-store.js';
import { resolveInstallPlan } from '../tools/installer.js';

function loadProfile(id) {
  const profile = getProfile(id);
  if (!profile) {
    const err = new Error(`profile not found: ${id}`);
    err.code = 'PROFILE_NOT_FOUND';
    throw err;
  }
  return profile;
}

/**
 * Return the `tool_ids` array for the profile. Throws if the id is unknown.
 *
 * @param {string} id  profile id
 * @returns {string[]} tool ids in their stored order
 */
export function expandProfile(id) {
  return loadProfile(id).tool_ids;
}

/**
 * Render a Dockerfile RUN fragment that calls into Phase 3's
 * `scripts/install-profile.sh`. We deliberately keep this fragment small
 * and declarative: the heavy lifting (apt + pipx + go orchestration,
 * cache-busting, --no-install-recommends, the Metasploit gate) lives in
 * the shell script. The Dockerfile only needs to know which profile to
 * invoke and the operator's intent.
 *
 * @param {string} id  profile id
 * @returns {string}   multi-line RUN fragment (newline-terminated)
 */
export function renderProfileAsDockerfile(id) {
  const profile = loadProfile(id);
  const safeName = String(profile.name).replace(/"/g, '\\"');
  const lines = [
    `# profile: ${profile.name}`,
  ];
  if (profile.description) {
    // Indent continuation lines with `#` so the snippet pastes cleanly.
    for (const descLine of String(profile.description).split(/\r?\n/)) {
      lines.push(`# ${descLine}`);
    }
  }
  if (profile.tool_ids.length) {
    lines.push(`# tools: ${profile.tool_ids.join(', ')}`);
  } else {
    lines.push('# tools: (none)');
  }
  lines.push(`RUN /tmp/install-profile.sh "${safeName}"`);
  return lines.join('\n') + '\n';
}

/**
 * Resolve the profile to an install plan via the existing
 * `resolveInstallPlan(toolIds)` in server/tools/installer.js. The plan
 * shape is whatever the installer returns — by routing through the
 * single resolver, the runtime path and the approval queue stay 100%
 * consistent with the manual "install by toolIds" surface.
 *
 * @param {string} id              profile id
 * @param {object} [hostOverride]  optional host descriptor (used by tests)
 * @returns {object[]}             install-plan entries
 */
export function resolveProfileAsInstallPlan(id, hostOverride = null) {
  const toolIds = expandProfile(id);
  return resolveInstallPlan(toolIds, hostOverride);
}
