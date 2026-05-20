// Campaign create form — pure validation surface + a couple of smoke
// renders to make sure the dialog mounts the right sections.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import {
  defaultFormState,
  validateFormState,
  toCreatePayload,
  generatePromptPreview,
  CampaignCreateForm,
} from './CampaignCreate';
import type { CampaignFormState } from '@/lib/types';

describe('validateFormState', () => {
  it('flags missing title + objective', () => {
    const v = validateFormState(defaultFormState());
    expect(v.ok).toBe(false);
    expect(v.errors.title).toBeTruthy();
    expect(v.errors.objective).toBeTruthy();
  });

  it('requires a scope when an allowed risk class needs one', () => {
    const state: CampaignFormState = {
      ...defaultFormState(),
      title: 'C',
      objective: 'O',
    };
    // default allowed includes 'recon' → scope required
    let v = validateFormState(state);
    expect(v.errors.scopeId).toBeTruthy();

    // strip down to only 'read/local' (no scope needed)
    state.riskBudget.allowedRiskClasses = ['read/local'];
    v = validateFormState(state);
    expect(v.ok).toBe(true);
  });

  it('codex-exec requires a workdir', () => {
    const state: CampaignFormState = {
      ...defaultFormState(),
      title: 'C',
      objective: 'O',
      riskBudget: {
        ...defaultFormState().riskBudget,
        allowedRiskClasses: ['read/local'],
      },
      backend: 'codex-exec',
    };
    const v = validateFormState(state);
    expect(v.errors.workdir).toBeTruthy();
  });

  it('positive integer required for max child runs', () => {
    const state: CampaignFormState = {
      ...defaultFormState(),
      title: 'C',
      objective: 'O',
      riskBudget: {
        ...defaultFormState().riskBudget,
        allowedRiskClasses: ['read/local'],
      },
      runBudget: { ...defaultFormState().runBudget, maxChildRuns: 0 },
    };
    const v = validateFormState(state);
    expect(v.errors.maxChildRuns).toBeTruthy();
  });
});

describe('toCreatePayload', () => {
  it('maps state to API body with trimmed strings + notification policy', () => {
    const state: CampaignFormState = {
      ...defaultFormState(),
      title: '  Map AdminPortal  ',
      objective: 'find admins',
      scopeId: 'scope-a',
      toolpackIds: ['web-recon'],
      backend: 'codex-exec',
      workdir: '/lab',
    };
    const body = toCreatePayload(state);
    expect(body.title).toBe('Map AdminPortal');
    expect(body.scopeId).toBe('scope-a');
    expect(body.workerBackend).toBe('codex-exec');
    expect(body.notificationPolicy?.workdir).toBe('/lab');
  });

  it('phantom-native backend leaves notificationPolicy null', () => {
    const state: CampaignFormState = {
      ...defaultFormState(),
      title: 'X',
      objective: 'Y',
    };
    expect(toCreatePayload(state).notificationPolicy).toBeNull();
  });
});

describe('generatePromptPreview', () => {
  it('substitutes objective + allowed risk classes', () => {
    const state: CampaignFormState = {
      ...defaultFormState(),
      objective: 'Map the lab.',
      riskBudget: {
        ...defaultFormState().riskBudget,
        allowedRiskClasses: ['recon'],
      },
    };
    const preview = generatePromptPreview(state, []);
    expect(preview).toMatch(/Map the lab\./);
    expect(preview).toMatch(/Allowed risk classes: recon/);
  });
});

describe('CampaignCreateForm rendering', () => {
  it('renders the identity / governance / tools / budgets sections', () => {
    const state = defaultFormState();
    const validation = validateFormState(state);
    renderWithProviders(
      <CampaignCreateForm
        scopes={[{ id: 'scope-a', name: 'Lab A' }]}
        profiles={[{ id: 'p1', name: 'Default' }]}
        toolpacks={[{ id: 'web-recon', name: 'Web recon', risks: ['recon'] }]}
        backends={[
          { id: 'phantom-native', available: true },
          { id: 'codex-exec', available: false },
        ]}
        state={state}
        setState={() => {}}
        validation={validation}
        submitted={false}
      />,
    );
    expect(screen.getByRole('heading', { name: /Identity/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Governance/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Tools & worker/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Budgets$/ })).toBeInTheDocument();
    // Live prompt preview renders.
    expect(screen.getByTestId('cf-prompt-preview')).toBeInTheDocument();
  });

  it('shows scope validation error after submit when scoped risk is on', () => {
    const state: CampaignFormState = {
      ...defaultFormState(),
      title: 't',
      objective: 'o',
    };
    const validation = validateFormState(state);
    renderWithProviders(
      <CampaignCreateForm
        scopes={[]}
        profiles={[]}
        toolpacks={[]}
        backends={[]}
        state={state}
        setState={() => {}}
        validation={validation}
        submitted
      />,
    );
    expect(
      screen.getByText(/Scope is required when network/i),
    ).toBeInTheDocument();
  });
});
