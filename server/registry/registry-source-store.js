// Registry source store (B3-full).
//
// CRUD for `registry_sources` — the operator-managed list of remote
// registries PHANTOM may fetch signed manifests from. Each source
// carries a pinned ed25519 trust root (base64 raw public key). Sources
// land DISABLED by default; the operator must explicitly enable
// browsing before any remote fetch happens.
//
// This store handles persistence only. The remote-fetch + verify
// orchestration lives in server/registry/remote-fetch.js so the
// fetch can be tested with a stub HTTP client.

import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../memory/store.js';

const VALID_CHANNELS = new Set(['stable', 'preview', 'dev']);
const VALID_STATUS = new Set([null, 'ok', 'unreachable', 'invalid_signature', 'invalid_schema', 'error']);

function normalize(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    channel: row.channel,
    signing_key: row.signing_key || null,
    signing_key_id: row.signing_key_id || null,
    enabled: !!row.enabled,
    last_fetched_at: row.last_fetched_at,
    last_status: row.last_status,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createRegistrySource({
  label,
  url,
  channel = 'stable',
  signingKey = null,
  signingKeyId = null,
  enabled = false,
}) {
  if (!label || !String(label).trim()) throw new Error('label is required');
  if (!url || !String(url).trim()) throw new Error('url is required');
  // Hard-require HTTPS for remote sources — operators can configure
  // an explicit dev-mode flag in a follow-up if they need plain HTTP
  // against a localhost test rig.
  if (!/^https:\/\//i.test(url)) {
    throw new Error('url must be https:// (deny-by-default for remote registries)');
  }
  if (!VALID_CHANNELS.has(channel)) {
    throw new Error(`channel must be one of: ${[...VALID_CHANNELS].join(', ')}`);
  }
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO registry_sources
      (id, label, url, channel, signing_key, signing_key_id, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(label).trim(),
    String(url).trim(),
    channel,
    signingKey || null,
    signingKeyId || null,
    enabled ? 1 : 0,
  );
  return getRegistrySource(id);
}

export function getRegistrySource(id) {
  if (!id) return null;
  return normalize(getDB().prepare('SELECT * FROM registry_sources WHERE id = ?').get(id));
}

export function listRegistrySources({ enabledOnly = false } = {}) {
  const sql = enabledOnly
    ? 'SELECT * FROM registry_sources WHERE enabled = 1 ORDER BY label'
    : 'SELECT * FROM registry_sources ORDER BY label';
  return getDB().prepare(sql).all().map(normalize);
}

export function updateRegistrySource(id, updates = {}) {
  const current = getRegistrySource(id);
  if (!current) return null;
  if (updates.channel !== undefined && !VALID_CHANNELS.has(updates.channel)) {
    throw new Error(`channel must be one of: ${[...VALID_CHANNELS].join(', ')}`);
  }
  const next = {
    label:          updates.label          ?? current.label,
    url:            updates.url            ?? current.url,
    channel:        updates.channel        ?? current.channel,
    signing_key:    updates.signingKey    !== undefined ? updates.signingKey    : current.signing_key,
    signing_key_id: updates.signingKeyId  !== undefined ? updates.signingKeyId  : current.signing_key_id,
    enabled:        updates.enabled       !== undefined ? (updates.enabled ? 1 : 0) : (current.enabled ? 1 : 0),
  };
  if (next.url && !/^https:\/\//i.test(next.url)) {
    throw new Error('url must be https://');
  }
  getDB().prepare(
    `UPDATE registry_sources
     SET label = ?, url = ?, channel = ?, signing_key = ?, signing_key_id = ?, enabled = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    next.label, next.url, next.channel,
    next.signing_key, next.signing_key_id, next.enabled,
    id
  );
  return getRegistrySource(id);
}

export function deleteRegistrySource(id) {
  const out = getDB().prepare('DELETE FROM registry_sources WHERE id = ?').run(id);
  return out.changes > 0;
}

/**
 * Called after each fetch attempt to record the outcome. status ∈
 * {ok, unreachable, invalid_signature, invalid_schema, error}.
 */
export function recordFetchOutcome(id, { status, error = null }) {
  if (!VALID_STATUS.has(status)) {
    throw new Error(`unknown status: ${status}`);
  }
  const sql = error
    ? 'UPDATE registry_sources SET last_fetched_at = CURRENT_TIMESTAMP, last_status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    : 'UPDATE registry_sources SET last_fetched_at = CURRENT_TIMESTAMP, last_status = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
  if (error) {
    getDB().prepare(sql).run(status, error, id);
  } else {
    getDB().prepare(sql).run(status, id);
  }
  return getRegistrySource(id);
}
