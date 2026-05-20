// Campaign create Dialog — translation of campaign-form.js into React.
//
// The form state lives in React useState. Validation runs synchronously
// every render so the submit button's disabled state and inline error
// messages stay current. On submit, the create mutation invalidates
// the list query and navigates to the new campaign's detail Sheet.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Card, CardContent } from '@/components/ui/card';
import { RiskGrid } from '@/components/RiskGrid';
import { ToolpackPicker } from '@/components/ToolpackPicker';
import { SCOPE_REQUIRED } from '@/lib/campaigns';
import { useCampaignRefs, useCreateCampaign } from '@/lib/useCampaigns';
import type {
  CampaignFormState,
  CreateCampaignBody,
  PromptProfile,
  Scope,
  Toolpack,
  WorkerBackend,
  BackendDescriptor,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const DEFAULT_BLOCKED = [
  'exploit',
  'destructive',
  'credentialed',
  'online-bruteforce',
];

export function defaultFormState(): CampaignFormState {
  return {
    title: '',
    objective: '',
    scopeId: '',
    profileId: '',
    toolpackIds: [],
    backend: 'phantom-native',
    workdir: '',
    runBudget: { maxChildRuns: 10, maxAttemptsPerGoal: 2, maxWallClockMinutes: 120 },
    riskBudget: {
      allowedRiskClasses: ['read/local', 'recon'],
      blockedRiskClasses: [...DEFAULT_BLOCKED],
      pauseOnNewFinding: true,
      pauseOnApprovalRequired: true,
    },
  };
}

interface ValidationResult {
  ok: boolean;
  errors: Partial<Record<string, string>>;
}

export function validateFormState(state: CampaignFormState): ValidationResult {
  const errors: Partial<Record<string, string>> = {};
  if (!state.title.trim()) errors.title = 'Title is required.';
  if (!state.objective.trim()) errors.objective = 'Objective is required.';
  const allowed = state.riskBudget.allowedRiskClasses;
  const wantsScopedRisk = allowed.some((c) => SCOPE_REQUIRED.has(c));
  if (wantsScopedRisk && !state.scopeId) {
    errors.scopeId =
      'Scope is required when network / security risk classes are enabled.';
  }
  if (state.backend === 'codex-exec' && !state.workdir.trim()) {
    errors.workdir = 'Codex working directory is required for codex-exec.';
  }
  if (!Number.isInteger(+state.runBudget.maxChildRuns) || +state.runBudget.maxChildRuns < 1) {
    errors.maxChildRuns = 'Max child runs must be a positive integer.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toCreatePayload(state: CampaignFormState): CreateCampaignBody {
  return {
    title: state.title.trim(),
    objective: state.objective.trim(),
    scopeId: state.scopeId || null,
    promptProfileId: state.profileId || null,
    toolpackIds: state.toolpackIds.slice(),
    workerBackend: state.backend,
    runBudget: {
      maxChildRuns: parseInt(String(state.runBudget.maxChildRuns), 10) || 10,
      maxAttemptsPerGoal: parseInt(String(state.runBudget.maxAttemptsPerGoal), 10) || 2,
      maxWallClockMinutes:
        parseInt(String(state.runBudget.maxWallClockMinutes), 10) || 120,
    },
    riskBudget: {
      allowedRiskClasses: state.riskBudget.allowedRiskClasses.slice(),
      blockedRiskClasses: state.riskBudget.blockedRiskClasses.slice(),
      pauseOnNewFinding: !!state.riskBudget.pauseOnNewFinding,
      pauseOnApprovalRequired: !!state.riskBudget.pauseOnApprovalRequired,
    },
    notificationPolicy:
      state.backend === 'codex-exec' && state.workdir
        ? { workdir: state.workdir }
        : null,
  };
}

export function generatePromptPreview(
  state: CampaignFormState,
  scopes: Scope[],
): string {
  const scopeName = scopes.find((s) => s.id === state.scopeId)?.name;
  const tps = state.toolpackIds.length ? state.toolpackIds.join(', ') : 'none';
  const allowed = state.riskBudget.allowedRiskClasses.join(', ') || 'none';
  const rb = state.runBudget;
  return [
    'You are PHANTOM’s governed security goal supervisor.',
    '',
    'Objective:',
    state.objective || '[ONE-SENTENCE OBJECTIVE]',
    '',
    'Authorized scope:',
    `- Scope: ${scopeName || state.scopeId || '[SCOPE]'}`,
    `- Allowed risk classes: ${allowed}`,
    `- Blocked unless approved: ${state.riskBudget.blockedRiskClasses.join(', ') || 'none'}`,
    '',
    'Toolpacks:',
    `- ${tps}`,
    '',
    'Budgets:',
    `- Max child runs: ${rb.maxChildRuns}`,
    `- Max attempts per goal: ${rb.maxAttemptsPerGoal}`,
    `- Max wall-clock: ${rb.maxWallClockMinutes} min`,
    `- Pause on new finding: ${state.riskBudget.pauseOnNewFinding ? 'yes' : 'no'}`,
    `- Pause on approval-required: ${state.riskBudget.pauseOnApprovalRequired ? 'yes' : 'no'}`,
    '',
    'Start by decomposing the objective into the smallest useful first goal, then execute only that first goal. After the child run, evaluate whether to continue, retry, branch, request approval, pause, or complete.',
  ].join('\n');
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <h3 className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  htmlFor,
  label,
  hint,
  error,
  children,
}: {
  htmlFor?: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

interface CampaignCreateFormProps {
  scopes: Scope[];
  profiles: PromptProfile[];
  toolpacks: Toolpack[];
  backends: BackendDescriptor[];
  state: CampaignFormState;
  setState: React.Dispatch<React.SetStateAction<CampaignFormState>>;
  validation: ValidationResult;
  submitted: boolean;
}

export function CampaignCreateForm({
  scopes,
  profiles,
  toolpacks,
  backends,
  state,
  setState,
  validation,
  submitted,
}: CampaignCreateFormProps) {
  const errors = validation.errors;
  const showError = (k: keyof typeof errors) =>
    submitted ? errors[k] : undefined;
  const backendAvail = useMemo(
    () => new Map(backends.map((b) => [b.id, b.available])),
    [backends],
  );
  const codexDisabled = backendAvail.get('codex-exec') === false;
  const showWorkdir = state.backend === 'codex-exec';
  const preview = useMemo(
    () => generatePromptPreview(state, scopes),
    [state, scopes],
  );

  return (
    <form
      className="space-y-5 px-5 py-4 overflow-y-auto"
      autoComplete="off"
      noValidate
      data-testid="campaign-create-form"
      onSubmit={(e) => e.preventDefault()}
    >
      <FormSection title="Identity">
        <Field
          htmlFor="cf-title"
          label="Title"
          hint="Short headline operators will recognize in a queue."
          error={showError('title')}
        >
          <Input
            id="cf-title"
            data-cf="title"
            maxLength={120}
            placeholder="Map AdminPortal exposure"
            value={state.title}
            onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
          />
        </Field>
        <Field
          htmlFor="cf-objective"
          label="Objective"
          hint="One-paragraph description. Becomes part of every child run's system prompt."
          error={showError('objective')}
        >
          <Textarea
            id="cf-objective"
            data-cf="objective"
            rows={3}
            placeholder="What we want PHANTOM to accomplish across child runs."
            value={state.objective}
            onChange={(e) =>
              setState((s) => ({ ...s, objective: e.target.value }))
            }
          />
        </Field>
      </FormSection>

      <FormSection title="Governance">
        <Field
          htmlFor="cf-scopeId"
          label={`Scope${errors.scopeId ? ' (required for selected risk classes)' : ''}`}
          hint={
            errors.scopeId
              ? 'A scope is required because at least one network / security risk class is enabled.'
              : 'Optional. Bounds where the campaign may operate.'
          }
          error={showError('scopeId')}
        >
          <Select
            id="cf-scopeId"
            data-cf="scopeId"
            value={state.scopeId}
            onChange={(e) =>
              setState((s) => ({ ...s, scopeId: e.target.value }))
            }
            className={cn(errors.scopeId && 'border-destructive')}
          >
            <option value="">— no scope —</option>
            {scopes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.id}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          htmlFor="cf-profileId"
          label="Prompt profile"
          hint="Optional. Locks the prompt persona used by child workers."
        >
          <Select
            id="cf-profileId"
            data-cf="profileId"
            value={state.profileId}
            onChange={(e) =>
              setState((s) => ({ ...s, profileId: e.target.value }))
            }
          >
            <option value="">— default —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Allowed risk classes"
          hint="Anything you don't tick goes into the blocked list. Exploit + destructive are locked."
        >
          <RiskGrid
            allowed={state.riskBudget.allowedRiskClasses}
            onChange={(next) =>
              setState((s) => {
                // Anything not in `next` and not locked → blocked.
                const nextAllowed = new Set(next);
                const nextBlocked = new Set(s.riskBudget.blockedRiskClasses);
                // Add any newly-removed classes to blocked; remove ones now allowed.
                for (const id of s.riskBudget.allowedRiskClasses) {
                  if (!nextAllowed.has(id)) nextBlocked.add(id);
                }
                for (const id of next) nextBlocked.delete(id);
                return {
                  ...s,
                  riskBudget: {
                    ...s.riskBudget,
                    allowedRiskClasses: next,
                    blockedRiskClasses: Array.from(nextBlocked),
                  },
                };
              })
            }
          />
        </Field>
      </FormSection>

      <FormSection title="Tools & worker">
        <Field
          label="Toolpacks"
          hint={`${state.toolpackIds.length} selected. Click to toggle.`}
        >
          <ToolpackPicker
            options={toolpacks}
            selected={state.toolpackIds}
            onChange={(next) => setState((s) => ({ ...s, toolpackIds: next }))}
          />
        </Field>

        <Field
          label="Worker backend"
          hint={
            codexDisabled
              ? 'codex-exec is unavailable (codex CLI not on PATH).'
              : 'Pick how each child run is executed.'
          }
        >
          <ToggleGroup
            type="single"
            variant="default"
            value={state.backend}
            onValueChange={(v: string) => {
              if (!v) return;
              setState((s) => ({ ...s, backend: v as WorkerBackend }));
            }}
            data-cf-segmented="backend"
            aria-label="Worker backend"
          >
            <ToggleGroupItem
              value="phantom-native"
              data-value="phantom-native"
              className="flex-col items-start h-auto py-2 px-3 min-w-[160px]"
            >
              <span className="text-sm font-semibold">phantom-native</span>
              <span className="text-[10px] text-muted-foreground">
                In-process · default
              </span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="codex-exec"
              data-value="codex-exec"
              disabled={codexDisabled}
              className="flex-col items-start h-auto py-2 px-3 min-w-[160px]"
            >
              <span className="text-sm font-semibold">codex-exec</span>
              <span className="text-[10px] text-muted-foreground">
                Codex CLI · sandboxed
              </span>
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        {showWorkdir ? (
          <Field
            htmlFor="cf-workdir"
            label="Codex working directory"
            hint={
              <>
                Filesystem writes are confined here via{' '}
                <code className="font-mono">--sandbox workspace-write</code>.
              </>
            }
            error={showError('workdir')}
          >
            <Input
              id="cf-workdir"
              data-cf="workdir"
              placeholder="/workspace/lab"
              value={state.workdir}
              onChange={(e) =>
                setState((s) => ({ ...s, workdir: e.target.value }))
              }
            />
          </Field>
        ) : null}
      </FormSection>

      <FormSection title="Budgets">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field
            htmlFor="cf-maxChildRuns"
            label="Max child runs"
            error={showError('maxChildRuns')}
          >
            <Input
              id="cf-maxChildRuns"
              type="number"
              min={1}
              max={100}
              value={state.runBudget.maxChildRuns}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  runBudget: { ...s.runBudget, maxChildRuns: +e.target.value },
                }))
              }
            />
          </Field>
          <Field htmlFor="cf-maxAttempts" label="Attempts / goal">
            <Input
              id="cf-maxAttempts"
              type="number"
              min={1}
              max={10}
              value={state.runBudget.maxAttemptsPerGoal}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  runBudget: {
                    ...s.runBudget,
                    maxAttemptsPerGoal: +e.target.value,
                  },
                }))
              }
            />
          </Field>
          <Field htmlFor="cf-maxMinutes" label="Wall-clock cap (min)">
            <Input
              id="cf-maxMinutes"
              type="number"
              min={5}
              max={1440}
              value={state.runBudget.maxWallClockMinutes}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  runBudget: {
                    ...s.runBudget,
                    maxWallClockMinutes: +e.target.value,
                  },
                }))
              }
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--cy-1)]"
              checked={state.riskBudget.pauseOnNewFinding}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  riskBudget: {
                    ...s.riskBudget,
                    pauseOnNewFinding: e.target.checked,
                  },
                }))
              }
            />
            <span>Pause on new finding</span>
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--cy-1)]"
              checked={state.riskBudget.pauseOnApprovalRequired}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  riskBudget: {
                    ...s.riskBudget,
                    pauseOnApprovalRequired: e.target.checked,
                  },
                }))
              }
            />
            <span>Pause on approval-required action</span>
          </label>
        </div>
      </FormSection>

      <FormSection title="Initial goal preview">
        <p className="text-xs text-muted-foreground">
          PHANTOM derives a first goal from the objective so you can sanity-check the prompt
          before saving. Edit later via{' '}
          <code className="font-mono">POST /api/campaigns/:id/goals</code>.
        </p>
        <Card>
          <CardContent className="pt-3 pb-3">
            <pre
              data-testid="cf-prompt-preview"
              className="m-0 max-h-[200px] overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-[var(--fg-2)] leading-relaxed"
            >
              {preview}
            </pre>
          </CardContent>
        </Card>
      </FormSection>
    </form>
  );
}

export function CampaignCreateRoute() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<CampaignFormState>(() => defaultFormState());
  const [submitted, setSubmitted] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const refs = useCampaignRefs();
  const create = useCreateCampaign();
  const validation = useMemo(() => validateFormState(state), [state]);

  useEffect(() => {
    if (!open) navigate('/react/campaigns', { replace: true });
  }, [open, navigate]);

  const handleSubmit = async () => {
    setSubmitted(true);
    setErrorBanner(null);
    if (!validation.ok) {
      const first = Object.values(validation.errors)[0];
      if (first) setErrorBanner(`✗ ${first}`);
      return;
    }
    try {
      const created = await create.mutateAsync(toCreatePayload(state));
      setOpen(false);
      navigate(`/react/campaigns/${created.id}`, { replace: true });
    } catch (err) {
      setErrorBanner(`✗ ${(err as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="campaign-create-dialog">
        <DialogHeader>
          <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
            Draft a governed campaign
          </p>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Risk classes, budgets, and the initial goal preview are computed live as you
            edit.
          </DialogDescription>
        </DialogHeader>
        <CampaignCreateForm
          scopes={refs.scopes}
          profiles={refs.profiles}
          toolpacks={refs.toolpacks}
          backends={refs.backends}
          state={state}
          setState={setState}
          validation={validation}
          submitted={submitted}
        />
        <DialogFooter>
          {errorBanner ? (
            <span
              role="alert"
              data-testid="campaign-create-feedback"
              className="text-xs text-destructive mr-auto"
            >
              {errorBanner}
            </span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={create.isPending}
            data-testid="campaign-create-submit"
          >
            {create.isPending ? 'Saving…' : 'Save as draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CampaignCreateRoute;
