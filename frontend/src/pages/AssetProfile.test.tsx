// AssetProfile page — renders identity / health / findings / services /
// scope-membership from GET /api/assets/:id (+ derived scope membership
// from GET /api/scopes), and degrades to clear empty states when an
// asset has no findings/services/scopes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { makeQueryClient } from '@/test/test-utils';
import { ToastProvider } from '@/components/ui/toast';
import AssetProfilePage from './AssetProfile';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fullAsset = {
  id: 'a_shop_p4f9',
  type: 'web-app',
  name: 'shop.acme.io',
  description: 'commerce front-end',
  owner: 'team-commerce',
  environment: 'prod-eu',
  status: 'active',
  criticality: 'high',
  notes: '',
  metadata: {},
  addresses: [
    { id: 'ad1', kind: 'domain', value: 'shop.acme.io', label: null },
    { id: 'ad2', kind: 'ip', value: '10.40.12.4', label: null },
  ],
  services: [
    {
      id: 'sv1',
      name: 'https',
      protocol: 'tcp',
      port: 443,
      url: null,
      status: 'open',
      metadata: { banner: 'nginx/1.20.1', tls: 'TLS 1.3' },
    },
  ],
  tags: ['nginx', 'node'],
  findings: [
    {
      id: 'fnd-7818abcd',
      title: 'Reflected XSS · /search?q',
      severity: 'high',
      status: 'open',
      assetId: 'a_shop_p4f9',
      runId: null,
      metadata: { rule: 'web-vuln:nuclei', cwe: 'CWE-79' },
      first_seen_at: '2026-05-17T12:00:00Z',
      last_seen_at: '2026-05-20T12:00:00Z',
      fixed_at: null,
      triage_status: 'in_progress',
    },
    {
      id: 'fnd-closed1',
      title: 'Old resolved issue',
      severity: 'low',
      status: 'closed',
      assetId: 'a_shop_p4f9',
      runId: null,
      metadata: {},
      first_seen_at: '2026-05-01T12:00:00Z',
      last_seen_at: '2026-05-02T12:00:00Z',
      fixed_at: '2026-05-03T12:00:00Z',
      triage_status: 'closed',
    },
  ],
  snapshots: [
    { id: 's1', healthScore: 41, findingCounts: {}, captured_at: '2026-05-20T12:00:00Z' },
    { id: 's2', healthScore: 55, findingCounts: {}, captured_at: '2026-05-18T12:00:00Z' },
  ],
  created_at: '2026-05-01T12:00:00Z',
  updated_at: '2026-05-20T12:00:00Z',
};

const scopes = [
  {
    id: 'sc1',
    name: 'WEB-PROD-Q2',
    targets: { assetIds: ['a_shop_p4f9'] },
    allowed_actions: ['recon', 'web-vuln'],
    blocked_actions: ['destructive'],
    action_modes: null,
    expires_at: '2099-01-01T00:00:00Z',
    archived_at: null,
    created_at: '2026-05-01T12:00:00Z',
    updated_at: null,
    rules_of_engagement: '',
    credential_refs: [],
    notes: '',
    active_hours: null,
    blackout_windows: null,
    rate_caps: null,
  },
  {
    id: 'sc2',
    name: 'OTHER-SCOPE',
    targets: { assetIds: ['some-other-asset'] },
    allowed_actions: ['recon'],
    blocked_actions: [],
    action_modes: null,
    expires_at: null,
    archived_at: null,
    created_at: '2026-05-01T12:00:00Z',
    updated_at: null,
    rules_of_engagement: '',
    credential_refs: [],
    notes: '',
    active_hours: null,
    blackout_windows: null,
    rate_caps: null,
  },
];

const emptyAsset = {
  ...fullAsset,
  id: 'a_empty',
  name: 'bare.acme.io',
  services: [],
  findings: [],
  snapshots: [],
  tags: [],
};

function stubFetch(opts: { asset?: unknown; scopes?: unknown; assetStatus?: number } = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/assets/')) {
      if (opts.assetStatus && opts.assetStatus >= 400) {
        return jsonResponse({ error: 'Asset not found' }, opts.assetStatus);
      }
      return jsonResponse(opts.asset ?? fullAsset);
    }
    if (url.includes('/api/scopes')) {
      return jsonResponse(opts.scopes ?? scopes);
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
}

function renderAt(id: string) {
  const qc = makeQueryClient();
  return render(
    <ToastProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/assets/${id}`]}>
          <Routes>
            <Route path="/assets/:id" element={<AssetProfilePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

describe('AssetProfilePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders identity, health, open findings, services, and scope membership', async () => {
    stubFetch();
    renderAt('a_shop_p4f9');

    // Title + identity
    expect(
      await screen.findByRole('heading', { name: 'shop.acme.io' }),
    ).toBeInTheDocument();
    expect(screen.getByText('a_shop_p4f9')).toBeInTheDocument();
    expect(screen.getByText('team-commerce')).toBeInTheDocument();

    // Health — snapshot score is live (41)
    expect(screen.getByTestId('asset-health-score')).toHaveTextContent('41');
    expect(screen.getByTestId('asset-sev-distribution')).toBeInTheDocument();

    // Open findings: the open one is present, the closed one filtered out.
    const table = screen.getByTestId('asset-findings-table');
    expect(table).toHaveTextContent('Reflected XSS');
    expect(table).toHaveTextContent('web-vuln:nuclei');
    expect(table).toHaveTextContent('CWE-79');
    expect(table).not.toHaveTextContent('Old resolved issue');

    // Services
    const services = screen.getByTestId('asset-services-table');
    expect(services).toHaveTextContent('443');
    expect(services).toHaveTextContent('nginx/1.20.1');
    expect(services).toHaveTextContent('TLS 1.3');

    // Scope membership: only the matching scope, not OTHER-SCOPE.
    await waitFor(() =>
      expect(screen.getByTestId('asset-scopes')).toHaveTextContent('WEB-PROD-Q2'),
    );
    expect(screen.getByTestId('asset-scopes')).not.toHaveTextContent('OTHER-SCOPE');
  });

  it('shows empty states for an asset with no findings, services, or scopes', async () => {
    stubFetch({ asset: emptyAsset, scopes });
    renderAt('a_empty');

    expect(await screen.findByText('bare.acme.io')).toBeInTheDocument();
    expect(screen.getByTestId('asset-findings-empty')).toBeInTheDocument();
    expect(screen.getByTestId('asset-services-empty')).toBeInTheDocument();
    expect(screen.getByTestId('asset-scopes-empty')).toBeInTheDocument();
  });

  it('renders an error state when the asset fails to load', async () => {
    stubFetch({ assetStatus: 404 });
    renderAt('missing');

    expect(await screen.findByTestId('asset-profile-error')).toBeInTheDocument();
  });
});
