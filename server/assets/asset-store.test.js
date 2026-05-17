import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { initDB, closeDB, getDB, createConversation, createRun, addTraceEvent } from '../memory/store.js';
import { createScope } from '../scope/scope-store.js';
import { evaluateToolAction } from '../scope/policy.js';
import {
  createAsset,
  getAsset,
  getAssets,
  updateAsset,
  archiveAsset,
  createFinding,
  updateFinding,
  getFindings,
  createAssetSnapshot,
  getAssetSnapshots,
  createRunTemplateFromRun,
  materializeRunFromTemplate,
  compareAssetSnapshots,
} from './asset-store.js';

describe('asset registry and mitigation reruns', () => {
  afterEach(() => closeDB());

  test('creates rich assets with redacted credential references, addresses, services, and tags', () => {
    initDB(':memory:');
    const asset = createAsset({
      type: 'device',
      name: 'Docker-Server',
      owner: 'Bailey',
      environment: 'homelab',
      notes: 'Primary docker host',
      credentialRefs: ['vault:docker-ref'],
      addresses: [
        { kind: 'ip', value: '172.16.24.250' },
        { kind: 'hostname', value: 'docker-server.local' },
      ],
      services: [
        { name: 'ssh', protocol: 'tcp', port: 22, status: 'open' },
        { name: 'phantom', protocol: 'https', port: 443, url: 'https://phantom.example.test', status: 'open' },
      ],
      tags: ['critical', 'docker'],
    });

    assert.strictEqual(asset.name, 'Docker-Server');
    assert.strictEqual(asset.credentialRefs.length, 1);
    assert.strictEqual(asset.credentialRefs[0], '[REDACTED]');
    assert.ok(!JSON.stringify(asset).includes('vault:docker-ref'));
    assert.ok(!getDB().prepare('SELECT credential_refs_json FROM assets WHERE id = ?').get(asset.id).credential_refs_json.includes('vault:docker-ref'));
    assert.deepStrictEqual(asset.addresses.map(a => a.value).sort(), ['172.16.24.250', 'docker-server.local']);
    assert.strictEqual(asset.services.length, 2);
    assert.deepStrictEqual(asset.tags.sort(), ['critical', 'docker']);

    const fetched = getAsset(asset.id);
    assert.strictEqual(fetched.id, asset.id);
    assert.ok(getAssets({ query: 'docker', tag: 'critical' }).some(item => item.id === asset.id));

    const updated = updateAsset(asset.id, { status: 'active', tags: ['critical', 'patched'] });
    assert.strictEqual(updated.status, 'active');
    assert.deepStrictEqual(updated.tags.sort(), ['critical', 'patched']);

    const archived = archiveAsset(asset.id);
    assert.ok(archived.archived_at);
    assert.ok(!getAssets().some(item => item.id === asset.id));
    assert.ok(getAssets({ includeArchived: true }).some(item => item.id === asset.id));
  });

  test('scope policy can authorize risky actions through referenced asset targets', () => {
    initDB(':memory:');
    const asset = createAsset({
      type: 'network',
      name: 'Lab subnet',
      addresses: [{ kind: 'cidr', value: '172.16.24.0/24' }],
      services: [{ name: 'portal', protocol: 'https', port: 443, url: 'https://lab.example.test' }],
    });
    const scope = createScope({
      name: 'Asset-backed scope',
      targets: { assetIds: [asset.id], hosts: ['jumpbox.local'] },
      allowedActions: ['recon', 'network-scan'],
      blockedActions: ['destructive'],
    });

    const allowed = evaluateToolAction({ toolName: 'execute_command', args: { command: 'nmap 172.16.24.42' }, scope });
    assert.strictEqual(allowed.allowed, true);
    assert.match(allowed.reason, /inside selected scope/i);

    const denied = evaluateToolAction({ toolName: 'execute_command', args: { command: 'nmap 10.10.10.10' }, scope });
    assert.strictEqual(denied.allowed, false);
    assert.match(denied.reason, /outside selected scope/i);
  });

  test('findings, snapshots, comparisons, and rerun templates link assets to runs and evidence', () => {
    initDB(':memory:');
    const conv = createConversation('Mitigation test');
    const asset = createAsset({
      type: 'web_app',
      name: 'Portal',
      addresses: [{ kind: 'url', value: 'https://portal.example.test' }],
      services: [{ name: 'https', protocol: 'tcp', port: 443, url: 'https://portal.example.test', status: 'open' }],
    });
    const scope = createScope({ name: 'Portal scope', targets: { assetIds: [asset.id] }, allowedActions: ['recon'] });
    const run = createRun({ conversationId: conv.id, title: 'Baseline run', goal: 'Check portal', model: 'grok-4.3', providerRoute: 'hermes-proxy', scopeId: scope.id, promptSnapshot: { scope: { id: scope.id, credential_refs: ['credential-ref'] } } });
    const event = addTraceEvent(run.id, { type: 'tool.call.completed', phase: 'tool', status: 'completed', toolName: 'web_request', outputPreview: 'Server: nginx/1.18.0' });

    const finding = createFinding({
      assetId: asset.id,
      runId: run.id,
      traceEventId: event.id,
      scopeId: scope.id,
      title: 'Version header exposed',
      severity: 'medium',
      status: 'open',
      evidence: 'Server: nginx/1.18.0',
      recommendation: 'Disable version tokens',
    });
    assert.strictEqual(finding.status, 'open');
    assert.strictEqual(getFindings({ assetId: asset.id })[0].id, finding.id);

    const before = createAssetSnapshot({
      assetId: asset.id,
      scopeId: scope.id,
      runId: run.id,
      title: 'Before mitigation',
      status: 'degraded',
      healthScore: 62,
      observations: { ports: [443], headers: { server: 'nginx/1.18.0' } },
      findingCounts: { open: 1, mitigated: 0, medium: 1 },
      artifactIds: ['artifact-before'],
    });
    updateFinding(finding.id, { status: 'mitigated', fixedAt: '2026-05-17T20:00:00.000Z' });
    const after = createAssetSnapshot({
      assetId: asset.id,
      scopeId: scope.id,
      runId: run.id,
      title: 'After mitigation',
      status: 'healthy',
      healthScore: 91,
      observations: { ports: [443], headers: {} },
      findingCounts: { open: 0, mitigated: 1, medium: 0 },
      artifactIds: ['artifact-after'],
    });

    const comparison = compareAssetSnapshots({ baseSnapshotId: before.id, compareSnapshotId: after.id, title: 'Mitigation delta' });
    assert.strictEqual(comparison.diff.healthDelta, 29);
    assert.strictEqual(comparison.diff.resolvedFindings, 1);
    assert.ok(comparison.summary.includes('health +29'));

    const template = createRunTemplateFromRun(run.id, { name: 'Portal verification rerun', assetIds: [asset.id] });
    assert.strictEqual(template.source_run_id, run.id);
    assert.deepStrictEqual(template.assetIds, [asset.id]);
    assert.ok(!JSON.stringify(template).includes('credential-ref'));

    const rerun = materializeRunFromTemplate(template.id, { conversationId: conv.id, title: 'After mitigation rerun' });
    assert.strictEqual(rerun.scope_id, scope.id);
    assert.ok(rerun.goal.includes('Check portal'));
    assert.ok(getAssetSnapshots({ assetId: asset.id }).length >= 2);
  });
});
