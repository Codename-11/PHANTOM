import { Router } from 'express';
import config, { updateConfig } from '../config.js';
import { resetClient, testConnection, processMessage } from '../ai/llm-client.js';
import {
  createConversation, getConversations, getConversation, deleteConversation,
  updateConversationTitle, getMessages,
  getAllSettings, getSetting, setSetting,
  getAllMemories, searchMemories,
  getMCPServers, addMCPServer, removeMCPServer,
  getRuns, getRun, getTraceEvents,
  getArtifacts, getArtifact, getArtifactsForRun,
} from '../memory/store.js';
import { artifactToPublic } from '../artifacts/renderers.js';
import { writeArtifact, exportEvidenceBundle } from '../artifacts/artifact-store.js';
import { renderExecutiveSummary, renderPentestReport } from '../artifacts/report-renderers.js';
import { deriveRunGraph } from '../graph/graph-derive.js';
import { buildSystemPrompt } from '../ai/system-prompt.js';
import { createScope, getScope, getScopes, updateScope, archiveScope } from '../scope/scope-store.js';
import { evaluateToolAction } from '../scope/policy.js';
import { parseTargetInput, targetsToScopeFields } from '../scope/target-parser.js';
import { getScopeTemplates } from '../scope/templates.js';
import {
  createPromptProfile, getPromptProfiles, getPromptProfile, updatePromptProfile,
  createPromptFragment, getPromptFragments, getPromptFragment, updatePromptFragment,
  resolvePrompt,
} from '../prompts/prompt-store.js';
import { getToolDefinitions } from '../tools/registry.js';
import { getToolpacks, getToolpack, checkToolpackAvailability } from '../toolpacks/toolpack-registry.js';
import { buildRunReplay } from '../runs/replay.js';
import {
  createAsset, getAsset, getAssets, updateAsset, archiveAsset,
  createFinding, getFindings, updateFinding,
  createAssetSnapshot, getAssetSnapshots,
  createRunTemplateFromRun, getRunTemplates, materializeRunFromTemplate,
  compareAssetSnapshots, getRunComparisons,
} from '../assets/asset-store.js';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync, statSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';

const execAsync = promisify(exec);
import { join, basename } from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';

const router = Router();

// Multer for file uploads (skills .zip)
const upload = multer({ dest: '/tmp/phantom-uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Settings ───
router.get('/settings', (req, res) => {
  const settings = getAllSettings();
  res.json({
    baseUrl: settings.api_base_url || config.api.baseUrl,
    apiKey: settings.api_key ? '••••••••' + settings.api_key.slice(-4) : '',
    apiKeySet: !!settings.api_key || !!config.api.apiKey,
    model: settings.api_model || config.api.model,
    temperature: parseFloat(settings.api_temperature || config.api.temperature),
    maxTokens: parseInt(settings.api_max_tokens || config.api.maxTokens),
    workspace: settings.workspace || config.workspace,
    sudoConfigured: !!settings.sudo_password,
  });
});

router.put('/settings', (req, res) => {
  const { baseUrl, apiKey, model, temperature, maxTokens, sudoPassword, workspace } = req.body;

  if (baseUrl) { setSetting('api_base_url', baseUrl); updateConfig({ baseUrl }); }
  if (apiKey && apiKey !== '••••••••') { setSetting('api_key', apiKey); updateConfig({ apiKey }); }
  if (model) { setSetting('api_model', model); updateConfig({ model }); }
  if (temperature !== undefined) { setSetting('api_temperature', String(temperature)); updateConfig({ temperature }); }
  if (maxTokens !== undefined) { setSetting('api_max_tokens', String(maxTokens)); updateConfig({ maxTokens }); }
  if (sudoPassword !== undefined) { setSetting('sudo_password', sudoPassword); }
  if (workspace) { setSetting('workspace', workspace); updateConfig({ workspace }); }

  resetClient();
  res.json({ success: true, message: 'Settings updated' });
});

router.post('/settings/test', async (req, res) => {
  const result = await testConnection();
  res.json(result);
});

// ─── Prompt Preview + Profiles ───
router.get('/prompts/preview', (req, res) => {
  const basePrompt = buildSystemPrompt({ raw: true });
  const toolpackIds = req.query.toolpackIds ? String(req.query.toolpackIds).split(',') : [];
  const resolved = resolvePrompt({ basePrompt, profileId: req.query.profileId || null, scopeId: req.query.scopeId || null, toolpackIds });
  res.json({
    id: resolved.profile?.id || 'system-default',
    mode: resolved.profile?.mode || 'default',
    profile: resolved.profile,
    scope: resolved.scope ? { id: resolved.scope.id, name: resolved.scope.name, expires_at: resolved.scope.expires_at } : null,
    toolpacks: resolved.toolpacks.map(pack => ({ id: pack.id, name: pack.name, summary: pack.summary, risks: pack.risks, defaultLevel: pack.defaultLevel || null, levels: pack.levels || null })),
    fragmentIds: resolved.snapshot.fragmentIds,
    content: resolved.content,
    length: resolved.content.length,
  });
});

router.get('/prompts/profiles', (req, res) => res.json(getPromptProfiles()));
router.post('/prompts/profiles', (req, res) => {
  try { res.json(createPromptProfile(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/prompts/profiles/:id', (req, res) => {
  const profile = updatePromptProfile(req.params.id, req.body || {});
  if (!profile) return res.status(404).json({ error: 'Prompt profile not found' });
  res.json(profile);
});

router.get('/prompts/fragments', (req, res) => {
  res.json(getPromptFragments({
    profileId: req.query.profileId === undefined ? undefined : (req.query.profileId || null),
    enabled: req.query.enabled === undefined ? undefined : req.query.enabled !== 'false',
  }));
});
router.post('/prompts/fragments', (req, res) => {
  try { res.json(createPromptFragment(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/prompts/fragments/:id', (req, res) => {
  const fragment = updatePromptFragment(req.params.id, req.body || {});
  if (!fragment) return res.status(404).json({ error: 'Prompt fragment not found' });
  res.json(fragment);
});

// ─── Scopes ───
router.get('/scopes', (req, res) => {
  res.json(getScopes({ includeArchived: req.query.includeArchived === 'true' }));
});
router.get('/scopes/templates', (req, res) => {
  res.json(getScopeTemplates());
});
router.post('/scopes/parse-targets', (req, res) => {
  const parsed = parseTargetInput(req.body?.input || '');
  res.json({ ...parsed, scopeFields: targetsToScopeFields(parsed.targets) });
});
router.post('/scopes/evaluate-draft', (req, res) => {
  const scope = {
    id: 'draft',
    name: req.body?.scope?.name || 'Draft scope',
    targets: req.body?.scope?.targets || {},
    allowed_actions: req.body?.scope?.allowedActions || req.body?.scope?.allowed_actions || [],
    blocked_actions: req.body?.scope?.blockedActions || req.body?.scope?.blocked_actions || [],
    expires_at: req.body?.scope?.expiresAt || req.body?.scope?.expires_at || null,
  };
  res.json(evaluateToolAction({ toolName: req.body?.toolName || 'execute_command', args: req.body?.args || {}, scope }));
});
router.post('/scopes', (req, res) => {
  try { res.json(createScope(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get('/scopes/:id', (req, res) => {
  const scope = getScope(req.params.id);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  res.json(scope);
});
router.put('/scopes/:id', (req, res) => {
  try {
    const scope = updateScope(req.params.id, req.body || {});
    if (!scope) return res.status(404).json({ error: 'Scope not found' });
    res.json(scope);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.post('/scopes/:id/archive', (req, res) => {
  const scope = archiveScope(req.params.id);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  res.json(scope);
});
router.delete('/scopes/:id', (req, res) => {
  const scope = archiveScope(req.params.id);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  res.json(scope);
});
router.post('/scopes/:id/evaluate', (req, res) => {
  const scope = getScope(req.params.id);
  if (!scope) return res.status(404).json({ error: 'Scope not found' });
  res.json(evaluateToolAction({ toolName: req.body?.toolName, args: req.body?.args || {}, scope }));
});

// ─── Assets, Findings, Baselines, Reruns ───
function assetDetail(asset) {
  if (!asset) return null;
  return {
    ...asset,
    findings: getFindings({ assetId: asset.id, limit: 200 }),
    snapshots: getAssetSnapshots({ assetId: asset.id, limit: 100 }),
  };
}

router.get('/assets', (req, res) => {
  res.json(getAssets({
    includeArchived: req.query.includeArchived === 'true',
    query: req.query.query || '',
    type: req.query.type || null,
    tag: req.query.tag || null,
    limit: req.query.limit || 100,
  }));
});

router.post('/assets', (req, res) => {
  try { res.json(createAsset(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/assets/:id', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(assetDetail(asset));
});

router.put('/assets/:id', (req, res) => {
  try {
    const asset = updateAsset(req.params.id, req.body || {});
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(asset);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/assets/:id/archive', (req, res) => {
  const asset = archiveAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
});
router.delete('/assets/:id', (req, res) => {
  const asset = archiveAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
});

router.get('/assets/:id/snapshots', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(getAssetSnapshots({ assetId: req.params.id, limit: req.query.limit || 100 }));
});
router.post('/assets/:id/snapshots', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  try { res.json(createAssetSnapshot({ ...(req.body || {}), assetId: req.params.id })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/findings', (req, res) => {
  res.json(getFindings({ assetId: req.query.assetId || null, runId: req.query.runId || null, status: req.query.status || null, severity: req.query.severity || null, limit: req.query.limit || 100 }));
});
router.post('/findings', (req, res) => {
  try { res.json(createFinding(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/findings/:id', (req, res) => {
  try {
    const finding = updateFinding(req.params.id, req.body || {});
    if (!finding) return res.status(404).json({ error: 'Finding not found' });
    res.json(finding);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/run-templates', (req, res) => {
  res.json(getRunTemplates({ sourceRunId: req.query.sourceRunId || null, limit: req.query.limit || 100 }));
});
router.post('/run-templates', (req, res) => {
  try { res.json(createRunTemplateFromRun(req.body?.sourceRunId, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post('/run-templates/:id/runs', (req, res) => {
  try { res.json(materializeRunFromTemplate(req.params.id, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/comparisons', (req, res) => res.json(getRunComparisons({ limit: req.query.limit || 100 })));
router.post('/comparisons', (req, res) => {
  try { res.json(compareAssetSnapshots(req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── Runs + Trace Events ───
router.get('/runs', (req, res) => {
  res.json(getRuns({
    limit: req.query.limit || 50,
    conversationId: req.query.conversationId || null,
    includeCompleted: req.query.includeCompleted !== 'false',
  }));
});

router.get('/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const artifacts = getArtifactsForRun(req.params.id).map(artifact => artifactToPublic(artifact));
  res.json({ ...run, events: getTraceEvents(req.params.id), artifacts });
});

router.get('/runs/:id/replay', (req, res) => {
  const replay = buildRunReplay(req.params.id, { eventLimit: req.query.limit || 2000 });
  if (!replay) return res.status(404).json({ error: 'Run not found' });
  res.json(replay);
});

router.get('/runs/:id/artifacts', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(getArtifactsForRun(req.params.id).map(artifact => artifactToPublic(artifact)));
});

router.get('/runs/:id/graph', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: req.query.limit || 2000 });
  const artifacts = getArtifactsForRun(req.params.id).map(artifact => artifactToPublic(artifact, { includeMetadata: true }));
  res.json(deriveRunGraph({ run, events, artifacts }));
});

router.post('/runs/:id/artifacts/graph', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: 2000 });
  const artifacts = getArtifactsForRun(req.params.id).map(artifact => artifactToPublic(artifact, { includeMetadata: true }));
  const graph = deriveRunGraph({ run, events, artifacts });
  const artifact = writeArtifact({
    runId: run.id,
    conversationId: run.conversation_id,
    type: 'json',
    title: 'Graph snapshot',
    mimeType: 'application/json',
    extension: '.json',
    content: JSON.stringify(graph, null, 2),
    metadata: { source: 'graph_snapshot', eventCount: events.length, nodeCount: graph.nodes.length, edgeCount: graph.edges.length },
  });
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.post('/runs/:id/artifacts/report', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: 2000 });
  const artifacts = getArtifactsForRun(req.params.id);
  const artifact = writeArtifact({
    runId: run.id,
    conversationId: run.conversation_id,
    type: 'markdown',
    title: 'Pentest report',
    mimeType: 'text/markdown',
    extension: '.md',
    content: renderPentestReport(run, events, artifacts),
    metadata: { source: 'pentest_report', eventCount: events.length, artifactCount: artifacts.length },
  });
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.post('/runs/:id/artifacts/summary', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: 2000 });
  const artifacts = getArtifactsForRun(req.params.id);
  const artifact = writeArtifact({
    runId: run.id,
    conversationId: run.conversation_id,
    type: 'markdown',
    title: 'Executive summary',
    mimeType: 'text/markdown',
    extension: '.md',
    content: renderExecutiveSummary(run, events, artifacts),
    metadata: { source: 'executive_summary', eventCount: events.length, artifactCount: artifacts.length },
  });
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.post('/runs/:id/artifacts/evidence', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const events = getTraceEvents(req.params.id, { limit: 2000 });
  const artifacts = getArtifactsForRun(req.params.id);
  const artifact = exportEvidenceBundle(run, events, artifacts);
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.get('/runs/:id/events', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(getTraceEvents(req.params.id, { limit: req.query.limit || 500 }));
});

// ─── Artifacts ───
router.get('/artifacts', (req, res) => {
  const artifacts = getArtifacts({
    limit: req.query.limit || 100,
    runId: req.query.runId || null,
    conversationId: req.query.conversationId || null,
    type: req.query.type || null,
  });
  res.json(artifacts.map(artifact => artifactToPublic(artifact)));
});

router.get('/artifacts/:id', (req, res) => {
  const artifact = getArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
  res.json(artifactToPublic(artifact, { includeMetadata: true }));
});

router.get('/artifacts/:id/content', (req, res) => {
  const artifact = getArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
  if (!existsSync(artifact.path)) return res.status(404).json({ error: 'Artifact content not found' });
  res.type(artifact.mime_type);
  res.sendFile(artifact.path);
});

router.get('/artifacts/:id/download', (req, res) => {
  const artifact = getArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
  if (!existsSync(artifact.path)) return res.status(404).json({ error: 'Artifact content not found' });
  res.download(artifact.path, basename(artifact.path));
});

// ─── Conversations ───
router.get('/conversations', (req, res) => {
  res.json(getConversations());
});

router.post('/conversations', (req, res) => {
  const conv = createConversation(req.body.title || 'New Conversation');
  res.json(conv);
});

router.get('/conversations/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const messages = getMessages(req.params.id);
  res.json({ ...conv, messages });
});

router.delete('/conversations/:id', (req, res) => {
  deleteConversation(req.params.id);
  res.json({ success: true });
});

router.put('/conversations/:id/title', (req, res) => {
  updateConversationTitle(req.params.id, req.body.title);
  res.json({ success: true });
});

// ─── Tools ───
router.get('/tools', (req, res) => {
  res.json(getToolDefinitions().map(t => ({
    name: t.function.name,
    description: t.function.description,
  })));
});

router.get('/toolpacks', (req, res) => {
  res.json(getToolpacks());
});
router.get('/toolpacks/:id', (req, res) => {
  const pack = getToolpack(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Toolpack not found' });
  res.json(pack);
});
router.get('/toolpacks/:id/availability', (req, res) => {
  const pack = checkToolpackAvailability(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Toolpack not found' });
  res.json(pack);
});

// ─── Memory ───
router.get('/memory', (req, res) => {
  const { query, category } = req.query;
  if (query) {
    res.json(searchMemories(query, category));
  } else {
    res.json(getAllMemories(category));
  }
});

// ─── MCP Servers ───
router.get('/mcp/servers', (req, res) => {
  res.json(getMCPServers());
});

router.post('/mcp/servers', (req, res) => {
  const id = addMCPServer(req.body);
  res.json({ success: true, id });
});

router.delete('/mcp/servers/:id', (req, res) => {
  removeMCPServer(req.params.id);
  res.json({ success: true });
});

// ─── Sudo Validation ───
router.post('/sudo/validate', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.json({ valid: false, message: 'No password provided' });
  }

  try {
    // Test sudo password by running a harmless command without blocking event loop
    const escapedPass = password.replace(/'/g, "'\\''");
    try {
      await execAsync(`echo '${escapedPass}' | sudo -S -p '' echo 'phantom_sudo_ok' 2>&1`, {
        encoding: 'utf8',
        timeout: 15000,
      });
      // Password is correct — store it
      setSetting('sudo_password', password);
      res.json({ valid: true, message: 'Sudo access granted ✅' });
    } catch (err) {
      res.json({ valid: false, message: 'Incorrect sudo password' });
    }
  } catch (err) {
    res.json({ valid: false, message: `Validation error: ${err.message}` });
  }
});

// ─── System Info ───
router.get('/system/info', async (req, res) => {
  const info = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    user: os.userInfo().username,
    uptime: os.uptime(),
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
    },
    cpus: os.cpus().length,
  };

  // Run external commands concurrently without blocking the event loop
  const results = await Promise.allSettled([
    execAsync('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'', { encoding: 'utf8' }),
    execAsync("hostname -I 2>/dev/null | awk '{print $1}'", { encoding: 'utf8' })
  ]);

  if (results[0].status === 'fulfilled' && results[0].value.stdout) {
    info.distro = results[0].value.stdout.trim();
  }
  if (results[1].status === 'fulfilled' && results[1].value.stdout) {
    info.ip = results[1].value.stdout.trim();
  }

  // Check if sudo password is stored
  info.sudoConfigured = !!getSetting('sudo_password', '');
  info.workspace = config.workspace;

  res.json(info);
});

// ─── Skills Management ───
function getSkillsDir() {
  const dir = join(config.workspace, 'skills');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

router.get('/skills', (req, res) => {
  try {
    const skillsDir = getSkillsDir();
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const skills = entries.filter(e => e.isDirectory()).map(e => {
      const skillPath = join(skillsDir, e.name);
      let meta = { name: e.name, description: '', files: [] };
      // Try reading a manifest/readme
      try {
        const metaPath = join(skillPath, 'skill.json');
        if (existsSync(metaPath)) {
          meta = { ...meta, ...JSON.parse(readFileSync(metaPath, 'utf8')) };
        }
      } catch {}
      try {
        meta.files = readdirSync(skillPath).slice(0, 20);
      } catch {}
      return meta;
    });
    res.json(skills);
  } catch (err) {
    res.json([]);
  }
});

router.post('/skills/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const skillsDir = getSkillsDir();
    const zip = new AdmZip(req.file.path);
    const entries = zip.getEntries();
    // Determine skill name from zip
    const firstDir = entries.find(e => e.isDirectory);
    let skillName = firstDir ? firstDir.entryName.split('/')[0] : req.file.originalname.replace(/\.zip$/i, '');

    // Sanitize skillName to prevent path traversal
    skillName = basename(skillName);
    if (!skillName || skillName === '.' || skillName === '..') {
      return res.status(400).json({ error: 'Invalid skill name' });
    }

    const extractTo = join(skillsDir, skillName);
    if (!existsSync(extractTo)) mkdirSync(extractTo, { recursive: true });
    zip.extractAllTo(extractTo, true);
    // Cleanup temp file
    try { rmSync(req.file.path); } catch {}
    res.json({ success: true, name: skillName, message: `Skill "${skillName}" imported successfully` });
  } catch (err) {
    res.status(500).json({ error: `Failed to import skill: ${err.message}` });
  }
});

router.delete('/skills/:name', (req, res) => {
  try {
    const skillsDir = getSkillsDir();
    const skillName = basename(req.params.name);
    if (!skillName || skillName === '.' || skillName === '..') {
      return res.status(400).json({ error: 'Invalid skill name' });
    }
    const skillPath = join(skillsDir, skillName);
    if (existsSync(skillPath)) {
      rmSync(skillPath, { recursive: true, force: true });
      res.json({ success: true, message: `Skill "${skillName}" deleted` });
    } else {
      res.status(404).json({ error: 'Skill not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── AI Doctor ───
// Uses temporary API credentials — completely separate from main PHANTOM config.
// Uses raw fetch to call any OpenAI-compatible API and pipes the SSE stream to the client.
router.post('/doctor/chat', async (req, res) => {
  const { message, config: doctorCfg, systemPrompt } = req.body;

  if (!doctorCfg?.apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }

  const baseUrl = (doctorCfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey  = doctorCfg.apiKey;
  const model   = doctorCfg.model || 'gpt-4o';

  // Gather live system context without blocking the event loop
  const sysInfo = [];
  const sysCommands = [
    { prefix: 'OS: ', cmd: "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'" },
    { prefix: 'Kernel: ', cmd: 'uname -r' },
    { prefix: 'Uptime: ', cmd: 'uptime -p' },
    { prefix: 'Disk: ', cmd: 'df -h / | tail -1' },
    { prefix: 'Memory: ', cmd: 'free -h | head -2 | tail -1' },
    { prefix: 'Failed services:\n', cmd: 'systemctl --failed --no-legend 2>/dev/null | head -10' }
  ];

  const sysResults = await Promise.allSettled(
    sysCommands.map(c => execAsync(c.cmd, { encoding: 'utf8' }))
  );

  sysResults.forEach((result, idx) => {
    if (result.status === 'fulfilled' && result.value.stdout) {
      const output = result.value.stdout.trim();
      if (output) {
        sysInfo.push(sysCommands[idx].prefix + output);
      }
    }
  });

  const fullSystemPrompt =
    (systemPrompt || 'You are Dr. AI — an expert Linux system administrator and diagnostics AI. Diagnose and fix system issues proactively.') +
    (sysInfo.length ? `\n\n## LIVE SYSTEM STATE\n${sysInfo.join('\n')}` : '');

  const messages = [
    { role: 'system', content: fullSystemPrompt },
    { role: 'user',   content: message },
  ];

  // Send SSE headers immediately
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    // Call OpenAI-compatible API directly via fetch — no SDK, no dynamic import issues
    const apiRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      const errContent = `\n\n❌ **API Error ${apiRes.status}**\n\`\`\`\n${errText.substring(0, 400)}\n\`\`\``;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errContent } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Pipe SSE bytes directly from OpenAI API → client (format is already correct)
    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done || req.socket.destroyed) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[AI Doctor] Error:', err.message);
    const errContent = `\n\n❌ **Error:** ${err.message}`;
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errContent } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

export default router;
