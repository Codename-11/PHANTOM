// First-run onboarding detection.
//
// "First run" = the operator has not yet completed the welcome wizard AND
// the database is essentially empty (no scopes, no completed runs, no
// conversations with messages). We treat completion as a sticky flag —
// even if the operator later deletes everything, we don't re-open the
// wizard. They can always re-run it manually from Settings.
//
// The signals object exposes the raw counts so the wizard can show
// targeted guidance ("you've got a scope, just need an API key").

import { getSetting, setSetting, getDB } from '../memory/store.js';

const ONBOARDING_KEY = 'onboarding_completed';

function safeCount(sql, params = []) {
  try {
    const row = getDB().prepare(sql).get(...params);
    return Number(row?.n || 0);
  } catch {
    return 0;
  }
}

function collectSignals() {
  return {
    conversations: safeCount('SELECT COUNT(*) AS n FROM conversations'),
    scopes: safeCount('SELECT COUNT(*) AS n FROM scopes WHERE archived_at IS NULL'),
    runs: safeCount("SELECT COUNT(*) AS n FROM runs WHERE status IN ('completed','running','failed','stopped')"),
    apiKey: !!getSetting('api_key', ''),
    provider: getSetting('api_provider', '') || null,
    model: getSetting('api_model', '') || null,
  };
}

export function getOnboardingStatus() {
  const completed = getSetting(ONBOARDING_KEY, '0') === '1';
  const signals = collectSignals();
  const emptyState = !signals.conversations && !signals.scopes && !signals.runs;
  const firstRun = !completed && emptyState;
  return {
    completed,
    firstRun,
    emptyState,
    signals,
  };
}

export function markOnboardingComplete(value = true) {
  setSetting(ONBOARDING_KEY, value ? '1' : '0');
  return getOnboardingStatus();
}

export function resetOnboarding() {
  setSetting(ONBOARDING_KEY, '0');
  return getOnboardingStatus();
}
