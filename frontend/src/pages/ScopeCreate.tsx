// Scope create Dialog — a minimal, governed form that lets operators
// authorize a new scope from the React preview surface.
//
// Form fields (per the A8.2 spec):
//   - name: required, single-line Input
//   - targets: multi-line Textarea parsed via POST /api/scopes/parse-targets
//   - allowedActions: Checkbox grid — RECON / NETWORK-SCAN / WEB-VULN /
//     OFFLINE-PASSWORD-AUDIT (the canonical safe set)
//   - blockedActions: Checkbox grid — EXPLOIT / DESTRUCTIVE / CREDENTIALED /
//     ONLINE-BRUTEFORCE (pinned-checked + disabled, by design)
//
// Submit POSTs /api/scopes; on success the dialog closes and navigates
// to the new scope's detail Sheet.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { scopesApi, useCreateScope } from '@/lib/scopes';
import {
  SCOPE_ALLOWED_ACTIONS,
  SCOPE_BLOCKED_ACTIONS,
  type ParsedTarget,
} from '@/lib/types';
import { cn } from '@/lib/utils';

interface ScopeCreateFormState {
  name: string;
  targetsInput: string;
  allowedActions: Set<string>;
}

export function defaultScopeFormState(): ScopeCreateFormState {
  return {
    name: '',
    targetsInput: '',
    allowedActions: new Set(['recon']),
  };
}

export interface ScopeCreateValidation {
  ok: boolean;
  errors: { name?: string; targets?: string };
}

export function validateScopeForm(state: ScopeCreateFormState): ScopeCreateValidation {
  const errors: ScopeCreateValidation['errors'] = {};
  if (!state.name.trim()) errors.name = 'Name is required.';
  return { ok: Object.keys(errors).length === 0, errors };
}

// Parsed targets get bucketed by type so the create payload matches the
// shape /api/scopes expects (targets.hosts, .domains, .cidrs, .urls).
function bucketTargets(parsed: ParsedTarget[]) {
  const hosts: string[] = [];
  const domains: string[] = [];
  const cidrs: string[] = [];
  const urls: string[] = [];
  for (const t of parsed) {
    if (t.type === 'host' || t.type === 'host_port') hosts.push(t.value);
    else if (t.type === 'domain') domains.push(t.value);
    else if (t.type === 'cidr') cidrs.push(t.value);
    else if (t.type === 'url') urls.push(t.value);
  }
  return { hosts, domains, cidrs, urls };
}

// ── Action class grid ─────────────────────────────────────────────────

function ActionCheckboxRow({
  label,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 rounded-md border border-[var(--line-1)] bg-[var(--bg-2)] px-2.5 py-1.5 transition-colors text-sm',
        checked && !disabled && 'border-[var(--cy-2)] bg-[var(--cy-3)]/20',
        disabled && 'opacity-60 cursor-not-allowed',
        !disabled && 'cursor-pointer hover:border-[var(--line-3)]',
      )}
      data-testid={testId}
      data-disabled={disabled || undefined}
      data-checked={checked || undefined}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        aria-label={label}
      />
      <span className="font-mono text-xs text-foreground">{label}</span>
    </label>
  );
}

// ── Form body (exported standalone so the test can drive it directly) ─

interface FormProps {
  state: ScopeCreateFormState;
  setState: React.Dispatch<React.SetStateAction<ScopeCreateFormState>>;
  validation: ScopeCreateValidation;
  submitted: boolean;
  parsed: ParsedTarget[];
  parsing: boolean;
  parseError: string | null;
  onBlurTargets: () => void;
}

export function ScopeCreateForm({
  state,
  setState,
  validation,
  submitted,
  parsed,
  parsing,
  parseError,
  onBlurTargets,
}: FormProps) {
  const errors = validation.errors;
  const showError = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  return (
    <form
      className="space-y-5 px-5 py-4 overflow-y-auto"
      autoComplete="off"
      noValidate
      data-testid="scope-create-form"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="space-y-1.5">
        <Label htmlFor="sc-name">Name</Label>
        <Input
          id="sc-name"
          maxLength={120}
          placeholder="LAB-INTERNAL"
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          data-testid="scope-name-input"
          className={cn(submitted && errors.name && 'border-destructive')}
        />
        {showError('name') ? (
          <p className="text-xs text-destructive" data-testid="scope-name-error">
            {showError('name')}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Short ALL-CAPS handle operators will recognize in approval prompts.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sc-targets">Targets</Label>
        <Textarea
          id="sc-targets"
          rows={4}
          placeholder="example.test, 10.0.0.0/24, https://app.example.test"
          value={state.targetsInput}
          onChange={(e) => setState((s) => ({ ...s, targetsInput: e.target.value }))}
          onBlur={onBlurTargets}
          data-testid="scope-targets-input"
        />
        <p className="text-[11px] text-muted-foreground">
          One or more hosts, domains, CIDRs, or URLs. Parsed on blur via{' '}
          <code className="font-mono">/api/scopes/parse-targets</code>.
        </p>
        {parsing ? (
          <p className="text-[11px] text-muted-foreground">Parsing…</p>
        ) : parseError ? (
          <p className="text-xs text-destructive" role="alert" data-testid="scope-parse-error">
            {parseError}
          </p>
        ) : parsed.length > 0 ? (
          <div className="flex flex-wrap gap-1" data-testid="scope-parsed-targets">
            {parsed.map((t) => (
              <Badge key={t.id} variant="outline" className="font-mono">
                {t.type}:{t.value}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>Allowed actions</Label>
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-2"
          role="group"
          aria-label="Allowed actions"
          data-testid="scope-allowed-grid"
        >
          {SCOPE_ALLOWED_ACTIONS.map((action) => {
            const checked = state.allowedActions.has(action);
            return (
              <ActionCheckboxRow
                key={action}
                label={action}
                checked={checked}
                onChange={(next) =>
                  setState((s) => {
                    const updated = new Set(s.allowedActions);
                    if (next) updated.add(action);
                    else updated.delete(action);
                    return { ...s, allowedActions: updated };
                  })
                }
                testId={`scope-allowed-${action}`}
              />
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Blocked actions (locked)</Label>
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-2"
          role="group"
          aria-label="Blocked actions"
          data-testid="scope-blocked-grid"
        >
          {SCOPE_BLOCKED_ACTIONS.map((action) => (
            <ActionCheckboxRow
              key={action}
              label={action}
              checked
              disabled
              onChange={() => undefined}
              testId={`scope-blocked-${action}`}
            />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          These risk classes are blocked by default and can only be enabled by editing
          the saved scope's policy from the legacy <code className="font-mono">/scope</code> page.
        </p>
      </div>
    </form>
  );
}

// ── Route + container ─────────────────────────────────────────────────

export function ScopeCreateRoute() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<ScopeCreateFormState>(() => defaultScopeFormState());
  const [submitted, setSubmitted] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedTarget[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const create = useCreateScope();
  const validation = useMemo(() => validateScopeForm(state), [state]);

  useEffect(() => {
    if (!open) navigate('/react/scope', { replace: true });
  }, [open, navigate]);

  const parseOnBlur = async () => {
    const input = state.targetsInput.trim();
    if (!input) {
      setParsed([]);
      setParseError(null);
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      const data = await scopesApi.parseTargets(input);
      setParsed(data.targets || []);
      if (data.errors?.length) {
        setParseError(
          `${data.errors.length} unrecognized: ${data.errors
            .map((e) => e.input)
            .slice(0, 3)
            .join(', ')}${data.errors.length > 3 ? '…' : ''}`,
        );
      }
    } catch (err) {
      setParseError((err as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    setErrorBanner(null);
    if (!validation.ok) {
      const first = Object.values(validation.errors)[0];
      if (first) setErrorBanner(`✗ ${first}`);
      return;
    }
    try {
      const targets = bucketTargets(parsed);
      const created = await create.mutateAsync({
        name: state.name.trim(),
        targets,
        allowedActions: Array.from(state.allowedActions),
        blockedActions: Array.from(SCOPE_BLOCKED_ACTIONS),
      });
      setOpen(false);
      navigate(`/react/scope/${created.id}`, { replace: true });
    } catch (err) {
      setErrorBanner(`✗ ${(err as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="scope-create-dialog">
        <DialogHeader>
          <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
            Authorize a new scope
          </p>
          <DialogTitle>New scope</DialogTitle>
          <DialogDescription>
            Targets parse on blur. The four critical risk classes stay locked-blocked —
            elevate them later from the legacy scope builder.
          </DialogDescription>
        </DialogHeader>
        <ScopeCreateForm
          state={state}
          setState={setState}
          validation={validation}
          submitted={submitted}
          parsed={parsed}
          parsing={parsing}
          parseError={parseError}
          onBlurTargets={() => void parseOnBlur()}
        />
        <DialogFooter>
          {errorBanner ? (
            <span
              role="alert"
              data-testid="scope-create-feedback"
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
            data-testid="scope-create-submit"
          >
            {create.isPending ? 'Saving…' : 'Save scope'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ScopeCreateRoute;
