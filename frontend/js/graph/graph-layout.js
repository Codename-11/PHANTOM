(function attachGraphLayout(global) {
  const NODE_WIDTH = 224;
  const NODE_HEIGHT = 74;
  const COLUMN_X = {
    run: 32,
    tool: 312,
    command: 312,
    host: 640,
    url: 640,
    port: 960,
    artifact: 960,
    error: 960,
  };
  const ROW_GAP = 108;
  const TOP_PADDING = 36;
  const RIGHT_PADDING = 96;
  const BOTTOM_PADDING = 80;
  const LANE_SPACING = 14;

  function numeric(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function buildOrthogonalPath(source, target, laneIndex = 0) {
    const sourceX = Math.round(numeric(source.x));
    const sourceY = Math.round(numeric(source.y));
    const targetX = Math.round(numeric(target.x));
    const targetY = Math.round(numeric(target.y));
    const direction = targetX >= sourceX ? 1 : -1;
    const baseMid = sourceX + ((targetX - sourceX) / 2);
    const laneOffset = numeric(laneIndex) * LANE_SPACING * direction;
    const midX = Math.round(baseMid + laneOffset);
    return `M ${sourceX} ${sourceY} H ${midX} V ${targetY} H ${targetX}`;
  }

  function edgeLaneKey(edge) {
    return `${edge.source}->${edge.target}`;
  }

  function layoutGraph(graph = {}, options = {}) {
    const nodeWidth = numeric(options.nodeWidth, NODE_WIDTH);
    const nodeHeight = numeric(options.nodeHeight, NODE_HEIGHT);
    const rowGap = numeric(options.rowGap, ROW_GAP);
    const columns = { ...COLUMN_X, ...(options.columns || {}) };
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    const buckets = new Map();

    nodes.forEach((node) => {
      const x = columns[node.type] ?? columns.host;
      if (!buckets.has(x)) buckets.set(x, []);
      buckets.get(x).push(node);
    });

    const positioned = [];
    let maxX = nodeWidth + RIGHT_PADDING;
    let maxY = nodeHeight + BOTTOM_PADDING;
    Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).forEach(([x, bucket]) => {
      bucket.sort((a, b) => (numeric(a.seq) - numeric(b.seq)) || String(a.label || a.id).localeCompare(String(b.label || b.id)));
      bucket.forEach((node, index) => {
        const y = TOP_PADDING + index * rowGap;
        positioned.push({ ...node, x, y, width: nodeWidth, height: nodeHeight });
        maxX = Math.max(maxX, x + nodeWidth + RIGHT_PADDING);
        maxY = Math.max(maxY, y + nodeHeight + BOTTOM_PADDING);
      });
    });

    const nodeMap = new Map(positioned.map(node => [node.id, node]));
    const laneCounts = new Map();
    const positionedEdges = edges.map((edge, index) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return { ...edge, index, path: '' };
      const key = edgeLaneKey(edge);
      const seen = laneCounts.get(key) || 0;
      laneCounts.set(key, seen + 1);
      const lane = seen === 0 ? 0 : (seen % 2 === 0 ? -Math.ceil(seen / 2) : Math.ceil(seen / 2));
      const sourcePoint = {
        x: source.x + nodeWidth,
        y: source.y + Math.round(nodeHeight / 2),
      };
      const targetPoint = {
        x: target.x,
        y: target.y + Math.round(nodeHeight / 2),
      };
      return {
        ...edge,
        index,
        lane,
        path: buildOrthogonalPath(sourcePoint, targetPoint, lane),
      };
    });

    return {
      nodes: positioned,
      edges: positionedEdges,
      nodeWidth,
      nodeHeight,
      bounds: {
        width: Math.max(numeric(options.minWidth, 960), maxX),
        height: Math.max(numeric(options.minHeight, 360), maxY),
      },
    };
  }

  function calculateFitTransform(bounds = {}, viewport = {}, options = {}) {
    const padding = numeric(options.padding, 36);
    const maxScale = numeric(options.maxScale, 1.15);
    const minScale = numeric(options.minScale, 0.2);
    const width = Math.max(1, numeric(bounds.width, 1));
    const height = Math.max(1, numeric(bounds.height, 1));
    const viewportWidth = Math.max(1, numeric(viewport.width, 1));
    const viewportHeight = Math.max(1, numeric(viewport.height, 1));
    const scaleX = (viewportWidth - padding * 2) / width;
    const scaleY = (viewportHeight - padding * 2) / height;
    const scale = Math.max(minScale, Math.min(maxScale, scaleX, scaleY));
    return {
      scale,
      x: Math.round((viewportWidth - width * scale) / 2),
      y: Math.round((viewportHeight - height * scale) / 2),
    };
  }

  function clampScale(scale, min = 0.25, max = 2.2) {
    return Math.max(min, Math.min(max, numeric(scale, 1)));
  }

  const api = {
    NODE_WIDTH,
    NODE_HEIGHT,
    buildOrthogonalPath,
    layoutGraph,
    calculateFitTransform,
    clampScale,
  };

  global.GraphLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
