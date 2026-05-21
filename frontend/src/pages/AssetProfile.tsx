// Asset / Entity profile — React port of the PHANTOM SEC UI kit's
// asset-profile screen (kit/screens/asset-profile.jsx).
//
// Data sources (all existing endpoints — no new backend surface):
//   - GET /api/assets/:id   → asset row + { findings, snapshots }
//   - GET /api/scopes       → scope list; membership is derived client-side
//                             by matching this asset's id against each
//                             scope's targets.assetIds.
//
// The kit mock carried fields the real asset row doesn't (health score,
// CWE/CVE per finding, TLS per service). Where the row omits them we
// degrade gracefully and label the value as unknown rather than invent
// data. Health score is read from the most-recent snapshot when present,
// otherwise computed from the open-finding severity mix.
import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/PageHeader';
import { SeverityBadge } from '@/components/SeverityBadge';
import { Panel, Kv, Bar, Spark, SevTick, Chip, type Severity } from '@/components/ui/kit';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api';
import { severityClass, severityRank, parseFindingMeta } from '@/lib/findings';
import { useScopes, deriveScopeStatus } from '@/lib/scopes';
import type { FindingRecord, ScopeRecord } from '@/lib/types';

// ── Asset detail shape (server/assets/asset-store.normalizeAsset + the
// assetDetail() wrapper in routes/api.js). Typed locally — lib/types.ts is
// owned by another surface. ────────────────────────────────────────────
interface AssetAddress {
  id: string;
  kind: string | null;
  value: string;
  label: string | null;
}
interface AssetService {
  id: string;
  name: string | null;
  protocol: string | null;
  port: number | null;
  url: string | null;
  status: string | null;
  metadata?: Record<string, unknown>;
}
interface AssetDetailRecord {
  id: string;
  type: string;
  name: string;
  description: string;
  owner: string;
  environment: string;
  status: string;
  criticality: string;
  notes: string;
  metadata: Record<string, unknown>;
  addresses: AssetAddress[];
  services: AssetService[];
  tags: string[];
  findings: FindingRecord[];
  snapshots: Array<{
    id: string;
    healthScore: number | null;
    findingCounts: Record<string, number>;
    captured_at: string | null;
  }>;
  created_at: string | null;
  updated_at: string | null;
}

function useAssetDetail(id: string | undefined) {
  return useQuery<AssetDetailRecord, Error>({
    queryKey: ['asset', 'profile', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const data = await apiFetch<AssetDetailRecord>(
        `/api/assets/${encodeURIComponent(id as string)}`,
      );
      if (!data) throw new Error('asset not found');
      return data;
    },
  });
}

const SEV_KEYS = ['crit', 'high', 'med', 'low', 'info'] as const;
type SevKey = (typeof SEV_KEYS)[number];

// Open-finding tally per severity bucket, used by both the distribution
// grid and the computed-health fallback.
function tallySeverities(findings: FindingRecord[]): Record<SevKey, number> {
  const out: Record<SevKey, number> = { crit: 0, high: 0, med: 0, low: 0, info: 0 };
  for (const f of findings) {
    const cls = severityClass(f.severity);
    if (cls === 'ok') continue;
    out[cls] += 1;
  }
  return out;
}

// Health 100 = clean. Each open finding subtracts a severity-weighted
// penalty (crit 25 / high 12 / med 6 / low 2 / info 0), floored at 0.
// Mirrors the kit's "lower is worse" reading; used only when no snapshot
// healthScore is on record.
const SEV_PENALTY: Record<SevKey, number> = { crit: 25, high: 12, med: 6, low: 2, info: 0 };
function computeHealth(tally: Record<SevKey, number>): number {
  let score = 100;
  for (const k of SEV_KEYS) score -= SEV_PENALTY[k] * tally[k];
  return Math.max(0, Math.min(100, score));
}

// Bar/Stat color band: <40 crit, <70 high, <85 med, else ok.
function healthKind(score: number): 'crit' | 'high' | 'med' | 'ok' {
  if (score < 40) return 'crit';
  if (score < 70) return 'high';
  if (score < 85) return 'med';
  return 'ok';
}

function healthColorVar(score: number): string {
  const k = healthKind(score);
  return k === 'ok' ? 'var(--sev-ok)' : `var(--sev-${k})`;
}

function timeAgo(ts: string | null | undefined): string {
  if (!ts) return '—';
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function expiresLabel(scope: ScopeRecord): string {
  const status = deriveScopeStatus(scope);
  if (status === 'archived') return 'archived';
  if (status === 'expired') return 'expired';
  if (!scope.expires_at) return 'no expiry';
  return `expires ${timeAgo(scope.expires_at)}`;
}

function isOpen(f: FindingRecord): boolean {
  const s = String(f.status || '').toLowerCase();
  return s !== 'closed' && s !== 'resolved' && s !== 'fixed';
}

function addressesByKind(addresses: AssetAddress[], ...kinds: string[]): string {
  const set = new Set(kinds);
  const vals = addresses
    .filter((a) => set.has(String(a.kind || 'host')))
    .map((a) => a.value);
  return vals.length ? vals.join(' · ') : '—';
}

// Status cell color — untriaged reads crit, active work reads high,
// everything else falls to muted (mirrors the kit + Alerts page).
function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'new' || s === 'untriaged' || s === 'open') return 'var(--sev-crit)';
  if (s === 'in_progress' || s === 'investigating' || s === 'acknowledged') return 'var(--sev-high)';
  return 'var(--fg-3)';
}

function findingRule(f: FindingRecord): string {
  const meta = parseFindingMeta(f);
  return (meta.rule as string) || (meta.detector as string) || '—';
}
function findingRef(f: FindingRecord): string {
  const meta = parseFindingMeta(f);
  return (meta.cve as string) || (meta.cwe as string) || '—';
}

// ── Page ────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="space-y-4" data-testid="asset-profile-loading">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export function AssetProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data: asset, isLoading, isError, error } = useAssetDetail(id);
  const { data: scopesData } = useScopes();

  const findings = asset?.findings ?? [];
  const openFindings = useMemo(
    () =>
      findings
        .filter(isOpen)
        .sort((a, b) => {
          const r = severityRank(b.severity) - severityRank(a.severity);
          if (r !== 0) return r;
          const ta = a.first_seen_at ? Date.parse(a.first_seen_at) : 0;
          const tb = b.first_seen_at ? Date.parse(b.first_seen_at) : 0;
          return tb - ta;
        }),
    [findings],
  );

  const tally = useMemo(() => tallySeverities(openFindings), [openFindings]);

  // Health: prefer the latest snapshot's recorded score; otherwise derive
  // it from the open-finding severity mix.
  const snapshot = asset?.snapshots?.[0] ?? null;
  const health =
    snapshot && typeof snapshot.healthScore === 'number'
      ? snapshot.healthScore
      : computeHealth(tally);
  const healthIsLive = Boolean(snapshot && typeof snapshot.healthScore === 'number');

  // Spark trend from snapshot history (health over time, oldest→newest).
  // snapshots arrive newest-first; reverse for a left-to-right reading.
  const sparkData = useMemo(() => {
    const snaps = asset?.snapshots ?? [];
    const scores = snaps
      .map((s) => (typeof s.healthScore === 'number' ? s.healthScore : null))
      .filter((v): v is number => v != null)
      .slice(0, 12)
      .reverse();
    // Map 0..100 health → 2..14px bar heights (inverted: low health → tall
    // bar, matching the kit's "crit" spark reading worse = bigger).
    return scores.map((v) => Math.max(2, Math.round(((100 - v) / 100) * 12) + 2));
  }, [asset?.snapshots]);

  // Scope membership — derived client-side by matching this asset id
  // against each scope's targets.assetIds.
  const memberScopes = useMemo(() => {
    if (!asset) return [];
    return (scopesData ?? []).filter((s) =>
      (s.targets?.assetIds ?? []).includes(asset.id),
    );
  }, [scopesData, asset]);

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto" data-testid="asset-profile">
        {isLoading ? (
          <ProfileSkeleton />
        ) : isError || !asset ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="asset-profile-error"
          >
            Failed to load asset: {(error as Error)?.message ?? 'asset not found'}.{' '}
            <Link to="/registry" className="underline">
              Back to registry
            </Link>
          </div>
        ) : (
          <>
            <PageHeader
              className="mb-4"
              eyebrow={`${asset.type || 'asset'} · ${asset.environment || 'env ?'}${
                asset.owner ? ` · ${asset.owner}` : ''
              }`}
              title={asset.name}
              description={
                asset.description ||
                'Entity profile — identity, health, open findings, exposed services, and scope membership.'
              }
              actions={
                <span
                  className="font-mono text-[11px] text-muted-foreground self-center"
                  data-testid="asset-last-seen"
                >
                  updated {timeAgo(asset.updated_at || asset.created_at)} ago
                </span>
              }
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Identity */}
              <Panel title="Identity" flush>
                <div style={{ padding: 14 }}>
                  <Kv
                    items={[
                      { k: 'asset id', v: <span className="mono">{asset.id}</span> },
                      {
                        k: 'fqdn',
                        v: addressesByKind(asset.addresses, 'domain', 'hostname', 'host'),
                      },
                      {
                        k: 'addresses',
                        v: addressesByKind(asset.addresses, 'ip', 'host', 'cidr'),
                      },
                      {
                        k: 'open ports',
                        v:
                          asset.services.filter((s) => s.port != null).length === 0
                            ? '—'
                            : asset.services
                                .filter((s) => s.port != null)
                                .map((s) => `${s.port}/${s.protocol || 'tcp'}`)
                                .join(' · '),
                      },
                      {
                        k: 'stack',
                        v: asset.tags.length ? asset.tags.join(' · ') : '—',
                        sans: true,
                      },
                      { k: 'owner', v: asset.owner || '—', sans: true },
                      { k: 'environment', v: asset.environment || '—', sans: true },
                      {
                        k: 'criticality',
                        v: (
                          <span
                            style={{
                              color:
                                asset.criticality === 'critical' || asset.criticality === 'high'
                                  ? 'var(--sev-crit)'
                                  : undefined,
                            }}
                          >
                            {asset.criticality || '—'}
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>
              </Panel>

              {/* Health */}
              <Panel
                title="Health score"
                sub={
                  healthIsLive
                    ? `HEALTH ${health} / 100 · live`
                    : `HEALTH ${health} / 100 · derived`
                }
                flush
              >
                <div style={{ padding: 14 }} data-testid="asset-health">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 44,
                        color: healthColorVar(health),
                        fontWeight: 500,
                        lineHeight: 1,
                      }}
                      data-testid="asset-health-score"
                    >
                      {health}
                    </span>
                    <span className="mono" style={{ color: 'var(--fg-3)' }}>
                      /100
                    </span>
                    <span style={{ flex: 1 }} />
                    {sparkData.length > 1 ? (
                      <Spark data={sparkData} crit={healthKind(health) === 'crit'} />
                    ) : (
                      <span className="caption">no trend</span>
                    )}
                  </div>
                  <Bar pct={health} kind={healthKind(health)} />

                  <div
                    style={{
                      borderTop: '1px solid var(--line-1)',
                      margin: '14px 0',
                    }}
                  />
                  <div className="caption" style={{ marginBottom: 6 }}>
                    SEVERITY DISTRIBUTION
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 1fr)',
                      gap: 6,
                    }}
                    data-testid="asset-sev-distribution"
                  >
                    {SEV_KEYS.map((s) => (
                      <div
                        key={s}
                        style={{
                          textAlign: 'center',
                          padding: '8px 4px',
                          background: 'var(--bg-1)',
                          borderRadius: 'var(--r-3)',
                          border: '1px solid var(--line-1)',
                        }}
                      >
                        <div
                          className="mono"
                          style={{ fontSize: 18, color: `var(--sev-${s})` }}
                        >
                          {tally[s]}
                        </div>
                        <SeverityBadge severity={s} dot={false} className="mt-1" />
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>

              {/* Open findings */}
              <Panel
                title="Open findings"
                sub={`${openFindings.length} OPEN`}
                flush
                style={{ gridColumn: '1 / -1' }}
              >
                {openFindings.length === 0 ? (
                  <div
                    style={{ padding: 18 }}
                    className="text-sm text-muted-foreground"
                    data-testid="asset-findings-empty"
                  >
                    No open findings for this asset.
                  </div>
                ) : (
                  <table className="tbl dense" data-testid="asset-findings-table">
                    <thead>
                      <tr>
                        <th style={{ width: 14, padding: 0 }} aria-label="severity" />
                        <th style={{ width: 90 }}>ID</th>
                        <th style={{ width: 70 }}>SEV</th>
                        <th>TITLE</th>
                        <th style={{ width: 150 }}>RULE</th>
                        <th style={{ width: 110 }}>CWE/CVE</th>
                        <th style={{ width: 70 }}>AGE</th>
                        <th style={{ width: 100 }}>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openFindings.map((f) => {
                        const sev = severityClass(f.severity) as Severity;
                        const status =
                          f.triage_status || (f.status as string) || 'new';
                        return (
                          <tr key={f.id} data-finding-id={f.id}>
                            <td style={{ padding: 0 }}>
                              <SevTick s={sev} />
                            </td>
                            <td className="mono">
                              <span style={{ color: 'var(--cy-1)' }}>
                                {f.id.slice(0, 8)}
                              </span>
                            </td>
                            <td>
                              <SeverityBadge severity={f.severity} />
                            </td>
                            <td>{f.title || '(untitled)'}</td>
                            <td className="mono muted">{findingRule(f)}</td>
                            <td className="mono muted">{findingRef(f)}</td>
                            <td className="mono muted">
                              {timeAgo(f.first_seen_at || f.last_seen_at)}
                            </td>
                            <td>
                              <span
                                className="caption"
                                style={{ color: statusColor(status) }}
                              >
                                {status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </Panel>

              {/* Services */}
              <Panel title="Services" flush>
                {asset.services.length === 0 ? (
                  <div
                    style={{ padding: 18 }}
                    className="text-sm text-muted-foreground"
                    data-testid="asset-services-empty"
                  >
                    No services recorded for this asset.
                  </div>
                ) : (
                  <table className="tbl dense" data-testid="asset-services-table">
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>PORT</th>
                        <th style={{ width: 70 }}>PROTO</th>
                        <th>SERVICE</th>
                        <th>BANNER</th>
                        <th style={{ width: 90 }}>TLS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {asset.services.map((s) => {
                        const meta = s.metadata || {};
                        const banner =
                          (meta.banner as string) ||
                          (meta.product as string) ||
                          s.url ||
                          '—';
                        const tls =
                          (meta.tls as string) ||
                          (meta.tlsVersion as string) ||
                          '—';
                        return (
                          <tr key={s.id}>
                            <td className="mono">{s.port ?? '—'}</td>
                            <td className="mono muted">{s.protocol || '—'}</td>
                            <td className="mono">{s.name || '—'}</td>
                            <td className="mono muted">{banner}</td>
                            <td className="mono muted">{tls}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </Panel>

              {/* Scope membership */}
              <Panel title="Scope membership" flush>
                <div
                  style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
                  data-testid="asset-scopes"
                >
                  {memberScopes.length === 0 ? (
                    <div
                      className="text-sm text-muted-foreground"
                      data-testid="asset-scopes-empty"
                    >
                      This asset is not a target of any scope.
                    </div>
                  ) : (
                    memberScopes.map((s) => (
                      <div
                        key={s.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                        data-scope-id={s.id}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Chip k="scope" v={deriveScopeStatus(s)} />
                          <span className="mono" style={{ color: 'var(--fg-1)' }}>
                            {s.name}
                          </span>
                          <span style={{ flex: 1 }} />
                          <span className="ts">{expiresLabel(s)}</span>
                        </div>
                        <div className="caption">
                          allows:{' '}
                          {(s.allowed_actions ?? []).length
                            ? s.allowed_actions.join(' · ')
                            : '—'}{' '}
                          — blocks:{' '}
                          {(s.blocked_actions ?? []).length
                            ? s.blocked_actions.join(' · ')
                            : '—'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default AssetProfilePage;

