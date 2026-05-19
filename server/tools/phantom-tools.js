// PHANTOM-native tools.
//
// Exposes PHANTOM's own domain objects (scopes, assets, findings, runs,
// artifacts, toolpacks, reports) to the LLM as callable OpenAI-style tools.
// Without these, the agent only knew shell/file/web tools and was blind to
// what PHANTOM itself had stored — it couldn't help the operator triage
// findings, draft a scope from a conversation, or generate reports.
//
// Naming convention: every tool is `phantom_<verb>_<noun>`. The prefix is
// load-bearing — `executor.js` uses it to route dispatch here instead of
// the general tool implementations.
//
// Outputs are JSON strings so the LLM can parse them cleanly; large arrays
// are pre-truncated and counts surfaced so the model knows when to paginate.

import { getScopes, getScope, createScope } from '../scope/scope-store.js';
import {
  getAssets, getAsset, createAsset,
  getFindings, createFinding, updateFinding,
} from '../assets/asset-store.js';
import { getRuns, getRun, getTraceEvents, getArtifacts } from '../memory/store.js';
import { getToolpacks } from '../toolpacks/toolpack-registry.js';
import { renderExecutiveSummary, renderPentestReport } from '../artifacts/report-renderers.js';
import { writeArtifact } from '../artifacts/artifact-store.js';
import { parseTargetInput } from '../scope/target-parser.js';

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'triaged', 'fixed', 'wont_fix', 'duplicate'];

function json(value, fallback = null) {
  try { return JSON.stringify(value, null, 2); } catch { return JSON.stringify(fallback); }
}

function summarizeRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    title: run.title,
    status: run.status,
    goal: run.goal,
    started_at: run.started_at,
    ended_at: run.ended_at,
    model: run.model,
    scope: run.scope ? { id: run.scope.id, name: run.scope.name } : null,
    summary: run.summary,
  };
}

function summarizeAsset(asset) {
  if (!asset) return null;
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    criticality: asset.criticality,
    status: asset.status,
    environment: asset.environment,
    addresses: asset.addresses?.map((a) => ({ kind: a.kind, value: a.value })) || [],
    services: asset.services?.map((s) => ({
      name: s.name, protocol: s.protocol, port: s.port, url: s.url, status: s.status,
    })) || [],
    tags: asset.tags || [],
  };
}

function summarizeFinding(finding) {
  if (!finding) return null;
  return {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    assetId: finding.assetId,
    runId: finding.runId,
    description: finding.description,
    recommendation: finding.recommendation,
    first_seen_at: finding.first_seen_at,
    last_seen_at: finding.last_seen_at,
  };
}

function summarizeScope(scope) {
  if (!scope) return null;
  return {
    id: scope.id,
    name: scope.name,
    targets: scope.targets,
    allowed_actions: scope.allowed_actions,
    blocked_actions: scope.blocked_actions,
    expires_at: scope.expires_at,
    archived_at: scope.archived_at,
  };
}

// ── Tool definitions ─────────────────────────────────────────────────────────

export function getPhantomToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'phantom_get_context',
        description: 'Get a snapshot of PHANTOM\'s current operational state — active scopes, total assets, recent runs, open findings by severity, and registered toolpacks. Call this first when the operator asks "what do we have set up?" or "what\'s the current state?" Returns counts and recent items so you can decide whether to drill in with phantom_list_* tools.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_list_scopes',
        description: 'List authorized scopes (target authorizations). Each scope defines what PHANTOM is allowed to touch and which action classes are permitted. Use to find an existing scope before suggesting a new run.',
        parameters: {
          type: 'object',
          properties: {
            include_archived: { type: 'boolean', description: 'Include archived scopes. Default false.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_get_scope',
        description: 'Fetch a single scope by id — full target list, allowed/blocked action classes, credential refs, expiry.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Scope id.' } },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_create_scope',
        description: 'Create a new authorized scope. The operator-supplied targets text is parsed (domains, IPs, CIDRs, URLs, host:port) and normalized. Use this when the operator describes a new engagement in chat and asks PHANTOM to "set up the scope."',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Human-readable scope name, e.g. "Q3 web app baseline".' },
            targets: { type: 'string', description: 'Free-form targets — newline or comma separated. Domains, IPs, CIDRs, URLs, host:port all accepted.' },
            allowed_actions: { type: 'array', items: { type: 'string' }, description: 'Action class ids the scope permits. Common values: "recon", "network-scan", "exploit", "credentialed". Default: ["recon"].' },
            notes: { type: 'string', description: 'Operator notes / authorization context.' },
          },
          required: ['name', 'targets'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_list_assets',
        description: 'List assets in the inventory. Filter by type, tag, or free-text query. Returns name, addresses, services, criticality.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Free-text match against name/description/owner/environment.' },
            type: { type: 'string', description: 'Filter by asset type: "device", "network", "web_app", "url", "domain", etc.' },
            tag: { type: 'string', description: 'Filter to assets carrying this tag.' },
            limit: { type: 'integer', description: 'Max rows to return (default 50).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_get_asset',
        description: 'Fetch a single asset by id including addresses, services, tags, and recent findings.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Asset id.' } },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_create_asset',
        description: 'Add a new asset to the inventory. Use when the operator mentions a new target system that should be tracked across runs.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Human-readable name.' },
            type: { type: 'string', description: 'Asset type — "device" | "network" | "web_app" | "url" | "domain". Default "device".' },
            description: { type: 'string' },
            criticality: { type: 'string', description: '"low" | "medium" | "high" | "critical". Default "medium".' },
            environment: { type: 'string', description: '"prod" | "staging" | "lab" | etc.' },
            addresses: {
              type: 'array',
              description: 'List of {kind, value} pairs. Kinds: "ip", "host", "domain", "cidr", "url".',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  value: { type: 'string' },
                },
              },
            },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_list_findings',
        description: 'List findings (vulnerabilities, weaknesses, observations) — filterable by status, severity, asset, or run.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: `One of: ${STATUSES.join(', ')}.` },
            severity: { type: 'string', description: `One of: ${SEVERITIES.join(', ')}.` },
            assetId: { type: 'string' },
            runId: { type: 'string' },
            limit: { type: 'integer', description: 'Max rows (default 50).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_create_finding',
        description: 'Record a finding. Use after analyzing tool output to persist a vulnerability or security observation that should appear in the alerts queue and reports.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short finding title.' },
            severity: { type: 'string', description: `One of: ${SEVERITIES.join(', ')}. Default "low".` },
            description: { type: 'string', description: 'Markdown-formatted detail.' },
            evidence: { type: 'string', description: 'Raw evidence excerpt — command output, request/response, screenshot caption.' },
            recommendation: { type: 'string', description: 'Suggested remediation.' },
            assetId: { type: 'string', description: 'Optional asset link.' },
            runId: { type: 'string', description: 'Optional run link — defaults to the current run.' },
            scopeId: { type: 'string', description: 'Optional scope link — defaults to the current scope.' },
          },
          required: ['title'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_update_finding',
        description: 'Change a finding\'s status or severity. Use when triaging — "this is a false positive" → status="wont_fix"; "we patched this" → status="fixed".',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', description: `One of: ${STATUSES.join(', ')}.` },
            severity: { type: 'string', description: `One of: ${SEVERITIES.join(', ')}.` },
            recommendation: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_list_runs',
        description: 'List recent runs. A run is one governed operation against a scope, with a trace of every tool decision. Use to find a previous run to follow up on.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', description: 'Max runs (default 20).' },
            conversationId: { type: 'string', description: 'Filter to runs from a specific conversation.' },
            activeOnly: { type: 'boolean', description: 'If true, exclude completed/failed/stopped runs.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_get_run',
        description: 'Fetch a single run by id with its trace event summary and linked artifacts.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            includeTrace: { type: 'boolean', description: 'Include trace events (default true, capped at 100 events).' },
          },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_list_artifacts',
        description: 'List artifacts (saved evidence files, previews, reports). Filterable by run, conversation, or type.',
        parameters: {
          type: 'object',
          properties: {
            runId: { type: 'string' },
            conversationId: { type: 'string' },
            type: { type: 'string', description: 'Filter by type — "html", "json", "markdown", "preview", "report", etc.' },
            limit: { type: 'integer', description: 'Max rows (default 50).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_list_toolpacks',
        description: 'List registered security toolpacks (Passive OSINT, Web Recon, Network Discovery, Vulnerability Assessment, Offline Password Audit, etc.) with risk classes and policy summaries.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'phantom_generate_report',
        description: 'Generate a pentest or executive-summary report for a run and save it as an artifact. Returns the artifact id and a markdown preview. Use after a run completes to give the operator a shareable write-up.',
        parameters: {
          type: 'object',
          properties: {
            runId: { type: 'string', description: 'The run to report on.' },
            kind: { type: 'string', description: '"pentest" (full technical) or "executive" (summary). Default "pentest".' },
          },
          required: ['runId'],
        },
      },
    },
  ];
}

const PHANTOM_TOOL_NAMES = new Set(
  getPhantomToolDefinitions().map((t) => t.function.name)
);

export function isPhantomTool(name) {
  return PHANTOM_TOOL_NAMES.has(name);
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function executePhantomTool(name, args = {}, context = {}) {
  try {
    switch (name) {
      case 'phantom_get_context':           return await opGetContext(context);
      case 'phantom_list_scopes':           return opListScopes(args);
      case 'phantom_get_scope':             return opGetScope(args);
      case 'phantom_create_scope':          return opCreateScope(args);
      case 'phantom_list_assets':           return opListAssets(args);
      case 'phantom_get_asset':             return opGetAsset(args);
      case 'phantom_create_asset':          return opCreateAsset(args);
      case 'phantom_list_findings':         return opListFindings(args);
      case 'phantom_create_finding':        return opCreateFinding(args, context);
      case 'phantom_update_finding':        return opUpdateFinding(args);
      case 'phantom_list_runs':             return opListRuns(args);
      case 'phantom_get_run':               return opGetRun(args);
      case 'phantom_list_artifacts':        return opListArtifacts(args);
      case 'phantom_list_toolpacks':        return opListToolpacks();
      case 'phantom_generate_report':       return opGenerateReport(args, context);
      default:
        return `Unknown PHANTOM tool: ${name}`;
    }
  } catch (err) {
    return `phantom-tool error (${name}): ${err.message}`;
  }
}

// ── Operations ───────────────────────────────────────────────────────────────

async function opGetContext(context) {
  const scopes = getScopes({ includeArchived: false });
  const assets = getAssets({ limit: 10 });
  const runs = getRuns({ limit: 5 });
  const allFindings = getFindings({ limit: 200 });
  const open = allFindings.filter((f) => f.status === 'open');
  const sevCounts = SEVERITIES.reduce((acc, sev) => {
    acc[sev] = open.filter((f) => f.severity === sev).length;
    return acc;
  }, {});
  const toolpacks = getToolpacks().map((tp) => ({
    id: tp.id, name: tp.name, category: tp.category, risks: tp.risks,
  }));

  return json({
    summary: {
      scopes: scopes.length,
      assets: assets.length,
      runs: runs.length,
      open_findings: open.length,
      severity_breakdown: sevCounts,
      toolpacks: toolpacks.length,
    },
    ui_context: context.uiContext || null,
    active_scope: context.scope ? summarizeScope(context.scope) : null,
    recent_scopes: scopes.slice(0, 5).map(summarizeScope),
    recent_assets: assets.slice(0, 5).map(summarizeAsset),
    recent_runs: runs.map(summarizeRun),
    toolpacks,
  });
}

function opListScopes({ include_archived = false } = {}) {
  const rows = getScopes({ includeArchived: include_archived });
  return json({ count: rows.length, scopes: rows.map(summarizeScope) });
}

function opGetScope({ id }) {
  if (!id) return 'id is required';
  const scope = getScope(id);
  if (!scope) return `No scope found with id ${id}`;
  return json(summarizeScope(scope));
}

function opCreateScope({ name, targets, allowed_actions, notes } = {}) {
  if (!name) return 'name is required';
  if (!targets) return 'targets is required';
  const parsed = parseTargetInput(String(targets));
  const targetFields = {
    hosts: parsed.hosts || [],
    domains: parsed.domains || [],
    cidrs: parsed.cidrs || [],
    urls: parsed.urls || [],
  };
  const scope = createScope({
    name,
    targets: targetFields,
    allowedActions: Array.isArray(allowed_actions) && allowed_actions.length
      ? allowed_actions
      : ['recon'],
    notes: notes || '',
  });
  return json({ created: true, scope: summarizeScope(scope) });
}

function opListAssets({ query = '', type = null, tag = null, limit = 50 } = {}) {
  const rows = getAssets({ query, type, tag, limit });
  return json({ count: rows.length, assets: rows.map(summarizeAsset) });
}

function opGetAsset({ id } = {}) {
  if (!id) return 'id is required';
  const asset = getAsset(id);
  if (!asset) return `No asset found with id ${id}`;
  const findings = getFindings({ assetId: id, limit: 50 });
  return json({ ...summarizeAsset(asset), findings: findings.map(summarizeFinding) });
}

function opCreateAsset(args = {}) {
  if (!args.name) return 'name is required';
  const asset = createAsset({
    name: args.name,
    type: args.type || 'device',
    description: args.description || '',
    criticality: args.criticality || 'medium',
    environment: args.environment || '',
    addresses: Array.isArray(args.addresses) ? args.addresses : [],
    tags: Array.isArray(args.tags) ? args.tags : [],
  });
  return json({ created: true, asset: summarizeAsset(asset) });
}

function opListFindings(args = {}) {
  const rows = getFindings({
    status: args.status || null,
    severity: args.severity || null,
    assetId: args.assetId || null,
    runId: args.runId || null,
    limit: args.limit || 50,
  });
  return json({ count: rows.length, findings: rows.map(summarizeFinding) });
}

function opCreateFinding(args = {}, context = {}) {
  if (!args.title) return 'title is required';
  const finding = createFinding({
    title: args.title,
    severity: args.severity || 'low',
    status: 'open',
    description: args.description || '',
    evidence: args.evidence || '',
    recommendation: args.recommendation || '',
    assetId: args.assetId || null,
    runId: args.runId || context.runId || null,
    scopeId: args.scopeId || context.scope?.id || null,
  });
  return json({ created: true, finding: summarizeFinding(finding) });
}

function opUpdateFinding(args = {}) {
  if (!args.id) return 'id is required';
  const updated = updateFinding(args.id, {
    status: args.status,
    severity: args.severity,
    recommendation: args.recommendation,
    fixedAt: args.status === 'fixed' ? new Date().toISOString() : undefined,
  });
  if (!updated) return `No finding found with id ${args.id}`;
  return json({ updated: true, finding: summarizeFinding(updated) });
}

function opListRuns({ limit = 20, conversationId = null, activeOnly = false } = {}) {
  const rows = getRuns({
    limit,
    conversationId,
    includeCompleted: !activeOnly,
  });
  return json({ count: rows.length, runs: rows.map(summarizeRun) });
}

function opGetRun({ id, includeTrace = true } = {}) {
  if (!id) return 'id is required';
  const run = getRun(id);
  if (!run) return `No run found with id ${id}`;
  const summary = summarizeRun(run);
  const artifacts = getArtifacts({ runId: id, limit: 30 });
  const result = {
    ...summary,
    artifacts: artifacts.map((a) => ({ id: a.id, type: a.type, title: a.title, mime_type: a.mime_type })),
  };
  if (includeTrace) {
    const events = getTraceEvents(id, { limit: 100 });
    result.trace = events.map((e) => ({
      seq: e.seq, type: e.type, phase: e.phase, status: e.status,
      tool_name: e.tool_name, output_preview: e.output_preview,
    }));
  }
  return json(result);
}

function opListArtifacts(args = {}) {
  const rows = getArtifacts({
    runId: args.runId || null,
    conversationId: args.conversationId || null,
    type: args.type || null,
    limit: args.limit || 50,
  });
  return json({
    count: rows.length,
    artifacts: rows.map((a) => ({
      id: a.id, type: a.type, title: a.title, mime_type: a.mime_type,
      run_id: a.run_id, conversation_id: a.conversation_id, created_at: a.created_at,
    })),
  });
}

function opListToolpacks() {
  const rows = getToolpacks();
  return json({
    count: rows.length,
    toolpacks: rows.map((tp) => ({
      id: tp.id,
      name: tp.name,
      category: tp.category,
      summary: tp.summary,
      risks: tp.risks,
      allowedActions: tp.allowedActions,
      blockedByDefault: tp.blockedByDefault,
      tool_count: Array.isArray(tp.tools) ? tp.tools.length : 0,
    })),
  });
}

function opGenerateReport({ runId, kind = 'pentest' } = {}, context = {}) {
  if (!runId) return 'runId is required';
  const run = getRun(runId);
  if (!run) return `No run found with id ${runId}`;
  const events = getTraceEvents(runId, { limit: 2000 });
  const artifacts = getArtifacts({ runId, limit: 200 });
  const isExec = String(kind).toLowerCase() === 'executive';
  const markdown = isExec
    ? renderExecutiveSummary(run, events, artifacts)
    : renderPentestReport(run, events, artifacts);
  const artifact = writeArtifact({
    runId,
    conversationId: context.conversationId || run.conversation_id || null,
    type: 'report',
    title: `${isExec ? 'Executive Summary' : 'Pentest Report'} — ${run.title || run.id}`,
    mimeType: 'text/markdown',
    extension: '.md',
    content: markdown,
    metadata: { kind: isExec ? 'executive' : 'pentest', source: 'phantom_generate_report' },
  });
  return json({
    created: true,
    artifact: { id: artifact.id, type: artifact.type, title: artifact.title, path: artifact.path },
    markdown_preview: markdown.slice(0, 1200) + (markdown.length > 1200 ? '\n…' : ''),
  });
}
