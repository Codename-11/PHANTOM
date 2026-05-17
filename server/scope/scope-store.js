import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../memory/store.js';

function parseJSON(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeScope(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    targets: parseJSON(row.targets_json, {}),
    allowed_actions: parseJSON(row.allowed_actions_json, []),
    blocked_actions: parseJSON(row.blocked_actions_json, []),
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
  credentialRefs = [],
  notes = '',
  expiresAt = null,
}) {
  if (!name || !String(name).trim()) throw new Error('scope name is required');
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO scopes (
      id, name, targets_json, allowed_actions_json, blocked_actions_json,
      credential_refs_json, notes, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(name).trim(),
    json(targets, {}),
    json(allowedActions, []),
    json(blockedActions, []),
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
    credentialRefs: updates.credentialRefs !== undefined ? updates.credentialRefs : current.credential_refs,
    notes: updates.notes !== undefined ? updates.notes : current.notes,
    expiresAt: updates.expiresAt !== undefined ? updates.expiresAt : current.expires_at,
  };
  if (!next.name) throw new Error('scope name is required');
  getDB().prepare(
    `UPDATE scopes
     SET name = ?, targets_json = ?, allowed_actions_json = ?, blocked_actions_json = ?,
         credential_refs_json = ?, notes = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    next.name,
    json(next.targets, {}),
    json(next.allowedActions, []),
    json(next.blockedActions, []),
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
