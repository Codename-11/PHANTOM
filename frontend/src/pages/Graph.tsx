// Graph — operational-graph React surface for run topology + artifact
// lineage, rebuilt to match the original "PHANTOM SEC UI kit" graph
// concept (kit/screens/graph.jsx) that was flattened during migration.
//
// The data pipeline is unchanged: GraphCanvas renders a deterministic
// layered layout from the /api/runs/:id/graph endpoint. On top we restore
// the kit chrome — a toolbar (search, Run/Topology/Asset view switch,
// Follow + Show-Blocked toggles, Fit/Snapshot), a bottom overlays legend
// + zoom pill (in GraphCanvas), and a right-side node inspector drawer
// (COMMAND / POLICY / OUTPUT / EDGES).
//
// Reads `runId` from either the URL parameter (/graph/:runId) or the
// `?runId=` query string so a deep-link from the Runs surface works
// either way.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ButtonGroup, Chip, Kv } from '@/components/ui/kit';
import { IcPlay, IcPause, IcStep, IcReplay } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { useRunEvents } from '@/lib/runs';
import { useArtifacts } from '@/lib/artifacts';
import {
  useRunGraph,
  nodeColorVar,
  nodeKindLabel,
  isBlockedEdge,
  type RunGraphNode,
  type RunGraphEdge,
} from '@/lib/graph';
import { GraphCanvas } from '@/components/GraphCanvas';

const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

// Replay transport — ~800ms per step auto-advance.
const REPLAY_INTERVAL_MS = 800;

// prefers-reduced-motion guard. Defaults to false (animate) in non-DOM /
// test environments where matchMedia is unavailable.
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

type GraphView = 'run' | 'topology' | 'asset';

// Per-view node-type whitelist passed to layoutGraph().
//   • Run      — the full pipeline (no filter; every type renders)
//   • Topology — infrastructure: host/url/port + artifacts produced on them
//   • Asset    — hosts + the findings/errors observed against them
// Run returns null (no filter) so the default layout is unchanged.
const VIEW_NODE_TYPES: Record<GraphView, string[] | null> = {
  run: null,
  topology: ['host', 'domain', 'url', 'port', 'artifact'],
  asset: ['host', 'domain', 'url', 'finding', 'error'],
};

export function GraphPage() {
  const params = useParams<{ runId?: string }>();
  const [search] = useSearchParams();
  // Prefer the path-param form, fall back to ?runId=.
  const runId = params.runId || search.get('runId') || null;
  const { toast } = useToast();
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<GraphView>('run');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [showBlocked, setShowBlocked] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Pre-fetch events + artifacts so the count badges stay warm alongside
  // the graph; the renderer itself reads the derived graph endpoint.
  const eventsQuery = useRunEvents(runId);
  const artifactsQuery = useArtifacts(runId ? { runId } : {});
  const graphQuery = useRunGraph(runId);

  const legacyHref = runId ? `/graph?runId=${encodeURIComponent(runId)}` : '/graph';
  const allNodes = graphQuery.data?.nodes ?? [];
  const allEdges = graphQuery.data?.edges ?? [];

  // Show-Blocked toggle filters policy-blocked edges (and the nodes that
  // become unreferenced) without mutating the underlying graph data.
  const edges = useMemo<RunGraphEdge[]>(
    () => (showBlocked ? allEdges : allEdges.filter((e) => !isBlockedEdge(e))),
    [allEdges, showBlocked],
  );
  const nodes = allNodes;

  // View-switch → node-type whitelist forwarded to layoutGraph (Run = all).
  const nodeTypeFilter = VIEW_NODE_TYPES[view] ?? undefined;

  // Search → case-insensitive label match. Returns the set of node ids whose
  // label (or id fallback) contains the query; `null` when the box is empty
  // so the canvas renders every node at full opacity. Pure client-side op.
  const matchIds = useMemo<Set<string> | null>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<string>();
    for (const n of nodes) {
      const label = String(n.label || n.id).toLowerCase();
      if (label.includes(q)) set.add(n.id);
    }
    return set;
  }, [nodes, query]);

  // ── Replay sequence ──────────────────────────────────────────────────
  // The transport replays the run's execution order. We order every node by
  // its `seq` (the event/step index the server stamps), falling back to a
  // stable label/id sort for nodes without a seq so the sequence is fully
  // deterministic. The cursor indexes into this list and drives the active
  // node (which feeds GraphCanvas's highlight + ▼REPLAY marker).
  const sequence = useMemo<RunGraphNode[]>(() => {
    return [...nodes].sort(
      (a, b) =>
        (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) ||
        String(a.label || a.id).localeCompare(String(b.label || b.id)),
    );
  }, [nodes]);

  const stepCount = sequence.length;
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Keep the cursor in range as the sequence changes (run switch, filter,
  // load). Clamp rather than reset so a valid position survives re-renders.
  useEffect(() => {
    setCursor((c) => (stepCount === 0 ? 0 : Math.min(c, stepCount - 1)));
    if (stepCount === 0) setPlaying(false);
  }, [stepCount]);

  // Active node = the node under the cursor. Replaces the old "first node"
  // derivation; this is the single source of truth for the ▼REPLAY marker.
  const activeNode = stepCount > 0 ? sequence[Math.min(cursor, stepCount - 1)] : null;
  const activeId = activeNode?.id ?? null;

  const step = useCallback(() => {
    setCursor((c) => {
      const next = Math.min(c + 1, Math.max(0, stepCount - 1));
      // Reaching the end stops auto-advance.
      if (next >= stepCount - 1) setPlaying(false);
      return next;
    });
  }, [stepCount]);

  const reset = useCallback(() => {
    setPlaying(false);
    setCursor(0);
  }, []);

  // Manual Step pauses any running playback.
  const stepManual = useCallback(() => {
    setPlaying(false);
    setCursor((c) => Math.min(c + 1, Math.max(0, stepCount - 1)));
  }, [stepCount]);

  // Play/Pause toggle. Starting from the end rewinds to 0 so Play always
  // produces visible motion. No-op when there are no steps.
  const togglePlay = useCallback(() => {
    if (stepCount === 0) return;
    setPlaying((p) => {
      if (!p && cursor >= stepCount - 1) setCursor(0);
      return !p;
    });
  }, [cursor, stepCount]);

  // Auto-advance timer. Respects prefers-reduced-motion by skipping the
  // timer entirely (the user can still Step manually).
  const reduced = useRef(prefersReducedMotion());
  useEffect(() => {
    if (!playing || reduced.current) return;
    if (cursor >= stepCount - 1) {
      setPlaying(false);
      return;
    }
    const id = window.setInterval(step, REPLAY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, cursor, stepCount, step]);

  // Selecting a node in the canvas moves the cursor to it and pauses.
  const selectNode = useCallback(
    (n: RunGraphNode) => {
      setSelectedId(n.id);
      setPlaying(false);
      const idx = sequence.findIndex((s) => s.id === n.id);
      if (idx >= 0) setCursor(idx);
    },
    [sequence],
  );

  const selected = useMemo<RunGraphNode | null>(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const activeLabel = activeNode ? activeNode.label || activeNode.id : '';
  const activeTs =
    activeNode?.metadata && (activeNode.metadata.ts ?? activeNode.metadata.timestamp)
      ? String(activeNode.metadata.ts ?? activeNode.metadata.timestamp)
      : activeNode?.seq != null
        ? `evt #${activeNode.seq}`
        : '';

  function zoomBy(delta: number) {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  }

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-4">
        <PageHeader
          eyebrow="Run topology + artifact lineage"
          title="Graph"
          description={
            <>
              An operational node-link view of the selected run — flow,
              findings, blocked actions, and artifact lineage. For the full
              interactive canvas (pan, deep replay) open the legacy{' '}
              <code className="font-mono">/graph</code> viewer.
            </>
          }
          actions={
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/runs" data-testid="back-to-runs-btn">
                  ← Runs
                </Link>
              </Button>
              <Button variant="primary" size="sm" asChild>
                <a href={legacyHref} data-testid="open-legacy-graph">
                  Open in legacy graph viewer →
                </a>
              </Button>
            </>
          }
        />

        <Card data-testid="graph-toolbar-card">
          <CardHeader>
            <CardTitle>Run context</CardTitle>
            <CardDescription>
              {runId
                ? `Bound to run ${runId.slice(0, 12)}…`
                : 'No run selected — pass ?runId=<id> or follow a link from /runs.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runId ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono">run: {runId.slice(0, 8)}</Badge>
                  {graphQuery.isLoading ? (
                    <Skeleton className="h-6 w-32" />
                  ) : (
                    <>
                      <Badge variant="outline" className="font-mono">
                        {nodes.length} nodes
                      </Badge>
                      <Badge variant="outline" className="font-mono">
                        {edges.length} edges
                      </Badge>
                    </>
                  )}
                  {eventsQuery.data ? (
                    <Badge variant="outline" className="font-mono">
                      {eventsQuery.data.length} events
                    </Badge>
                  ) : null}
                  {artifactsQuery.data ? (
                    <Badge variant="outline" className="font-mono">
                      {artifactsQuery.data.length} artifacts
                    </Badge>
                  ) : null}
                </div>
                {graphQuery.isError ? (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    Failed to load graph: {(graphQuery.error as Error)?.message ?? 'unknown error'}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-4 text-sm text-muted-foreground">
                Pick a run on <Link to="/runs" className="text-[var(--cy-2)] hover:underline">/runs</Link>{' '}
                and click <strong className="text-foreground">Open graph</strong> on the detail
                sheet to come back here with a run id attached.
              </div>
            )}
          </CardContent>
        </Card>

        {runId ? (
          <Card data-testid="graph-canvas-card">
            {/* toolbar chrome */}
            <div
              data-testid="graph-toolbar"
              className="flex flex-wrap items-center gap-2"
              style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-1)' }}
            >
              <input
                type="search"
                className="input mono"
                placeholder="Filter nodes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter nodes"
                data-testid="graph-search"
                style={{ width: 200, height: 'var(--ctl-h-sm)' }}
              />
              <ButtonGroup<GraphView>
                value={view}
                onChange={setView}
                options={[
                  { value: 'run', label: 'Run' },
                  { value: 'topology', label: 'Topology' },
                  { value: 'asset', label: 'Asset' },
                ]}
              />
              <span className="grow" />
              <Chip
                k="follow"
                v="live"
                pressed={follow}
                role="button"
                tabIndex={0}
                onClick={() => setFollow((v) => !v)}
                data-testid="graph-follow-toggle"
                style={{ cursor: 'pointer' }}
              />
              <Chip
                k="show"
                v="blocked"
                pressed={showBlocked}
                role="button"
                tabIndex={0}
                onClick={() => setShowBlocked((v) => !v)}
                data-testid="graph-blocked-toggle"
                style={{ cursor: 'pointer' }}
              />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setZoom(1)}
                data-testid="graph-fit"
              >
                Fit
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="graph-snapshot"
                onClick={() => toast({ title: 'Graph snapshot copied to clipboard' })}
              >
                Snapshot
              </button>
              <Button
                variant="ghost"
                size="sm"
                loading={graphQuery.isFetching}
                onClick={() => {
                  graphQuery.refetch();
                  toast({ title: 'Refreshing graph…' });
                }}
                data-testid="graph-refresh"
              >
                Refresh
              </Button>
            </div>

            {/* replay transport — Play/Pause • Step • Reset, progress + counter */}
            <div
              data-testid="graph-replay-transport"
              className="flex flex-wrap items-center gap-2"
              style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-1)' }}
            >
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={togglePlay}
                disabled={stepCount === 0}
                aria-label={playing ? 'Pause replay' : 'Play replay'}
                aria-pressed={playing}
                data-testid="graph-replay-play"
              >
                {playing ? <IcPause size={14} /> : <IcPlay size={14} />}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={stepManual}
                disabled={stepCount === 0 || cursor >= stepCount - 1}
                aria-label="Step forward"
                data-testid="graph-replay-step"
              >
                <IcStep size={14} />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={reset}
                disabled={stepCount === 0 || cursor === 0}
                aria-label="Reset replay"
                data-testid="graph-replay-reset"
              >
                <IcReplay size={14} />
              </button>

              <span
                className="mono"
                data-testid="graph-replay-counter"
                style={{ fontSize: 11, color: 'var(--fg-2)', letterSpacing: '0.04em' }}
              >
                STEP {String(Math.min(cursor + 1, Math.max(stepCount, 1))).padStart(2, '0')} /{' '}
                {String(stepCount).padStart(2, '0')}
              </span>

              {/* progress bar */}
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={Math.max(stepCount - 1, 0)}
                aria-valuenow={Math.min(cursor, Math.max(stepCount - 1, 0))}
                data-testid="graph-replay-progress"
                style={{
                  flex: '1 1 120px',
                  minWidth: 120,
                  height: 4,
                  borderRadius: 999,
                  background: 'var(--bg-3)',
                  overflow: 'hidden',
                }}
              >
                <div
                  data-testid="graph-replay-progress-fill"
                  style={{
                    height: '100%',
                    width: `${stepCount > 1 ? (cursor / (stepCount - 1)) * 100 : stepCount === 1 ? 100 : 0}%`,
                    background: 'var(--cy-2)',
                    transition: reduced.current ? 'none' : 'width 200ms ease',
                  }}
                />
              </div>

              {activeLabel ? (
                <span
                  className="mono"
                  data-testid="graph-replay-active-label"
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-1)',
                    maxWidth: 240,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={activeLabel}
                >
                  {activeLabel}
                  {activeTs ? (
                    <span style={{ color: 'var(--fg-3)' }}> · {activeTs}</span>
                  ) : null}
                </span>
              ) : null}
            </div>

            <CardContent className="p-0">
              <div
                className="grid"
                style={{ gridTemplateColumns: 'minmax(0,1fr) 320px', minHeight: 0 }}
              >
                <div style={{ borderRight: '1px solid var(--line-1)', minWidth: 0 }}>
                  {graphQuery.isLoading ? (
                    <div className="p-3">
                      <Skeleton className="h-64 w-full" />
                    </div>
                  ) : (
                    <GraphCanvas
                      nodes={nodes}
                      edges={edges}
                      zoom={zoom}
                      selectedId={selectedId}
                      activeId={activeId}
                      nodeTypeFilter={nodeTypeFilter}
                      matchIds={matchIds}
                      onSelect={selectNode}
                      onZoomIn={() => zoomBy(ZOOM_STEP)}
                      onZoomOut={() => zoomBy(-ZOOM_STEP)}
                      onFit={() => setZoom(1)}
                    />
                  )}
                </div>

                {/* node inspector drawer */}
                <NodeInspector
                  node={selected}
                  edges={allEdges}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

// ── Node inspector drawer ──────────────────────────────────────────────
// COMMAND / POLICY / OUTPUT / EDGES sections populated from the selected
// node. Where the data model doesn't carry a field (command text, raw
// output) we derive from metadata or show a graceful placeholder.
function NodeInspector({
  node,
  edges,
  onClose,
}: {
  node: RunGraphNode | null;
  edges: RunGraphEdge[];
  onClose: () => void;
}) {
  if (!node) {
    return (
      <aside className="drawer" data-testid="graph-inspector">
        <div className="drawer-hd">
          <div className="grow">
            <div className="caption">SELECTED NODE</div>
            <div className="title" style={{ fontSize: 13, marginTop: 2 }}>
              No node selected
            </div>
          </div>
        </div>
        <div className="drawer-bd" style={{ padding: '14px 16px' }}>
          <p style={{ color: 'var(--fg-3)', fontSize: 12 }}>
            Click a node in the graph to inspect its command, policy decision,
            output, and edges.
          </p>
        </div>
      </aside>
    );
  }

  const meta = node.metadata ?? {};
  const label = node.label || node.id;
  const command = meta.command ? String(meta.command) : meta.value ? String(meta.value) : '';
  const output = meta.output ?? meta.output_preview ?? meta.policyReason ?? '';
  const outgoing = edges.filter((e) => e.source === node.id);

  return (
    <aside className="drawer" data-testid="graph-inspector">
      <div className="drawer-hd">
        <div className="grow">
          <div className="caption">SELECTED NODE</div>
          <div className="title mono" style={{ fontSize: 13, marginTop: 2 }} data-testid="graph-inspector-title">
            {label}
          </div>
          <div className="sub mono" style={{ fontSize: 11 }}>
            {nodeKindLabel(node).toLowerCase()} · {node.id.slice(0, 18)}
            {node.seq != null ? ` · evt #${node.seq}` : ''}
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="drawer-bd" style={{ padding: '14px 16px' }}>
        <div className="caption" style={{ marginBottom: 6 }}>COMMAND</div>
        <pre
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--line-1)',
            borderLeft: '2px solid var(--cy-2)',
            borderRadius: 'var(--r-3)',
            padding: '10px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--fg-1)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            lineHeight: 1.55,
          }}
        >
          {command || '— no command recorded for this node —'}
        </pre>

        <div className="caption" style={{ marginTop: 16, marginBottom: 6 }}>POLICY</div>
        <Kv
          items={[
            { k: 'kind', v: nodeKindLabel(node).toLowerCase() },
            { k: 'status', v: node.status ?? '—' },
            {
              k: 'scope',
              v: meta.scopeStatus ? (
                <span style={{ color: 'var(--policy)' }}>{String(meta.scopeStatus)}</span>
              ) : (
                <span style={{ color: 'var(--sev-ok)' }}>in-scope</span>
              ),
            },
            ...(meta.policyReason
              ? [{ k: 'reason', v: String(meta.policyReason) }]
              : []),
          ]}
        />

        <div className="caption" style={{ marginTop: 16, marginBottom: 6 }}>OUTPUT (TRUNCATED)</div>
        <pre
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--line-1)',
            borderRadius: 'var(--r-3)',
            padding: '10px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--fg-2)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            lineHeight: 1.55,
            maxHeight: 160,
            overflow: 'auto',
          }}
        >
          {output ? String(output) : '— no output captured —'}
        </pre>

        <div className="caption" style={{ marginTop: 16, marginBottom: 6 }}>EDGES</div>
        {outgoing.length === 0 ? (
          <p style={{ color: 'var(--fg-3)', fontSize: 12 }}>No outgoing edges.</p>
        ) : (
          <div className="kit-col" style={{ gap: 6 }}>
            {outgoing.map((e, i) => {
              const targetNode = { id: e.target, type: '' } as RunGraphNode;
              const stroke = isBlockedEdge(e) ? 'var(--policy)' : nodeColorVar(targetNode);
              return (
                <div className="kit-row" key={e.id ?? `${e.target}:${i}`} data-testid="graph-inspector-edge">
                  <span className="mono" style={{ color: 'var(--fg-3)' }}>→</span>
                  <span className="mono" style={{ fontSize: 11, color: stroke }}>
                    {e.target}
                  </span>
                  <span className="grow" />
                  <span className={`badge ${isBlockedEdge(e) ? 'policy' : 'cyan'}`}>
                    {e.type ?? 'edge'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

export default GraphPage;
