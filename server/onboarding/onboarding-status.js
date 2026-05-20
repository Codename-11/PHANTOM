// Onboarding status — derives a 5-item readiness checklist from existing
// stores. No new schema. Used by the Dash onboarding checklist + the
// extended onboarding wizard's "Get started" step.
//
// All five booleans are best-effort: a thrown probe degrades to `false`
// without failing the whole status response.

import { getDB } from '../memory/store.js';
import { getScopes } from '../scope/scope-store.js';
import { getAssets } from '../assets/asset-store.js';
import { getToolpacks, checkToolpackAvailability } from '../toolpacks/toolpack-registry.js';
import { isDemoLoaded } from '../../scripts/seed.js';

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

/**
 * Returns the onboarding checklist + an overall `complete` boolean.
 * `complete` is true only when ALL five items are checked.
 *
 * Items:
 *   toolpacksInstalled — at least one toolpack reports `available` or `partial`.
 *   hasAsset           — at least one row in `assets`.
 *   hasScope           — at least one non-archived row in `scopes`.
 *   hasRun             — at least one terminal run in `runs`.
 *   demoLoaded         — at least one [demo]-tagged scope exists.
 */
export function getOnboardingChecklist() {
  const toolpacksInstalled = safe(() => {
    const packs = getToolpacks() || [];
    return packs.some((p) => {
      try {
        const avail = checkToolpackAvailability(p.id);
        return avail && (avail.available || avail.partial);
      } catch { return false; }
    });
  }, false);

  const hasAsset = safe(() => {
    const assets = getAssets({ limit: 1 }) || [];
    return assets.length > 0;
  }, false);

  const hasScope = safe(() => {
    const scopes = getScopes() || [];
    return scopes.length > 0;
  }, false);

  const hasRun = safe(() => {
    const row = getDB().prepare(
      `SELECT id FROM runs WHERE status IN ('completed', 'failed', 'stopped') LIMIT 1`
    ).get();
    return !!row;
  }, false);

  const demoLoaded = safe(() => isDemoLoaded(), false);

  const checklist = { toolpacksInstalled, hasAsset, hasScope, hasRun, demoLoaded };
  const complete = Object.values(checklist).every(Boolean);
  return { checklist, complete };
}
