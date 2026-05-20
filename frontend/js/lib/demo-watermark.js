// Demo watermark — apply [demo]-tag detection across the cockpit.
//
// Any row whose visible name or title begins with `[demo]` gets a
// `data-demo="true"` attribute, which the styles.css `[data-demo]`
// selector turns into a small "DEMO" badge in the corner.
//
// A MutationObserver watches the page-container so injected rows
// (campaigns, alerts, runs, artifacts) are caught after their fetch
// completes — no per-page wiring required.

(function () {
  'use strict';

  const DEMO_RE = /\[demo\]/i;

  function markRow(el) {
    // Cheap check: read the element's textContent and tag at element-level.
    const txt = (el.textContent || '').slice(0, 200);
    if (DEMO_RE.test(txt)) el.setAttribute('data-demo', 'true');
  }

  // Selectors that name "rows" across the cockpit. Adding a new
  // page? Add its row selector here.
  const ROW_SELECTORS = [
    '.campaign-row',
    '.goal-row',
    '.cockpit-run-row',
    '.cockpit-alert-row',
    '.runs-list .run-row',
    '.alerts-row',
    '.asset-row',
    '.artifact-row',
    '.scope-row',
    '.target-chip',
  ].join(',');

  function sweepWithin(root) {
    root.querySelectorAll(ROW_SELECTORS).forEach(markRow);
  }

  function initialSweep() {
    sweepWithin(document);
  }

  function observe() {
    const target = document.getElementById('page-container') || document.body;
    if (!target) return;
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.(ROW_SELECTORS)) markRow(node);
          if (node.querySelectorAll) sweepWithin(node);
        }
      }
    });
    obs.observe(target, { childList: true, subtree: true });
  }

  window.DemoWatermark = {
    init() { initialSweep(); observe(); },
    sweep: sweepWithin,
    markRow,
  };
})();
