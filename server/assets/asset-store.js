import { v4 as uuidv4 } from 'uuid';
import { getDB, getRun, createRun, addTraceEvent } from '../memory/store.js';

function parseJSON(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function json(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function redactCredentialRefs(refs = []) {
  return array(refs).map(() => '[REDACTED]');
}

function redactSnapshot(value) {
  if (!value || typeof value !== 'object') return value || null;
  const clone = JSON.parse(JSON.stringify(value));
  if (clone.scope?.credential_refs) delete clone.scope.credential_refs;
  if (clone.scope?.credentialRefs) delete clone.scope.credentialRefs;
  if (clone.credential_refs) clone.credential_refs = redactCredentialRefs(clone.credential_refs);
  if (clone.credentialRefs) clone.credentialRefs = redactCredentialRefs(clone.credentialRefs);
  return clone;
}

function normalizeAddress(row) {
  if (!row) return null;
  return { id: row.id, assetId: row.asset_id, kind: row.kind, value: row.value, label: row.label, created_at: row.created_at };
}

function normalizeService(row) {
  if (!row) return null;
  return {
    id: row.id,
    assetId: row.asset_id,
    name: row.name,
    protocol: row.protocol,
    port: row.port,
    url: row.url,
    status: row.status,
    metadata: parseJSON(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getAssetAddresses(assetId) {
  return getDB().prepare('SELECT * FROM asset_addresses WHERE asset_id = ? ORDER BY kind, value').all(assetId).map(normalizeAddress);
}

function getAssetServices(assetId) {
  return getDB().prepare('SELECT * FROM asset_services WHERE asset_id = ? ORDER BY port, name').all(assetId).map(normalizeService);
}

function getAssetTags(assetId) {
  return getDB().prepare('SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag').all(assetId).map(row => row.tag);
}

function normalizeAsset(row, { redacted = true } = {}) {
  if (!row) return null;
  const credentialRefs = parseJSON(row.credential_refs_json, []);
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description || '',
    owner: row.owner || '',
    environment: row.environment || '',
    status: row.status || 'active',
    criticality: row.criticality || 'medium',
    notes: row.notes || '',
    credentialRefs: redacted ? redactCredentialRefs(credentialRefs) : credentialRefs,
    metadata: parseJSON(row.metadata_json, {}),
    addresses: getAssetAddresses(row.id),
    services: getAssetServices(row.id),
    tags: getAssetTags(row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

function replaceAddresses(assetId, addresses = []) {
  getDB().prepare('DELETE FROM asset_addresses WHERE asset_id = ?').run(assetId);
  const stmt = getDB().prepare('INSERT INTO asset_addresses (id, asset_id, kind, value, label) VALUES (?, ?, ?, ?, ?)');
  for (const address of array(addresses)) {
    if (!address?.value) continue;
    stmt.run(uuidv4(), assetId, address.kind || 'host', String(address.value).trim(), address.label || null);
  }
}

function replaceServices(assetId, services = []) {
  getDB().prepare('DELETE FROM asset_services WHERE asset_id = ?').run(assetId);
  const stmt = getDB().prepare('INSERT INTO asset_services (id, asset_id, name, protocol, port, url, status, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const service of array(services)) {
    if (!service?.name && !service?.port && !service?.url) continue;
    stmt.run(
      uuidv4(),
      assetId,
      service.name || null,
      service.protocol || null,
      service.port === undefined || service.port === '' ? null : Number(service.port),
      service.url || null,
      service.status || 'unknown',
      json(service.metadata, {})
    );
  }
}

function replaceTags(assetId, tags = []) {
  getDB().prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(assetId);
  const stmt = getDB().prepare('INSERT INTO asset_tags (id, asset_id, tag) VALUES (?, ?, ?)');
  const seen = new Set();
  for (const rawTag of array(tags)) {
    const tag = String(rawTag).trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    stmt.run(uuidv4(), assetId, tag);
  }
}

export function createAsset({
  type = 'device',
  name,
  description = '',
  owner = '',
  environment = '',
  status = 'active',
  criticality = 'medium',
  notes = '',
  credentialRefs = [],
  metadata = {},
  addresses = [],
  services = [],
  tags = [],
} = {}) {
  if (!name || !String(name).trim()) throw new Error('asset name is required');
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO assets (id, type, name, description, owner, environment, status, criticality, notes, credential_refs_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, type, String(name).trim(), description || null, owner || null, environment || null, status, criticality, notes || null, json(redactCredentialRefs(credentialRefs), []), json(metadata, {}));
  replaceAddresses(id, addresses);
  replaceServices(id, services);
  replaceTags(id, tags);
  return getAsset(id);
}

export function getAsset(id, options = {}) {
  return normalizeAsset(getDB().prepare('SELECT * FROM assets WHERE id = ?').get(id), options);
}

export function getAssets({ includeArchived = false, query = '', type = null, tag = null, limit = 100 } = {}) {
  const params = [];
  const where = [];
  if (!includeArchived) where.push('a.archived_at IS NULL');
  if (type) { where.push('a.type = ?'); params.push(type); }
  if (query) {
    const q = `%${String(query).toLowerCase()}%`;
    where.push("(LOWER(a.name) LIKE ? OR LOWER(COALESCE(a.description, '')) LIKE ? OR LOWER(COALESCE(a.owner, '')) LIKE ? OR LOWER(COALESCE(a.environment, '')) LIKE ?)");
    params.push(q, q, q, q);
  }
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag = ?)');
    params.push(String(tag).toLowerCase());
  }
  let sql = 'SELECT a.* FROM assets a';
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY a.updated_at DESC, a.created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(parseInt(limit, 10) || 100, 500)));
  return getDB().prepare(sql).all(...params).map(row => normalizeAsset(row));
}

export function updateAsset(id, updates = {}) {
  const current = getAsset(id, { redacted: false });
  if (!current) return null;
  const next = {
    type: updates.type ?? current.type,
    name: updates.name !== undefined ? String(updates.name).trim() : current.name,
    description: updates.description ?? current.description,
    owner: updates.owner ?? current.owner,
    environment: updates.environment ?? current.environment,
    status: updates.status ?? current.status,
    criticality: updates.criticality ?? current.criticality,
    notes: updates.notes ?? current.notes,
    credentialRefs: updates.credentialRefs ?? current.credentialRefs,
    metadata: updates.metadata ?? current.metadata,
  };
  if (!next.name) throw new Error('asset name is required');
  getDB().prepare(
    `UPDATE assets SET type = ?, name = ?, description = ?, owner = ?, environment = ?, status = ?, criticality = ?, notes = ?, credential_refs_json = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(next.type, next.name, next.description || null, next.owner || null, next.environment || null, next.status, next.criticality, next.notes || null, json(redactCredentialRefs(next.credentialRefs), []), json(next.metadata, {}), id);
  if (updates.addresses !== undefined) replaceAddresses(id, updates.addresses);
  if (updates.services !== undefined) replaceServices(id, updates.services);
  if (updates.tags !== undefined) replaceTags(id, updates.tags);
  return getAsset(id);
}

export function archiveAsset(id) {
  getDB().prepare('UPDATE assets SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  return getAsset(id);
}

function normalizeFinding(row) {
  if (!row) return null;
  return {
    id: row.id,
    assetId: row.asset_id,
    serviceId: row.service_id,
    runId: row.run_id,
    traceEventId: row.trace_event_id,
    scopeId: row.scope_id,
    title: row.title,
    severity: row.severity,
    status: row.status,
    description: row.description || '',
    evidence: row.evidence || '',
    recommendation: row.recommendation || '',
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    fixed_at: row.fixed_at,
    metadata: parseJSON(row.metadata_json, {}),
  };
}

export function createFinding({ assetId = null, serviceId = null, runId = null, traceEventId = null, scopeId = null, title, severity = 'low', status = 'open', description = '', evidence = '', recommendation = '', firstSeenAt = null, lastSeenAt = null, fixedAt = null, metadata = {} } = {}) {
  if (!title || !String(title).trim()) throw new Error('finding title is required');
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO findings (id, asset_id, service_id, run_id, trace_event_id, scope_id, title, severity, status, description, evidence, recommendation, first_seen_at, last_seen_at, fixed_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`
  ).run(id, assetId, serviceId, runId, traceEventId, scopeId, String(title).trim(), severity, status, description || null, evidence || null, recommendation || null, firstSeenAt, lastSeenAt, fixedAt, json(metadata, {}));
  return getFinding(id);
}

export function getFinding(id) {
  return normalizeFinding(getDB().prepare('SELECT * FROM findings WHERE id = ?').get(id));
}

export function getFindings({ assetId = null, runId = null, status = null, severity = null, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (assetId) { where.push('asset_id = ?'); params.push(assetId); }
  if (runId) { where.push('run_id = ?'); params.push(runId); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (severity) { where.push('severity = ?'); params.push(severity); }
  let sql = 'SELECT * FROM findings';
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY last_seen_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(parseInt(limit, 10) || 100, 500)));
  return getDB().prepare(sql).all(...params).map(normalizeFinding);
}

export function updateFinding(id, updates = {}) {
  const current = getFinding(id);
  if (!current) return null;
  const next = {
    severity: updates.severity ?? current.severity,
    status: updates.status ?? current.status,
    title: updates.title ?? current.title,
    description: updates.description ?? current.description,
    evidence: updates.evidence ?? current.evidence,
    recommendation: updates.recommendation ?? current.recommendation,
    fixedAt: updates.fixedAt !== undefined ? updates.fixedAt : current.fixed_at,
    metadata: updates.metadata ?? current.metadata,
  };
  getDB().prepare(
    `UPDATE findings SET title = ?, severity = ?, status = ?, description = ?, evidence = ?, recommendation = ?, fixed_at = ?, metadata_json = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(next.title, next.severity, next.status, next.description || null, next.evidence || null, next.recommendation || null, next.fixedAt || null, json(next.metadata, {}), id);
  return getFinding(id);
}

function normalizeSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    assetId: row.asset_id,
    scopeId: row.scope_id,
    runId: row.run_id,
    title: row.title,
    status: row.status,
    healthScore: row.health_score,
    summary: row.summary || '',
    observations: parseJSON(row.observations_json, {}),
    findingCounts: parseJSON(row.finding_counts_json, {}),
    artifactIds: parseJSON(row.artifact_ids_json, []),
    captured_at: row.captured_at,
  };
}

export function createAssetSnapshot({ assetId, scopeId = null, runId = null, title = 'Asset snapshot', status = 'unknown', healthScore = null, summary = '', observations = {}, findingCounts = {}, artifactIds = [], capturedAt = null } = {}) {
  if (!assetId) throw new Error('assetId is required');
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO asset_snapshots (id, asset_id, scope_id, run_id, title, status, health_score, summary, observations_json, finding_counts_json, artifact_ids_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`
  ).run(id, assetId, scopeId, runId, title, status, healthScore === null || healthScore === undefined ? null : Number(healthScore), summary || null, json(observations, {}), json(findingCounts, {}), json(artifactIds, []), capturedAt);
  return getAssetSnapshot(id);
}

export function getAssetSnapshot(id) {
  return normalizeSnapshot(getDB().prepare('SELECT * FROM asset_snapshots WHERE id = ?').get(id));
}

export function getAssetSnapshots({ assetId = null, scopeId = null, runId = null, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (assetId) { where.push('asset_id = ?'); params.push(assetId); }
  if (scopeId) { where.push('scope_id = ?'); params.push(scopeId); }
  if (runId) { where.push('run_id = ?'); params.push(runId); }
  let sql = 'SELECT * FROM asset_snapshots';
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY captured_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(parseInt(limit, 10) || 100, 500)));
  return getDB().prepare(sql).all(...params).map(normalizeSnapshot);
}

function normalizeRunTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    source_run_id: row.source_run_id,
    scope_id: row.scope_id,
    name: row.name,
    goal: row.goal || '',
    promptProfileId: row.prompt_profile_id,
    configSnapshot: redactSnapshot(parseJSON(row.config_snapshot_json, {})),
    assetIds: parseJSON(row.asset_ids_json, []),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createRunTemplateFromRun(sourceRunId, { name = null, assetIds = [], goal = null, promptProfileId = null, configSnapshot = null } = {}) {
  const sourceRun = getRun(sourceRunId);
  if (!sourceRun) throw new Error('source run not found');
  const id = uuidv4();
  const snapshot = redactSnapshot(configSnapshot || sourceRun.prompt_snapshot || {});
  getDB().prepare(
    `INSERT INTO run_templates (id, source_run_id, scope_id, name, goal, prompt_profile_id, config_snapshot_json, asset_ids_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sourceRun.id, sourceRun.scope_id || null, name || `Rerun ${sourceRun.title || sourceRun.id}`, goal || sourceRun.goal || sourceRun.title || '', promptProfileId || snapshot?.profile?.id || null, json(snapshot, {}), json(assetIds, []));
  return getRunTemplate(id);
}

export function getRunTemplate(id) {
  return normalizeRunTemplate(getDB().prepare('SELECT * FROM run_templates WHERE id = ?').get(id));
}

export function getRunTemplates({ sourceRunId = null, limit = 100 } = {}) {
  const params = [];
  let sql = 'SELECT * FROM run_templates';
  if (sourceRunId) { sql += ' WHERE source_run_id = ?'; params.push(sourceRunId); }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(parseInt(limit, 10) || 100, 500)));
  return getDB().prepare(sql).all(...params).map(normalizeRunTemplate);
}

export function materializeRunFromTemplate(templateId, { conversationId, title = null, goal = null, model = null, providerRoute = null } = {}) {
  const template = getRunTemplate(templateId);
  if (!template) throw new Error('run template not found');
  if (!conversationId) throw new Error('conversationId is required');
  const sourceRun = getRun(template.source_run_id);
  const run = createRun({
    conversationId,
    title: title || `Rerun: ${template.name}`,
    goal: goal || `Rerun after mitigation: ${template.goal}`,
    model: model || sourceRun?.model || null,
    providerRoute: providerRoute || sourceRun?.provider_route || null,
    scopeId: template.scope_id || null,
    promptSnapshot: template.configSnapshot || null,
  });
  addTraceEvent(run.id, {
    type: 'run.rerun.created',
    phase: 'planning',
    status: 'completed',
    outputPreview: `Created from template ${template.name}; policy will be re-evaluated before tool execution.`,
    metadata: { templateId: template.id, sourceRunId: template.source_run_id, assetIds: template.assetIds },
  });
  return run;
}

function countValue(snapshot, key) {
  return Number(snapshot.findingCounts?.[key] || 0);
}

function arrayDelta(before = [], after = []) {
  const b = new Set(before.map(String));
  const a = new Set(after.map(String));
  return {
    added: [...a].filter(item => !b.has(item)),
    removed: [...b].filter(item => !a.has(item)),
    unchanged: [...a].filter(item => b.has(item)),
  };
}

function diffSnapshots(base, compare) {
  const basePorts = array(base.observations?.ports);
  const comparePorts = array(compare.observations?.ports);
  const resolvedFindings = Math.max(0, countValue(base, 'open') - countValue(compare, 'open'));
  const addedFindings = Math.max(0, countValue(compare, 'open') - countValue(base, 'open'));
  return {
    healthDelta: (compare.healthScore ?? 0) - (base.healthScore ?? 0),
    statusChanged: base.status !== compare.status,
    beforeStatus: base.status,
    afterStatus: compare.status,
    resolvedFindings,
    addedFindings,
    unchangedOpenFindings: Math.min(countValue(base, 'open'), countValue(compare, 'open')),
    ports: arrayDelta(basePorts, comparePorts),
    artifacts: arrayDelta(base.artifactIds, compare.artifactIds),
  };
}

function normalizeComparison(row) {
  if (!row) return null;
  return {
    id: row.id,
    baseSnapshotId: row.base_snapshot_id,
    compareSnapshotId: row.compare_snapshot_id,
    baseRunId: row.base_run_id,
    compareRunId: row.compare_run_id,
    title: row.title,
    summary: row.summary || '',
    diff: parseJSON(row.diff_json, {}),
    created_at: row.created_at,
  };
}

export function compareAssetSnapshots({ baseSnapshotId, compareSnapshotId, title = 'Snapshot comparison' } = {}) {
  const base = getAssetSnapshot(baseSnapshotId);
  const compare = getAssetSnapshot(compareSnapshotId);
  if (!base || !compare) throw new Error('both snapshots are required');
  const diff = diffSnapshots(base, compare);
  const direction = diff.healthDelta >= 0 ? '+' : '';
  const summary = `Asset health ${direction}${diff.healthDelta}; resolved ${diff.resolvedFindings}; added ${diff.addedFindings}; status ${base.status} → ${compare.status}.`;
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO run_comparisons (id, base_snapshot_id, compare_snapshot_id, base_run_id, compare_run_id, title, summary, diff_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, base.id, compare.id, base.runId || null, compare.runId || null, title, summary, json(diff, {}));
  return getRunComparison(id);
}

export function getRunComparison(id) {
  return normalizeComparison(getDB().prepare('SELECT * FROM run_comparisons WHERE id = ?').get(id));
}

export function getRunComparisons({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
  return getDB().prepare('SELECT * FROM run_comparisons ORDER BY created_at DESC LIMIT ?').all(safeLimit).map(normalizeComparison);
}

export function extractAssetTargets(assetIds = []) {
  const ids = array(assetIds).filter(Boolean);
  if (!ids.length) return { hosts: [], domains: [], cidrs: [], urls: [] };
  const targets = { hosts: [], domains: [], cidrs: [], urls: [] };
  for (const id of ids) {
    const asset = getAsset(id);
    if (!asset) continue;
    for (const address of asset.addresses) {
      if (address.kind === 'cidr') targets.cidrs.push(address.value);
      else if (address.kind === 'url') targets.urls.push(address.value);
      else if (address.kind === 'domain') targets.domains.push(address.value);
      else targets.hosts.push(address.value);
    }
    for (const service of asset.services) {
      if (service.url) targets.urls.push(service.url);
      if (service.port) {
        for (const address of asset.addresses) {
          if (['ip', 'host', 'hostname', 'domain'].includes(address.kind)) targets.hosts.push(`${address.value}:${service.port}`);
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(targets).map(([key, values]) => [key, [...new Set(values)]]));
}
