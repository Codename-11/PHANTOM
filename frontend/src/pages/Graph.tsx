// Graph — chrome-only React surface. The canvas painter (graph-layout.js
// + graph-presenter.js) stays on the legacy /graph page until A8.5
// migrates it as part of the renderer port; this React page just hosts
// the toolbar Card, a "open in legacy graph viewer" link, and a stub
// area that surfaces node/edge counts for the selected run.
//
// Reads `runId` from either the URL parameter (/react/graph/:runId) or
// the `?runId=` query string so a deep-link from the Runs surface works
// either way.

import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api';
import { useRunEvents } from '@/lib/runs';
import { useArtifacts } from '@/lib/artifacts';

interface RunGraphResponse {
  nodes: Array<{ id: string; label?: string; kind?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

function useRunGraph(runId: string | null | undefined) {
  return useQuery({
    queryKey: ['runs', 'graph', runId],
    queryFn: async () => {
      const data = await apiFetch<RunGraphResponse>(
        `/api/runs/${encodeURIComponent(runId!)}/graph`,
      );
      return data ?? { nodes: [], edges: [] };
    },
    enabled: Boolean(runId),
  });
}

export function GraphPage() {
  const params = useParams<{ runId?: string }>();
  const [search] = useSearchParams();
  // Prefer the path-param form, fall back to ?runId=.
  const runId = params.runId || search.get('runId') || null;

  // Pre-fetch /api/runs/:id/events + /api/artifacts so the data is warm
  // for the renderer migration in A8.5. We deliberately read them here
  // even though we don't render them yet — that's the mega-plan ask.
  const eventsQuery = useRunEvents(runId);
  const artifactsQuery = useArtifacts(runId ? { runId } : {});
  const graphQuery = useRunGraph(runId);

  const legacyHref = runId ? `/graph?runId=${encodeURIComponent(runId)}` : '/graph';
  const nodes = graphQuery.data?.nodes ?? [];
  const edges = graphQuery.data?.edges ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-1">
              Run topology + artifact lineage
            </p>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Graph</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              The interactive canvas renderer stays on the legacy <code className="font-mono">/graph</code>{' '}
              page for this phase. This React surface shows the run context plus
              node/edge counts and links out to the full viewer.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/react/runs" data-testid="back-to-runs-btn">
                ← Runs
              </Link>
            </Button>
            <Button variant="primary" size="sm" asChild>
              <a href={legacyHref} data-testid="open-legacy-graph">
                Open in legacy graph viewer →
              </a>
            </Button>
          </div>
        </header>

        <Card data-testid="graph-toolbar-card">
          <CardHeader>
            <CardTitle>Run context</CardTitle>
            <CardDescription>
              {runId
                ? `Bound to run ${runId.slice(0, 12)}…`
                : 'No run selected — pass ?runId=<id> or follow a link from /react/runs.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runId ? (
              <>
                <div className="flex flex-wrap gap-2">
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
                Pick a run on <Link to="/react/runs" className="text-[var(--cy-2)] hover:underline">/react/runs</Link>{' '}
                and click <strong className="text-foreground">Open graph</strong> on the detail
                sheet to come back here with a run id attached.
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="graph-canvas-placeholder">
          <CardHeader>
            <CardTitle>Canvas renderer</CardTitle>
            <CardDescription>Deferred to phase A8.5</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-8 text-center">
              <p className="font-mono uppercase tracking-[0.08em] text-[11px] text-muted-foreground mb-2">
                Coming soon
              </p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                The interactive node/edge canvas (zoom, pan, fit, replay, blocked
                filter) migrates as part of the renderer port. Until then, the
                legacy <code className="font-mono">/graph</code> page hosts the full viewer —
                the toolbar link above opens it with the same{' '}
                <code className="font-mono">runId</code> attached.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default GraphPage;
