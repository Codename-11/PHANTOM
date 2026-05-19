# Your first run

Now that you're set up, let's drive a recon engagement end-to-end and read the synthesis card. We'll use a public, low-risk target (your own machine or `scanme.nmap.org`) so the policy gate is happy.

## Pick a target you're authorized to scan

PHANTOM's scope policy will refuse anything outside your declared targets. For this first run, edit your scope (Scope page → your scope → **Edit**) to include something you genuinely own or have permission to test:

- Your local machine: `127.0.0.1` or `10.0.0.0/24` if you're on a private LAN
- A target you authorized: e.g. `example-corp-lab.test`
- The community test host: `scanme.nmap.org` (Nmap's own free target — read their terms first)

::: danger Don't point this at production you don't own
PHANTOM is for *authorized* security testing. Scope policy gates reduce risk, they do not grant authorization. If you don't own the host or have written permission, stop. See the [security page](/security).
:::

## Activate the scope

On the Chat page, use the scope chip in the top bar to select the scope you want to run under. The "Active scope" indicator shows the scope name plus a count of authorized targets.

If you don't see your scope, refresh the page or check that it isn't archived (Scope page → toggle "Include archived" off).

## Send the first message

In the chat input, ask for something simple:

> Do a quick port scan of 127.0.0.1 and tell me what's open.

What happens behind the scenes:

1. **A run is created** in SQLite with your goal, scope id, model id, and a redacted prompt snapshot.
2. **The agent decides** to call `execute_command` with an `nmap` invocation (or `nc`, `python3` socket, or whatever's available on your host — the agent reads the `INSTALLED SEC-OPS TOOLS ON HOST` block in its system prompt and reaches for what exists).
3. **Policy evaluates** the proposed call. Your scope allows `network-scan` against `127.0.0.1`, so it returns `allowed: true`.
4. **The tool runs.** Output streams back into the chat in real time.
5. **The agent reads the output** and either calls another tool (e.g. summarize the open ports) or produces a final assistant turn.
6. **The run terminates** when the model returns a turn with no tool calls — at which point a `run.completed` trace event is recorded.

## Read the synthesis

Click into **Runs** in the left nav, pick your run from the sidebar. The default tab is **Synthesis** — that's the headline view.

You'll see:

- **Posture donut** — a 0–100 score with a strong/fair/weak rating. Derived from three weighted components: coverage (40%) = tool-call success rate, risk (40%) = inverse of blocked + failed actions, hygiene (20%) = did the run terminate cleanly with artifacts.
- **Outcome line** — one-glance summary: "Completed · 3 ok · 0 blocked · posture 84/100 (strong)".
- **Status pills** — run status, scope name, duration, policy mode (governed / operator-override).
- **Objective card** — your goal verbatim plus a chip showing met / partial / unmet and the signal that drove the call.
- **Activity card** — event count, tool-call breakdown (succeeded / failed / blocked), artifact count, approval totals.
- **Posture breakdown** — bars for each component so you can see *why* posture is what it is.
- **Findings bar** — if your run created any findings (open ports, missing headers, etc.) they're stacked by severity.
- **Highlights** — short lines like "Three tool calls completed successfully" or "One action blocked — out-of-scope target". Heuristic by default; can be LLM-generated if you flip the flag.
- **Next steps** — clickable buttons that route to Rerun, Triage findings, Review approvals, Generate exec summary, etc.

::: tip The synthesis card is the same data shape everywhere
The trending panel on the Dash, the preview in the onboarding wizard, and this card all consume the same v1 data shape. Read the [synthesis data shape](/reference/synthesis-shape) reference page for the schema.
:::

## Look at the trace

Synthesis is the operator view. For forensics, click the **Trace** tab — that's the full event timeline (one row per `tool.call.started` / `tool.call.completed` / etc., with chunked assistant replies collapsed into expandable summary rows).

Click **Messages** for a reconstructed chat-style view of what was said and done, or **Graph** to see the trace-derived execution graph with pan/zoom and replay controls.

## Generate an artifact

The synthesis card's "Generate executive summary" next-step button creates a durable markdown artifact tied to the run. Same for "Evidence bundle" — a tarball of every artifact + trace export, ready to hand off.

## What if the agent stops after one tool call?

If you're using Grok or some local OpenAI-compatible shims, you might historically have seen the agent fire one tool and stop. PHANTOM's agent loop tolerates `finish_reason: 'stop'` paired with `tool_calls` in the same stream — see [Agent loop](/architecture/agent-loop) for the technical detail. If you do see early stops with your provider, file an issue with the trace bundle attached.

## Re-run after mitigation

After fixing whatever the run surfaced, click the **Replay** button on the run header. PHANTOM creates a run-template from the source run, materializes a new run against the same scope, and emits a `run.rerun.created` trace event so the audit trail links the before-and-after.

The synthesis card's posture trending across the two runs lands on the Dash automatically.
