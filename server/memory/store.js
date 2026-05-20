import Database from 'better-sqlite3';
import config from '../config.js';
import { v4 as uuidv4 } from 'uuid';

let db;

function ensureColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column);
  if (!existing) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

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
      prompt_snapshot_json TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scopes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      targets_json TEXT,
      allowed_actions_json TEXT,
      blocked_actions_json TEXT,
      credential_refs_json TEXT,
      notes TEXT,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS prompt_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      mode TEXT DEFAULT 'general',
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prompt_fragments (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      position INTEGER DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_id) REFERENCES prompt_profiles(id) ON DELETE CASCADE
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

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      conversation_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      path TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      published_at DATETIME,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'device',
      name TEXT NOT NULL,
      description TEXT,
      owner TEXT,
      environment TEXT,
      status TEXT DEFAULT 'active',
      criticality TEXT DEFAULT 'medium',
      notes TEXT,
      credential_refs_json TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS asset_addresses (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_services (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      name TEXT,
      protocol TEXT,
      port INTEGER,
      url TEXT,
      status TEXT DEFAULT 'unknown',
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_tags (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_relationships (
      id TEXT PRIMARY KEY,
      from_asset_id TEXT NOT NULL,
      to_asset_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (to_asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      asset_id TEXT,
      service_id TEXT,
      run_id TEXT,
      trace_event_id TEXT,
      scope_id TEXT,
      title TEXT NOT NULL,
      severity TEXT DEFAULT 'low',
      status TEXT DEFAULT 'open',
      description TEXT,
      evidence TEXT,
      recommendation TEXT,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      fixed_at DATETIME,
      metadata_json TEXT,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL,
      FOREIGN KEY (service_id) REFERENCES asset_services(id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL,
      FOREIGN KEY (trace_event_id) REFERENCES trace_events(id) ON DELETE SET NULL,
      FOREIGN KEY (scope_id) REFERENCES scopes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS finding_evidence (
      id TEXT PRIMARY KEY,
      finding_id TEXT NOT NULL,
      artifact_id TEXT,
      trace_event_id TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE CASCADE,
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
      FOREIGN KEY (trace_event_id) REFERENCES trace_events(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS asset_snapshots (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      scope_id TEXT,
      run_id TEXT,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'unknown',
      health_score INTEGER,
      summary TEXT,
      observations_json TEXT,
      finding_counts_json TEXT,
      artifact_ids_json TEXT,
      captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (scope_id) REFERENCES scopes(id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS run_templates (
      id TEXT PRIMARY KEY,
      source_run_id TEXT NOT NULL,
      scope_id TEXT,
      name TEXT NOT NULL,
      goal TEXT,
      prompt_profile_id TEXT,
      config_snapshot_json TEXT,
      asset_ids_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (scope_id) REFERENCES scopes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS run_comparisons (
      id TEXT PRIMARY KEY,
      base_snapshot_id TEXT,
      compare_snapshot_id TEXT,
      base_run_id TEXT,
      compare_run_id TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      diff_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (base_snapshot_id) REFERENCES asset_snapshots(id) ON DELETE SET NULL,
      FOREIGN KEY (compare_snapshot_id) REFERENCES asset_snapshots(id) ON DELETE SET NULL,
      FOREIGN KEY (base_run_id) REFERENCES runs(id) ON DELETE SET NULL,
      FOREIGN KEY (compare_run_id) REFERENCES runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
    CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_scope ON runs(scope_id);
    CREATE INDEX IF NOT EXISTS idx_scopes_archived ON scopes(archived_at);
    CREATE INDEX IF NOT EXISTS idx_prompt_fragments_profile ON prompt_fragments(profile_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_fragments_kind ON prompt_fragments(kind);
    CREATE INDEX IF NOT EXISTS idx_trace_events_run_seq ON trace_events(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
    CREATE INDEX IF NOT EXISTS idx_assets_archived ON assets(archived_at);
    CREATE INDEX IF NOT EXISTS idx_asset_addresses_asset ON asset_addresses(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_addresses_value ON asset_addresses(value);
    CREATE INDEX IF NOT EXISTS idx_asset_services_asset ON asset_services(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_tags_asset ON asset_tags(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_findings_asset ON findings(asset_id);
    CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
    CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);
    CREATE INDEX IF NOT EXISTS idx_asset_snapshots_asset ON asset_snapshots(asset_id);
    CREATE INDEX IF NOT EXISTS idx_run_templates_source ON run_templates(source_run_id);

    CREATE TABLE IF NOT EXISTS install_requests (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      tool_ids_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      note TEXT,
      result_json TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME,
      completed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_install_requests_status ON install_requests(status);

    -- ─── Goal Context (v0) ─────────────────────────────────────────────
    -- A flat "what we're working toward in this chat" pointer + progress
    -- notes the agent files itself. See docs/plans/2026-05-20-phantom-
    -- goal-prompt.md for the prompt-level surface. Distinct from the
    -- Campaign engine below — goals here are an ad-hoc context primitive,
    -- not the governed multi-run supervisor.
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      success_criteria TEXT NOT NULL,
      scope_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      satisfied_at DATETIME,
      satisfaction_claim_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      metadata_json TEXT,
      FOREIGN KEY (scope_id) REFERENCES scopes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS goal_progress (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      run_id TEXT,
      note TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'step',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_goals_status        ON goals(status);
    CREATE INDEX IF NOT EXISTS idx_goals_scope         ON goals(scope_id);
    CREATE INDEX IF NOT EXISTS idx_goal_progress_goal  ON goal_progress(goal_id);
    CREATE INDEX IF NOT EXISTS idx_goal_progress_run   ON goal_progress(run_id);

    -- ─── Campaign engine (v1) ──────────────────────────────────────────
    -- A campaign is a governed multi-run security objective. It owns a
    -- queue of child goals; each goal spawns one or more PHANTOM runs
    -- via a worker_backend (phantom-native | codex-exec | codex-goal-
    -- experimental). Evaluator decides next state after every run. See
    -- docs/plans/2026-05-20-phantom-goal-engine-plan.md.
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      scope_id TEXT,
      prompt_profile_id TEXT,
      toolpack_ids_json TEXT,
      worker_backend TEXT NOT NULL DEFAULT 'phantom-native',
      risk_budget_json TEXT,
      run_budget_json TEXT,
      notification_policy_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      ended_at DATETIME,
      FOREIGN KEY (scope_id) REFERENCES scopes(id) ON DELETE SET NULL,
      FOREIGN KEY (prompt_profile_id) REFERENCES prompt_profiles(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_goals (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      parent_goal_id TEXT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      priority INTEGER DEFAULT 0,
      attempt_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 2,
      completion_criteria_json TEXT,
      evaluator_result_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      ended_at DATETIME,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_goal_id) REFERENCES campaign_goals(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_goal_runs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      worker_backend TEXT NOT NULL DEFAULT 'phantom-native',
      status TEXT NOT NULL DEFAULT 'spawned',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (goal_id) REFERENCES campaign_goals(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_campaigns_status            ON campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_campaigns_scope             ON campaigns(scope_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_goals_campaign     ON campaign_goals(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_goals_status       ON campaign_goals(status);
    CREATE INDEX IF NOT EXISTS idx_campaign_goals_parent       ON campaign_goals(parent_goal_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_goal_runs_campaign ON campaign_goal_runs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_goal_runs_goal     ON campaign_goal_runs(goal_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_goal_runs_run      ON campaign_goal_runs(run_id);
  `);

  ensureColumn('runs', 'prompt_snapshot_json', 'TEXT');
  // Phase 4 goal engine: links a run to the active goal it was launched
  // under so synthesis-time progress can be attributed cleanly.
  ensureColumn('runs', 'goal_id', 'TEXT');

  // Scope-policy expansion (action_modes, time windows, rate caps, ROE).
  // These are additive — existing scopes continue working with their
  // allowed_actions/blocked_actions columns; the new fields take precedence
  // only when populated.
  ensureColumn('scopes', 'action_modes_json', 'TEXT');
  ensureColumn('scopes', 'active_hours_json', 'TEXT');
  ensureColumn('scopes', 'blackout_windows_json', 'TEXT');
  ensureColumn('scopes', 'rate_caps_json', 'TEXT');
  ensureColumn('scopes', 'rules_of_engagement', 'TEXT');

  // A3 — Approval explainability: high|crit denials persist a free-text
  // reason. Additive column on install_requests; future approval types
  // (registry imports, elevated commands) will reuse the same column when
  // their record stores land.
  ensureColumn('install_requests', 'denial_reason', 'TEXT');

  // A7 — Findings triage workflow. triage_status moves through
  // new → acknowledged → in_progress → dismissed → closed. Distinct
  // from `status` (which keeps its open/closed lifecycle); triage is
  // the operator's queue position. dismissal_note is required for
  // dismissing high|crit severities (enforced at the route layer).
  ensureColumn('findings', 'triage_status', 'TEXT');
  ensureColumn('findings', 'dismissal_note', 'TEXT');

  // B3-full — Hosted registry sources. Operator-managed list of remote
  // registry URLs PHANTOM may fetch signed manifests from. Each source
  // has a pinned ed25519 trust root (base64-encoded raw 32-byte public
  // key) — without it, fetched manifests are treated as unsigned. New
  // sources land disabled by default; the operator must explicitly
  // enable browsing.
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_sources (
      id              TEXT PRIMARY KEY,
      label           TEXT NOT NULL,
      url             TEXT NOT NULL UNIQUE,
      channel         TEXT NOT NULL DEFAULT 'stable',
      signing_key     TEXT,
      signing_key_id  TEXT,
      enabled         INTEGER NOT NULL DEFAULT 0,
      last_fetched_at TEXT,
      last_status     TEXT,
      last_error      TEXT,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_registry_sources_enabled ON registry_sources(enabled);
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
function normalizeScopeSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    expires_at: row.expires_at,
    archived_at: row.archived_at,
  };
}

function redactSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot || null;
  const clone = JSON.parse(JSON.stringify(snapshot));
  if (clone.scope) delete clone.scope.credential_refs;
  if (clone.scope?.credentialRefs) delete clone.scope.credentialRefs;
  return clone;
}

function normalizeRun(row) {
  if (!row) return null;
  const normalized = {
    ...row,
    prompt_snapshot: row.prompt_snapshot_json ? redactSnapshot(parseJSONField(row.prompt_snapshot_json)) : null,
  };
  delete normalized.prompt_snapshot_json;
  if (row.scope_id) {
    try {
      normalized.scope = normalizeScopeSummary(getDB().prepare('SELECT id, name, expires_at, archived_at FROM scopes WHERE id = ?').get(row.scope_id));
    } catch {
      normalized.scope = null;
    }
  } else {
    normalized.scope = null;
  }
  return normalized;
}

export function createRun({ conversationId, title, goal, model, providerRoute, scopeId = null, riskLevel = 'unknown', promptSnapshot = null }) {
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO runs (id, conversation_id, title, goal, status, model, provider_route, scope_id, risk_level, prompt_snapshot_json)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`
  ).run(
    id,
    conversationId,
    title || (goal ? goal.substring(0, 80) : 'New Run'),
    goal || null,
    model || null,
    providerRoute || null,
    scopeId || null,
    riskLevel || 'unknown',
    promptSnapshot ? JSON.stringify(promptSnapshot) : null
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

// ─── Approval audit queries ────────────────────────────────────────────────
//
// Reconstructs the approval log from the trace_events table — no new table
// needed since every approval/denial/override is already persisted. The
// "decision" field is derived from the event type so the UI doesn't have
// to know about the underlying trace vocabulary.
const APPROVAL_EVENT_TYPES = [
  'tool.call.approval.granted',
  'tool.call.approval.denied',
  'tool.call.allow-once',
  'tool.call.override',
];

function decisionForEvent(event) {
  if (event.type === 'tool.call.approval.granted') {
    return event.metadata?.kind === 'allow-once' ? 'allow-once' : 'granted';
  }
  if (event.type === 'tool.call.approval.denied') {
    // Timeout note is set server-side when the 5-min timer fires.
    return /timed out/i.test(event.metadata?.approval?.note || '') ? 'timeout' : 'denied';
  }
  if (event.type === 'tool.call.allow-once') return 'allow-once';
  if (event.type === 'tool.call.override') return 'override';
  return 'unknown';
}

function normalizeApprovalEvent(row) {
  const event = normalizeTraceEvent(row);
  if (!event) return null;
  const metadata = event.metadata || {};
  const decision = decisionForEvent(event);
  return {
    id: event.id,
    runId: event.run_id,
    seq: event.seq,
    type: event.type,
    decision,
    kind: metadata.kind || (event.type === 'tool.call.override' ? 'override' : null),
    risk: metadata.risk || metadata.decision?.risk || 'unknown',
    gate: metadata.gate || metadata.decision?.gate || null,
    reason: metadata.decision?.reason || event.output_preview || '',
    operatorNote: metadata.approval?.note || null,
    toolName: event.tool_name,
    args: event.input || null,
    scopeId: metadata.scopeId || metadata.decision?.scopeId || null,
    policyMode: metadata.policyMode || metadata.decision?.policyMode || null,
    toolCallId: metadata.toolCallId || null,
    occurredAt: event.started_at,
    durationMs: event.duration_ms || null,
    // Scope name is filled in by the route handler via a join.
    scopeName: null,
    runTitle: null,
  };
}

/**
 * Query approval events with optional filters. Decisions:
 *   'granted'    — operator approved an ask-gate
 *   'denied'     — operator denied an ask-gate or allow-once card
 *   'allow-once' — operator granted a one-time exception to an implicit deny
 *   'override'   — Operator Override bypassed the gate
 *   'timeout'    — the 5-minute approval window expired
 */
export function getApprovalEvents({
  limit = 100,
  decision = null,
  risk = null,
  scopeId = null,
  toolName = null,
  since = null,
} = {}) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 1000));
  const placeholders = APPROVAL_EVENT_TYPES.map(() => '?').join(',');
  const params = [...APPROVAL_EVENT_TYPES];
  const where = [`type IN (${placeholders})`];
  if (since) {
    where.push('started_at >= ?');
    params.push(since);
  }
  if (toolName) {
    where.push('tool_name = ?');
    params.push(toolName);
  }
  const sql = `SELECT * FROM trace_events WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT ?`;
  params.push(safeLimit * 4); // overshoot since some filters apply post-load
  const rows = getDB().prepare(sql).all(...params).map(normalizeApprovalEvent).filter(Boolean);

  // Post-filter by derived fields (decision, risk, scopeId — these live in
  // metadata JSON so we can't push them into the WHERE cheaply).
  const filtered = rows.filter((row) => {
    if (decision && row.decision !== decision) return false;
    if (risk && row.risk !== risk) return false;
    if (scopeId && row.scopeId !== scopeId) return false;
    return true;
  }).slice(0, safeLimit);

  // Join scope name and run title.
  const scopeIds = [...new Set(filtered.map((r) => r.scopeId).filter(Boolean))];
  const runIds = [...new Set(filtered.map((r) => r.runId).filter(Boolean))];
  const scopeNames = {};
  const runTitles = {};
  if (scopeIds.length) {
    const sPh = scopeIds.map(() => '?').join(',');
    for (const s of getDB().prepare(`SELECT id, name FROM scopes WHERE id IN (${sPh})`).all(...scopeIds)) {
      scopeNames[s.id] = s.name;
    }
  }
  if (runIds.length) {
    const rPh = runIds.map(() => '?').join(',');
    for (const r of getDB().prepare(`SELECT id, title, conversation_id FROM runs WHERE id IN (${rPh})`).all(...runIds)) {
      runTitles[r.id] = { title: r.title, conversationId: r.conversation_id };
    }
  }
  return filtered.map((row) => ({
    ...row,
    scopeName: scopeNames[row.scopeId] || null,
    runTitle: runTitles[row.runId]?.title || null,
    conversationId: runTitles[row.runId]?.conversationId || null,
  }));
}

/**
 * Aggregate approval stats for the dashboard KPI strip.
 * Counts events grouped by decision and by risk; also returns the most
 * recent 14 days as a sparkline series.
 */
export function getApprovalStats({ since = null } = {}) {
  const placeholders = APPROVAL_EVENT_TYPES.map(() => '?').join(',');
  const params = [...APPROVAL_EVENT_TYPES];
  const where = [`type IN (${placeholders})`];
  if (since) { where.push('started_at >= ?'); params.push(since); }
  const sql = `SELECT * FROM trace_events WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT 5000`;
  const rows = getDB().prepare(sql).all(...params).map(normalizeApprovalEvent).filter(Boolean);

  const byDecision = { granted: 0, denied: 0, 'allow-once': 0, override: 0, timeout: 0 };
  const byRisk = {};
  const byDay = {};
  for (const row of rows) {
    byDecision[row.decision] = (byDecision[row.decision] || 0) + 1;
    if (row.risk) byRisk[row.risk] = (byRisk[row.risk] || 0) + 1;
    const day = String(row.occurredAt || '').slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;
  }

  // Last 14 days as a flat series (oldest first).
  const series = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, count: byDay[key] || 0 });
  }

  return {
    total: rows.length,
    byDecision,
    byRisk,
    series,
  };
}

// ─── Artifacts ───
function normalizeArtifact(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: parseJSONField(row.metadata_json) || {},
  };
}

export function createArtifact({
  runId,
  conversationId = null,
  type,
  title,
  mimeType,
  path,
  metadata = {},
  publishedAt = null,
}) {
  if (!runId) throw new Error('runId is required');
  if (!type) throw new Error('artifact type is required');
  if (!path) throw new Error('artifact path is required');

  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO artifacts (id, run_id, conversation_id, type, title, mime_type, path, metadata_json, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    runId,
    conversationId,
    type,
    title || 'Untitled Artifact',
    mimeType || 'application/octet-stream',
    path,
    JSON.stringify(metadata || {}),
    publishedAt
  );
  return getArtifact(id);
}

export function getArtifact(id) {
  return normalizeArtifact(getDB().prepare('SELECT * FROM artifacts WHERE id = ?').get(id));
}

export function getArtifacts({ limit = 100, runId = null, conversationId = null, type = null } = {}) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
  let sql = 'SELECT * FROM artifacts';
  const params = [];
  const where = [];
  if (runId) {
    where.push('run_id = ?');
    params.push(runId);
  }
  if (conversationId) {
    where.push('conversation_id = ?');
    params.push(conversationId);
  }
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(safeLimit);
  return getDB().prepare(sql).all(...params).map(normalizeArtifact);
}

export function getArtifactsForRun(runId, options = {}) {
  return getArtifacts({ ...options, runId });
}

// ─── Install requests ─────────────────────────────────────────────────────
// Approval-gated install requests for the sec-ops installer. Stores the
// resolved plan so the approval card can re-display it verbatim, and the
// captured result (stdout/stderr/exit) so post-hoc audits can replay what
// actually happened.
function normalizeInstallRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    toolIds: parseJSONField(row.tool_ids_json) || [],
    plan: parseJSONField(row.plan_json) || [],
    note: row.note || '',
    result: parseJSONField(row.result_json) || null,
    requested_at: row.requested_at,
    decided_at: row.decided_at,
    completed_at: row.completed_at,
    // A3 — persisted operator reason for high|crit denials.
    denial_reason: row.denial_reason || null,
  };
}

export function createInstallRequest({ toolIds, plan, note = '' }) {
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO install_requests (id, status, tool_ids_json, plan_json, note)
     VALUES (?, 'pending', ?, ?, ?)`
  ).run(id, JSON.stringify(toolIds || []), JSON.stringify(plan || []), note || null);
  return getInstallRequest(id);
}

export function getInstallRequest(id) {
  return normalizeInstallRequest(getDB().prepare('SELECT * FROM install_requests WHERE id = ?').get(id));
}

export function getInstallRequests({ status = null, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
  let sql = 'SELECT * FROM install_requests';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY requested_at DESC LIMIT ?';
  params.push(safeLimit);
  return getDB().prepare(sql).all(...params).map(normalizeInstallRequest);
}

export function updateInstallRequest(id, { status = null, result = null, decidedAt = null, completedAt = null, denialReason = null }) {
  const fields = [];
  const params = [];
  if (status) { fields.push('status = ?'); params.push(status); }
  if (result !== null) { fields.push('result_json = ?'); params.push(JSON.stringify(result)); }
  if (decidedAt) { fields.push('decided_at = ?'); params.push(decidedAt); }
  if (completedAt) { fields.push('completed_at = ?'); params.push(completedAt); }
  if (denialReason !== null) { fields.push('denial_reason = ?'); params.push(denialReason || null); }
  if (!fields.length) return getInstallRequest(id);
  params.push(id);
  getDB().prepare(`UPDATE install_requests SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getInstallRequest(id);
}

export function closeDB() {
  if (db) db.close();
  db = null;
}
