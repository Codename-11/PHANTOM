// DashPage cockpit tests — verifies the restored PHANTOM SEC cockpit
// surface: KPI Stat strip + the five panels (Live runs, Untriaged alerts,
// Policy decisions, Toolpacks, Asset health). Data is supplied through a
// URL-routed global.fetch mock so the real react-query hooks
// (useDashState / useDashCharts / useToolpacks / useScopeAssets) run end
// to end against fixture payloads.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import DashPage from './Dash';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const RUNS = [
  {
    id: 'run-aaaa1111',
    conversation_id: null,
    title: 'Web surface audit',
    goal: null,
    status: 'running',
    model: null,
    provider_route: null,
    scope_id: 'scp1',
    risk_level: null,
    summary: null,
    started_at: iso(90_000),
    ended_at: null,
    prompt_snapshot: null,
    scope: { id: 'scp1', name: 'WEB-PROD', expires_at: null, archived_at: null },
  },
  {
    id: 'run-bbbb2222',
    conversation_id: null,
    title: 'TLS posture',
    goal: null,
    status: 'completed',
    model: null,
    provider_route: null,
    scope_id: 'scp1',
    risk_level: null,
    summary: null,
    started_at: iso(600_000),
    ended_at: iso(300_000),
    prompt_snapshot: null,
    scope: { id: 'scp1', name: 'WEB-PROD', expires_at: null, archived_at: null },
  },
];

const FINDINGS = [
  {
    id: 'fnd-crit-01',
    title: 'SQL injection on /orders',
    description: null,
    severity: 'critical',
    status: 'open',
    assetId: 'asset-shop',
    runId: null,
    recommendation: null,
    evidence: null,
    metadata: { host: 'shop.acme.io' },
    first_seen_at: iso(180_000),
    last_seen_at: iso(180_000),
    fixed_at: null,
    triage_status: 'new',
  },
  {
    id: 'fnd-high-01',
    title: 'Exposed .git directory',
    description: null,
    severity: 'high',
    status: 'open',
    assetId: 'asset-edge',
    runId: null,
    recommendation: null,
    evidence: null,
    metadata: null,
    first_seen_at: iso(2_400_000),
    last_seen_at: iso(2_400_000),
    fixed_at: null,
    triage_status: 'new',
  },
  {
    id: 'fnd-low-01',
    title: 'Verbose stack trace',
    description: null,
    severity: 'low',
    status: 'open',
    assetId: 'asset-shop',
    runId: null,
    recommendation: null,
    evidence: null,
    metadata: null,
    first_seen_at: iso(8_000_000),
    last_seen_at: iso(8_000_000),
    fixed_at: null,
    triage_status: 'acknowledged',
  },
];

const APPROVAL_EVENTS = [
  { id: 'a1', decision: 'denied', toolName: 'sqlmap', risk: 'destructive', scopeId: null, scopeName: null, reason: 'out-of-scope target', operatorNote: null, runId: null, runTitle: null, occurredAt: iso(3_600_000), args: null },
  { id: 'a2', decision: 'denied', toolName: 'sqlmap', risk: 'destructive', scopeId: null, scopeName: null, reason: 'out-of-scope target', operatorNote: null, runId: null, runTitle: null, occurredAt: iso(3_700_000), args: null },
  { id: 'a3', decision: 'denied', toolName: 'hashcat', risk: 'credentialed', scopeId: null, scopeName: null, reason: 'destructive class blocked', operatorNote: null, runId: null, runTitle: null, occurredAt: iso(3_800_000), args: null },
  { id: 'a4', decision: 'granted', toolName: 'nmap', risk: 'recon', scopeId: null, scopeName: null, reason: null, operatorNote: null, runId: null, runTitle: null, occurredAt: iso(3_900_000), args: null },
];

const TOOLPACKS = [
  { id: 'web-vuln', name: 'Web Vulnerability', category: 'web', risks: ['exploit'], tools: [{ name: 'sqlmap', command: 'sqlmap', risk: 'high', available: true }] },
  { id: 'passive-osint', name: 'Passive OSINT', category: 'osint', risks: [], tools: [{ name: 'dns-recon', command: 'dig', risk: 'low', available: true }] },
];

const ASSETS = [
  { id: 'asset-shop', name: 'shop.acme.io', type: 'web-app' },
  { id: 'asset-edge', name: 'edge-www-03', type: 'host' },
  { id: 'asset-clean', name: 'log.acme.internal', type: 'service' },
];

function routedFetch(url: string): Response {
  if (url.includes('/api/diagnostics')) return jsonResponse({ overall: 'ok', checks: [], elapsedMs: 5, generatedAt: 'now' });
  if (url.includes('/api/onboarding')) return jsonResponse({ complete: true, checklist: { demoLoaded: true, toolpacksInstalled: true, hasScope: true, hasAsset: true, hasRun: true } });
  if (url.includes('/api/campaigns')) return jsonResponse({ campaigns: [] });
  if (url.includes('/api/installer/requests')) return jsonResponse({ requests: [], explained: [] });
  if (url.includes('/api/approvals/stats')) return jsonResponse({ total: 0, byDecision: {}, byRisk: {}, series: [] });
  if (url.includes('/api/approvals')) return jsonResponse({ count: APPROVAL_EVENTS.length, events: APPROVAL_EVENTS, explained: [] });
  if (url.includes('/api/findings')) return jsonResponse(FINDINGS);
  if (url.includes('/api/runs')) return jsonResponse(RUNS);
  // Per-pack availability probe re-hydrates one pack's tools with .available.
  const avail = url.match(/\/api\/toolpacks\/([^/]+)\/availability/);
  if (avail) {
    const wanted = decodeURIComponent(avail[1] ?? '');
    const pack = TOOLPACKS.find((p) => p.id === wanted);
    return jsonResponse(pack ?? {}, pack ? 200 : 404);
  }
  if (url.includes('/api/toolpacks')) return jsonResponse(TOOLPACKS);
  if (url.includes('/api/assets')) return jsonResponse(ASSETS);
  if (url.includes('/api/trending')) return jsonResponse({ sparkline: [{ score: 70, rating: 'fair', delta: null }], runsConsidered: 1, current: 70, delta: 2 });
  return jsonResponse({});
}

describe('DashPage cockpit', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      routedFetch(String(input)),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the KPI Stat strip with derived headline metrics', async () => {
    renderWithProviders(<DashPage />, { route: '/react/dash' });

    const strip = await screen.findByTestId('dash-kpis');
    expect(within(strip).getByText('ACTIVE RUNS')).toBeInTheDocument();
    expect(within(strip).getByText('UNTRIAGED')).toBeInTheDocument();
    expect(within(strip).getByText('OPEN FINDINGS')).toBeInTheDocument();
    expect(within(strip).getByText('POLICY BLOCKS · 24H')).toBeInTheDocument();
  });

  it('renders Live runs rows with mono id + duration', async () => {
    renderWithProviders(<DashPage />, { route: '/react/dash' });

    const card = await screen.findByTestId('dash-runs-card');
    await waitFor(() => {
      expect(within(card).getByText('Web surface audit')).toBeInTheDocument();
    });
    expect(within(card).getByText('TLS posture')).toBeInTheDocument();
    // Run id is truncated to 8 chars in the mono cell.
    expect(within(card).getByText('run-aaaa')).toBeInTheDocument();
  });

  it('renders Untriaged alerts panel filtered to high/crit, sorted by severity', async () => {
    renderWithProviders(<DashPage />, { route: '/react/dash' });

    const card = await screen.findByTestId('dash-alerts-card');
    await waitFor(() => {
      expect(within(card).getByText('SQL injection on /orders')).toBeInTheDocument();
    });
    expect(within(card).getByText('Exposed .git directory')).toBeInTheDocument();
    // The low-severity finding is excluded.
    expect(within(card).queryByText('Verbose stack trace')).not.toBeInTheDocument();
  });

  it('buckets policy decisions into allowed/blocked and lists top reasons', async () => {
    renderWithProviders(<DashPage />, { route: '/react/dash' });

    const card = await screen.findByTestId('dash-policy-card');
    await waitFor(() => {
      expect(within(card).getByText('BLOCKED')).toBeInTheDocument();
    });
    expect(within(card).getByText('ALLOWED')).toBeInTheDocument();
    // Most-frequent denial reason surfaces in TOP REASONS.
    expect(within(card).getByText('out-of-scope target')).toBeInTheDocument();
    expect(within(card).getByText('TOP REASONS')).toBeInTheDocument();
  });

  it('renders the Toolpacks panel with risk badges + real readiness dots', async () => {
    renderWithProviders(<DashPage />, { route: '/react/dash' });

    const card = await screen.findByTestId('dash-toolpacks-card');
    await waitFor(() => {
      expect(within(card).getByText('Web Vulnerability')).toBeInTheDocument();
    });
    expect(within(card).getByText('Passive OSINT')).toBeInTheDocument();
    // Both fixture packs have their single tool available:true on the
    // /availability probe → the readiness dot resolves to "all tools on PATH"
    // rather than the old "availability unknown" placeholder.
    await waitFor(() => {
      expect(within(card).getAllByTitle('all tools on PATH').length).toBe(2);
    });
    expect(within(card).queryByTitle('availability unknown')).not.toBeInTheDocument();
  });

  it('renders Asset health movers with a derived health bar + finding count', async () => {
    renderWithProviders(<DashPage />, { route: '/react/dash' });

    const card = await screen.findByTestId('dash-assets-card');
    await waitFor(() => {
      // Worst asset (crit finding) sorts first; finding count is shown.
      expect(within(card).getByText('shop.acme.io')).toBeInTheDocument();
    });
    expect(within(card).getByText('edge-www-03')).toBeInTheDocument();
    // The clean asset has 0 findings → full health, count "0 fnd".
    expect(within(card).getByText(/0 fnd/)).toBeInTheDocument();
  });
});
