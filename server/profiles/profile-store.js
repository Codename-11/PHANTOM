// Toolpack profile store — CRUD against the `profiles` table.
//
// A profile is a named bag of toolIds that can resolve two ways:
//   • build-time → a Dockerfile RUN fragment baked into the image
//   • runtime    → an install plan routed through the existing
//                  approval-gated installer
//
// The table is created lazily on first use so this module is
// self-contained: callers don't have to remember to wire it into
// `initDB()`. `CREATE TABLE IF NOT EXISTS` is idempotent so repeated
// calls (including across `initDB(':memory:')` cycles in tests) are
// cheap and safe.

import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../memory/store.js';

let lastBootstrappedDb = null;

// `monotonicNow()` guarantees that successive timestamps written into
// the `profiles` table are strictly increasing even when wall-clock
// `Date.now()` doesn't advance between two calls (common on fast inserts
// inside a test loop). Without this guard, `ORDER BY updated_at DESC`
// can return rows in an order that contradicts the operator's mental
// model of "most recently touched first" when two updates land inside
// the same millisecond. The cost is one extra SELECT per write, which
// is dwarfed by SQLite's per-statement overhead.
function monotonicNow(db) {
  const wall = Date.now();
  const row = db.prepare(
    'SELECT MAX(MAX(created_at), MAX(updated_at)) AS hi FROM profiles'
  ).get();
  const floor = (row?.hi || 0) + 1;
  return wall > floor ? wall : floor;
}

function ensureSchema() {
  const db = getDB();
  // Re-run the bootstrap when the underlying db handle changes (e.g.,
  // each `initDB(':memory:')` in tests yields a fresh handle).
  if (db === lastBootstrappedDb) return db;
  // Timestamps are ms-epoch INTEGERs (Phase 4 plan): finer than SQLite's
  // 1-second DATETIME, monotonic, trivially sortable, and JSON-friendly.
  // The other tables in this codebase use DATETIME for legacy reasons; new
  // tables coming online with the containerization rollout standardize on
  // ms-epoch so cross-host build timing has sub-second resolution.
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      tool_ids_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);
  `);
  lastBootstrappedDb = db;
  return db;
}

function parseToolIds(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    tool_ids: parseToolIds(row.tool_ids_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeIncomingToolIds(toolIds) {
  if (!Array.isArray(toolIds)) return [];
  // Stable dedupe; keep order of first appearance so the Dockerfile
  // fragment is deterministic.
  const seen = new Set();
  const out = [];
  for (const raw of toolIds) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function createProfile({ name, description = '', toolIds = [] } = {}) {
  const db = ensureSchema();
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('profile name is required');
  const ids = normalizeIncomingToolIds(toolIds);
  const id = uuidv4();
  const now = monotonicNow(db);
  try {
    db.prepare(
      `INSERT INTO profiles (id, name, description, tool_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, trimmed, description || null, JSON.stringify(ids), now, now);
  } catch (err) {
    // better-sqlite3 surfaces UNIQUE violations with SQLITE_CONSTRAINT_UNIQUE.
    if (/UNIQUE/i.test(err.message)) {
      throw new Error(`profile name "${trimmed}" already exists`);
    }
    throw err;
  }
  return getProfile(id);
}

export function getProfile(id) {
  if (!id) return null;
  const db = ensureSchema();
  return normalizeProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(id));
}

export function getProfileByName(name) {
  if (!name) return null;
  const db = ensureSchema();
  return normalizeProfile(db.prepare('SELECT * FROM profiles WHERE name = ?').get(String(name).trim()));
}

export function listProfiles() {
  const db = ensureSchema();
  return db
    .prepare('SELECT * FROM profiles ORDER BY updated_at DESC, created_at DESC')
    .all()
    .map(normalizeProfile);
}

export function updateProfile(id, patch = {}) {
  const db = ensureSchema();
  const current = getProfile(id);
  if (!current) return null;
  const nextName = patch.name !== undefined ? String(patch.name || '').trim() : current.name;
  if (!nextName) throw new Error('profile name is required');
  const nextDescription = patch.description !== undefined ? patch.description : current.description;
  const nextToolIds = patch.toolIds !== undefined
    ? normalizeIncomingToolIds(patch.toolIds)
    : current.tool_ids;
  // Strictly greater than every other timestamp in the table — see
  // monotonicNow() for why. Without this, parallel `npm test` runs can
  // produce two profiles with the same `Date.now()` and an update that
  // doesn't actually advance past the *other* profile's create time.
  const now = monotonicNow(db);
  try {
    db.prepare(
      `UPDATE profiles
       SET name = ?, description = ?, tool_ids_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextName, nextDescription || null, JSON.stringify(nextToolIds), now, id);
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) {
      throw new Error(`profile name "${nextName}" already exists`);
    }
    throw err;
  }
  return getProfile(id);
}

export function deleteProfile(id) {
  if (!id) return false;
  const db = ensureSchema();
  const result = db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  return result.changes > 0;
}
