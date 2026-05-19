import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../memory/store.js';
import { extractAssetTargets } from '../assets/asset-store.js';

function parseJSON(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function expandScopeTargets(targets = {}) {
  const expanded = { ...targets };
  if (Array.isArray(targets.assetIds) && targets.assetIds.length) {
    try {
      const assetTargets = extractAssetTargets(targets.assetIds);
      for (const key of ['hosts', 'domains', 'cidrs', 'urls']) {
        expanded[key] = [...new Set([...(targets[key] || []), ...(assetTargets[key] || [])])];
      }
    } catch {
      // Asset schema may not exist during partial migrations; raw scope targets still work.
    }
  }
  return expanded;
}

function normalizeScope(row) {
  if (!row) return null;
  const targets = parseJSON(row.targets_json, {});
  return {
    id: row.id,
    name: row.name,
    targets: expandScopeTargets(targets),
    raw_targets: targets,
    allowed_actions: parseJSON(row.allowed_actions_json, []),
    blocked_actions: parseJSON(row.blocked_actions_json, []),
    // New: per-action-class modes (auto/ask/deny). Null when scope predates
    // the expansion — policy.js falls back to allowed/blocked_actions then.
    action_modes: parseJSON(row.action_modes_json, null),
    active_hours: parseJSON(row.active_hours_json, null),
    blackout_windows: parseJSON(row.blackout_windows_json, null),
    rate_caps: parseJSON(row.rate_caps_json, null),
    rules_of_engagement: row.rules_of_engagement || '',
    credential_refs: parseJSON(row.credential_refs_json, []),
    notes: row.notes || '',
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

function json(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

export function createScope({
  name,
  targets = {},
  allowedActions = [],
  blockedActions = [],
  actionModes = null,
  activeHours = null,
  blackoutWindows = null,
  rateCaps = null,
  rulesOfEngagement = '',
  credentialRefs = [],
  notes = '',
  expiresAt = null,
}) {
  if (!name || !String(name).trim()) throw new Error('scope name is required');
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO scopes (
      id, name, targets_json, allowed_actions_json, blocked_actions_json,
      action_modes_json, active_hours_json, blackout_windows_json, rate_caps_json, rules_of_engagement,
      credential_refs_json, notes, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(name).trim(),
    json(targets, {}),
    json(allowedActions, []),
    json(blockedActions, []),
    actionModes ? JSON.stringify(actionModes) : null,
    activeHours ? JSON.stringify(activeHours) : null,
    blackoutWindows ? JSON.stringify(blackoutWindows) : null,
    rateCaps ? JSON.stringify(rateCaps) : null,
    rulesOfEngagement || null,
    json(credentialRefs, []),
    notes || null,
    expiresAt || null
  );
  return getScope(id);
}

export function getScope(id) {
  return normalizeScope(getDB().prepare('SELECT * FROM scopes WHERE id = ?').get(id));
}

export function getScopes({ includeArchived = false } = {}) {
  const sql = includeArchived
    ? 'SELECT * FROM scopes ORDER BY created_at DESC'
    : 'SELECT * FROM scopes WHERE archived_at IS NULL ORDER BY created_at DESC';
  return getDB().prepare(sql).all().map(normalizeScope);
}

export function updateScope(id, updates = {}) {
  const current = getScope(id);
  if (!current) return null;
  const next = {
    name: updates.name !== undefined ? String(updates.name).trim() : current.name,
    targets: updates.targets !== undefined ? updates.targets : current.targets,
    allowedActions: updates.allowedActions !== undefined ? updates.allowedActions : current.allowed_actions,
    blockedActions: updates.blockedActions !== undefined ? updates.blockedActions : current.blocked_actions,
    actionModes: updates.actionModes !== undefined ? updates.actionModes : current.action_modes,
    activeHours: updates.activeHours !== undefined ? updates.activeHours : current.active_hours,
    blackoutWindows: updates.blackoutWindows !== undefined ? updates.blackoutWindows : current.blackout_windows,
    rateCaps: updates.rateCaps !== undefined ? updates.rateCaps : current.rate_caps,
    rulesOfEngagement: updates.rulesOfEngagement !== undefined ? updates.rulesOfEngagement : current.rules_of_engagement,
    credentialRefs: updates.credentialRefs !== undefined ? updates.credentialRefs : current.credential_refs,
    notes: updates.notes !== undefined ? updates.notes : current.notes,
    expiresAt: updates.expiresAt !== undefined ? updates.expiresAt : current.expires_at,
  };
  if (!next.name) throw new Error('scope name is required');
  getDB().prepare(
    `UPDATE scopes
     SET name = ?, targets_json = ?, allowed_actions_json = ?, blocked_actions_json = ?,
         action_modes_json = ?, active_hours_json = ?, blackout_windows_json = ?, rate_caps_json = ?,
         rules_of_engagement = ?,
         credential_refs_json = ?, notes = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    next.name,
    json(next.targets, {}),
    json(next.allowedActions, []),
    json(next.blockedActions, []),
    next.actionModes ? JSON.stringify(next.actionModes) : null,
    next.activeHours ? JSON.stringify(next.activeHours) : null,
    next.blackoutWindows ? JSON.stringify(next.blackoutWindows) : null,
    next.rateCaps ? JSON.stringify(next.rateCaps) : null,
    next.rulesOfEngagement || null,
    json(next.credentialRefs, []),
    next.notes || null,
    next.expiresAt || null,
    id
  );
  return getScope(id);
}

export function archiveScope(id) {
  getDB().prepare('UPDATE scopes SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  return getScope(id);
}
