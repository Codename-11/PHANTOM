# Synthesis data shape

The end-of-run synthesis is a single canonical data shape. Same schema is rendered by the Runs page Synthesis tab, previewed by the onboarding wizard, and aggregated by the posture-trending dashboard.

This page is the v1 schema reference.

## Top level

```ts
type Synthesis = {
  v: 1,
  runId: string,
  title: string,
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'unknown',
  goal: string | null,
  outcome: string,            // one-line summary, < 120 chars, no newlines
  startedAt: string | null,   // ISO timestamp
  endedAt: string | null,
  durationMs: number | null,

  scope: ScopeSummary | null,
  objectives: Objectives,
  activity: Activity,
  risk: Risk,
  findings: Findings,
  posture: Posture,
  highlights: Highlight[],    // 1-6 entries
  nextSteps: NextStep[],      // 1-5 entries
  policy: Policy,

  enrichment?: Enrichment,    // present only when LLM enrichment ran
}
```

## ScopeSummary

```ts
type ScopeSummary = {
  id: string,
  name: string,
  status: 'active' | 'archived',
  expiresAt: string | null,
}
```

## Objectives

```ts
type Objectives = {
  stated: string,                                       // goal verbatim
  met: 'met' | 'partial' | 'unmet' | 'unknown',
  signal: string,                                       // why we drew that conclusion
}
```

Heuristic for `met`:

- `met` — run completed AND no failed tool calls AND no errors
- `partial` — run completed but failures occurred
- `unmet` — run status is `failed` or `stopped`
- `unknown` — anything else (still running, no goal recorded)

## Activity

```ts
type Activity = {
  events: number,
  toolCalls: {
    total: number,
    succeeded: number,
    failed: number,
    blocked: number,
  },
  artifacts: number,
  errors: { tool: string | null, preview: string }[],   // first ~3
}
```

`toolCalls.total` counts unique `tool.call.started` events (by `metadata.toolCallId`); if those are missing (older traces) it falls back to the sum of completed+failed+blocked.

## Risk

```ts
type Risk = {
  highest: 'none' | 'low' | 'medium' | 'high' | 'critical',
  distribution: {
    critical: number,
    high: number,
    medium: number,
    low: number,
  },
  blockedHighRisk: number,                              // blocked actions of high/critical risk
}
```

Risk class is read from `event.metadata.risk` (or `metadata.decision.risk` as a fallback). The `med` → `medium` normalization happens at parse time.

## Findings

```ts
type Findings = {
  total: number,
  bySeverity: {
    critical: number,
    high: number,
    medium: number,
    low: number,
  },
  new: number,        // open + unfixed
  resolved: number,   // status fixed/closed or fixed_at set
}
```

## Posture

```ts
type Posture = {
  score: number,        // 0-100
  delta: number | null, // current - previousScore (when supplied)
  components: {
    coverage: number,   // 0-100 — succeeded/total tool calls
    risk: number,       // 0-100 — inverse of high-risk + blocked + failed
    hygiene: number,    // 0-100 — completed cleanly + has artifacts
  },
  rating: 'strong' | 'fair' | 'weak' | 'unknown',
}
```

Composition:

```text
score = round(coverage * 0.4 + risk * 0.4 + hygiene * 0.2)

coverage = (toolCalls.succeeded / toolCalls.total) * 100
         | 100 if no tool calls attempted

risk = 100
     - (criticalFindings + highFindings) * 12
     - (mediumFindings) * 4
     - (blockedActions) * 4
     - (failedActions) * 6
     | floor 0

hygiene = 50
        + 30 if replay.complete
        + 20 if artifacts > 0
        - 20 if errors.length > 3
        | clamp 0..100
```

Ratings:

- `strong` if score ≥ 75
- `fair` if score ≥ 50
- `weak` otherwise
- `unknown` if score isn't a finite number

`delta` is `null` unless you call `/api/runs/:id/synthesis?previousScore=N`; the trending aggregator chains it across runs.

## Highlight

```ts
type Highlight = {
  kind: 'win' | 'risk' | 'note',
  text: string,         // ≤ 160 chars after validation
  refType?: string,     // optional pointer for future drill-in
  refId?: string,
}
```

Heuristic builder emits up to 6 highlights, leading with wins (tool calls succeeded, artifacts captured, findings resolved), then risks (blocked actions, high-severity findings, failed runs), then notes (failed tool calls).

LLM enrichment may replace this array; the validator strips unknown `kind` values to `note` and clips text to 160 chars.

## NextStep

```ts
type NextStep = {
  kind: 'rerun' | 'review' | 'remediate' | 'expand' | 'report',
  text: string,         // ≤ 200 chars after validation
  action?: 'rerun' | 'summary' | 'review-trace' | 'review-approvals' | 'review-findings' | 'edit-scope' | null,
}
```

`action` is the click target. The synthesis card's renderer wires each `action` to its own handler:

- `rerun` — POST a new run-template from this run and materialize a fresh run
- `summary` — generate an exec-summary artifact
- `review-trace` — switch to the Trace tab
- `review-approvals` — navigate to the Approvals page
- `review-findings` — navigate to the Alerts page
- `edit-scope` — navigate to the Scope page

Buttons without an `action` render as flat text notes.

## Policy

```ts
type Policy = {
  mode: 'governed' | 'operator-override',
  approvals: {
    granted: number,
    denied: number,
    allowOnce: number,
    override: number,
    timeout: number,
  },
}
```

## Enrichment

Present only when LLM enrichment ran successfully:

```ts
type Enrichment = {
  source: 'llm',
  generatedAt: string,    // ISO timestamp
}
```

Heuristic synthesis omits this field. If you're inspecting a synthesis programmatically and want to know whether the highlights were LLM-rewritten, check for `synthesis.enrichment?.source === 'llm'`.

## Stub shape

`GET /api/runs/:id/synthesis?preview=stub` returns a hand-tuned sample synthesis with the same v1 shape. The wizard's preview uses this so first-time operators see the card before any real run has executed:

```json
{
  "v": 1,
  "runId": "preview-run",
  "title": "Recon lab.local/24",
  "status": "completed",
  "outcome": "Completed · 7 ok · 1 blocked · posture 72/100 (fair)",
  "...": "..."
}
```

The stub is keyed at `runId: 'preview-run'` so a test can disambiguate it from a real run.

## Trending sparkline entries

The trending endpoint emits a stripped-down per-run shape for the sparkline:

```ts
type SparklineEntry = {
  runId: string,
  title: string,
  score: number,
  rating: 'strong' | 'fair' | 'weak' | 'unknown',
  delta: number | null,    // vs. the previous sparkline entry
  endedAt: string | null,
  startedAt: string | null,
  status: string,
  scope: string | null,
}
```

Plus the full synthesis array in `recentRuns` for the bottom-of-panel list. See [Posture trending](/features/posture-trending) for the full trending payload.

## Stability promise

The `v: 1` field is stable. Additive changes (new optional fields) are backwards-compatible and will not bump `v`. Breaking changes (field renames, removed fields, semantic changes) will bump to `v: 2` and ship migration notes in DEVLOG.

Consumers should check `v` before assuming a field exists.
