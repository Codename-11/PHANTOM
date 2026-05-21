// Graph — read-only React surface for run topology + artifact lineage.
//
// A8.5b v1: renders a static SVG node-link diagram (GraphCanvas) from
// the existing /api/runs/:id/graph endpoint using a deterministic
// layered layout. The FULL interactive canvas (drag physics, pan,
// replay, blocked filter) remains DEFERRED per the mega-plan and lives
// on the legacy /graph page — the "open in legacy graph viewer" link is
// the escape hatch to it.
//
// Reads `runId` from either the URL parameter (/graph/:runId) or the
// `?runId=` query string so a deep-link from the Runs surface works
// either way.

import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { useRunEvents } from '@/lib/runs';
import { useArtifacts } from '@/lib/artifacts';
import { useRunGraph } from '@/lib/graph';
import { GraphCanvas } from '@/components/GraphCanvas';

const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

export function GraphPage() {
  const params = useParams<{ runId?: string }>();
  const [search] = useSearchParams();
  // Prefer the path-param form, fall back to ?runId=.
  const runId = params.runId || search.get('runId') || null;
  const { toast } = useToast();
  const [zoom, setZoom] = useState(1);

  // Pre-fetch events + artifacts so the count badges stay warm alongside
  // the graph; the renderer itself reads the derived graph endpoint.
  const eventsQuery = useRunEvents(runId);
  const artifactsQuery = useArtifacts(runId ? { runId } : {});
  const graphQuery = useRunGraph(runId);

  const legacyHref = runId ? `/graph?runId=${encodeURIComponent(runId)}` : '/graph';
  const nodes = graphQuery.data?.nodes ?? [];
  const edges = graphQuery.data?.edges ?? [];

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
              A read-only node-link view of the selected run. For the full
              interactive canvas (zoom, pan, replay, blocked filter) open the
              legacy <code className="font-mono">/graph</code> viewer.
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
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Topology</CardTitle>
                <CardDescription>
                  Layered by node type · colors map to type and policy status
                </CardDescription>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Tooltip content="Zoom out">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => zoomBy(-ZOOM_STEP)}
                    disabled={zoom <= ZOOM_MIN}
                    data-testid="graph-zoom-out"
                    aria-label="Zoom out"
                  >
                    −
                  </Button>
                </Tooltip>
                <span className="font-mono text-[11px] text-muted-foreground w-12 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Tooltip content="Zoom in">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => zoomBy(ZOOM_STEP)}
                    disabled={zoom >= ZOOM_MAX}
                    data-testid="graph-zoom-in"
                    aria-label="Zoom in"
                  >
                    +
                  </Button>
                </Tooltip>
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
            </CardHeader>
            <CardContent>
              {graphQuery.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <GraphCanvas nodes={nodes} edges={edges} zoom={zoom} />
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

export default GraphPage;
