import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import apiRouter from './api.js';
import {
  initDB, closeDB,
  createConversation,
  createRun,
  addTraceEvent,
  createArtifact,
} from '../memory/store.js';

let server;
let baseUrl;

describe('API Routes Integration', () => {
  before(async () => {
    initDB(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}/api`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
    closeDB();
  });

  test('GET /api/tools should return list of available tools', async () => {
    const res = await fetch(`${baseUrl}/tools`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data), 'Tools should be an array');
    assert.ok(data.length > 0, 'Should have at least one tool');
    assert.ok(data[0].name, 'Tool should have a name');
  });

  test('GET /api/providers returns the OpenAI-compatible registry with Hermes as default', async () => {
    const res = await fetch(`${baseUrl}/providers`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.default, 'hermes', 'default provider should be hermes');
    assert.ok(Array.isArray(data.providers), 'providers should be an array');
    const hermes = data.providers.find(p => p.id === 'hermes');
    assert.ok(hermes, 'hermes provider must exist in the registry');
    assert.strictEqual(hermes.baseUrl, 'http://127.0.0.1:8645/v1', 'hermes baseUrl must match the 0.14.0 canonical port');
    assert.strictEqual(hermes.keyOptional, true, 'hermes bearer token is optional (proxy attaches real creds)');
    // Every wired provider claims OpenAI-compatible OR is flagged unavailable
    for (const p of data.providers) {
      assert.ok(p.openaiCompatible || p.unavailable,
        `provider ${p.id} must be openaiCompatible or marked unavailable`);
    }
  });

  test('Conversation CRUD operations', async () => {
    // Create
    let res = await fetch(`${baseUrl}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Integration Test Conversation' })
    });
    assert.strictEqual(res.status, 200);
    const conv = await res.json();
    assert.strictEqual(conv.title, 'Integration Test Conversation');
    assert.ok(conv.id);

    const convId = conv.id;

    // Get
    res = await fetch(`${baseUrl}/conversations/${convId}`);
    assert.strictEqual(res.status, 200);
    const getConv = await res.json();
    assert.strictEqual(getConv.id, convId);

    // Update title
    res = await fetch(`${baseUrl}/conversations/${convId}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' })
    });
    assert.strictEqual(res.status, 200);

    // Delete
    res = await fetch(`${baseUrl}/conversations/${convId}`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 200);

    // Get (should fail)
    res = await fetch(`${baseUrl}/conversations/${convId}`);
    assert.strictEqual(res.status, 404);
  });

  test('Run and prompt preview endpoints expose telemetry without secrets', async () => {
    const conv = createConversation('API run test');
    const run = createRun({
      conversationId: conv.id,
      title: 'API Run',
      goal: 'Verify run API',
      model: 'grok-4.3',
      providerRoute: 'hermes-proxy',
    });
    addTraceEvent(run.id, {
      type: 'run.started',
      phase: 'general',
      status: 'started',
      outputPreview: 'Started via test',
    });

    let res = await fetch(`${baseUrl}/runs`);
    assert.strictEqual(res.status, 200);
    const runs = await res.json();
    assert.ok(runs.some(r => r.id === run.id));

    res = await fetch(`${baseUrl}/runs/${run.id}`);
    assert.strictEqual(res.status, 200);
    const runDetail = await res.json();
    assert.strictEqual(runDetail.id, run.id);
    assert.ok(Array.isArray(runDetail.events));
    assert.strictEqual(runDetail.events[0].type, 'run.started');
    assert.ok(Array.isArray(runDetail.artifacts));

    res = await fetch(`${baseUrl}/runs/${run.id}/events`);
    assert.strictEqual(res.status, 200);
    const events = await res.json();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].seq, 1);

    res = await fetch(`${baseUrl}/runs/${run.id}/replay`);
    assert.strictEqual(res.status, 200);
    const replay = await res.json();
    assert.strictEqual(replay.run.id, run.id);
    assert.deepStrictEqual(replay.replay.sequence, [1]);
    assert.strictEqual(replay.replay.eventCount, 1);
    assert.strictEqual(replay.replay.artifactCount, 0);
    assert.ok(Array.isArray(replay.events));
    assert.ok(replay.graph.nodes.some(node => node.type === 'run'));

    res = await fetch(`${baseUrl}/prompts/preview`);
    assert.strictEqual(res.status, 200);
    const prompt = await res.json();
    assert.ok(prompt.content.includes('You are PHANTOM'));
    assert.ok(!JSON.stringify(prompt).includes('sudo_password'));

    // Synthesis: real run plus the stub-preview variant.
    res = await fetch(`${baseUrl}/runs/${run.id}/synthesis`);
    assert.strictEqual(res.status, 200);
    const synthesis = await res.json();
    assert.strictEqual(synthesis.v, 1);
    assert.strictEqual(synthesis.runId, run.id);
    assert.ok(synthesis.posture && typeof synthesis.posture.score === 'number');
    assert.ok(Array.isArray(synthesis.highlights));
    assert.ok(Array.isArray(synthesis.nextSteps));

    res = await fetch(`${baseUrl}/runs/${run.id}/synthesis?preview=stub`);
    assert.strictEqual(res.status, 200);
    const stub = await res.json();
    assert.strictEqual(stub.runId, 'preview-run');
    assert.strictEqual(stub.posture.rating, 'fair');
  });

  test('Settings exposes docsEnabled (default on) and PUT round-trips the flag', async () => {
    // GET — default should be on.
    let res = await fetch(`${baseUrl}/settings`);
    let s = await res.json();
    assert.strictEqual(s.docsEnabled, true, 'docs are on by default');

    // PUT off.
    res = await fetch(`${baseUrl}/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docsEnabled: false }),
    });
    assert.strictEqual(res.status, 200);
    res = await fetch(`${baseUrl}/settings`);
    s = await res.json();
    assert.strictEqual(s.docsEnabled, false, 'PUT { docsEnabled:false } persists');

    // PUT back on, leave the world as we found it for any later tests.
    res = await fetch(`${baseUrl}/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docsEnabled: true }),
    });
    assert.strictEqual(res.status, 200);
    res = await fetch(`${baseUrl}/settings`);
    s = await res.json();
    assert.strictEqual(s.docsEnabled, true);
  });

  test('Sec-ops installer exposes status, preview, request lifecycle without exec', async () => {
    let res = await fetch(`${baseUrl}/installer/status`);
    assert.strictEqual(res.status, 200);
    const status = await res.json();
    assert.ok(status.host && typeof status.host.os === 'string');
    assert.ok(Array.isArray(status.tools));
    assert.ok(status.byTier.base && status.byTier.offensive && status.byTier.blue);

    res = await fetch(`${baseUrl}/installer/catalog`);
    assert.strictEqual(res.status, 200);
    const catalog = await res.json();
    assert.deepStrictEqual(catalog.tiers, ['base', 'offensive', 'blue']);
    assert.ok(catalog.tools.length >= 20);

    res = await fetch(`${baseUrl}/installer/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'base' }),
    });
    assert.strictEqual(res.status, 200);
    const preview = await res.json();
    assert.ok(Array.isArray(preview.plan) && preview.plan.length >= 5);
    assert.ok(preview.summary.total === preview.plan.length);

    res = await fetch(`${baseUrl}/installer/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);

    // Request → cancel lifecycle (we deliberately don't approve here; the
    // approve path actually spawns package managers and would break CI).
    res = await fetch(`${baseUrl}/installer/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolIds: ['nmap', 'ffuf'], note: 'integration test' }),
    });
    assert.strictEqual(res.status, 200);
    const reqResp = await res.json();
    const request = reqResp.request;
    assert.ok(request.id);
    assert.strictEqual(request.status, 'pending');
    assert.deepStrictEqual(request.toolIds, ['nmap', 'ffuf']);

    res = await fetch(`${baseUrl}/installer/requests`);
    const list = await res.json();
    assert.ok(list.some(r => r.id === request.id));

    // A3 — installs are credentialed (high-risk); cancelling without a
    // denial reason is rejected with 400.
    res = await fetch(`${baseUrl}/installer/requests/${request.id}/cancel`, { method: 'POST' });
    assert.strictEqual(res.status, 400);
    const denyErr = await res.json();
    assert.strictEqual(denyErr.error, 'denial_reason_required');

    res = await fetch(`${baseUrl}/installer/requests/${request.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ denialReason: 'not approved for production hosts' }),
    });
    assert.strictEqual(res.status, 200);
    const cancelled = await res.json();
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.strictEqual(cancelled.denial_reason, 'not approved for production hosts');

    // Double-cancel must fail with 409 even when a reason is supplied.
    res = await fetch(`${baseUrl}/installer/requests/${request.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ denialReason: 'attempting again' }),
    });
    assert.strictEqual(res.status, 409);

    // A3 — /installer/requests?explained=1 returns the structured shape
    // alongside the raw request so the Approvals UI doesn't have to
    // recompute risk/sideEffects on the client.
    res = await fetch(`${baseUrl}/installer/requests?explained=1`);
    assert.strictEqual(res.status, 200);
    const explainedList = await res.json();
    assert.ok(Array.isArray(explainedList.requests));
    assert.ok(Array.isArray(explainedList.explained));
    const explainedRow = explainedList.explained.find(r => r && r.id === request.id);
    assert.ok(explainedRow, 'explained list should contain the cancelled request');
    assert.strictEqual(explainedRow.type, 'install');
    assert.strictEqual(explainedRow.riskClass, 'credentialed');
    assert.strictEqual(explainedRow.status, 'denied');
    assert.strictEqual(explainedRow.denialReason, 'not approved for production hosts');
    assert.ok(Array.isArray(explainedRow.sideEffects) && explainedRow.sideEffects.length > 0);
    assert.ok(explainedRow.rawDetails, 'rawDetails must be preserved');
  });

  test('Toolpack profile CRUD: list/get/create/update/delete with validation', async () => {
    // POST happy path
    let res = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'api-test-profile',
        description: 'integration-test profile',
        toolIds: ['nmap', 'ffuf'],
      }),
    });
    assert.strictEqual(res.status, 200);
    const created = await res.json();
    assert.ok(created.id);
    assert.strictEqual(created.name, 'api-test-profile');
    assert.deepStrictEqual(created.tool_ids, ['nmap', 'ffuf']);

    // POST missing name → 400
    res = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolIds: ['nmap'] }),
    });
    assert.strictEqual(res.status, 400);

    // POST missing toolIds → 400
    res = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'no-tools' }),
    });
    assert.strictEqual(res.status, 400);

    // POST duplicate name → 400
    res = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'api-test-profile', toolIds: ['nmap'] }),
    });
    assert.strictEqual(res.status, 400);

    // GET list
    res = await fetch(`${baseUrl}/profiles`);
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    assert.ok(list.some((p) => p.id === created.id));

    // GET single
    res = await fetch(`${baseUrl}/profiles/${created.id}`);
    assert.strictEqual(res.status, 200);
    const fetched = await res.json();
    assert.strictEqual(fetched.id, created.id);

    // GET unknown → 404
    res = await fetch(`${baseUrl}/profiles/does-not-exist`);
    assert.strictEqual(res.status, 404);

    // PUT
    res = await fetch(`${baseUrl}/profiles/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'updated description', toolIds: ['nmap', 'sqlmap'] }),
    });
    assert.strictEqual(res.status, 200);
    const updated = await res.json();
    assert.strictEqual(updated.description, 'updated description');
    assert.deepStrictEqual(updated.tool_ids, ['nmap', 'sqlmap']);

    // PUT unknown → 404
    res = await fetch(`${baseUrl}/profiles/does-not-exist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'x' }),
    });
    assert.strictEqual(res.status, 404);

    // GET dockerfile
    res = await fetch(`${baseUrl}/profiles/${created.id}/dockerfile`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/plain/);
    const fragment = await res.text();
    assert.match(fragment, /# profile: api-test-profile/);
    assert.match(fragment, /RUN \/tmp\/install-profile\.sh "api-test-profile"/);

    // GET dockerfile unknown → 404
    res = await fetch(`${baseUrl}/profiles/does-not-exist/dockerfile`);
    assert.strictEqual(res.status, 404);

    // POST install → enqueues into the existing install_requests queue
    res = await fetch(`${baseUrl}/profiles/${created.id}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'route-test install' }),
    });
    assert.strictEqual(res.status, 200);
    const installResp = await res.json();
    assert.ok(installResp.request);
    assert.strictEqual(installResp.request.status, 'pending', 'install must be pending — no execution yet');
    assert.deepStrictEqual(installResp.request.toolIds, ['nmap', 'sqlmap']);
    assert.strictEqual(installResp.profile.name, 'api-test-profile');
    assert.match(installResp.request.note, /profile:api-test-profile.*route-test install/);

    // The newly-pending request should appear in the existing approvals
    // surface — proves we routed through the same queue.
    res = await fetch(`${baseUrl}/installer/requests?status=pending`);
    assert.strictEqual(res.status, 200);
    const pending = await res.json();
    assert.ok(pending.some((r) => r.id === installResp.request.id),
      'profile install should surface in /api/installer/requests?status=pending');

    // POST install unknown → 404
    res = await fetch(`${baseUrl}/profiles/does-not-exist/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 404);

    // DELETE
    res = await fetch(`${baseUrl}/profiles/${created.id}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);

    // DELETE unknown → 404
    res = await fetch(`${baseUrl}/profiles/${created.id}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 404);

    res = await fetch(`${baseUrl}/profiles/${created.id}`);
    assert.strictEqual(res.status, 404);
  });

  test('Scope and prompt APIs support governed run administration', async () => {
    let res = await fetch(`${baseUrl}/scopes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'API scope',
        targets: { hosts: ['example.com'], cidrs: ['192.168.1.0/24'] },
        allowedActions: ['recon', 'network-scan'],
        blockedActions: ['destructive'],
        credentialRefs: ['vault:api-ref'],
        notes: 'API rules',
      }),
    });
    assert.strictEqual(res.status, 200);
    const scope = await res.json();
    assert.strictEqual(scope.name, 'API scope');
    assert.ok(!JSON.stringify(scope).includes('targets_json'));

    res = await fetch(`${baseUrl}/scopes/${scope.id}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName: 'execute_command', args: { command: 'nmap 10.0.0.5' } }),
    });
    assert.strictEqual(res.status, 200);
    const decision = await res.json();
    assert.strictEqual(decision.allowed, false);
    assert.match(decision.reason, /outside selected scope/i);

    res = await fetch(`${baseUrl}/scopes/parse-targets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'https://api.example.com 192.168.1.50:443' }),
    });
    assert.strictEqual(res.status, 200);
    const parsedTargets = await res.json();
    assert.ok(parsedTargets.targets.some(target => target.value === 'https://api.example.com'));
    assert.ok(parsedTargets.scopeFields.hosts.includes('192.168.1.50'));

    res = await fetch(`${baseUrl}/scopes/templates`);
    assert.strictEqual(res.status, 200);
    const templates = await res.json();
    assert.ok(templates.some(template => template.id === 'web-recon'));

    res = await fetch(`${baseUrl}/toolpacks`);
    assert.strictEqual(res.status, 200);
    const toolpacks = await res.json();
    assert.ok(toolpacks.some(pack => pack.id === 'passive-osint' && pack.tools.length > 0));

    res = await fetch(`${baseUrl}/toolpacks/network-discovery/availability`);
    assert.strictEqual(res.status, 200);
    const availability = await res.json();
    assert.strictEqual(availability.id, 'network-discovery');
    assert.ok(Array.isArray(availability.tools));

    res = await fetch(`${baseUrl}/prompts/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'API profile', mode: 'recon', description: 'API prompt profile' }),
    });
    assert.strictEqual(res.status, 200);
    const profile = await res.json();

    res = await fetch(`${baseUrl}/prompts/fragments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: profile.id, kind: 'mode', name: 'API mode', body: 'API MODE FRAGMENT', position: 1 }),
    });
    assert.strictEqual(res.status, 200);
    const fragment = await res.json();
    assert.strictEqual(fragment.body, 'API MODE FRAGMENT');

    res = await fetch(`${baseUrl}/prompts/preview?profileId=${profile.id}&scopeId=${scope.id}&toolpackIds=passive-osint,reporting`);
    assert.strictEqual(res.status, 200);
    const preview = await res.json();
    assert.ok(preview.content.includes('API MODE FRAGMENT'));
    assert.ok(preview.content.includes('Scope: API scope'));
    assert.ok(preview.content.includes('Passive OSINT'));
    assert.deepStrictEqual(preview.toolpacks.map(pack => pack.id), ['passive-osint', 'reporting']);
    assert.ok(!JSON.stringify(preview).includes('vault:api-ref'));

    res = await fetch(`${baseUrl}/scopes/${scope.id}/archive`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
  });

  test('Asset, finding, baseline, rerun, and comparison APIs expose operational security workspace state', async () => {
    let res = await fetch(`${baseUrl}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'web_app',
        name: 'API Portal',
        owner: 'Security',
        environment: 'staging',
        credentialRefs: ['vault:portal-ref'],
        addresses: [{ kind: 'url', value: 'https://portal.example.test' }],
        services: [{ name: 'https', protocol: 'tcp', port: 443, url: 'https://portal.example.test', status: 'open' }],
        tags: ['staging', 'portal'],
      }),
    });
    assert.strictEqual(res.status, 200);
    const asset = await res.json();
    assert.strictEqual(asset.name, 'API Portal');
    assert.ok(!JSON.stringify(asset).includes('vault:portal-ref'));
    assert.strictEqual(asset.services[0].port, 443);

    res = await fetch(`${baseUrl}/assets?query=portal&tag=staging`);
    assert.strictEqual(res.status, 200);
    const assets = await res.json();
    assert.ok(assets.some(item => item.id === asset.id));

    res = await fetch(`${baseUrl}/scopes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'API asset scope', targets: { assetIds: [asset.id] }, allowedActions: ['recon'] }),
    });
    assert.strictEqual(res.status, 200);
    const scope = await res.json();
    assert.deepStrictEqual(scope.raw_targets.assetIds, [asset.id]);
    assert.ok(scope.targets.urls.includes('https://portal.example.test'));

    const conv = createConversation('Asset API run');
    const run = createRun({ conversationId: conv.id, title: 'Asset API run', goal: 'Check API Portal', model: 'grok-4.3', providerRoute: 'hermes-proxy', scopeId: scope.id });
    const event = addTraceEvent(run.id, { type: 'tool.call.completed', phase: 'tool', status: 'completed', toolName: 'web_request', outputPreview: 'Server header exposed' });

    res = await fetch(`${baseUrl}/findings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id, runId: run.id, traceEventId: event.id, scopeId: scope.id, title: 'Server header exposed', severity: 'medium', evidence: 'Server: nginx', recommendation: 'Disable version header' }),
    });
    assert.strictEqual(res.status, 200);
    const finding = await res.json();
    assert.strictEqual(finding.status, 'open');

    res = await fetch(`${baseUrl}/assets/${asset.id}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopeId: scope.id, runId: run.id, title: 'Before mitigation', status: 'degraded', healthScore: 55, observations: { ports: [443] }, findingCounts: { open: 1, mitigated: 0 }, artifactIds: [] }),
    });
    assert.strictEqual(res.status, 200);
    const before = await res.json();

    await fetch(`${baseUrl}/findings/${finding.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'mitigated' }),
    });

    res = await fetch(`${baseUrl}/assets/${asset.id}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopeId: scope.id, runId: run.id, title: 'After mitigation', status: 'healthy', healthScore: 95, observations: { ports: [443] }, findingCounts: { open: 0, mitigated: 1 }, artifactIds: [] }),
    });
    assert.strictEqual(res.status, 200);
    const after = await res.json();

    res = await fetch(`${baseUrl}/comparisons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseSnapshotId: before.id, compareSnapshotId: after.id, title: 'Mitigation comparison' }),
    });
    assert.strictEqual(res.status, 200);
    const comparison = await res.json();
    assert.strictEqual(comparison.diff.healthDelta, 40);
    assert.strictEqual(comparison.diff.resolvedFindings, 1);

    res = await fetch(`${baseUrl}/run-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceRunId: run.id, name: 'Portal rerun', assetIds: [asset.id] }),
    });
    assert.strictEqual(res.status, 200);
    const template = await res.json();
    assert.strictEqual(template.source_run_id, run.id);

    res = await fetch(`${baseUrl}/run-templates/${template.id}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: conv.id, title: 'API rerun' }),
    });
    assert.strictEqual(res.status, 200);
    const rerun = await res.json();
    assert.strictEqual(rerun.scope_id, scope.id);

    res = await fetch(`${baseUrl}/assets/${asset.id}`);
    assert.strictEqual(res.status, 200);
    const detail = await res.json();
    assert.ok(detail.findings.some(item => item.id === finding.id));
    assert.ok(detail.snapshots.length >= 2);
    assert.ok(!JSON.stringify(detail).includes('vault:portal-ref'));
  });

  test('Artifact endpoints list metadata and serve artifact content', async () => {
    const conv = createConversation('Artifact API test');
    const run = createRun({
      conversationId: conv.id,
      title: 'Artifact API Run',
      goal: 'Verify artifact API',
      model: 'grok-4.3',
      providerRoute: 'hermes-proxy',
    });
    addTraceEvent(run.id, {
      type: 'tool.call.started',
      phase: 'tool',
      status: 'started',
      toolName: 'execute_command',
      input: { command: 'curl http://example.com:8080/status && nc -vz 10.0.0.5 22' },
      metadata: { toolCallId: 'call-api-graph' },
    });
    const completedEvent = addTraceEvent(run.id, {
      type: 'tool.call.completed',
      phase: 'tool',
      status: 'completed',
      toolName: 'execute_command',
      outputPreview: 'Connected to 10.0.0.5:22 and https://api.example.com/login',
      metadata: { toolCallId: 'call-api-graph' },
    });
    const artifact = createArtifact({
      runId: run.id,
      conversationId: conv.id,
      type: 'html',
      title: 'API Preview',
      mimeType: 'text/html',
      path: '/tmp/phantom-api-preview.html',
      metadata: { source: 'test', traceEventId: completedEvent.id, secret: 'should-not-leak-in-list' },
    });

    let res = await fetch(`${baseUrl}/artifacts?runId=${run.id}`);
    assert.strictEqual(res.status, 200);
    const artifacts = await res.json();
    assert.strictEqual(artifacts.length, 1);
    assert.strictEqual(artifacts[0].id, artifact.id);
    assert.ok(!('path' in artifacts[0]), 'list response should not expose filesystem paths');
    assert.ok(!JSON.stringify(artifacts[0]).includes('should-not-leak'));
    assert.ok(artifacts[0].contentUrl.includes(`/api/artifacts/${artifact.id}/content`));

    res = await fetch(`${baseUrl}/artifacts/${artifact.id}`);
    assert.strictEqual(res.status, 200);
    const detail = await res.json();
    assert.strictEqual(detail.id, artifact.id);
    assert.ok(!('path' in detail), 'detail response should not expose filesystem paths');

    res = await fetch(`${baseUrl}/artifacts/${artifact.id}/content`);
    assert.strictEqual(res.status, 404, 'missing file should produce 404 instead of leaking path');

    res = await fetch(`${baseUrl}/runs/${run.id}/artifacts/report`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const report = await res.json();
    assert.strictEqual(report.type, 'markdown');
    assert.strictEqual(report.title, 'Pentest report');

    res = await fetch(`${baseUrl}/artifacts/${report.id}/content`);
    assert.strictEqual(res.status, 200);
    const reportText = await res.text();
    assert.ok(reportText.includes('PHANTOM Pentest Report'));

    res = await fetch(`${baseUrl}/runs/${run.id}/graph`);
    assert.strictEqual(res.status, 200);
    const graph = await res.json();
    assert.strictEqual(graph.runId, run.id);
    assert.ok(graph.nodes.some(node => node.type === 'run'));
    assert.ok(graph.nodes.some(node => node.type === 'tool' && node.label === 'execute_command'));
    assert.ok(graph.nodes.some(node => node.type === 'artifact' && node.refId === artifact.id));
    assert.ok(graph.nodes.some(node => node.type === 'host' && node.label === '10.0.0.5'));
    assert.ok(graph.nodes.some(node => node.type === 'url' && node.label === 'https://api.example.com/login'));
    assert.ok(graph.edges.some(edge => edge.type === 'observed'));

    res = await fetch(`${baseUrl}/runs/${run.id}/artifacts/graph`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const graphArtifact = await res.json();
    assert.strictEqual(graphArtifact.type, 'json');
    assert.strictEqual(graphArtifact.title, 'Graph snapshot');

    res = await fetch(`${baseUrl}/artifacts/${graphArtifact.id}/content`);
    assert.strictEqual(res.status, 200);
    const graphSnapshot = await res.json();
    assert.strictEqual(graphSnapshot.runId, run.id);
    assert.ok(graphSnapshot.nodes.length >= graph.nodes.length);
  });

  test('Goal CRUD + activate/complete/progress flow', async () => {
    // POST create
    let res = await fetch(`${baseUrl}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'API goal',
        objective: 'Demonstrate the goal API end-to-end.',
        successCriteria: 'All CRUD endpoints respond as documented.',
      }),
    });
    assert.strictEqual(res.status, 201);
    const created = (await res.json()).goal;
    assert.ok(created.id);
    assert.strictEqual(created.status, 'active');

    // GET list (active by default)
    res = await fetch(`${baseUrl}/goals`);
    assert.strictEqual(res.status, 200);
    const list = (await res.json()).goals;
    assert.ok(list.some((g) => g.id === created.id));

    // POST validation error
    res = await fetch(`${baseUrl}/goals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', objective: 'x', successCriteria: 'y' }),
    });
    assert.strictEqual(res.status, 400);

    // GET current is null before activation
    res = await fetch(`${baseUrl}/goals/current`);
    let body = await res.json();
    assert.strictEqual(body.goal, null);

    // POST /goals/:id/activate
    res = await fetch(`${baseUrl}/goals/${created.id}/activate`, { method: 'POST' });
    assert.strictEqual(res.status, 200);

    res = await fetch(`${baseUrl}/goals/current`);
    body = await res.json();
    assert.strictEqual(body.goal.id, created.id);

    // POST progress
    res = await fetch(`${baseUrl}/goals/${created.id}/progress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'kicked off the recon phase', kind: 'step' }),
    });
    assert.strictEqual(res.status, 201);
    const prog = (await res.json()).progress;
    assert.strictEqual(prog.kind, 'step');

    // GET progress
    res = await fetch(`${baseUrl}/goals/${created.id}/progress`);
    assert.strictEqual(res.status, 200);
    const all = (await res.json()).progress;
    assert.ok(all.length >= 1);

    // GET /goals/:id detail bundles goal + progress + runs + count
    res = await fetch(`${baseUrl}/goals/${created.id}`);
    assert.strictEqual(res.status, 200);
    const detail = await res.json();
    assert.strictEqual(detail.goal.id, created.id);
    assert.ok(Array.isArray(detail.progress));
    assert.ok(Array.isArray(detail.runs));
    assert.strictEqual(typeof detail.linkedRunCount, 'number');

    // PATCH
    res = await fetch(`${baseUrl}/goals/${created.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'API goal (renamed)' }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).goal.title, 'API goal (renamed)');

    // POST complete
    res = await fetch(`${baseUrl}/goals/${created.id}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'operator confirmed' }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).goal.status, 'completed');

    // GET current is null again (complete clears the pointer)
    res = await fetch(`${baseUrl}/goals/current`);
    assert.strictEqual((await res.json()).goal, null);

    // GET list with status=all sees the completed one
    res = await fetch(`${baseUrl}/goals?status=all`);
    assert.ok((await res.json()).goals.some((g) => g.id === created.id));

    // DELETE
    res = await fetch(`${baseUrl}/goals/${created.id}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 204);

    res = await fetch(`${baseUrl}/goals/${created.id}`);
    assert.strictEqual(res.status, 404);
  });

  test('Campaign CRUD + goal queue + lifecycle controls', async () => {
    // POST create — missing required fields
    let res = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', objective: 'o' }),
    });
    assert.strictEqual(res.status, 400);

    // POST create — unknown scope id (must fail with 400 not 500)
    res = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 't', objective: 'o', scopeId: 'does-not-exist' }),
    });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /unknown scope_id/);

    // POST create — unknown toolpack
    res = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 't', objective: 'o', toolpackIds: ['totally-fake'] }),
    });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /unknown toolpack/);

    // POST create — happy path
    res = await fetch(`${baseUrl}/campaigns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Web recon campaign',
        objective: 'Map authorized lab and identify safe findings',
        runBudget: { maxChildRuns: 3 },
      }),
    });
    assert.strictEqual(res.status, 201);
    const campaign = (await res.json()).campaign;
    assert.strictEqual(campaign.status, 'draft');
    assert.strictEqual(campaign.run_budget.maxChildRuns, 3);

    // POST goal under campaign
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}/goals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'first goal', prompt: 'do recon' }),
    });
    assert.strictEqual(res.status, 201);
    const goal = (await res.json()).goal;
    assert.strictEqual(goal.status, 'queued');

    // GET detail bundles goals + runs
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}`);
    const detail = await res.json();
    assert.strictEqual(detail.goals.length, 1);
    assert.strictEqual(detail.runCount, 0);

    // Lifecycle: draft → running
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}/start`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).campaign.status, 'running');

    // Lifecycle: can't start again (already running)
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}/start`, { method: 'POST' });
    assert.strictEqual(res.status, 409);

    // Pause → resume
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}/pause`, { method: 'POST' });
    assert.strictEqual((await res.json()).campaign.status, 'paused');
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}/resume`, { method: 'POST' });
    assert.strictEqual((await res.json()).campaign.status, 'running');

    // Patch goal to running
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}/goals/${goal.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });
    assert.strictEqual((await res.json()).goal.status, 'running');

    // Patch evaluator result
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}/goals/${goal.id}/evaluate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'complete', confidence: 0.9, summary: 'all done' }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).goal.evaluator_result.decision, 'complete');

    // Cancel: any → canceled; queued goals get skipped
    // First create a second queued goal so cancel has something to skip
    await fetch(`${baseUrl}/campaigns/${campaign.id}/goals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'second goal', prompt: 'next' }),
    });
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}/cancel`, { method: 'POST' });
    assert.strictEqual((await res.json()).campaign.status, 'canceled');

    res = await fetch(`${baseUrl}/campaigns/${campaign.id}/goals`);
    const finalGoals = (await res.json()).goals;
    const queuedRemaining = finalGoals.filter((g) => g.status === 'queued');
    assert.strictEqual(queuedRemaining.length, 0, 'cancel skips remaining queued goals');

    // DELETE cascades
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 204);
    res = await fetch(`${baseUrl}/campaigns/${campaign.id}`);
    assert.strictEqual(res.status, 404);
  });
});

// ─── Local-network discovery (A1b) ─────────────────────────────────────────
//
// The discover endpoint shells out to arp/ip-neigh on the host; in test we
// route through the global module so any host environment works. We assert
// the policy-gate refusal (no scope, no ack) and the promote endpoint's
// idempotence semantics — both are the load-bearing contracts for the
// Assets scan modal.

describe('Local-network discovery routes', () => {
  let serverB;
  let baseUrlB;

  before(async () => {
    // Re-init under a fresh in-memory DB so existing test state from the
    // outer suite doesn't pollute the asset count.
    initDB(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    await new Promise((resolve) => {
      serverB = app.listen(0, () => {
        baseUrlB = `http://localhost:${serverB.address().port}/api`;
        resolve();
      });
    });
  });

  after(() => {
    if (serverB) serverB.close();
    closeDB();
  });

  test('POST /api/discover/local-network without scope or ack returns 403', async () => {
    const res = await fetch(`${baseUrlB}/discover/local-network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.risk, 'recon');
    assert.match(body.error, /scope|recon/i);
  });

  test('POST /api/discover/local-network with acknowledgedNoScope returns structured payload', async () => {
    const res = await fetch(`${baseUrlB}/discover/local-network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acknowledgedNoScope: true }),
    });
    // 200 on any host — the underlying tool may return zero neighbors if
    // arp / ip aren't on PATH; what we care about is the contract.
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.count === 'number');
    assert.ok(Array.isArray(body.neighbors));
    assert.strictEqual(body.acknowledgedNoScope, true);
  });

  test('POST /api/discover/local-network/promote creates new assets and skips duplicates', async () => {
    // First promote — both items are new, both get created.
    let res = await fetch(`${baseUrlB}/discover/local-network/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { ip: '10.99.0.1', mac: 'aa:bb:cc:dd:ee:01', hostname: 'router' },
          { ip: '10.99.0.2', mac: 'aa:bb:cc:dd:ee:02' },
        ],
      }),
    });
    assert.strictEqual(res.status, 200);
    let body = await res.json();
    assert.strictEqual(body.createdCount, 2);
    assert.strictEqual(body.skippedCount, 0);
    // Created assets carry the discovery tag.
    for (const asset of body.created) {
      assert.ok((asset.tags || []).includes('local-network-scan'),
        `created asset should be tagged local-network-scan, got ${(asset.tags || []).join(',')}`);
      assert.strictEqual(asset.metadata?.discoveredFrom, 'local-network-scan');
      // The new asset has its IP recorded as an address.
      assert.ok((asset.addresses || []).some((a) => a.kind === 'ip'));
    }

    // Second promote — the same IPs come back. Both should be skipped
    // (idempotence guarantee for repeated scans).
    res = await fetch(`${baseUrlB}/discover/local-network/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { ip: '10.99.0.1', mac: 'aa:bb:cc:dd:ee:01' },
          { ip: '10.99.0.2' },
          { ip: '10.99.0.3' }, // new — should be created
        ],
      }),
    });
    assert.strictEqual(res.status, 200);
    body = await res.json();
    assert.strictEqual(body.createdCount, 1, 'only the new IP is created');
    assert.strictEqual(body.skippedCount, 2, 'duplicate IPs are skipped');
    assert.ok(body.skipped.every((s) => /already exists/.test(s.reason)));
  });

  test('POST /api/discover/local-network/promote rejects empty items', async () => {
    const res = await fetch(`${baseUrlB}/discover/local-network/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    assert.strictEqual(res.status, 400);
  });

  test('POST /api/discover/local-network/promote dedupes within a single payload', async () => {
    const res = await fetch(`${baseUrlB}/discover/local-network/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { ip: '10.99.0.51' },
          { ip: '10.99.0.51' }, // duplicate of the first in the same call
        ],
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.createdCount, 1);
    assert.strictEqual(body.skippedCount, 1);
  });
});


// ── B1 — Registry browse + preview routes ────────────────────────────────
// Verify the read-only registry surface returns local manifests, surfaces
// the validation summary, gates the preview-install path on schema
// validity, and 404s unknown ids.

describe('Registry routes (B1)', () => {
  let serverR;
  let baseUrlR;

  before(async () => {
    initDB(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    await new Promise((resolve) => {
      serverR = app.listen(0, () => {
        baseUrlR = `http://localhost:${serverR.address().port}/api`;
        resolve();
      });
    });
  });

  after(() => {
    if (serverR) serverR.close();
    closeDB();
  });

  test('GET /api/registry/local returns summary + list', async () => {
    const res = await fetch(`${baseUrlR}/registry/local`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.summary);
    assert.ok(body.summary.total >= 7);
    assert.strictEqual(body.summary.invalid, 0);
    assert.ok(Array.isArray(body.manifests));
    assert.ok(body.manifests.some((m) => m.id === 'web-recon'));
    // List response strips full manifest content (kept light for the UI)
    for (const m of body.manifests) {
      assert.ok(m.id);
      assert.ok(m.version);
      assert.strictEqual(typeof m.valid, 'boolean');
      assert.strictEqual(m.errorCount, 0);
    }
  });

  test('GET /api/registry/local/:id returns the full record', async () => {
    const res = await fetch(`${baseUrlR}/registry/local/web-recon`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.id, 'web-recon');
    assert.strictEqual(body.valid, true);
    assert.ok(body.manifest);
    assert.strictEqual(body.manifest.identity.id, 'web-recon');
  });

  test('GET /api/registry/local/:id returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrlR}/registry/local/does-not-exist`);
    assert.strictEqual(res.status, 404);
  });

  test('POST /api/registry/local/:id/preview-install returns plan', async () => {
    const res = await fetch(`${baseUrlR}/registry/local/web-recon/preview-install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.id, 'web-recon');
    assert.ok(body.plan);
    assert.ok(Array.isArray(body.plan.recipes));
    assert.ok(Array.isArray(body.riskClasses));
    assert.match(body.note, /No execution/i);
  });
});
