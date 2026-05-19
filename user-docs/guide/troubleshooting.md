# Troubleshooting

The shortest path to a fix for each class of problem I've seen during PHANTOM development.

## The agent stops after one tool call

**Symptom.** You send a multi-step request ("scan, then write a report"). The agent calls one tool, then stops without continuing.

**Most likely cause.** Your provider is emitting `finish_reason: 'stop'` alongside `tool_calls` in the same response chunk. The OpenAI spec says this should be `finish_reason: 'tool_calls'`, but Grok and several local OpenAI-compatible shims don't comply.

**What PHANTOM does about it.** As of the cohesive-flow round, `server/ai/llm-client.js` defers the stop decision until *after* the stream drains. If `tool_calls` were assembled, they take precedence over `finish_reason`. The agent loop keeps going until the model produces a turn with no tool calls or hits the `MAX_AGENT_ITERATIONS = 40` cap.

**If you still see early stops:**

1. Check the Trace tab on Runs. If `tool.call.started` shows up but `tool.call.completed` doesn't, the executor's the bottleneck, not the loop.
2. Check the Output tab. If `finish_reason: 'length'` appears, your `max_tokens` is too low — bump it in Settings → Models.
3. File an issue with the run id, provider, and model name.

## "needs admin" on an install step

**Symptom.** You requested an install from Settings → Tools or the Approvals page; the step result shows an orange **needs admin** pill instead of `exit 0 · ok`.

**On Linux:**

1. Settings → General → set your sudo password (it's stored locally in the SQLite settings table; never shipped off-device).
2. Re-approve the install request. PHANTOM will prepend `-S` and pipe the cached password to `sudo -S apt-get install …` so it runs without a TTY.

**On Windows:**

1. Click the **Copy elevated cmd** button next to the step. PHANTOM dropped a `Start-Process -Verb RunAs winget …` (or `choco …`) one-liner onto your clipboard.
2. Open an elevated PowerShell window (right-click → Run as Administrator).
3. Paste and run.
4. After install completes, refresh the request — the per-tool availability dots in the Tools panel will update on the next probe.

## The Synthesis tab is empty / says "Failed to build synthesis"

**Symptom.** Synthesis tab shows an error or no posture data.

**Causes I've seen:**

- The run hasn't terminated yet (still in `running` status). Wait for it to complete.
- A trace event got persisted with a malformed `metadata_json` blob. Open `phantom.db` in a SQLite viewer; look for trace events on that run with non-parseable JSON.
- The run has zero trace events. Some failure mode in the WebSocket handler — restart `npm run dev` and try again.

**The healthy state.** Even a run with zero tool calls renders a synthesis card with posture, status, and one fallback highlight ("Run completed with no notable activity"). If you get a hard error, file an issue.

## The wizard won't open

**Symptom.** Fresh install, page loads, no wizard appears.

**Causes:**

1. **You're not on a fresh install.** The wizard's sticky-completion flag is on. Click Settings → Advanced → **Open wizard** to clear the flag and re-summon.
2. **The status endpoint failed.** Open dev tools → Network → look for `/api/onboarding/status`. If it 500s, check the server log — usually a DB-init race.
3. **JS error before the bootstrap fires.** Same place: dev tools console. The wizard is invoked from `app.js` ~800ms after page load.

## "no package available for win32" on every installer tier

**Symptom.** The installer panel shows tier counts but every step in a preview comes back as "skipped · no package available for win32" — `winget` and `choco` and `scoop` are all listed as off in the host detection card.

**Cause.** None of the Windows package managers are on PATH. Most likely you installed PHANTOM in a fresh Windows VM that's never had winget initialized.

**Fix.**

1. Open a regular PowerShell.
2. Run `winget --version`. If it errors with "not recognized", install App Installer from the Microsoft Store and reboot.
3. Or install [Chocolatey](https://chocolatey.org/install) (admin PowerShell, one curl-piped install command).
4. Refresh the installer panel. The host detection card should now show the manager you installed in green.

## Trace events flood the timeline

**Symptom.** A single chat turn produces 170+ rows in the Runs → Trace tab.

**Cause.** Every streamed assistant chunk emits its own `assistant.chunk` trace event. The aggregated timeline view collapses consecutive chunk events into one expandable row (look for "💬 Assistant reply · N chunks · M chars").

**Workaround.** If you're forensically inspecting a specific tool call, use the Messages tab instead — it reconstructs the conversation chat-style without the chunk noise.

## CSS classes look stale after a backend change

**Symptom.** You updated PHANTOM, restarted `npm run dev`, but the page still uses old layout.

**Fix.** Vite caches aggressively in dev. Hard-refresh with Ctrl+Shift+R (or Cmd+Shift+R) once.

## Tests pass locally but I can't reproduce a feature

**Symptom.** `npm test` is green, build is clean, but the live UI doesn't show what you expected.

**Diagnostic order:**

1. **Browser cache.** Hard-refresh.
2. **Server stale.** Kill `npm run dev`, restart.
3. **Wrong port.** Vite runs on 5173, Express on 1337. The dev URL is the Vite one — Express alone won't serve the JS dev bundle.
4. **Logged-out provider.** If your provider key expired, `/v1/models` probes start failing. Settings → Models → re-test connection.
5. **Database in a weird state.** As a last resort, `rm phantom.db phantom.db-wal phantom.db-shm` and restart. You'll lose all runs but the DB will rebuild clean. (Don't do this on data you care about.)

## Getting more help

- [GitHub Issues](https://github.com/Codename-11/PHANTOM/issues) — bug reports, feature requests
- DEVLOG.md in the repo — running history of what's changed and why
- `ai_sync/` directory — internal implementation notes (read-only, but useful for understanding architectural choices)
