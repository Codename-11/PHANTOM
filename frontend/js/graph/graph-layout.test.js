import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

function loadLayout() {
  const source = readFileSync(new URL('./graph-layout.js', import.meta.url), 'utf8');
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  new Script(source, { filename: 'graph-layout.js' }).runInContext(sandbox);
  return sandbox.window.GraphLayout || sandbox.GraphLayout;
}

describe('Graph viewer layout helpers', () => {
  test('buildOrthogonalPath returns readable 90-degree connector with lane offsets', () => {
    const { buildOrthogonalPath } = loadLayout();
    const first = buildOrthogonalPath({ x: 10, y: 20 }, { x: 210, y: 120 }, 0);
    const second = buildOrthogonalPath({ x: 10, y: 20 }, { x: 210, y: 120 }, 2);

    assert.match(first, /^M 10 20 H \d+ V 120 H 210$/);
    assert.match(second, /^M 10 20 H \d+ V 120 H 210$/);
    assert.notStrictEqual(first, second, 'parallel lanes should not overlap exactly');
    assert.ok(!first.includes('C '), 'orthogonal connector should not use bezier curves');
  });

  test('layoutGraph returns graph bounds large enough to fit positioned nodes', () => {
    const { layoutGraph } = loadLayout();
    const graph = {
      nodes: [
        { id: 'run:1', type: 'run', label: 'Run', status: 'completed' },
        { id: 'tool:1', type: 'tool', label: 'execute_command', status: 'completed' },
        { id: 'host:example.com', type: 'host', label: 'example.com', status: 'observed' },
        { id: 'artifact:a', type: 'artifact', label: 'Report', status: 'completed' },
      ],
      edges: [
        { source: 'run:1', target: 'tool:1', type: 'called' },
        { source: 'tool:1', target: 'host:example.com', type: 'observed' },
        { source: 'tool:1', target: 'artifact:a', type: 'generated' },
      ],
    };

    const layout = layoutGraph(graph);
    assert.strictEqual(layout.nodes.length, 4);
    assert.strictEqual(layout.edges.length, 3);
    assert.ok(layout.bounds.width >= 900, `expected operational canvas width, got ${layout.bounds.width}`);
    assert.ok(layout.bounds.height >= 220, `expected vertical room, got ${layout.bounds.height}`);
    for (const node of layout.nodes) {
      assert.ok(node.x + layout.nodeWidth <= layout.bounds.width, `${node.id} should fit horizontally`);
      assert.ok(node.y + layout.nodeHeight <= layout.bounds.height, `${node.id} should fit vertically`);
    }
  });

  test('calculateFitTransform fits graph bounds into viewport and respects max zoom', () => {
    const { calculateFitTransform } = loadLayout();
    const transform = calculateFitTransform(
      { width: 1200, height: 800 },
      { width: 900, height: 500 },
      { padding: 48, maxScale: 1.1 }
    );

    assert.ok(transform.scale > 0);
    assert.ok(transform.scale <= 1.1);
    assert.ok(Number.isFinite(transform.x));
    assert.ok(Number.isFinite(transform.y));
    assert.ok(transform.x >= 0, 'fit should center/pad the graph horizontally');
  });
});
