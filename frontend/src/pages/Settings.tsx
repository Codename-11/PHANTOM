// Settings — React translation of the legacy settings-page.js +
// settings-page-presenter.js into a tabbed shadcn/Radix surface.
//
// For visual parity FIRST (per the A8.2 spec) the tab set mirrors the
// legacy IA exactly — Models / General / Agent Behavior / Prompts /
// Security & Scope / Tools, MCP & Skills / Diagnostics / Advanced.
// The mega-plan eventually flattens this to Setup / Operations /
// Governance / Integrations / Diagnostics; that's deferred to A8.5.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  deriveProviderState,
  deriveToolpackAvailability,
  useDiagnostics,
  useSettings,
  useToolpacks,
  useUpdateSettings,
  type ToolpackAvailability,
} from '@/lib/settings';
import type {
  AppSettings,
  DiagnosticsCheck,
  ProviderState,
  SettingsPatch,
  Toolpack,
} from '@/lib/types';
import { cn } from '@/lib/utils';

// ── Provider state pill ────────────────────────────────────────────────

const PROVIDER_STATE_COPY: Record<ProviderState, string> = {
  configured: 'Configured',
  reachable: 'Reachable',
  missing: 'Missing',
  'proxy-backed': 'Proxy-backed',
  failed: 'Failed',
};

const PROVIDER_STATE_VARIANT: Record<
  ProviderState,
  'completed' | 'queued' | 'destructive' | 'needs_approval' | 'failed'
> = {
  configured: 'queued',
  reachable: 'completed',
  missing: 'needs_approval',
  'proxy-backed': 'queued',
  failed: 'failed',
};

export function ProviderStatePill({
  state,
  provider,
  className,
}: {
  state: ProviderState;
  provider?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-border bg-[var(--bg-2)] px-2.5 py-1',
        className,
      )}
      data-provider-state={state}
      role="status"
      aria-label={`Provider state: ${PROVIDER_STATE_COPY[state]}`}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Provider
      </span>
      {provider ? (
        <span className="font-mono text-[11px] text-foreground">{provider}</span>
      ) : null}
      <Badge variant={PROVIDER_STATE_VARIANT[state]}>
        {PROVIDER_STATE_COPY[state]}
      </Badge>
    </div>
  );
}

// ── Models / General / Agent Behavior tab ─────────────────────────────

interface ProviderEditorProps {
  settings: AppSettings;
  onSave: (patch: SettingsPatch) => Promise<void>;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

function ProviderEditor({ settings, onSave, saving, error, saved }: ProviderEditorProps) {
  const [provider, setProvider] = useState(settings.provider);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(settings.model);
  const [temperature, setTemperature] = useState(String(settings.temperature));
  const [maxTokens, setMaxTokens] = useState(String(settings.maxTokens));

  // Keep local state in sync if the server settings change underneath us
  // (e.g. after the operator hit the onboarding wizard from a separate tab).
  useEffect(() => {
    setProvider(settings.provider);
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setTemperature(String(settings.temperature));
    setMaxTokens(String(settings.maxTokens));
  }, [settings]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const patch: SettingsPatch = {
      provider,
      baseUrl,
      model,
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
    };
    if (apiKey && apiKey !== settings.apiKey) patch.apiKey = apiKey;
    await onSave(patch);
  };

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)} data-testid="settings-provider-form">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="settings-provider">Provider</Label>
          <Select
            id="settings-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            data-testid="settings-provider-select"
          >
            {/* The provider list is small + stable. The legacy bundle
                pulls /api/providers; for visual parity we mirror the
                shipped options inline so the React surface doesn't add
                a network round-trip just to render the form. A8.5
                consolidates this against the real registry. */}
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="model-foundry">ModelFoundry</option>
            <option value="ollama">Ollama (local)</option>
            <option value="lmstudio">LM Studio (local)</option>
            <option value="custom">Custom (OpenAI-compatible)</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-base-url">Base URL</Label>
          <Input
            id="settings-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            data-testid="settings-base-url"
          />
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="settings-api-key">API key</Label>
          <Input
            id="settings-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.apiKeySet ? settings.apiKey : 'sk-…'}
            data-testid="settings-api-key"
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">
            Stored encrypted on the server. Leave blank to keep the existing key.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-model">Model</Label>
          <Input
            id="settings-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="claude-opus-4-5"
            data-testid="settings-model"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="settings-temperature">Temperature</Label>
            <Input
              id="settings-temperature"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              data-testid="settings-temperature"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-max-tokens">Max tokens</Label>
            <Input
              id="settings-max-tokens"
              type="number"
              min="1"
              max="200000"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              data-testid="settings-max-tokens"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        {saved ? (
          <span className="text-xs text-[#66c293]" role="status">
            Saved.
          </span>
        ) : null}
        {error ? (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

// ── Diagnostics tab ────────────────────────────────────────────────────

const DIAG_DOT_BY_STATUS: Record<string, string> = {
  ok: 'bg-[var(--ok)]',
  needs_setup: 'bg-[var(--warn)]',
  degraded: 'bg-[var(--warn)]',
  blocked: 'bg-destructive',
};

const DIAG_LABEL_BY_STATUS: Record<string, string> = {
  ok: 'Ready',
  needs_setup: 'Needs setup',
  degraded: 'Degraded',
  blocked: 'Blocked',
};

function DiagnosticsRow({ check }: { check: DiagnosticsCheck }) {
  return (
    <li
      className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
      data-status={check.status}
      data-testid="diag-row"
    >
      <span
        aria-hidden="true"
        className={cn('h-2.5 w-2.5 rounded-full shrink-0', DIAG_DOT_BY_STATUS[check.status] ?? 'bg-muted-foreground')}
      />
      <span className="font-mono text-xs text-foreground min-w-[110px]">{check.id}</span>
      <span className="text-xs text-muted-foreground flex-1">{check.detail || ''}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{check.elapsedMs}ms</span>
    </li>
  );
}

function DiagnosticsPanel() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDiagnostics();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-4 space-y-2">
          <Skeleton className="h-4 w-40" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-destructive" role="alert">
          Failed to load diagnostics: {(error as Error | undefined)?.message ?? 'unknown error'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'h-3 w-3 rounded-full',
              DIAG_DOT_BY_STATUS[data.overall] ?? 'bg-muted-foreground',
            )}
          />
          <span className="font-mono text-sm text-foreground">
            {DIAG_LABEL_BY_STATUS[data.overall] ?? data.overall}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="diag-refresh"
          >
            ↻ Refresh
          </Button>
        </div>
        <ul className="m-0 p-0 list-none" data-testid="diag-rows">
          {data.checks.map((c) => (
            <DiagnosticsRow key={c.id} check={c} />
          ))}
        </ul>
        <p className="font-mono text-[10px] text-muted-foreground">
          generated {data.generatedAt} · {data.elapsedMs}ms
        </p>
      </CardContent>
    </Card>
  );
}

// ── Tools / MCP / Skills tab ───────────────────────────────────────────

const AVAILABILITY_BADGE: Record<ToolpackAvailability, { label: string; variant: 'completed' | 'needs_approval' | 'failed' | 'queued' }> = {
  available: { label: 'available', variant: 'completed' },
  partial: { label: 'partial', variant: 'needs_approval' },
  missing: { label: 'missing', variant: 'failed' },
  unknown: { label: 'unknown', variant: 'queued' },
};

function ToolpackRow({ pack }: { pack: Toolpack }) {
  const availability = deriveToolpackAvailability(pack);
  const av = AVAILABILITY_BADGE[availability];
  return (
    <li
      className="rounded-md border border-border bg-card px-3 py-2.5"
      data-toolpack-id={pack.id}
      data-availability={availability}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-foreground">{pack.name || pack.id}</span>
        <Badge variant={av.variant} className="ml-auto">
          {av.label}
        </Badge>
      </div>
      {pack.summary ? (
        <p className="text-[12px] text-muted-foreground mb-2">{pack.summary}</p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {(pack.risks ?? []).map((r) => (
          <Badge key={r} variant="outline" className="font-mono">
            {r}
          </Badge>
        ))}
      </div>
    </li>
  );
}

function ToolpacksPanel() {
  const { data, isLoading, isError, error } = useToolpacks();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div role="alert" className="text-sm text-destructive">
        Failed to load toolpacks: {(error as Error)?.message ?? 'unknown error'}
      </div>
    );
  }
  const list = data ?? [];
  if (!list.length) {
    return (
      <div className="text-sm text-muted-foreground" data-testid="toolpacks-empty">
        No toolpacks registered.
      </div>
    );
  }
  return (
    <ul className="space-y-2 list-none m-0 p-0" data-testid="toolpacks-list">
      {list.map((p) => (
        <ToolpackRow key={p.id} pack={p} />
      ))}
    </ul>
  );
}

// ── Misc placeholder panels ────────────────────────────────────────────
// These mirror the legacy IA visually but defer their non-trivial
// implementation to A8.3+ (Prompts admin) and A8.5 (Advanced cleanup).

function PromptsPanel() {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground mb-2">
          Prompt admin
        </p>
        <p className="text-sm text-muted-foreground">
          Profile + fragment management lands in a follow-up commit
          (A8.3). The legacy <code className="font-mono">/settings</code> tab still
          renders the full editor.
        </p>
      </CardContent>
    </Card>
  );
}

function SecurityScopePanel() {
  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
          Security &amp; scope
        </p>
        <p className="text-sm text-muted-foreground">
          Risky tools are blocked before execution unless the selected scope policy
          allows the risk class and every extracted target is in scope.
        </p>
        <p className="text-sm">
          <Link
            to="/react/scope"
            className="text-[var(--cy-1)] underline-offset-2 hover:underline"
            data-testid="settings-open-scope"
          >
            Open the scope builder →
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function AdvancedPanel() {
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <p className="font-mono uppercase tracking-[0.08em] text-[10px] text-muted-foreground">
          Onboarding
        </p>
        <p className="text-sm text-muted-foreground">
          Re-walk the first-run wizard — useful after switching providers or
          rotating an API key.
        </p>
        <Button
          variant="default"
          size="sm"
          data-testid="settings-onboarding-open"
          onClick={async () => {
            // Reset the sticky completion flag, then nudge the operator
            // back to the wizard. We POST /api/onboarding/reset which the
            // legacy bundle's OnboardingWizard.open() consumes on the next
            // load. From React land we can only re-navigate to root —
            // the wizard mounts there.
            try {
              await fetch('/api/onboarding/reset', { method: 'POST' });
              window.location.assign('/');
            } catch (err) {
              // eslint-disable-next-line no-alert
              window.alert(`Failed to open wizard: ${(err as Error).message}`);
            }
          }}
        >
          Open onboarding wizard
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Page shell ────────────────────────────────────────────────────────

const TABS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'models', label: 'Models' },
  { id: 'general', label: 'General' },
  { id: 'behavior', label: 'Agent Behavior' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'security', label: 'Security & Scope' },
  { id: 'tools', label: 'Tools / MCP / Skills' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'advanced', label: 'Advanced' },
];

export function SettingsPage() {
  const settingsQ = useSettings();
  const diagQ = useDiagnostics();
  const updateSettings = useUpdateSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const providerState = useMemo(
    () => deriveProviderState(settingsQ.data, diagQ.data),
    [settingsQ.data, diagQ.data],
  );

  const handleSave = async (patch: SettingsPatch) => {
    setSaveError(null);
    setSaved(false);
    try {
      await updateSettings.mutateAsync(patch);
      setSaved(true);
      // Hide the saved banner after a brief grace period so the next
      // edit + save still flashes the affirmative.
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto">
        <header className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-1">
              Operator control surface
            </p>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Settings</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Provider configuration, prompts, governance, toolpacks, and diagnostics.
              The legacy <code className="font-mono">/settings</code> route continues to
              render the vanilla bundle until A8.5 flips it over.
            </p>
          </div>
          <ProviderStatePill
            state={providerState}
            provider={settingsQ.data?.provider}
            data-testid="provider-state-pill"
          />
        </header>

        {settingsQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : settingsQ.isError || !settingsQ.data ? (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Failed to load settings: {(settingsQ.error as Error)?.message ?? 'unknown error'}
          </div>
        ) : (
          <Tabs defaultValue="models" className="space-y-4" data-testid="settings-tabs">
            <TabsList aria-label="Settings tabs" className="flex-wrap h-auto">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} data-tab={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* The first 3 tabs share the same provider editor — they only
                differ in chrome / future expansion (general adds workspace
                inputs; behavior adds risk-bias toggles). For A8.2 visual
                parity we render the editor on all three so operators can
                hit any tab and still configure the provider. */}
            <TabsContent value="models">
              <Card>
                <CardContent className="pt-4">
                  <ProviderEditor
                    settings={settingsQ.data}
                    onSave={handleSave}
                    saving={updateSettings.isPending}
                    error={saveError}
                    saved={saved}
                  />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="general">
              <Card>
                <CardContent className="pt-4">
                  <ProviderEditor
                    settings={settingsQ.data}
                    onSave={handleSave}
                    saving={updateSettings.isPending}
                    error={saveError}
                    saved={saved}
                  />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="behavior">
              <Card>
                <CardContent className="pt-4">
                  <ProviderEditor
                    settings={settingsQ.data}
                    onSave={handleSave}
                    saving={updateSettings.isPending}
                    error={saveError}
                    saved={saved}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="prompts">
              <PromptsPanel />
            </TabsContent>
            <TabsContent value="security">
              <SecurityScopePanel />
            </TabsContent>
            <TabsContent value="tools">
              <ToolpacksPanel />
            </TabsContent>
            <TabsContent value="diagnostics">
              <DiagnosticsPanel />
            </TabsContent>
            <TabsContent value="advanced">
              <AdvancedPanel />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </main>
  );
}

export default SettingsPage;
