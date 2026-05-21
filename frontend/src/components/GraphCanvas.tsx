// GraphCanvas — read-only static SVG node-link diagram for a run.
//
// This is the pragmatic A8.5b v1: the full interactive canvas (drag
// physics, pan, replay, blocked filter) is DEFERRED and stays on the
// legacy /graph page. Here we render a deterministic layered layout
// (see layoutGraph in @/lib/graph) as SVG: edges as lines, nodes as
// rounded rects colored by type/severity via design tokens. Node labels
// surface on hover via a native SVG <title> plus an always-on text
// label. A simple CSS-transform zoom (bonus) is wired through the
// optional `zoom` prop — no pan, no physics.

import * as React from 'react';

import {
  layoutGraph,
  nodeColorVar,
  type RunGraphNode,
  type RunGraphEdge,
} from '@/lib/graph';

export interface GraphCanvasProps {
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
  zoom?: number;
  className?: string;
}

const NODE_W = 168;
const NODE_H = 34;

function edgeStrokeVar(edge: RunGraphEdge): string {
  const type = String(edge.type || '').toLowerCase();
  if (type.includes('blocked')) return 'var(--danger)';
  if (type === 'generated') return 'var(--ok-2)';
  return 'var(--cy-3)';
}

export function GraphCanvas({ nodes, edges, zoom = 1, className }: GraphCanvasProps) {
  const layout = React.useMemo(() => layoutGraph({ nodes, edges }), [nodes, edges]);

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

  // Center node anchors are layout (x,y); rects are drawn offset so the
  // (x,y) is the left-middle connection point, matching edge endpoints.
  const viewW = layout.width + NODE_W;
  const viewH = layout.height + NODE_H;

  return (
    <div
      data-testid="graph-canvas"
      className={className}
      style={{ overflow: 'auto', maxHeight: 560 }}
    >
      <svg
        role="img"
        aria-label={`Run graph: ${layout.nodes.length} nodes, ${layout.edges.length} edges`}
        viewBox={`0 0 ${viewW} ${viewH}`}
        width={viewW * zoom}
        height={viewH * zoom}
        style={{ display: 'block', minWidth: '100%' }}
      >
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--cy-3)" />
          </marker>
        </defs>

        <g data-testid="graph-edges">
          {layout.edges.map((edge, i) => (
            <line
              key={edge.id ?? `${edge.source}->${edge.target}:${i}`}
              x1={edge.x1 + NODE_W}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke={edgeStrokeVar(edge)}
              strokeWidth={1.25}
              strokeOpacity={0.65}
              markerEnd="url(#graph-arrow)"
            />
          ))}
        </g>

        <g data-testid="graph-nodes">
          {layout.nodes.map((node) => {
            const fill = nodeColorVar(node);
            const label = node.label || node.id;
            return (
              <g
                key={node.id}
                data-testid="graph-node"
                data-node-type={node.type}
                data-node-status={node.status}
                transform={`translate(${node.x}, ${node.y - NODE_H / 2})`}
              >
                <title>{`${node.type} · ${label}${node.status ? ` · ${node.status}` : ''}`}</title>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  ry={6}
                  fill={fill}
                  fillOpacity={0.18}
                  stroke={fill}
                  strokeWidth={1.25}
                />
                <rect width={4} height={NODE_H} rx={2} fill={fill} />
                <text
                  x={12}
                  y={NODE_H / 2 + 4}
                  fontSize={11}
                  fontFamily="var(--font-mono, monospace)"
                  fill="var(--cy-fg, currentColor)"
                >
                  {label.length > 22 ? `${label.slice(0, 21)}…` : label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export default GraphCanvas;
