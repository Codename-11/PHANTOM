import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../memory/store.js';
import { getScope } from '../scope/scope-store.js';
import { buildToolpackPrompt, getToolpack, normalizeToolpackIds } from '../toolpacks/toolpack-registry.js';

const ORDER = { base: 10, mode: 20, scope: 30, policy: 40, tools: 50, custom: 60 };

function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    mode: row.mode || 'general',
    is_default: !!row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeFragment(row) {
  if (!row) return null;
  return {
    id: row.id,
    profile_id: row.profile_id,
    kind: row.kind,
    name: row.name,
    body: row.body,
    enabled: !!row.enabled,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createPromptProfile({ name, description = '', mode = 'general', isDefault = false }) {
  if (!name || !String(name).trim()) throw new Error('profile name is required');
  const id = uuidv4();
  const db = getDB();
  if (isDefault) db.prepare('UPDATE prompt_profiles SET is_default = 0').run();
  db.prepare(
    'INSERT INTO prompt_profiles (id, name, description, mode, is_default) VALUES (?, ?, ?, ?, ?)'
  ).run(id, String(name).trim(), description || null, mode || 'general', isDefault ? 1 : 0);
  return getPromptProfile(id);
}

export function getPromptProfile(id) {
  return normalizeProfile(getDB().prepare('SELECT * FROM prompt_profiles WHERE id = ?').get(id));
}

export function getDefaultPromptProfile() {
  return normalizeProfile(getDB().prepare('SELECT * FROM prompt_profiles WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1').get());
}

export function getPromptProfiles() {
  return getDB().prepare('SELECT * FROM prompt_profiles ORDER BY is_default DESC, updated_at DESC').all().map(normalizeProfile);
}

export function updatePromptProfile(id, updates = {}) {
  const current = getPromptProfile(id);
  if (!current) return null;
  const next = {
    name: updates.name !== undefined ? String(updates.name).trim() : current.name,
    description: updates.description !== undefined ? updates.description : current.description,
    mode: updates.mode !== undefined ? updates.mode : current.mode,
    isDefault: updates.isDefault !== undefined ? !!updates.isDefault : current.is_default,
  };
  if (!next.name) throw new Error('profile name is required');
  const db = getDB();
  if (next.isDefault) db.prepare('UPDATE prompt_profiles SET is_default = 0 WHERE id != ?').run(id);
  db.prepare(
    `UPDATE prompt_profiles
     SET name = ?, description = ?, mode = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(next.name, next.description || null, next.mode || 'general', next.isDefault ? 1 : 0, id);
  return getPromptProfile(id);
}

export function createPromptFragment({ profileId = null, kind, name, body, enabled = true, position = 100 }) {
  if (!kind) throw new Error('fragment kind is required');
  if (!name || !String(name).trim()) throw new Error('fragment name is required');
  const id = uuidv4();
  getDB().prepare(
    `INSERT INTO prompt_fragments (id, profile_id, kind, name, body, enabled, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, profileId || null, kind, String(name).trim(), body || '', enabled ? 1 : 0, Number(position) || 100);
  return getPromptFragment(id);
}

export function getPromptFragment(id) {
  return normalizeFragment(getDB().prepare('SELECT * FROM prompt_fragments WHERE id = ?').get(id));
}

export function getPromptFragments({ profileId = undefined, enabled = undefined } = {}) {
  let sql = 'SELECT * FROM prompt_fragments';
  const where = [];
  const params = [];
  if (profileId !== undefined) {
    if (profileId === null) where.push('profile_id IS NULL');
    else { where.push('(profile_id IS NULL OR profile_id = ?)'); params.push(profileId); }
  }
  if (enabled !== undefined) { where.push('enabled = ?'); params.push(enabled ? 1 : 0); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY position ASC, updated_at ASC';
  return getDB().prepare(sql).all(...params).map(normalizeFragment);
}

export function updatePromptFragment(id, updates = {}) {
  const current = getPromptFragment(id);
  if (!current) return null;
  const next = {
    profileId: updates.profileId !== undefined ? updates.profileId : current.profile_id,
    kind: updates.kind !== undefined ? updates.kind : current.kind,
    name: updates.name !== undefined ? String(updates.name).trim() : current.name,
    body: updates.body !== undefined ? updates.body : current.body,
    enabled: updates.enabled !== undefined ? !!updates.enabled : current.enabled,
    position: updates.position !== undefined ? Number(updates.position) : current.position,
  };
  getDB().prepare(
    `UPDATE prompt_fragments
     SET profile_id = ?, kind = ?, name = ?, body = ?, enabled = ?, position = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(next.profileId || null, next.kind, next.name, next.body || '', next.enabled ? 1 : 0, next.position || 100, id);
  return getPromptFragment(id);
}

function scopePrompt(scope) {
  if (!scope) return '';
  const parts = [`## SELECTED SCOPE`, `Scope: ${scope.name}`];
  const targets = scope.targets || {};
  const targetLines = [];
  if (targets.hosts?.length) targetLines.push(`Hosts: ${targets.hosts.join(', ')}`);
  if (targets.domains?.length) targetLines.push(`Domains: ${targets.domains.join(', ')}`);
  if (targets.cidrs?.length) targetLines.push(`CIDRs: ${targets.cidrs.join(', ')}`);
  if (targets.urls?.length) targetLines.push(`URLs: ${targets.urls.join(', ')}`);
  if (targetLines.length) parts.push(targetLines.join('\n'));
  if (scope.notes) parts.push(`Rules of engagement: ${scope.notes}`);
  if (scope.expires_at) parts.push(`Scope expires: ${scope.expires_at}`);
  return parts.join('\n');
}

function fragmentRank(fragment) {
  return (ORDER[fragment.kind] || 90) * 100000 + (fragment.position || 100);
}

export function resolvePrompt({ basePrompt, profileId = null, scopeId = null, toolpackIds = [] } = {}) {
  const profile = profileId ? getPromptProfile(profileId) : getDefaultPromptProfile();
  const scope = scopeId ? getScope(scopeId) : null;
  const selectedToolpackIds = normalizeToolpackIds(toolpackIds);
  const toolpacks = selectedToolpackIds.map(getToolpack).filter(Boolean);
  const toolpackPrompt = buildToolpackPrompt(selectedToolpackIds);
  const fragments = getPromptFragments({ profileId: profile?.id ?? undefined, enabled: true })
    .filter(fragment => !fragment.profile_id || fragment.profile_id === profile?.id)
    .sort((a, b) => fragmentRank(a) - fragmentRank(b));
  const sections = [basePrompt || ''];
  let scopeInserted = false;
  let toolpacksInserted = false;
  const insertToolpacks = () => {
    if (toolpackPrompt && !toolpacksInserted) {
      sections.push(toolpackPrompt);
      toolpacksInserted = true;
    }
  };
  for (const fragment of fragments) {
    if (fragment.kind === 'scope') continue;
    if (fragment.kind === 'custom') insertToolpacks();
    if (fragment.body) sections.push(`## ${fragment.name}\n${fragment.body}`);
    if (fragment.kind === 'mode' && scope) {
      sections.push(scopePrompt(scope));
      scopeInserted = true;
    }
    if (fragment.kind === 'tools') insertToolpacks();
  }
  if (scope && !scopeInserted && !sections.some(section => section.includes('## SELECTED SCOPE'))) sections.push(scopePrompt(scope));
  insertToolpacks();
  const content = sections.filter(Boolean).join('\n\n');
  const snapshot = {
    resolvedPrompt: content,
    profile: profile ? { id: profile.id, name: profile.name, mode: profile.mode, updated_at: profile.updated_at } : null,
    scope: scope ? { id: scope.id, name: scope.name, expires_at: scope.expires_at, targets: scope.targets, notes: scope.notes } : null,
    toolpacks: toolpacks.map(pack => ({ id: pack.id, name: pack.name, risks: pack.risks, allowedActions: pack.allowedActions, blockedByDefault: pack.blockedByDefault })),
    fragmentIds: fragments.map(fragment => fragment.id),
    fragments: fragments.map(fragment => ({ id: fragment.id, name: fragment.name, kind: fragment.kind, updated_at: fragment.updated_at })),
    capturedAt: new Date().toISOString(),
  };
  return { content, profile, scope, toolpacks, fragments, snapshot };
}
