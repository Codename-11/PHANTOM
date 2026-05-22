// Toolpack Registry — React translation of registry-presenter.js +
// pages/registry-page.js (legacy B2 surface).
//
// React Query owns the data. The list mirrors the Campaigns list/ListRow
// pattern; clicking a row opens a persistent INLINE detail column
// (SplitPane, kit `.drawer` chrome) driven by selected-id local state (not
// a nested route) that shows validity/trust pills, risk chips, tools,
// install recipes, lifecycle, and the declarative preview-install plan.
// The "Request install" button is rendered-but-disabled — Approvals
// plumbing for registry events is a separate follow-up (matches legacy).
import { useEffect, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IcX } from '@/components/ui/icons';
import { SplitPane } from '@/components/ui/split-pane';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import {
  deriveTrust,
  usePreviewInstall,
  useRegistryLocal,
  useRegistryManifest,
} from '@/lib/registry';
import type {
  RegistryListItem,
  RegistryManifestRecord,
} from '@/lib/registry';

// ── Pills ──────────────────────────────────────────────────────────────

function ValidityPill({ valid }: { valid: boolean }) {
  return (
    <Badge variant={valid ? 'completed' : 'failed'} data-validity={valid ? 'valid' : 'invalid'}>
      {valid ? 'valid' : 'invalid'}
    </Badge>
  );
}

function TrustPill({
  declared,
  computed,
}: {
  declared: string | null | undefined;
  computed: string | null | undefined;
}) {
  const state = deriveTrust(declared, computed);
  if (state === 'signed') {
    return (
      <Tooltip content="declared digest matches the on-disk SHA-256">
        <Badge
          data-trust="signed"
          className="border-[var(--ok-2)] bg-transparent text-[var(--ok-2)]"
        >
          trust ✓
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="no signature, or the declared digest does not match the on-disk SHA-256">
      <Badge
        data-trust="unsigned"
        className="border-[var(--warn-2)] bg-transparent text-[var(--warn-2)]"
      >
        unsigned
      </Badge>
    </Tooltip>
  );
}

// ── List ─────────────────────────────────────────────────────────────────

function RegistryRow({
  item,
  onOpen,
}: {
  item: RegistryListItem;
  onOpen: (id: string) => void;
}) {
  const title = item.identity?.name || item.id;
  const summary = item.identity?.summary || '—';
  const riskClasses = (item.risk?.action_classes || []).slice(0, 4).join(', ');
  return (
    <li>
      <ListRow
        data-manifest-id={item.id}
        aria-label={`Open ${title}`}
        onClick={() => onOpen(item.id)}
      >
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <ValidityPill valid={item.valid} />
          <TrustPill declared={item.digest} computed={item.computedDigest} />
          <span className="font-semibold text-foreground">{title}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            v{item.version || '?'}
          </span>
        </div>
        <div className="text-[13px] text-[var(--fg-2)] mb-1 break-words">{summary}</div>
        {riskClasses ? (
          <div className="font-mono text-[11px] text-muted-foreground">
            risks: {riskClasses}
          </div>
        ) : null}
      </ListRow>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="registry-loading">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-[78px]" />
      ))}
    </div>
  );
}

function RegistryEmpty() {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-card px-6 py-6 text-center text-muted-foreground"
      data-testid="registry-empty"
    >
      <p className="font-mono uppercase tracking-[0.08em] text-xs text-[var(--fg-2)] mb-1">
        No manifests found
      </p>
      <p className="text-[13px] text-[var(--fg-3)]">
        Local toolpack manifests live under{' '}
        <code className="font-mono">server/registry/fixtures/</code>. Add one and refresh.
      </p>
    </div>
  );
}

// ── Detail panes ───────────────────────────────────────────────────────

function MetaDl({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3.5 gap-y-1.5 text-[12px]">
      {rows.map(([k, v]) => (
        <DlRow key={k} label={k} value={v} />
      ))}
    </dl>
  );
}

function DlRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground self-center">
        {label}
      </dt>
      <dd className="text-foreground break-all">{value}</dd>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card px-3.5 py-3">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground mb-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded bg-[var(--bg-1)] p-2.5 font-mono text-[11px] text-[var(--fg-2)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function DetailBody({ record }: { record: RegistryManifestRecord }) {
  const preview = usePreviewInstall();
  const m = record.manifest || {};
  const identity = m.identity || {};
  const risk = m.risk || {};
  const tools = m.tools || [];
  const install = m.install || {};
  const lifecycle = m.lifecycle || {};
  const actionClasses = risk.action_classes || [];

  // Fire the preview-install plan once when the record loads (valid only;
  // the server 400s on invalid manifests). Mirrors the legacy page's
  // best-effort parallel preview fetch.
  useEffect(() => {
    if (record.valid) {
      preview.mutate(record.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.valid]);

  return (
    <div className="drawer-bd px-4 py-3 space-y-3">
      {!record.valid ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
        >
          <p className="font-semibold mb-1">Manifest validation failed</p>
          <ul className="list-disc pl-5 space-y-0.5 text-[12px]">
            {record.errors.map((e, i) => (
              <li key={i}>
                <code className="font-mono">{e.path || '/'}</code>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Section title="Identity">
        <MetaDl
          rows={[
            ['ID', <span className="font-mono">{identity.id || record.id}</span>],
            ['Name', identity.name || '—'],
            [
              'Version',
              <span className="font-mono">{identity.version || record.version || '?'}</span>,
            ],
            ['Publisher', identity.publisher || '—'],
            ['License', identity.license || '—'],
            ['Category', identity.category || '—'],
          ]}
        />
      </Section>

      <Section title="Trust">
        <MetaDl
          rows={[
            [
              'Declared digest',
              <span className="font-mono">{m.trust?.digest || '—'}</span>,
            ],
            [
              'On-disk digest',
              <span className="font-mono">{record.computedDigest || '—'}</span>,
            ],
            ['Signed by', m.trust?.signed_by || '—'],
          ]}
        />
      </Section>

      <Section title={`Risk classes (${actionClasses.length})`}>
        <div className="flex flex-wrap gap-1.5">
          {actionClasses.length ? (
            actionClasses.map((c) => (
              <Badge key={c} variant="outline">
                {c}
              </Badge>
            ))
          ) : (
            <span className="text-[12px] text-muted-foreground">—</span>
          )}
        </div>
        {risk.scope_required ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Scope is required for this toolpack.
          </p>
        ) : null}
        {risk.network_egress ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Network egress: <Badge variant="outline">{risk.network_egress}</Badge>
          </p>
        ) : null}
      </Section>

      <Section title={`Tools (${tools.length})`}>
        {tools.length ? (
          <ul className="space-y-1.5 list-none m-0 p-0">
            {tools.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <Badge variant="outline">{t.risk || 'unknown'}</Badge>
                <span className="font-mono text-[12px] text-foreground">
                  {t.name || t.command || '?'}
                </span>
                {t.gated ? (
                  <Badge variant="needs_approval" data-gated="true">
                    gated
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">No tools declared.</p>
        )}
      </Section>

      <Section title={`Install recipes (${(install.recipes || []).length})`}>
        <JsonBlock value={install} />
      </Section>

      {preview.data ? (
        <Section title="Preview install plan">
          <p className="text-[12px] text-muted-foreground mb-2">{preview.data.note}</p>
          <JsonBlock value={preview.data.plan} />
          <div className="mt-3">
            <Tooltip content="Approvals plumbing lands in a follow-up commit.">
              {/* Span wrapper so the tooltip still fires over a disabled button. */}
              <span className="inline-block">
                <Button
                  variant="primary"
                  size="sm"
                  disabled
                  data-registry-action="request-install"
                >
                  Request install (queued)
                </Button>
              </span>
            </Tooltip>
          </div>
        </Section>
      ) : null}

      {lifecycle.deprecated_at ? (
        <Section title="Lifecycle">
          <MetaDl
            rows={[
              [
                'Deprecated',
                <span className="font-mono">{lifecycle.deprecated_at}</span>,
              ],
              ['Replacement', lifecycle.replacement || '—'],
            ]}
          />
        </Section>
      ) : null}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="px-4 py-6 space-y-3" data-testid="registry-detail-loading">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function RegistryDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { data: record, isLoading, isError, error } = useRegistryManifest(id);

  const title = record?.manifest?.identity?.name || record?.id || 'Manifest';
  const summary = record?.manifest?.identity?.summary || '';
  const version = record?.manifest?.identity?.version || record?.version || '?';

  return (
    <div className="drawer" data-testid="registry-detail-sheet" style={{ height: '100%' }}>
      {isLoading ? (
        <DetailSkeleton />
      ) : isError || !record ? (
        <div className="drawer-hd">
          <div className="grow">
            <div className="title">Failed to load</div>
            <div className="sub">{(error as Error)?.message ?? 'Manifest not found.'}</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close detail"
            data-testid="registry-detail-close"
          >
            <IcX />
          </Button>
        </div>
      ) : (
        <>
          <div className="drawer-hd">
            <div className="grow">
              <div className="flex flex-wrap items-center gap-2">
                <ValidityPill valid={record.valid} />
                <TrustPill
                  declared={record.manifest?.trust?.digest}
                  computed={record.computedDigest}
                />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {record.id} · v{version}
                </span>
              </div>
              <div className="title">{title}</div>
              {summary ? <div className="sub">{summary}</div> : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close detail"
              data-testid="registry-detail-close"
            >
              <IcX />
            </Button>
          </div>
          <DetailBody record={record} />
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export function RegistryPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch, isFetching } = useRegistryLocal();
  const summary = data?.summary;
  const list = data?.manifests ?? [];

  // The master column: summary line + the toolpack manifest list. Lives in
  // the SplitPane's list slot so it stays visible beside the inline detail
  // column on desktop.
  const listColumn = (
    <div className="p-6">
      {summary ? (
        <div
          className="flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground mb-3"
          data-testid="registry-summary"
        >
          <span>total {summary.total}</span>
          <span>valid {summary.valid}</span>
          <span>invalid {summary.invalid}</span>
        </div>
      ) : null}

      <section aria-label="Toolpack list" data-empty={list.length === 0} className="py-2">
        {isLoading ? (
          <ListSkeleton />
        ) : isError ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            Failed to load registry: {(error as Error)?.message ?? 'unknown error'}
          </div>
        ) : list.length === 0 ? (
          <RegistryEmpty />
        ) : (
          <ul className="flex flex-col gap-2 list-none m-0 p-0">
            {list.map((item) => (
              <RegistryRow key={item.id} item={item} onOpen={setSelectedId} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return (
    <main className="flex h-[calc(100vh-3rem)] flex-col bg-background text-foreground font-sans">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Governed toolpack catalog"
          title="Registry"
          description="Local toolpack manifests, each validated and trust-checked against its on-disk SHA-256. Read-only — install requests thread through the Approvals queue in a follow-up."
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="refresh-registry-btn"
            >
              ↻ Refresh
            </Button>
          }
        />
      </div>

      <div className="min-h-0 flex-1">
        <SplitPane
          list={listColumn}
          detail={
            selectedId ? (
              <RegistryDetail id={selectedId} onClose={() => setSelectedId(null)} />
            ) : null
          }
          detailOpen={!!selectedId}
          detailWidth={420}
        />
      </div>
    </main>
  );
}

export default RegistryPage;
