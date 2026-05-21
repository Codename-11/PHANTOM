// Scope create — the full builder. Covers the pure logic (validation,
// target bucketing, deny-default action modes) plus DOM-level governance
// guards (locked exploit/destructive rows, default-deny matrix) and the
// create payload shape (action_modes + derived allowed/blocked arrays).
//
// GOVERNANCE INVARIANTS asserted here:
//   - exploit + destructive are policy-locked to deny and cannot be elevated.
//   - a fresh builder denies everything except read/local + recon.
//   - the create POST carries action_modes AND the derived blocked array; the
//     two locked classes are always in blockedActions.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/components/ui/toast';
import ScopeCreateRoute, {
  bucketTargets,
  defaultScopeFormState,
  validateScopeForm,
  type TargetChip,
} from './ScopeCreate';
import {
  ACTION_CLASSES,
  defaultActionModes,
  deriveAllowedBlocked,
  normalizeActionModes,
  setActionMode,
} from '@/lib/scopeBuilder';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Wrap the route in a ToastProvider so useToast() resolves (AppShell provides
// it in the real app).
function renderRoute() {
  return renderWithProviders(
    <ToastProvider>
      <ScopeCreateRoute />
    </ToastProvider>,
    { route: '/scope/new' },
  );
}

describe('validateScopeForm', () => {
  it('flags missing name', () => {
    const v = validateScopeForm(defaultScopeFormState());
    expect(v.ok).toBe(false);
    expect(v.errors.name).toMatch(/required/i);
  });

  it('passes when name is supplied', () => {
    const v = validateScopeForm({ ...defaultScopeFormState(), name: 'LAB' });
    expect(v.ok).toBe(true);
    expect(v.errors.name).toBeUndefined();
  });

  it('treats whitespace-only name as missing', () => {
    const v = validateScopeForm({ ...defaultScopeFormState(), name: '   ' });
    expect(v.ok).toBe(false);
    expect(v.errors.name).toMatch(/required/i);
  });
});

describe('scope-builder action-mode semantics (deny-default)', () => {
  it('defaults a fresh builder to deny except read/local + recon', () => {
    const modes = defaultActionModes();
    expect(modes['read/local']).toBe('auto');
    expect(modes['recon']).toBe('auto');
    expect(modes['network-scan']).toBe('deny');
    expect(modes['web-vuln']).toBe('deny');
    expect(modes['credentialed']).toBe('deny');
    expect(modes['online-bruteforce']).toBe('deny');
    // Locked classes are always deny.
    expect(modes['exploit']).toBe('deny');
    expect(modes['destructive']).toBe('deny');
  });

  it('refuses to elevate locked classes via setActionMode', () => {
    let modes = defaultActionModes();
    modes = setActionMode(modes, 'exploit', 'auto');
    modes = setActionMode(modes, 'destructive', 'ask');
    expect(modes['exploit']).toBe('deny');
    expect(modes['destructive']).toBe('deny');
  });

  it('re-pins locked classes to deny on normalize even if a payload widens them', () => {
    const widened = normalizeActionModes({
      exploit: 'auto',
      destructive: 'auto',
      recon: 'auto',
    } as never);
    expect(widened['exploit']).toBe('deny');
    expect(widened['destructive']).toBe('deny');
    expect(widened['recon']).toBe('auto');
    // Unspecified classes are denied.
    expect(widened['network-scan']).toBe('deny');
  });

  it('derives allowed from auto and blocked from deny (ask lands in neither)', () => {
    let modes = defaultActionModes();
    modes = setActionMode(modes, 'network-scan', 'ask');
    modes = setActionMode(modes, 'web-vuln', 'auto');
    const { allowedActions, blockedActions } = deriveAllowedBlocked(modes);
    expect(allowedActions).toContain('recon');
    expect(allowedActions).toContain('web-vuln');
    expect(allowedActions).not.toContain('network-scan'); // ask
    expect(blockedActions).toContain('exploit');
    expect(blockedActions).toContain('destructive');
    expect(blockedActions).toContain('online-bruteforce');
    expect(blockedActions).not.toContain('network-scan'); // ask
  });
});

describe('bucketTargets', () => {
  it('buckets chips by kind and folds asset chips + picker ids into assetIds', () => {
    const chips: TargetChip[] = [
      { id: 'host:a', kind: 'host', value: 'a.test' },
      { id: 'domain:b', kind: 'domain', value: 'b.test' },
      { id: 'cidr:c', kind: 'cidr', value: '10.0.0.0/24' },
      { id: 'url:d', kind: 'url', value: 'https://d.test' },
      { id: 'asset:x', kind: 'asset', value: 'asset-x' },
    ];
    const out = bucketTargets(chips, ['asset-y']);
    expect(out.hosts).toEqual(['a.test']);
    expect(out.domains).toEqual(['b.test']);
    expect(out.cidrs).toEqual(['10.0.0.0/24']);
    expect(out.urls).toEqual(['https://d.test']);
    expect(new Set(out.assetIds)).toEqual(new Set(['asset-x', 'asset-y']));
  });
});

describe('ScopeCreateRoute', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the locked exploit + destructive rows pinned to deny', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId('scope-create-form')).toBeInTheDocument();
    });

    for (const cls of ACTION_CLASSES.filter((c) => c.locked)) {
      // The matrix renders a locked tag (no mode buttons) for these.
      const tag = screen.getByTestId(`scope-mode-locked-${cls.id}`);
      expect(tag).toHaveTextContent(/locked · deny/i);
      // No clickable mode buttons exist for a locked row.
      expect(screen.queryByTestId(`scope-mode-${cls.id}-auto`)).toBeNull();
      // The reassurance blocked-grid checkbox is disabled + checked.
      const row = screen.getByTestId(`scope-blocked-${cls.id}`);
      expect(row).toHaveAttribute('data-disabled', 'true');
      expect(row).toHaveAttribute('data-checked', 'true');
    }
  });

  it('surfaces the required-name error when the user submits an empty form', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId('scope-create-submit')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('scope-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('scope-name-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('scope-name-error')).toHaveTextContent(/required/i);
    expect(screen.getByTestId('scope-create-feedback')).toHaveTextContent(/required/i);
  });

  it('parses targets via /api/scopes/parse-targets on blur and shows removable chips', async () => {
    let parseCalled = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/scopes/parse-targets') && init?.method === 'POST') {
        parseCalled++;
        return jsonResponse({
          targets: [
            { id: 'host:lab.test', type: 'host', value: 'lab.test' },
            { id: 'cidr:10.0.0.0/24', type: 'cidr', value: '10.0.0.0/24' },
          ],
          errors: [],
          scopeFields: { hosts: ['lab.test'], cidrs: ['10.0.0.0/24'], domains: [], urls: [] },
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId('scope-targets-input')).toBeInTheDocument();
    });
    const ta = screen.getByTestId('scope-targets-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'lab.test 10.0.0.0/24' } });
    fireEvent.blur(ta);

    await waitFor(() => {
      expect(parseCalled).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId('scope-target-chips')).toBeInTheDocument();
    });
    expect(screen.getByText('lab.test')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.0/24')).toBeInTheDocument();

    // Removing a chip drops it from the list.
    fireEvent.click(screen.getByTestId('scope-remove-target-lab.test'));
    await waitFor(() => {
      expect(screen.queryByText('lab.test')).toBeNull();
    });
    expect(screen.getByText('10.0.0.0/24')).toBeInTheDocument();
  });

  it('applies an intent template to seed the action-class matrix + name', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/scopes/templates')) {
        return jsonResponse([
          {
            id: 'web-recon',
            name: 'Web Recon',
            summary: 'Scoped HTTP probing.',
            allowedActions: ['recon', 'network-scan'],
            blockedActions: ['exploit', 'destructive', 'credentialed'],
          },
        ]);
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId('scope-intent-web-recon')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('scope-intent-web-recon'));

    // network-scan flips to allow; exploit/destructive stay locked-deny.
    await waitFor(() => {
      expect(screen.getByTestId('scope-mode-network-scan-auto')).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
    expect(screen.getByTestId('scope-mode-locked-exploit')).toBeInTheDocument();
    // Name was auto-seeded from the template (operator hadn't typed one).
    expect((screen.getByTestId('scope-name-input') as HTMLInputElement).value).toBe('WEB-RECON');
  });

  it('POSTs /api/scopes with action_modes and the locked classes always in blockedActions', async () => {
    let createBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/scopes' && init?.method === 'POST') {
        createBody = JSON.parse(String(init.body));
        return jsonResponse({
          id: 'created-1',
          name: 'LAB',
          targets: {},
          allowed_actions: ['recon'],
          blocked_actions: ['exploit', 'destructive'],
          action_modes: createBody!.actionModes,
          active_hours: null,
          blackout_windows: null,
          rate_caps: null,
          rules_of_engagement: '',
          credential_refs: [],
          notes: '',
          expires_at: null,
          created_at: new Date().toISOString(),
          updated_at: null,
          archived_at: null,
        });
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId('scope-name-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('scope-name-input'), {
      target: { value: 'LAB' },
    });

    fireEvent.click(screen.getByTestId('scope-create-submit'));

    await waitFor(() => {
      expect(createBody).not.toBeNull();
    });
    const body = createBody as unknown as {
      name: string;
      allowedActions: string[];
      blockedActions: string[];
      actionModes: Record<string, string>;
    };
    expect(body.name).toBe('LAB');
    // action_modes is the canonical field and carries the locked deny pins.
    expect(body.actionModes.exploit).toBe('deny');
    expect(body.actionModes.destructive).toBe('deny');
    // Locked classes always land in the derived blocked array.
    expect(body.blockedActions).toContain('exploit');
    expect(body.blockedActions).toContain('destructive');
    // Default allowed set (recon) flows through.
    expect(body.allowedActions).toContain('recon');
  });
});
