// DashHero tests — port of the 7 deriveAction priority tests from the
// legacy frontend/js/pages/dash-hero.test.js. Each test asserts the
// 5-priority cascade implemented in lib/dash.ts deriveAction().
//
// Additional render test confirms the structured component surface
// (eyebrow / title / CTA / continue pill) lines up with the legacy
// dash-hero HTML.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { DashHero } from './DashHero';
import { deriveAction } from '@/lib/dash';
import type { Campaign, DiagnosticsResult, OnboardingChecklist } from '@/lib/types';

function diagBlocked(detail = 'sqlite open failed'): DiagnosticsResult {
  return {
    overall: 'blocked',
    checks: [{ id: 'db', status: 'blocked', detail, elapsedMs: 4 }],
    elapsedMs: 10,
    generatedAt: '2026-05-20T00:00:00Z',
  };
}

function checklistIncomplete(partial: Partial<OnboardingChecklist['checklist']> = {}): OnboardingChecklist {
  return {
    complete: false,
    checklist: {
      demoLoaded: false,
      toolpacksInstalled: false,
      hasScope: false,
      hasAsset: false,
      hasRun: false,
      ...partial,
    },
  };
}

const runningCampaign: Campaign = {
  id: 'c1',
  title: 'Recon sweep',
  objective: 'Map perimeter',
  status: 'running',
  scope_id: null,
  prompt_profile_id: null,
  toolpack_ids: [],
  worker_backend: 'phantom-native',
  run_budget: {},
  risk_budget: {},
  notification_policy: null,
  created_at: '2026-05-20T00:00:00Z',
  started_at: null,
  ended_at: null,
};

describe('deriveAction (cascade)', () => {
  it('priority 1: blocked diagnostic wins over everything else', () => {
    const a = deriveAction({
      diag: diagBlocked(),
      checklist: checklistIncomplete(),
      campaigns: [{ ...runningCampaign }],
      approvalsPending: 2,
    });
    expect(a.tone).toBe('crit');
    expect(a.title).toMatch(/Fix db/);
  });

  it('priority 2: onboarding incomplete wins over approvals + campaigns', () => {
    const a = deriveAction({
      diag: { overall: 'ok', checks: [], elapsedMs: 5, generatedAt: 'now' } as DiagnosticsResult,
      checklist: checklistIncomplete({ demoLoaded: false, toolpacksInstalled: false }),
      campaigns: [{ ...runningCampaign }],
      approvalsPending: 1,
    });
    expect(a.eyebrow).toBe('Get started');
    expect(a.title).toMatch(/Load demo scenario/);
  });

  it('priority 3: approvals win over campaigns when onboarding complete', () => {
    const a = deriveAction({
      diag: { overall: 'ok', checks: [], elapsedMs: 5, generatedAt: 'now' } as DiagnosticsResult,
      checklist: { complete: true, checklist: {
        demoLoaded: true, toolpacksInstalled: true, hasScope: true, hasAsset: true, hasRun: true,
      } },
      campaigns: [{ ...runningCampaign }],
      approvalsPending: 3,
    });
    expect(a.eyebrow).toBe('Awaiting your decision');
    expect(a.title).toMatch(/Review 3 approvals/);
  });

  it('priority 4: active campaign when nothing else pending', () => {
    const a = deriveAction({
      diag: { overall: 'ok', checks: [], elapsedMs: 5, generatedAt: 'now' } as DiagnosticsResult,
      checklist: { complete: true, checklist: {
        demoLoaded: true, toolpacksInstalled: true, hasScope: true, hasAsset: true, hasRun: true,
      } },
      campaigns: [{ ...runningCampaign }],
      approvalsPending: 0,
    });
    expect(a.eyebrow).toBe('Active campaign');
    expect(a.title).toMatch(/Continue Recon sweep/);
  });

  it('priority 5: default new-campaign CTA', () => {
    const a = deriveAction({
      diag: { overall: 'ok', checks: [], elapsedMs: 5, generatedAt: 'now' } as DiagnosticsResult,
      checklist: { complete: true, checklist: {
        demoLoaded: true, toolpacksInstalled: true, hasScope: true, hasAsset: true, hasRun: true,
      } },
      campaigns: [{ ...runningCampaign, status: 'completed' }],
      approvalsPending: 0,
    });
    expect(a.eyebrow).toBe('Ready');
    expect(a.title).toMatch(/Start a new campaign/);
  });

  it('diag null + checklist null falls through to campaigns/approvals/default', () => {
    const a = deriveAction({
      diag: null,
      checklist: null,
      campaigns: [],
      approvalsPending: 0,
    });
    expect(a.eyebrow).toBe('Ready');
  });

  it('returns special characters in title verbatim (escape happens at render time)', () => {
    const a = deriveAction({
      diag: { overall: 'ok', checks: [], elapsedMs: 5, generatedAt: 'now' } as DiagnosticsResult,
      checklist: { complete: true, checklist: {
        demoLoaded: true, toolpacksInstalled: true, hasScope: true, hasAsset: true, hasRun: true,
      } },
      campaigns: [{ ...runningCampaign, title: '<script>alert(1)</script>' }],
      approvalsPending: 0,
    });
    expect(a.title).toMatch(/<script>/);
  });
});

describe('DashHero rendering', () => {
  it('surfaces eyebrow, title, body, and CTA from a DashHeroAction', () => {
    render(
      <MemoryRouter>
        <DashHero
          action={{
            eyebrow: 'Active campaign',
            title: 'Continue Recon sweep',
            body: 'Map perimeter',
            ctaLabel: 'Open campaign',
            ctaRoute: 'campaigns',
            tone: 'cy',
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Active campaign')).toBeInTheDocument();
    expect(screen.getByText('Continue Recon sweep')).toBeInTheDocument();
    expect(screen.getByText('Map perimeter')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Open campaign/ });
    expect(cta).toHaveAttribute('href', '/react/campaigns');
  });

  it('renders the Continue-where-left-off pill when one is provided', () => {
    render(
      <MemoryRouter>
        <DashHero
          action={{
            eyebrow: 'Ready',
            title: 'Start a new campaign',
            body: '',
            ctaLabel: 'New campaign',
            ctaRoute: 'campaigns',
            tone: 'cy',
          }}
          continueCard={{
            kind: 'conversation',
            id: 'conv-1',
            label: 'Last chat',
            route: 'campaigns',
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('continue-pill')).toBeInTheDocument();
    expect(screen.getByText('Last chat')).toBeInTheDocument();
  });
});
