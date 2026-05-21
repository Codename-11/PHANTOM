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
  // Optional whitelist of node `type`s to keep (the view-switch passes the
  // set relevant to Run / Topology / Asset). Omitted/undefined ⇒ keep every
  // node (backward compatible). Edges referencing a dropped node are pruned.
  nodeTypeFilter?: Iterable<string>;
}

export function layoutGraph(
  graph: { nodes: RunGraphNode[]; edges: RunGraphEdge[] },
  options: LayoutOptions = {},
): GraphLayout {
  const columnGap = options.columnGap ?? 240;
  const rowGap = options.rowGap ?? 72;
  const paddingX = options.paddingX ?? 60;
  const paddingY = options.paddingY ?? 48;

  const allNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const allEdges = Array.isArray(graph.edges) ? graph.edges : [];

  // Apply the optional node-type whitelist. Default (no filter) keeps every
  // node so existing call sites are unaffected. The filter is deterministic:
  // it preserves the input node order and only drops by type.
  const typeSet = options.nodeTypeFilter ? new Set(options.nodeTypeFilter) : null;
  const nodes = typeSet ? allNodes.filter((n) => typeSet.has(n.type)) : allNodes;
  const keptIds = new Set(nodes.map((n) => n.id));
  // Drop edges whose endpoints were filtered out (the positioned-node guard
  // below would skip them anyway, but pruning here keeps width/height honest).
  const edges = typeSet
    ? allEdges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
    : allEdges;

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

// --- presentation derivations (kit graph parity) -----------------------
// These helpers shape the raw run-graph data into the kit's visual
// vocabulary — node kind classification, border/fill tokens, the
// uppercase kind-badge, a muted sub-text line, and orthogonal edge
// routing. They are pure + deterministic so the canvas renders the same
// way the design concept did.

/** Is this node a governance / policy-blocked node? */
export function isPolicyNode(node: RunGraphNode): boolean {
  const status = String(node.status || '').toLowerCase();
  const scope = String(node.metadata?.scopeStatus || '').toLowerCase();
  return (
    node.type === 'policy' ||
    node.type === 'blocked_by_policy' ||
    status === 'blocked' ||
    status === 'skipped' ||
    scope === 'out-of-scope' ||
    scope === 'blocked'
  );
}

/** Is this node a finding/error (severity-colored)? */
export function isFindingNode(node: RunGraphNode): boolean {
  const status = String(node.status || '').toLowerCase();
  return (
    node.type === 'error' ||
    node.type === 'finding' ||
    status === 'failed' ||
    status === 'error'
  );
}

// Node border/accent token by kind. Severity/blocked status overrides the
// type color so policy-blocked nodes always read purple (governance) and
// findings read red (severity). Cyan is the system accent for run/flow.
export function nodeColorVar(node: RunGraphNode): string {
  if (isPolicyNode(node)) return 'var(--policy)';
  if (isFindingNode(node)) return 'var(--sev-crit)';
  switch (node.type) {
    case 'run':
      return 'var(--cy-1)';
    case 'tool':
    case 'command':
      return 'var(--cy-2)';
    case 'host':
    case 'domain':
    case 'url':
    case 'port':
      return 'var(--cy-3)';
    case 'artifact':
      return 'var(--sev-ok)';
    default:
      return 'var(--cy-3)';
  }
}

// Node fill token — active node highlights, policy/finding tint by class,
// everything else the neutral panel surface.
export function nodeFillVar(node: RunGraphNode, active = false): string {
  if (active) return 'var(--bg-3)';
  if (isPolicyNode(node)) return 'var(--policy-bg)';
  if (isFindingNode(node)) return 'var(--sev-crit-bg)';
  return 'var(--bg-2)';
}

// Uppercase kind-badge text shown in each node's top-right corner.
export function nodeKindLabel(node: RunGraphNode): string {
  const t = String(node.type || '').toLowerCase();
  if (t === 'blocked_by_policy' || isPolicyNode(node)) return 'POLICY';
  if (t === 'error') return 'FINDING';
  if (t === 'command') return 'TOOL';
  if (t === 'url' || t === 'domain') return 'HOST';
  return (node.type || 'NODE').toUpperCase();
}

// Muted sub-text line under the node label. Derives a sensible second
// line from whatever the data model carries (scope/policy/status); omits
// gracefully (empty string) when nothing useful is available.
export function nodeSubText(node: RunGraphNode): string {
  const meta = node.metadata ?? {};
  const reason = meta.policyReason ? String(meta.policyReason) : '';
  const scope = meta.scopeStatus ? String(meta.scopeStatus) : '';
  const status = node.status ? String(node.status) : '';
  if (reason) return reason.length > 30 ? `${reason.slice(0, 29)}…` : reason;
  if (scope && scope !== 'observed') return scope;
  const refSeq = node.seq != null ? `evt #${node.seq}` : '';
  const parts = [status, refSeq].filter(Boolean);
  return parts.join(' · ');
}

// Edge stroke token by type/status. blocked edges read purple (policy),
// generated edges green (artifact), findings/errors red, the rest cyan.
export function edgeStrokeVar(edge: RunGraphEdge): string {
  const type = String(edge.type || '').toLowerCase();
  if (type.includes('blocked')) return 'var(--policy)';
  if (type === 'generated') return 'var(--sev-ok)';
  return 'var(--cy-2)';
}

/** Should this edge render dashed (policy-block / blocked)? */
export function isBlockedEdge(edge: RunGraphEdge): boolean {
  return String(edge.type || '').toLowerCase().includes('blocked');
}

// Build an orthogonal (right-angle) SVG path between two anchor points.
// Edges leave the source's right edge and enter the target's left edge;
// the turn happens at the horizontal midpoint, producing the kit's
// stepped connectors instead of straight diagonals. Same-row edges stay
// a single straight horizontal segment.
export function orthogonalPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  if (Math.abs(y1 - y2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const midX = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
}
