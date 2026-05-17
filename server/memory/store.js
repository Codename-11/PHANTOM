import Database from 'better-sqlite3';
import config from '../config.js';
import { v4 as uuidv4 } from 'uuid';

let db;

export function initDB(dbPath = config.db.path) {
  if (db) db.close();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT 'New Conversation',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT,
      args TEXT,
      url TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tool_results (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      tool_name TEXT NOT NULL,
      input TEXT,
      output TEXT,
      status TEXT DEFAULT 'success',
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      title TEXT DEFAULT 'New Run',
      goal TEXT,
      status TEXT DEFAULT 'running',
      model TEXT,
      provider_route TEXT,
      scope_id TEXT,
      risk_level TEXT DEFAULT 'unknown',
      summary TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trace_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_event_id TEXT,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      phase TEXT DEFAULT 'general',
      status TEXT DEFAULT 'started',
      tool_name TEXT,
      input_json TEXT,
      output_ref TEXT,
      output_preview TEXT,
      metadata_json TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      duration_ms INTEGER,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_event_id) REFERENCES trace_events(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
    CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_trace_events_run_seq ON trace_events(run_id, seq);
  `);

  return db;
}

export function getDB() {
  if (!db) initDB();
  return db;
}

// ─── Conversations ───
export function createConversation(title = 'New Conversation') {
  const id = uuidv4();
  getDB().prepare('INSERT INTO conversations (id, title) VALUES (?, ?)').run(id, title);
  return { id, title, created_at: new Date().toISOString() };
}

export function getConversations() {
  return getDB().prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all();
}

export function getConversation(id) {
  return getDB().prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

export function deleteConversation(id) {
  getDB().prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function updateConversationTitle(id, title) {
  getDB().prepare('UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title, id);
}

// ─── Messages ───
export function addMessage(conversationId, { role, content, tool_calls, tool_call_id, name }) {
  const id = uuidv4();
  getDB().prepare(
    'INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, conversationId, role, content || null, tool_calls ? JSON.stringify(tool_calls) : null, tool_call_id || null, name || null);

  getDB().prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversationId);
  return id;
}

export function getMessages(conversationId) {
  const rows = getDB().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId);
  return rows.map(r => ({
    ...r,
    tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
  }));
}

// ─── Memories ───
export function saveMemory(category, key, value, metadata = {}) {
  const id = uuidv4();
  const existing = getDB().prepare('SELECT id FROM memories WHERE category = ? AND key = ?').get(category, key);
  if (existing) {
    getDB().prepare('UPDATE memories SET value = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(value, JSON.stringify(metadata), existing.id);
    return existing.id;
  }
  getDB().prepare('INSERT INTO memories (id, category, key, value, metadata) VALUES (?, ?, ?, ?, ?)')
    .run(id, category, key, value, JSON.stringify(metadata));
  return id;
}

export function searchMemories(query, category = null) {
  const q = `%${query.toLowerCase()}%`;
  if (category) {
    return getDB().prepare(
      'SELECT * FROM memories WHERE category = ? AND (LOWER(key) LIKE ? OR LOWER(value) LIKE ?) ORDER BY updated_at DESC LIMIT 20'
    ).all(category, q, q);
  }
  return getDB().prepare(
    'SELECT * FROM memories WHERE LOWER(key) LIKE ? OR LOWER(value) LIKE ? ORDER BY updated_at DESC LIMIT 20'
  ).all(q, q);
}

export function getAllMemories(category = null) {
  if (category) {
    return getDB().prepare('SELECT * FROM memories WHERE category = ? ORDER BY updated_at DESC').all(category);
  }
  return getDB().prepare('SELECT * FROM memories ORDER BY updated_at DESC LIMIT 100').all();
}

// ─── Settings ───
export function getSetting(key, defaultValue = null) {
  const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

export function setSetting(key, value) {
  getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

export function getAllSettings() {
  const rows = getDB().prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

// ─── MCP Servers ───
export function getMCPServers() {
  return getDB().prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC').all();
}

export function addMCPServer({ name, transport, command, args, url }) {
  const id = uuidv4();
  getDB().prepare('INSERT INTO mcp_servers (id, name, transport, command, args, url) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, transport || 'stdio', command || null, args ? JSON.stringify(args) : null, url || null);
  return id;
}

export function removeMCPServer(id) {
  getDB().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
}

// ─── Tool Results ───
export function saveToolResult(conversationId, toolName, input, output, status, durationMs) {
  const id = uuidv4();
  getDB().prepare(
    'INSERT INTO tool_results (id, conversation_id, tool_name, input, output, status, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, conversationId, toolName, JSON.stringify(input), output, status, durationMs);
  return id;
}

// ─── Runs ───
function normalizeRun(row) {
  return row || null;
}

export function createRun({ conversationId, title, goal, model, providerRoute, scopeId = null, riskLevel = 'unknown' }) {
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO runs (id, conversation_id, title, goal, status, model, provider_route, scope_id, risk_level)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`
  ).run(
    id,
    conversationId,
    title || (goal ? goal.substring(0, 80) : 'New Run'),
    goal || null,
    model || null,
    providerRoute || null,
    scopeId || null,
    riskLevel || 'unknown'
  );
  return normalizeRun(getRun(id));
}

export function getRun(id) {
  return normalizeRun(getDB().prepare('SELECT * FROM runs WHERE id = ?').get(id));
}

export function getRuns({ limit = 50, conversationId = null, includeCompleted = true } = {}) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
  let sql = 'SELECT * FROM runs';
  const params = [];
  const where = [];
  if (conversationId) {
    where.push('conversation_id = ?');
    params.push(conversationId);
  }
  if (!includeCompleted) {
    where.push("status NOT IN ('completed', 'failed', 'stopped')");
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY started_at DESC LIMIT ?';
  params.push(safeLimit);
  return getDB().prepare(sql).all(...params).map(normalizeRun);
}

export function updateRunStatus(id, status, { summary = null, endedAt = null } = {}) {
  const terminal = ['completed', 'failed', 'stopped'].includes(status);
  getDB().prepare(
    `UPDATE runs
     SET status = ?,
         summary = COALESCE(?, summary),
         ended_at = CASE WHEN ? THEN COALESCE(?, CURRENT_TIMESTAMP) ELSE ended_at END
     WHERE id = ?`
  ).run(status, summary, terminal ? 1 : 0, endedAt, id);
  return getRun(id);
}

export function completeRun(id, summary = null) {
  return updateRunStatus(id, 'completed', { summary });
}

export function failRun(id, summary = null) {
  return updateRunStatus(id, 'failed', { summary });
}

// ─── Trace Events ───
function parseJSONField(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeTraceEvent(row) {
  if (!row) return null;
  return {
    ...row,
    input: parseJSONField(row.input_json),
    metadata: parseJSONField(row.metadata_json),
  };
}

export function addTraceEvent(runId, {
  parentEventId = null,
  type,
  phase = 'general',
  status = 'started',
  toolName = null,
  input = null,
  outputRef = null,
  outputPreview = null,
  metadata = null,
  startedAt = null,
  endedAt = null,
  durationMs = null,
}) {
  if (!runId) throw new Error('runId is required');
  if (!type) throw new Error('trace event type is required');

  const row = getDB().prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM trace_events WHERE run_id = ?').get(runId);
  const seq = row?.next_seq || 1;
  const id = uuidv4();

  getDB().prepare(
    `INSERT INTO trace_events (
      id, run_id, parent_event_id, seq, type, phase, status, tool_name,
      input_json, output_ref, output_preview, metadata_json, started_at, ended_at, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`
  ).run(
    id,
    runId,
    parentEventId,
    seq,
    type,
    phase,
    status,
    toolName,
    input !== null && input !== undefined ? JSON.stringify(input) : null,
    outputRef,
    outputPreview !== null && outputPreview !== undefined ? String(outputPreview).substring(0, 4000) : null,
    metadata !== null && metadata !== undefined ? JSON.stringify(metadata) : null,
    startedAt,
    endedAt,
    durationMs
  );

  return normalizeTraceEvent(getDB().prepare('SELECT * FROM trace_events WHERE id = ?').get(id));
}

export function getTraceEvents(runId, { limit = 500 } = {}) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 500, 2000));
  return getDB().prepare(
    'SELECT * FROM trace_events WHERE run_id = ? ORDER BY seq ASC LIMIT ?'
  ).all(runId, safeLimit).map(normalizeTraceEvent);
}

export function closeDB() {
  if (db) db.close();
}
