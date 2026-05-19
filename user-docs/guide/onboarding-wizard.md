# Onboarding wizard

When you start PHANTOM on an empty database for the first time, a 4-step wizard slides in to walk you through setup. It auto-opens once and remembers that you've completed it — even if you later wipe your data, it won't re-open without explicit action.

## When the wizard appears

The wizard checks `GET /api/onboarding/status` on every page load. It opens when **all** of these are true:

1. `completed` flag in the `settings` table is `0` (or unset).
2. No conversations exist.
3. No scopes exist.
4. No runs exist.

If you've already used PHANTOM, you won't see it auto-open. You can summon it any time from **Settings → Advanced → Open wizard** — that path also resets the sticky completion flag.

## The four steps

### 1. Welcome

A short pitch and a list of what you're about to set up. Nothing to fill in — click **Next**.

### 2. Provider

Pick an OpenAI-compatible provider from the dropdown (default is whatever the server registry's default points at — usually the Hermes proxy if installed, otherwise the first provider with credentials).

Paste your API key. Click **Test connection** to verify the endpoint responds. The test posts to `/api/settings` first (so the provisional settings are active) and then `/api/settings/test`.

::: tip Local endpoints don't need a key
For Ollama, LM Studio, or any local OpenAI-compatible server, leave the API key blank. The test will still work as long as the daemon is running.
:::

### 3. First scope

The wizard pulls live Rules-of-Engagement templates from `/api/scopes/roe-templates` so you can start with a sensible preset (Internal Pentest, Bug Bounty, Red Team, Lab/Internal). Pick one, name your scope, paste your targets (hosts, CIDRs, or URLs — one per line or comma-separated).

When you click **Next**, the wizard:

1. Calls `/api/scopes/parse-targets` to classify each line into hosts/cidrs/urls/domains.
2. Posts the resulting scope to `/api/scopes` with `allowedActions: ['recon']` and `blockedActions: ['destructive']` by default.

If you need richer policy (action modes, time windows, rate caps), edit the scope from the Scope page after setup.

### 4. Preview

The wizard fetches `/api/runs/preview/synthesis?preview=stub` — a hand-tuned sample synthesis with the same shape you'll see on real runs. The card renders inside the wizard with a "PREVIEW · sample data" banner so first-time operators see what the end-of-run experience looks like before kicking off a live run.

Click **Finish** to:

1. Mark `synthesis_llm_enabled` and `onboarding_completed` flags as appropriate.
2. Close the wizard.
3. Route you to the Chat surface.

## Re-running the wizard

From Settings → Advanced → **Open wizard**. The button calls `/api/onboarding/reset` (clears the sticky flag) and then summons the modal. It's safe to run repeatedly — your existing scopes, runs, and settings aren't touched.

## Skipping mid-flow

The wizard's "Skip for now" button also marks completion. We choose to be sticky on dismissal because surprise modals on every reload are a worse experience than the operator's natural fallback ("how do I re-run setup?") which leads them to Settings.

## What the wizard does NOT do

- It does not change the model, temperature, or max-tokens — those defaults from `.env` stay in effect.
- It does not enable Operator Override.
- It does not start a run. After Finish, you're on Chat with a fresh conversation; *you* type the first message.
