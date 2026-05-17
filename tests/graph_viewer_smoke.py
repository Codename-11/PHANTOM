#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path
from urllib.request import urlopen, Request

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = 'http://127.0.0.1:1337'
SCREENSHOT = '/tmp/phantom-graph-viewer-first-class.png'

fixture_raw = subprocess.check_output(['node', 'tests/fixtures/create_graph_viewer_fixture.mjs'], cwd=ROOT, text=True)
fixture = json.loads(fixture_raw)
run_id = fixture['runId']

with urlopen(f'{BASE_URL}/api/runs/{run_id}/graph', timeout=10) as res:
    graph = json.loads(res.read().decode())

with urlopen(f'{BASE_URL}/api/runs/{run_id}/replay', timeout=10) as res:
    replay = json.loads(res.read().decode())

assert graph['stats']['events'] >= 6, graph['stats']
assert any(node['type'] == 'artifact' for node in graph['nodes'])
assert any(node.get('status') == 'blocked' for node in graph['nodes'])
assert any(edge['type'] == 'blocked_by_policy' for edge in graph['edges'])
assert replay['replay']['steps'][2]['title'] == 'Shell command completed'
assert 'HTTP/1.1 200 OK' in replay['replay']['steps'][2]['outputPreview']

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 940})
    page.goto(f'{BASE_URL}/#graph', wait_until='domcontentloaded', timeout=30000)
    try:
        page.wait_for_load_state('networkidle', timeout=5000)
    except PlaywrightTimeoutError:
        pass

    page.locator('#graph-runs-list').get_by_text('SMOKE Graph Viewer').first.wait_for(timeout=10000)
    page.locator('#graph-canvas .graph-svg').wait_for(timeout=10000)

    stats = page.locator('#graph-stats').inner_text(timeout=10000)
    live_text = page.locator('#graph-live-indicator').inner_text(timeout=10000)
    assert 'follow' in stats.lower(), stats
    assert 'live' in live_text.lower(), live_text

    canvas_box = page.locator('#graph-canvas').bounding_box()
    svg_box = page.locator('#graph-canvas .graph-svg').bounding_box()
    assert canvas_box and svg_box
    assert svg_box['width'] <= canvas_box['width'] + 2
    assert svg_box['height'] <= canvas_box['height'] + 2

    assert page.locator('#graph-fit-btn').is_visible()
    assert page.locator('#graph-reset-btn').is_visible()
    assert page.locator('#graph-follow-btn').is_visible()
    assert page.locator('#graph-replay-panel').is_visible()
    assert page.locator('#graph-replay-prev-btn').is_visible()
    assert page.locator('#graph-replay-play-btn').is_visible()
    assert page.locator('#graph-replay-next-btn').is_visible()
    assert page.locator('#graph-zoom-in-btn').is_visible()
    assert page.locator('#graph-zoom-out-btn').is_visible()

    assert page.locator('#graph-replay-panel').inner_text(timeout=10000).startswith('Replay 1/')
    page.locator('#graph-replay-next-btn').click()
    page.locator('#graph-replay-next-btn').click()
    detail_text = page.locator('#graph-node-detail').inner_text(timeout=10000)
    assert 'Shell command completed' in detail_text, detail_text
    assert 'HTTP/1.1 200 OK' in detail_text, detail_text
    assert page.locator('#graph-canvas .graph-node.replay-active').count() >= 1
    assert page.locator('#graph-canvas .graph-edge-label').count() >= 1

    tool_type_text = page.locator('#graph-canvas .graph-node.tool .graph-node-type').first.text_content(timeout=10000) or ''
    assert 'SHELL COMMAND' in tool_type_text.upper(), tool_type_text
    assert page.locator('#graph-canvas .graph-node-label tspan').count() >= 2

    page.locator('#graph-replay-play-btn').click()
    assert 'pause' in page.locator('#graph-replay-play-btn').inner_text(timeout=10000).lower()
    page.locator('#graph-replay-play-btn').click()
    assert 'replay' in page.locator('#graph-replay-play-btn').inner_text(timeout=10000).lower()

    first_path = page.locator('#graph-canvas .graph-edge').first.get_attribute('d')
    assert first_path and ' H ' in first_path and ' V ' in first_path and ' C ' not in first_path, first_path

    blocked_nodes = page.locator('#graph-canvas .graph-node.blocked').count()
    blocked_edges = page.locator('#graph-canvas .graph-edge.blocked_by_policy, #graph-canvas .graph-edge.blocked').count()
    artifact_nodes = page.locator('#graph-canvas .graph-node.artifact').count()
    assert blocked_nodes >= 1
    assert blocked_edges >= 1
    assert artifact_nodes >= 1

    before = page.locator('#graph-canvas .graph-svg').get_attribute('data-scale')
    page.locator('#graph-zoom-in-btn').click()
    after_zoom = page.locator('#graph-canvas .graph-svg').get_attribute('data-scale')
    assert before != after_zoom, (before, after_zoom)
    page.locator('#graph-fit-btn').click()
    after_fit = page.locator('#graph-canvas .graph-svg').get_attribute('data-scale')
    assert after_fit, after_fit

    page.locator('#graph-follow-btn').click()
    assert 'paused' in page.locator('#graph-follow-btn').inner_text(timeout=10000).lower()
    page.locator('#graph-follow-btn').click()
    assert 'following' in page.locator('#graph-follow-btn').inner_text(timeout=10000).lower()

    page.evaluate("""(runId) => {
      window.dispatchEvent(new CustomEvent('phantom:trace', { detail: { runId, type: 'tool_progress' } }));
    }""", run_id)
    page.wait_for_timeout(350)
    assert 'live' in page.locator('#graph-live-indicator').inner_text(timeout=10000).lower()

    scroll = page.evaluate("""() => ({
      bodyOverflowX: document.body.scrollWidth > document.body.clientWidth,
      pageOverflowY: document.querySelector('.page-container').scrollHeight > document.querySelector('.page-container').clientHeight + 2,
      canvasOverflowX: document.querySelector('#graph-canvas').scrollWidth > document.querySelector('#graph-canvas').clientWidth,
      canvasOverflowY: document.querySelector('#graph-canvas').scrollHeight > document.querySelector('#graph-canvas').clientHeight,
    })""")
    assert not scroll['bodyOverflowX'], scroll
    assert not scroll['pageOverflowY'], scroll
    assert not scroll['canvasOverflowX'], scroll
    assert not scroll['canvasOverflowY'], scroll

    page.screenshot(path=SCREENSHOT, full_page=True)
    browser.close()

print(json.dumps({
    'ok': True,
    'runId': run_id,
    'stats': stats,
    'live': live_text,
    'screenshot': SCREENSHOT,
}, indent=2))
