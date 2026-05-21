// Scope create Dialog — the full governed scope builder, ported from the
// legacy frontend/js/scope/scope-builder.js + scope-page.js.
//
// Builder pieces:
//   - intent tiles      → /api/scopes/templates (seed allowed/blocked + notes)
//   - ROE templates     → /api/scopes/roe-templates (seed action_modes + ROE)
//   - action-class matrix (3-state Allow/Ask/Deny per class — the canonical
//     writer of action_modes; locked classes exploit + destructive are
//     pinned to Deny and can never be elevated here)
//   - target chips      → parsed via /api/scopes/parse-targets, removable
//   - asset picker      → /api/assets multi-select → targets.assetIds
//   - ROE prose textarea
//
// GOVERNANCE: the deny-default is enforced in lib/scopeBuilder.ts —
// unspecified classes resolve to deny, locked rows are re-pinned to deny on
// every read, and the create payload sends both the action_modes map and the
// derived allowed/blocked arrays so the policy evaluator's legacy reads stay
// correct.
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
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import {
  scopesApi,
  useCreateScope,
  useRoeTemplates,
  useScopeAssets,
  useScopeTemplates,
} from '@/lib/scopes';
import {
  ACTION_CLASSES,
  type ScopeActionMode,
  type ScopeActionModes,
  defaultActionModes,
  deriveAllowedBlocked,
  normalizeActionModes,
  setActionMode as setActionModeIn,
  templateActionModes,
  templateToDraft,
  templateRisk,
} from '@/lib/scopeBuilder';
import { type ParsedTarget } from '@/lib/types';
import { cn } from '@/lib/utils';

// A parsed/added target chip in the builder. `kind` mirrors the asset/legacy
// bucket vocabulary so we can round-trip into targets.{hosts,domains,…}.
export type TargetKind = 'host' | 'domain' | 'cidr' | 'url' | 'asset';
export interface TargetChip {
  id: string;
  kind: TargetKind;
  value: string;
}

export interface ScopeCreateFormState {
  name: string;
  targetsInput: string;
  targets: TargetChip[];
  actionModes: ScopeActionModes;
  assetIds: string[];
  rulesOfEngagement: string;
  notes: string;
  selectedTemplateId: string | null;
  selectedRoeTemplateId: string;
}

export function defaultScopeFormState(): ScopeCreateFormState {
  return {
    name: '',
    targetsInput: '',
    targets: [],
    actionModes: defaultActionModes(),
    assetIds: [],
    rulesOfEngagement: '',
    notes: '',
    selectedTemplateId: null,
    selectedRoeTemplateId: '',
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

// Bucket target chips into the targets.{hosts,domains,cidrs,urls,assetIds}
// shape /api/scopes expects. Asset-kind chips and the picker selection both
// land in assetIds.
export function bucketTargets(
  chips: TargetChip[],
  assetIds: string[],
): {
  hosts: string[];
  domains: string[];
  cidrs: string[];
  urls: string[];
  assetIds: string[];
} {
  const hosts: string[] = [];
  const domains: string[] = [];
  const cidrs: string[] = [];
  const urls: string[] = [];
  const assets = new Set(assetIds);
  for (const t of chips) {
    if (t.kind === 'domain') domains.push(t.value);
    else if (t.kind === 'cidr') cidrs.push(t.value);
    else if (t.kind === 'url') urls.push(t.value);
    else if (t.kind === 'asset') assets.add(t.value);
    else hosts.push(t.value);
  }
  return { hosts, domains, cidrs, urls, assetIds: Array.from(assets) };
}

// Map a parse-targets row type onto a builder chip kind.
function parsedToChip(t: ParsedTarget): TargetChip {
  const kind: TargetKind =
    t.type === 'domain'
      ? 'domain'
      : t.type === 'cidr'
        ? 'cidr'
        : t.type === 'url'
          ? 'url'
          : 'host';
  return { id: t.id || `${kind}:${t.value}`, kind, value: t.value };
}

// ── Action-class 3-state matrix ───────────────────────────────────────

const MODE_LABEL: Record<ScopeActionMode, string> = {
  auto: 'Allow',
  ask: 'Ask',
  deny: 'Deny',
};
const MODES: ScopeActionMode[] = ['auto', 'ask', 'deny'];

const RISK_TICK: Record<string, string> = {
  low: 'bg-[var(--ok)]',
  med: 'bg-[var(--warn)]',
  high: 'bg-[var(--warn-2)]',
  crit: 'bg-destructive',
};

function ActionClassMatrix({
  modes,
  onChange,
}: {
  modes: ScopeActionModes;
  onChange: (id: string, mode: ScopeActionMode) => void;
}) {
  return (
    <div
      className="rounded-md border border-[var(--line-1)] overflow-hidden"
      role="group"
      aria-label="Action-class policy matrix"
      data-testid="scope-action-matrix"
    >
      {ACTION_CLASSES.map((row) => {
        const locked = !!row.locked;
        const current: ScopeActionMode = locked ? 'deny' : (modes[row.id] ?? 'deny');
        return (
          <div
            key={row.id}
            className={cn(
              'flex items-center gap-3 px-3 py-2 border-b border-[var(--line-1)] last:border-b-0',
              locked && 'bg-destructive/5',
            )}
            data-action-class={row.id}
            data-mode={current}
            data-locked={locked || undefined}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn('h-2 w-2 rounded-full shrink-0', RISK_TICK[row.risk])}
                />
                <span className="font-mono text-xs text-foreground">{row.id}</span>
                <Badge variant="outline" className="font-mono text-[9px] uppercase">
                  {row.risk}
                </Badge>
              </div>
              <p className="font-mono text-[10px] text-[var(--fg-3)] mt-0.5 truncate">
                {row.examples}
              </p>
            </div>
            {locked ? (
              <Tooltip content="Policy-locked. Exploit and destructive classes are always denied and can only be elevated server-side.">
                <span
                  className="font-mono text-[10px] uppercase tracking-wider text-destructive"
                  data-testid={`scope-mode-locked-${row.id}`}
                >
                  locked · deny
                </span>
              </Tooltip>
            ) : (
              <div
                className="flex items-center gap-1 shrink-0"
                role="radiogroup"
                aria-label={`${row.id} mode`}
                data-action-mode={row.id}
              >
                {MODES.map((mode) => {
                  const active = current === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-mode-value={mode}
                      data-testid={`scope-mode-${row.id}-${mode}`}
                      onClick={() => onChange(row.id, mode)}
                      className={cn(
                        'rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide border transition-colors',
                        active && mode === 'auto' && 'border-[var(--ok-2)] text-[var(--ok-2)] bg-[var(--ok)]/10',
                        active && mode === 'ask' && 'border-[var(--warn-2)] text-[var(--warn-2)] bg-[var(--warn)]/10',
                        active && mode === 'deny' && 'border-destructive text-destructive bg-destructive/10',
                        !active && 'border-[var(--line-1)] text-muted-foreground hover:border-[var(--line-3)]',
                      )}
                    >
                      {MODE_LABEL[mode]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Form body (exported standalone so the test can drive it directly) ─

interface FormProps {
  state: ScopeCreateFormState;
  setState: React.Dispatch<React.SetStateAction<ScopeCreateFormState>>;
  validation: ScopeCreateValidation;
  submitted: boolean;
  parsing: boolean;
  parseError: string | null;
  onBlurTargets: () => void;
  onRemoveTarget: (id: string) => void;
  onSelectTemplate: (id: string) => void;
  onSelectRoeTemplate: (id: string) => void;
  onSetMode: (id: string, mode: ScopeActionMode) => void;
  templates: Array<{ id: string; name: string; summary?: string; allowedActions?: string[]; blockedActions?: string[] }>;
  roeTemplates: Array<{ id: string; name: string; summary?: string }>;
  assets: Array<{ id: string; name: string; type?: string }>;
}

export function ScopeCreateForm({
  state,
  setState,
  validation,
  submitted,
  parsing,
  parseError,
  onBlurTargets,
  onRemoveTarget,
  onSelectTemplate,
  onSelectRoeTemplate,
  onSetMode,
  templates,
  roeTemplates,
  assets,
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
      {/* Intent tiles */}
      <div className="space-y-2">
        <Label>Start from an intent template</Label>
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          role="group"
          aria-label="Intent templates"
          data-testid="scope-intent-grid"
        >
          {templates.length === 0 ? (
            <p className="text-[11px] text-muted-foreground col-span-full">
              No intent templates available.
            </p>
          ) : (
            templates.map((tpl) => {
              const active = tpl.id === state.selectedTemplateId;
              const risk = templateRisk(tpl);
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onSelectTemplate(tpl.id)}
                  data-testid={`scope-intent-${tpl.id}`}
                  data-active={active || undefined}
                  className={cn(
                    'text-left rounded-md border border-[var(--line-1)] bg-[var(--bg-2)] px-3 py-2 transition-colors',
                    active ? 'border-[var(--cy-2)] bg-[var(--cy-3)]/20' : 'hover:border-[var(--line-3)]',
                  )}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="outline" className="font-mono text-[9px] uppercase">
                      {risk}
                    </Badge>
                    <span className="text-xs font-semibold text-foreground">{tpl.name}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{tpl.summary || ''}</p>
                </button>
              );
            })
          )}
        </div>
      </div>

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
          rows={3}
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
        ) : null}
        {state.targets.length > 0 ? (
          <div className="flex flex-wrap gap-1" role="list" data-testid="scope-target-chips">
            {state.targets.map((t) => (
              <span
                key={t.id}
                role="listitem"
                data-kind={t.kind}
                data-value={t.value}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--line-2)] bg-[var(--bg-2)] pl-2 pr-1 py-0.5 font-mono text-[11px]"
              >
                <span className="text-[var(--fg-3)]">{t.kind}</span>
                <span className="text-foreground">{t.value}</span>
                <button
                  type="button"
                  aria-label={`Remove ${t.value}`}
                  data-testid={`scope-remove-target-${t.value}`}
                  onClick={() => onRemoveTarget(t.id)}
                  className="ml-0.5 rounded-full px-1 text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Asset picker */}
      <div className="space-y-1.5">
        <Label htmlFor="sc-assets">Reference assets</Label>
        <select
          id="sc-assets"
          multiple
          aria-label="Reference assets"
          data-testid="scope-asset-picker"
          value={state.assetIds}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              assetIds: Array.from(e.target.selectedOptions, (o) => o.value),
            }))
          }
          className="w-full min-h-[88px] rounded-md border border-[var(--line-2)] bg-[var(--bg-2)] px-2 py-1.5 text-sm font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.type ? ` · ${a.type}` : ''}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          Optional. Selected assets are added to the scope as <code className="font-mono">assetIds</code>.
        </p>
      </div>

      {/* Action-class matrix */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label>Action-class policy</Label>
          <Tooltip content="Per-class authorization: Allow runs without prompting, Ask gates each call for operator approval, Deny blocks the class entirely. Unset classes default to Deny.">
            <span
              className="cursor-help font-mono text-[10px] text-muted-foreground border border-[var(--line-2)] rounded-full h-4 w-4 inline-flex items-center justify-center"
              aria-label="Action-class help"
            >
              ?
            </span>
          </Tooltip>
        </div>
        <ActionClassMatrix modes={state.actionModes} onChange={onSetMode} />
        <p className="text-[11px] text-muted-foreground">
          Exploit and destructive stay <strong className="text-destructive">locked · deny</strong> by
          policy. Everything unset defaults to deny.
        </p>
      </div>

      {/* ROE template + prose */}
      <div className="space-y-2">
        <Label htmlFor="sc-roe-template">Rules of engagement</Label>
        <Select
          id="sc-roe-template"
          aria-label="ROE template"
          data-testid="scope-roe-template"
          value={state.selectedRoeTemplateId}
          onChange={(e) => {
            if (e.target.value) onSelectRoeTemplate(e.target.value);
          }}
        >
          <option value="">Start from an ROE template…</option>
          {roeTemplates.map((t) => (
            <option key={t.id} value={t.id} data-testid={`scope-roe-option-${t.id}`}>
              {t.name}
            </option>
          ))}
        </Select>
        <Textarea
          id="sc-roe"
          rows={4}
          placeholder="Engagement constraints, hours, escalation rules…"
          value={state.rulesOfEngagement}
          onChange={(e) => setState((s) => ({ ...s, rulesOfEngagement: e.target.value }))}
          data-testid="scope-roe-input"
        />
        <p className="text-[11px] text-muted-foreground">
          Picking a template seeds the action-class matrix and this prose. Edit freely before saving.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sc-notes">Notes</Label>
        <Textarea
          id="sc-notes"
          rows={2}
          placeholder="Optional operator notes."
          value={state.notes}
          onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
          data-testid="scope-notes-input"
        />
      </div>

      {/* Locked blocked-class reassurance — exploit + destructive only.
          (Kept as inert checkboxes for parity with the legacy reassurance.) */}
      <div className="space-y-2">
        <Label>Policy-locked classes</Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2" data-testid="scope-blocked-grid">
          {ACTION_CLASSES.filter((c) => c.locked).map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-[var(--line-1)] bg-[var(--bg-2)] px-2.5 py-1.5 text-sm opacity-60 cursor-not-allowed"
              data-testid={`scope-blocked-${c.id}`}
              data-disabled="true"
              data-checked="true"
            >
              <Checkbox checked disabled aria-label={c.id} />
              <span className="font-mono text-xs text-foreground line-through">{c.id}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          These critical risk classes are blocked by policy and cannot be enabled from the builder.
        </p>
      </div>
    </form>
  );
}

// ── Route + container ─────────────────────────────────────────────────

export function ScopeCreateRoute() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<ScopeCreateFormState>(() => defaultScopeFormState());
  const [submitted, setSubmitted] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const create = useCreateScope();
  const { data: templates = [] } = useScopeTemplates();
  const { data: roeTemplates = [] } = useRoeTemplates();
  const { data: assets = [] } = useScopeAssets();
  const validation = useMemo(() => validateScopeForm(state), [state]);

  useEffect(() => {
    if (!open) navigate('/scope', { replace: true });
  }, [open, navigate]);

  const parseOnBlur = async () => {
    const input = state.targetsInput.trim();
    if (!input) {
      setParseError(null);
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      const data = await scopesApi.parseTargets(input);
      const chips = (data.targets || []).map(parsedToChip);
      setState((s) => {
        // Merge new chips, de-duped by id, preserving existing chips.
        const seen = new Set(s.targets.map((t) => t.id));
        const merged = [...s.targets];
        for (const c of chips) {
          if (!seen.has(c.id)) {
            merged.push(c);
            seen.add(c.id);
          }
        }
        return { ...s, targets: merged, targetsInput: '' };
      });
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

  const handleRemoveTarget = (id: string) => {
    setState((s) => ({ ...s, targets: s.targets.filter((t) => t.id !== id) }));
  };

  const handleSetMode = (id: string, mode: ScopeActionMode) => {
    setState((s) => ({ ...s, actionModes: setActionModeIn(s.actionModes, id, mode) }));
  };

  const handleSelectTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    const draft = templateToDraft(tpl);
    const modes = templateActionModes(tpl);
    setState((s) => ({
      ...s,
      selectedTemplateId: id,
      actionModes: modes,
      // Only seed name/notes when the operator hasn't typed their own.
      name: s.name.trim()
        ? s.name
        : String(draft.nameSuffix).toUpperCase().replace(/\s+/g, '-'),
      notes: s.notes.trim() ? s.notes : draft.notes,
    }));
  };

  const handleSelectRoeTemplate = (id: string) => {
    const tpl = roeTemplates.find((t) => t.id === id);
    if (!tpl) return;
    const payload = tpl.payload || {};
    // Seed the full 3-state matrix from the template's action_modes (preserves
    // the 'ask' tier). normalizeActionModes re-pins locked rows to deny and
    // defaults any unspecified class to deny.
    const seeded = payload.action_modes
      ? normalizeActionModes(payload.action_modes)
      : null;
    setState((s) => ({
      ...s,
      selectedRoeTemplateId: id,
      actionModes: seeded ?? s.actionModes,
      rulesOfEngagement: payload.rules_of_engagement ?? s.rulesOfEngagement,
    }));
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
      const targets = bucketTargets(state.targets, state.assetIds);
      const { allowedActions, blockedActions } = deriveAllowedBlocked(state.actionModes);
      const created = await create.mutateAsync({
        name: state.name.trim(),
        targets,
        allowedActions,
        blockedActions,
        actionModes: state.actionModes,
        rulesOfEngagement: state.rulesOfEngagement.trim() || undefined,
        notes: state.notes.trim() || undefined,
      });
      toast({ title: 'Scope saved', description: created.name, variant: 'success' });
      setOpen(false);
      navigate(`/scope/${created.id}`, { replace: true });
    } catch (err) {
      const message = (err as Error).message;
      setErrorBanner(`✗ ${message}`);
      toast({ title: 'Scope save failed', description: message, variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-testid="scope-create-dialog"
        className="max-w-2xl max-h-[90vh] flex flex-col"
      >
        <DialogHeader>
          <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
            Authorize a new scope
          </p>
          <DialogTitle>New scope</DialogTitle>
          <DialogDescription>
            Pick an intent, define targets, set per-class policy, and apply rules of engagement.
            Exploit and destructive classes stay locked-deny by policy.
          </DialogDescription>
        </DialogHeader>
        <ScopeCreateForm
          state={state}
          setState={setState}
          validation={validation}
          submitted={submitted}
          parsing={parsing}
          parseError={parseError}
          onBlurTargets={() => void parseOnBlur()}
          onRemoveTarget={handleRemoveTarget}
          onSelectTemplate={handleSelectTemplate}
          onSelectRoeTemplate={handleSelectRoeTemplate}
          onSetMode={handleSetMode}
          templates={templates}
          roeTemplates={roeTemplates}
          assets={assets}
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
            loading={create.isPending}
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
