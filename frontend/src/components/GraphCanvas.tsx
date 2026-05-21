// GraphCanvas — operational-graph SVG node-link diagram for a run.
//
// Presentation upgrade to match the original "PHANTOM SEC UI kit" graph
// concept (kit/screens/graph.jsx), flattened during the React migration.
// The data + layout pipeline is unchanged: a deterministic layered layout
// (see layoutGraph in @/lib/graph) feeds the renderer. On top of it we
// now draw:
//   • a grid-pattern background (SVG defs),
//   • orthogonal (right-angle) connectors — dashed + purple for
//     policy-block / blocked edges,
//   • node chrome: an uppercase kind-badge (RUN/TOOL/HOST/FINDING/…),
//     a muted sub-text line, full token-colored borders by kind, and an
//     active/replay highlight (thicker stroke + "▼ REPLAY" marker),
//   • bottom-left legend overlay + bottom-right zoom widget pill.
// Nodes are clickable to drive the right-side inspector drawer.

import * as React from 'react';

import {
  layoutGraph,
  nodeColorVar,
  nodeFillVar,
  nodeKindLabel,
  nodeSubText,
  edgeStrokeVar,
  isBlockedEdge,
  isPolicyNode,
  isFindingNode,
  orthogonalPath,
  type RunGraphNode,
  type RunGraphEdge,
} from '@/lib/graph';

export interface GraphCanvasProps {
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
  zoom?: number;
  className?: string;
  /** id of the node currently selected in the inspector drawer. */
  selectedId?: string | null;
  /** id of the node that is the active replay step (▼ REPLAY marker). */
  activeId?: string | null;
  /**
   * View-switch node-type whitelist (Run/Topology/Asset). Forwarded to
   * layoutGraph; omitted ⇒ all node types render.
   */
  nodeTypeFilter?: Iterable<string>;
  /**
   * Search match set — node ids whose label matched the toolbar query.
   * `null`/undefined ⇒ no active search (every node at full opacity).
   * When present, non-matching nodes (and their edges) are dimmed.
   */
  matchIds?: Set<string> | null;
  onSelect?: (node: RunGraphNode) => void;
  /** zoom widget callbacks — rendered as a bottom-right pill overlay. */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFit?: () => void;
}

const NODE_W = 168;
const NODE_H = 46;

export function GraphCanvas({
  nodes,
  edges,
  zoom = 1,
  className,
  selectedId,
  activeId,
  nodeTypeFilter,
  matchIds,
  onSelect,
  onZoomIn,
  onZoomOut,
  onFit,
}: GraphCanvasProps) {
  // Stable identity for the type-filter set so the memo only recomputes when
  // its contents change, not on every render.
  const filterKey = nodeTypeFilter ? [...nodeTypeFilter].sort().join(',') : '';
  const layout = React.useMemo(
    () => layoutGraph({ nodes, edges }, nodeTypeFilter ? { nodeTypeFilter } : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges, filterKey],
  );
  const searching = matchIds != null;

  if (layout.nodes.length === 0) {
    return (
      <div
        data-testid="graph-canvas-empty"
        className="rounded-md border border-dashed border-border bg-[var(--bg-2)] p-8 text-center text-sm text-muted-foreground"
      >
        This run produced no graph nodes yet.
      </div>
    );
  }

  // Layout (x,y) is the node's left-middle anchor. Rects draw offset up by
  // NODE_H/2; edges leave the source right edge and enter the target left
  // edge so the orthogonal routing meets the node borders cleanly.
  const viewW = layout.width + NODE_W + 24;
  const viewH = layout.height + NODE_H + 24;

  return (
    <div
      data-testid="graph-canvas"
      className={className}
      style={{ position: 'relative', overflow: 'hidden', minHeight: 0, background: 'var(--bg-1)' }}
    >
      <div style={{ overflow: 'auto', maxHeight: 560 }}>
        <svg
          role="img"
          aria-label={`Run graph: ${layout.nodes.length} nodes, ${layout.edges.length} edges`}
          viewBox={`0 0 ${viewW} ${viewH}`}
          width={viewW * zoom}
          height={viewH * zoom}
          style={{ display: 'block', minWidth: '100%', background: 'var(--bg-1)' }}
        >
          <defs>
            <pattern id="graph-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="var(--line-1)"
                strokeOpacity={0.5}
                strokeWidth={1}
              />
            </pattern>
            <marker
              id="graph-arrow"
              viewBox="0 0 8 8"
              refX="6"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L6,4 L0,8 z" fill="var(--cy-2)" />
            </marker>
            <marker
              id="graph-arrow-policy"
              viewBox="0 0 8 8"
              refX="6"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L6,4 L0,8 z" fill="var(--policy)" />
            </marker>
            <marker
              id="graph-arrow-ok"
              viewBox="0 0 8 8"
              refX="6"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L6,4 L0,8 z" fill="var(--sev-ok)" />
            </marker>
          </defs>

          <rect width={viewW} height={viewH} fill="url(#graph-grid)" />

          <g data-testid="graph-edges" fill="none">
            {layout.edges.map((edge, i) => {
              const blocked = isBlockedEdge(edge);
              const stroke = edgeStrokeVar(edge);
              const type = String(edge.type || '').toLowerCase();
              const marker = blocked
                ? 'url(#graph-arrow-policy)'
                : type === 'generated'
                  ? 'url(#graph-arrow-ok)'
                  : 'url(#graph-arrow)';
              // Dim an edge when search is active and either endpoint isn't a
              // match (keeps matched sub-graph readable without removing edges).
              const edgeMatch = !searching || (matchIds!.has(edge.source) && matchIds!.has(edge.target));
              return (
                <path
                  key={edge.id ?? `${edge.source}->${edge.target}:${i}`}
                  data-testid="graph-edge"
                  data-edge-blocked={blocked || undefined}
                  data-edge-dimmed={searching && !edgeMatch ? true : undefined}
                  d={orthogonalPath(edge.x1 + NODE_W, edge.y1, edge.x2, edge.y2)}
                  stroke={stroke}
                  strokeWidth={blocked ? 1.2 : 1.25}
                  strokeOpacity={edgeMatch ? 0.85 : 0.12}
                  strokeDasharray={blocked ? '3 2' : undefined}
                  markerEnd={marker}
                />
              );
            })}
          </g>

          <g data-testid="graph-nodes">
            {layout.nodes.map((node) => {
              const stroke = nodeColorVar(node);
              const active = activeId === node.id;
              const selected = selectedId === node.id;
              const fill = nodeFillVar(node, active);
              const policy = isPolicyNode(node);
              const finding = isFindingNode(node);
              const label = node.label || node.id;
              const sub = nodeSubText(node);
              const kindLabel = nodeKindLabel(node);
              const emphasized = active || selected || finding;
              // Search dimming: when a query is active, fade nodes whose label
              // didn't match so the matching set stands out (they stay laid
              // out + clickable, just visually de-emphasised).
              const matched = !searching || matchIds!.has(node.id);
              return (
                <g
                  key={node.id}
                  data-testid="graph-node"
                  data-node-type={node.type}
                  data-node-status={node.status}
                  data-node-active={active || undefined}
                  data-node-selected={selected || undefined}
                  data-node-dimmed={searching && !matched ? true : undefined}
                  opacity={matched ? 1 : 0.18}
                  transform={`translate(${node.x}, ${node.y - NODE_H / 2})`}
                  style={{ cursor: onSelect ? 'pointer' : undefined }}
                  onClick={onSelect ? () => onSelect(node) : undefined}
                  role={onSelect ? 'button' : undefined}
                  aria-label={`${kindLabel} ${label}`}
                >
                  <title>{`${node.type} · ${label}${node.status ? ` · ${node.status}` : ''}`}</title>
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={4}
                    ry={4}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={emphasized ? 1.5 : 1}
                    strokeDasharray={policy ? '3 2' : undefined}
                  />
                  <text
                    x={10}
                    y={19}
                    fontFamily="var(--font-mono, monospace)"
                    fontSize={11}
                    fontWeight={500}
                    fill="var(--fg-1)"
                  >
                    {label.length > 22 ? `${label.slice(0, 21)}…` : label}
                  </text>
                  {sub ? (
                    <text
                      x={10}
                      y={35}
                      fontFamily="var(--font-mono, monospace)"
                      fontSize={10}
                      fill="var(--fg-3)"
                    >
                      {sub}
                    </text>
                  ) : null}
                  <text
                    x={NODE_W - 8}
                    y={12}
                    textAnchor="end"
                    fontFamily="var(--font-mono, monospace)"
                    fontSize={8}
                    fill={stroke}
                    letterSpacing="0.06em"
                  >
                    {kindLabel}
                  </text>
                  {active ? (
                    <text
                      x={NODE_W / 2}
                      y={-6}
                      textAnchor="middle"
                      fontFamily="var(--font-mono, monospace)"
                      fontSize={9}
                      fill="var(--cy-1)"
                      letterSpacing="0.08em"
                    >
                      ▼ REPLAY
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* legend overlay (bottom-left) */}
      <div
        data-testid="graph-legend"
        className="kit-row"
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          gap: 14,
          padding: '8px 10px',
          background: 'var(--bg-2)',
          border: '1px solid var(--line-1)',
          borderRadius: 'var(--r-3)',
          fontSize: 11,
          color: 'var(--fg-2)',
        }}
      >
        <span className="kit-row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 2, background: 'var(--cy-2)' }} />
          <span>flow</span>
        </span>
        <span className="kit-row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 2, background: 'var(--sev-crit)' }} />
          <span>finding</span>
        </span>
        <span className="kit-row" style={{ gap: 6 }}>
          <span
            style={{
              width: 12,
              height: 0,
              borderTop: '2px dashed var(--policy)',
            }}
          />
          <span>blocked</span>
        </span>
        <span className="kit-row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 2, background: 'var(--sev-ok)' }} />
          <span>artifact</span>
        </span>
      </div>

      {/* zoom widget overlay (bottom-right pill) */}
      {onZoomIn || onZoomOut || onFit ? (
        <div
          data-testid="graph-zoom-widget"
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'var(--bg-2)',
            border: '1px solid var(--line-1)',
            borderRadius: 'var(--r-3)',
          }}
        >
          <button
            type="button"
            className="btn btn-sm btn-icon"
            onClick={onZoomOut}
            aria-label="Zoom out"
            data-testid="graph-zoom-out"
          >
            −
          </button>
          <button
            type="button"
            className="btn btn-sm btn-icon"
            onClick={onZoomIn}
            aria-label="Zoom in"
            data-testid="graph-zoom-in"
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onFit}
            aria-label="Fit"
            data-testid="graph-zoom-fit"
          >
            Fit
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default GraphCanvas;
