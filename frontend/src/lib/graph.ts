// Typed wrapper + React Query hook for the run-graph endpoint
// (GET /api/runs/:id/graph), plus a small deterministic layered layout
// helper used by the read-only SVG renderer in GraphCanvas.tsx.
//
// The full interactive canvas (drag physics, zoom/pan, replay) is
// DEFERRED per the mega-plan and still lives on the legacy /graph page.
// This module only models the data and a static layered layout — no
// physics. The server shape comes from server/graph/graph-derive.js:
//   node: { id, type, label, status, refId?, seq?, metadata }
//   edge: { id, type, source, target, label?, eventId?, ... }

import { useQuery } from '@tanstack/react-query';

import { apiFetch } from './api';

export type GraphNodeType =
  | 'run'
  | 'tool'
  | 'command'
  | 'host'
  | 'url'
  | 'port'
  | 'artifact'
  | 'error'
  | string;

export interface RunGraphNode {
  id: string;
  type: GraphNodeType;
  label?: string;
  status?: string;
  seq?: number;
  refId?: string;
  metadata?: Record<string, unknown> & {
    scopeStatus?: string;
    policyReason?: string;
    risk?: unknown;
  };
}

export interface RunGraphEdge {
  id?: string;
  type?: string;
  source: string;
  target: string;
  label?: string;
  eventId?: string;
}

export interface RunGraphResponse {
  runId?: string;
  generatedAt?: string;
  stats?: { nodes: number; edges: number; events: number; artifacts: number };
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
}

const EMPTY_GRAPH: RunGraphResponse = { nodes: [], edges: [] };

export function useRunGraph(runId: string | null | undefined) {
  return useQuery({
    queryKey: ['runs', 'graph', runId],
    queryFn: async () => {
      const data = await apiFetch<RunGraphResponse>(
        `/api/runs/${encodeURIComponent(runId!)}/graph`,
      );
      const safe = data ?? EMPTY_GRAPH;
      return {
        ...safe,
        nodes: Array.isArray(safe.nodes) ? safe.nodes : [],
        edges: Array.isArray(safe.edges) ? safe.edges : [],
      } as RunGraphResponse;
    },
    enabled: Boolean(runId),
  });
}

// --- deterministic layered layout --------------------------------------
// Mirrors the legacy column ordering by node type (run → tool/command →
// host/url → port/artifact/error) so the read-only diagram reads the same
// way, but without the canvas/physics engine.

const COLUMN_ORDER: Record<string, number> = {
  run: 0,
  tool: 1,
  command: 1,
  host: 2,
  url: 2,
  port: 3,
  artifact: 3,
  error: 3,
};

export interface LaidOutNode extends RunGraphNode {
  x: number;
  y: number;
}

export interface LaidOutEdge extends RunGraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GraphLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  columnGap?: number;
  rowGap?: number;
  paddingX?: number;
  paddingY?: number;
}

export function layoutGraph(
  graph: { nodes: RunGraphNode[]; edges: RunGraphEdge[] },
  options: LayoutOptions = {},
): GraphLayout {
  const columnGap = options.columnGap ?? 240;
  const rowGap = options.rowGap ?? 72;
  const paddingX = options.paddingX ?? 60;
  const paddingY = options.paddingY ?? 48;

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  // Bucket nodes into deterministic columns by type.
  const columns = new Map<number, RunGraphNode[]>();
  for (const node of nodes) {
    const col = COLUMN_ORDER[node.type] ?? COLUMN_ORDER.host ?? 2;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  const positioned = new Map<string, LaidOutNode>();
  let maxCol = 0;
  let maxRow = 0;

  for (const [col, bucket] of Array.from(columns.entries()).sort((a, b) => a[0] - b[0])) {
    bucket.sort(
      (a, b) =>
        (a.seq ?? 0) - (b.seq ?? 0) ||
        String(a.label || a.id).localeCompare(String(b.label || b.id)),
    );
    bucket.forEach((node, row) => {
      const x = paddingX + col * columnGap;
      const y = paddingY + row * rowGap;
      positioned.set(node.id, { ...node, x, y });
      maxCol = Math.max(maxCol, col);
      maxRow = Math.max(maxRow, row);
    });
  }

  const laidOutEdges: LaidOutEdge[] = [];
  for (const edge of edges) {
    const source = positioned.get(edge.source);
    const target = positioned.get(edge.target);
    if (!source || !target) continue;
    laidOutEdges.push({
      ...edge,
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
    });
  }

  return {
    nodes: Array.from(positioned.values()),
    edges: laidOutEdges,
    width: paddingX * 2 + maxCol * columnGap,
    height: paddingY * 2 + maxRow * rowGap,
  };
}

// Node fill token by type (falls back to neutral). Severity/blocked
// status overrides type color so policy-blocked nodes always read red.
export function nodeColorVar(node: RunGraphNode): string {
  const status = String(node.status || '').toLowerCase();
  const scope = String(node.metadata?.scopeStatus || '').toLowerCase();
  if (status === 'blocked' || status === 'skipped' || scope === 'out-of-scope') {
    return 'var(--danger)';
  }
  if (status === 'failed' || status === 'error' || node.type === 'error') {
    return 'var(--warn-2)';
  }
  switch (node.type) {
    case 'run':
      return 'var(--cy-1)';
    case 'tool':
    case 'command':
      return 'var(--cy-2)';
    case 'host':
    case 'url':
    case 'port':
      return 'var(--cy-3)';
    case 'artifact':
      return 'var(--ok-2)';
    default:
      return 'var(--cy-3)';
  }
}
