// In-memory rate-limit counters per scope.
//
// We don't persist these — they reset on server restart, which is the right
// behavior for "actions per minute" / "actions per run" caps. The policy
// evaluator is pure (takes usage as an input); this module is the dirty
// state companion. Counters are timestamped so "last-minute" reads stay
// accurate without a sweep timer.

const _scopeActions = new Map(); // scopeId -> number[] (timestamps ms)
const _runActions = new Map();   // runId   -> number (cumulative count)

export function recordAction(scopeId, runId) {
  const now = Date.now();
  if (scopeId) {
    const arr = _scopeActions.get(scopeId) || [];
    arr.push(now);
    // Trim anything older than 90s so the array doesn't grow unboundedly
    // during long sessions.
    const cutoff = now - 90_000;
    while (arr.length && arr[0] < cutoff) arr.shift();
    _scopeActions.set(scopeId, arr);
  }
  if (runId) {
    _runActions.set(runId, (_runActions.get(runId) || 0) + 1);
  }
}

export function getUsage(scopeId, runId) {
  const now = Date.now();
  const arr = scopeId ? (_scopeActions.get(scopeId) || []) : [];
  const lastMinute = arr.filter((ts) => ts >= now - 60_000).length;
  const thisRun = runId ? (_runActions.get(runId) || 0) : 0;
  return { lastMinute, thisRun };
}

export function clearRunUsage(runId) {
  if (runId) _runActions.delete(runId);
}

// Reset everything — useful for tests.
export function _resetRateState() {
  _scopeActions.clear();
  _runActions.clear();
}
