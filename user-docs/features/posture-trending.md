# Posture trending

The **Posture trend** panel on the Dashboard answers a question the synthesis card can't: *"Are we getting better over time?"*

It sits above the lower three-column row of the cockpit and is hidden until you've completed at least one terminal run.

## What's in the panel

**Headline (left)**

- Current posture score (the most recent terminal run's score), large and bold.
- Rating label (strong / fair / weak), color-coded with the same scheme as the per-run card.
- Delta vs. baseline (the oldest run in the window) with an up/down chip.
- Caption: `baseline N`.

**Sparkline (left)**

- Inline SVG line chart of recent run scores, chronological (oldest → newest, left → right).
- Dots are color-coded per rating, so weak runs stand out visually.
- A dashed horizontal guide at 50 anchors the eye.
- Hover any dot for a tooltip: `<run title> · <score> · <endedAt>`.
- Click a dot to jump straight to that run's Synthesis tab.

**By scope (right)**

- One row per scope active in the window, sorted by run count then current score.
- Score, delta vs. that scope's prior run, run count.
- Left-border color follows the rating.

**Recent runs (bottom)**

- One row per run in reverse-chronological order.
- Each row uses `SynthesisCard.renderCompactRow` — same visual treatment as the per-run synthesis card, just a single line.
- Click a row to open the run.

## Scope filter

The panel header includes a dropdown that filters everything (headline, sparkline, by-scope list, recent-runs list) to one scope. Useful when you run against multiple engagements in parallel.

## How deltas are chained

The trending aggregator builds one synthesis per run, but passes `previousScore` from the last entry into each `buildRunSynthesis` call. That means every entry in the sparkline (except the oldest) carries a per-step delta. The headline's "baseline" delta is computed differently — it's `current − oldest`, end-to-end, across the whole window.

You'll see different magnitudes depending on which delta you're looking at. The headline answers "since when?"; the per-step deltas answer "what changed in this run specifically?"

## Auto-refresh

The panel listens for `phantom:trace` events on the window and debounces them — 1.5s after a run-affecting trace event fires, it re-fetches `/api/trending/posture`. You'll see new runs appear without manually refreshing the dashboard.

## Empty state

If you have no terminal runs yet, the panel shows a friendly empty state explaining that "Posture trending will appear once your first run completes" and points at the Runs page Synthesis tab for the per-run score the trend aggregates.

## API

```text
GET /api/trending/posture?limit=12
GET /api/trending/posture?scopeId=<id>&limit=12
GET /api/trending/posture?includeRecentRuns=false
```

Returns:

```json
{
  "v": 1,
  "scopeId": null,
  "runsConsidered": 4,
  "current": 78,
  "baseline": 52,
  "delta": 26,
  "sparkline": [
    { "runId": "...", "title": "...", "score": 52, "rating": "fair", "delta": null,  "endedAt": "...", "status": "completed", "scope": "Lab" },
    { "runId": "...", "title": "...", "score": 68, "rating": "fair", "delta": 16,    "endedAt": "...", "status": "completed", "scope": "Lab" },
    { "runId": "...", "title": "...", "score": 78, "rating": "strong", "delta": 10,  "endedAt": "...", "status": "completed", "scope": "Lab" }
  ],
  "byScope": [
    { "scopeId": "...", "name": "Lab", "current": 78, "delta": 10, "runs": 3 }
  ],
  "recentRuns": [ /* full synthesis v1 objects, newest first */ ]
}
```

The `recentRuns` array contains full synthesis bundles — that's what the bottom-of-panel list renders. Set `includeRecentRuns=false` if you only need the sparkline.

## Caveats

- Non-terminal runs (still `running`, or never updated to a terminal status) are excluded.
- The default window is the 12 most recent terminal runs. Bump with `?limit=` up to 50.
- Posture is a derived metric. If you don't trust the underlying composition (coverage / risk / hygiene weights), inspect `posture.components` on any individual synthesis to see where the score came from.
