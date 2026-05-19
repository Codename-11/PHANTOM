# Sec-Ops installer

PHANTOM's installer turns "the agent can't find nmap" into a one-click problem. It auto-detects your host package manager, exposes a curated catalog of base + offensive + blue security tools, and runs the installs through the same approval queue every other privileged action goes through.

You'll find it in **Settings → Tools** below the existing toolpack list.

## What it does

1. **Detects your host.** Reads `process.platform`, `/etc/os-release` (on Linux), and `/.dockerenv`, then walks `PATH` for each candidate package manager. Result: a card at the top of the panel showing OS, distro, docker flag, and per-manager green/red dots.
2. **Resolves an install plan.** For any tier (base / offensive / blue) or specific tool ids, picks the best backend in priority order (winget → choco → scoop → wsl-apt on Windows; apt → dnf → pacman → pipx → go on Linux; brew → pipx → go on macOS) and builds the exact `(command, args)` pair for each tool.
3. **Files an approval request.** Persisted to the `install_requests` table with status `pending`. Shows up in both Settings → Tools *and* the Approvals page.
4. **Executes on approval.** Each step runs via `spawn(command, args, {shell: false})` — no shell injection. Per-step 10-minute timeout. Stdout / stderr tails (4KB each) captured and persisted as the request's result.
5. **Classifies the result.** Each step lands as `ok | timeout | admin | failed | skipped`. Admin failures get a copy-the-elevated-command affordance instead of a raw exit code.

## The three tiers

**Base · recon + OSINT** (lowest blast radius)

- `nmap`, `masscan`, `ffuf`, `gobuster`, `sqlmap`, `nikto`, `theHarvester`, `amass`, `whatweb`, `httpx`

**Offensive · red team**

- `metasploit-framework`, `john`, `hashcat`, `hydra`, `responder`, `impacket`, `bloodhound`

**Blue · defense + DFIR**

- `wireshark`, `zeek`, `suricata`, `yara`, `volatility`, `chainsaw`

The full catalog with package ids per backend lives in `server/tools/installer-catalog.js` and is browsable via `GET /api/installer/catalog`.

## Workflow

### Browse status

Open Settings → Tools. The host card tells you which package managers are available. Each tier card shows installed/total ("3/10 installed") and a list-tools toggle.

Hovering "Show tools" expands the tier into a per-tool list with green dots for tools on PATH, red dots for missing tools, and a "docs ↗" link per tool.

### Preview commands

Click **Preview commands** on a tier. A modal-style alert shows exactly which command will run for each tool plus a summary like `"7/10 installable via apt, 3 skipped"`. Nothing is persisted yet.

### Request install

Click **Install missing (N)**. PHANTOM resolves the plan, files a pending request, and shows it in the install-requests list at the bottom of the panel. The same request also appears on the Approvals page above the KPI strip.

### Approve

Two paths:

- From the install-requests card (Settings → Tools), click **Approve & install**.
- From the Approvals page card, click **Approve & install**.

Either path runs the plan sequentially. Each step's result lands in the request's plan-table view: exit code, classification, stdout/stderr tail.

### Cancel

Cancel a pending request from either surface. Status flips to `cancelled` in both places on next refresh.

## Privilege failure handling

Some installs need admin/root and PHANTOM can't always provide it from a non-TTY Express request.

**Detection.** The classifier matches a conservative pattern set:

- `must (be|run as) root`
- `are you root`
- `permission denied`
- `requires (administrator|elevation|root|sudo)`
- `access is denied`
- `sudo: a password is required`
- `operation not permitted`
- Numeric: winget `0x80073D06`, choco MSI `1603`

When matched, the step is classified `admin` instead of generic `failed`.

**Linux mitigation.** If you've validated your sudo password via `/api/sudo/validate` (Settings → General), the installer prepends `-S` and pipes the cached password into `sudo -S` stdin. Non-TTY installs succeed.

**Windows mitigation.** The step result carries an `elevatedCommand` PowerShell one-liner (`Start-Process -Verb RunAs winget …`) and the UI surfaces a **Copy elevated cmd** button. Paste it into an admin PowerShell window.

::: warning Don't try to bypass the elevation prompt
PHANTOM does not silently auto-elevate on Windows. UAC promotion needs a user click. The Copy-elevated-cmd affordance is the deliberate seam.
:::

## Why every install is approval-gated

System-level package installs are the largest blast radius a desktop agent touches. The governance argument for PHANTOM is "nothing privileged goes unrecorded," and installs are squarely in that category. So:

- Every install is a persisted request with operator approval before any spawn.
- The exact command + args is shown to the operator before approval.
- Stdout / stderr tail is captured for the audit trail.
- Approval and cancellation are operator actions, never agent-initiated.

This is the same pattern as scope-gated tool calls — there are no separate flows for "install" vs. "scan."

## API

```text
GET  /api/installer/status               # host + per-tool availability + tier counts
GET  /api/installer/catalog              # tiers + tools (full catalog)
POST /api/installer/preview              # body: {tier} or {toolIds:[]}
POST /api/installer/request              # body: {tier} or {toolIds:[]}, note?
GET  /api/installer/requests             # ?status=pending|completed|failed|cancelled
GET  /api/installer/requests/:id
POST /api/installer/requests/:id/approve # executes the plan
POST /api/installer/requests/:id/cancel
```

The `request` shape (excerpt):

```json
{
  "id": "req-uuid",
  "status": "pending",
  "toolIds": ["nmap", "ffuf", "metasploit"],
  "plan": [
    {
      "id": "nmap",
      "tool": { "id": "nmap", "command": "nmap", "tier": "base", "summary": "…" },
      "backend": "apt",
      "packageId": "nmap",
      "command": "sudo",
      "args": ["apt-get", "install", "-y", "nmap"]
    },
    /* … */
  ],
  "note": "Install missing base tools",
  "result": null,
  "requested_at": "…", "decided_at": null, "completed_at": null
}
```

On approve, the result column is filled with `{ steps: [{ id, backend, command, args, exit, classification, stdoutTail, stderrTail, elevatedCommand? }, …] }`.

## Caveats

- The catalog is curated, not exhaustive. ~23 tools cover the workflows PHANTOM's toolpacks expect. Add to the catalog by editing `server/tools/installer-catalog.js`.
- `wsl-apt` on Windows lets you install Kali-side tools, but invoking them from PHANTOM-on-Windows requires `wsl.exe <tool>` — the agent's system prompt doesn't surface the WSL indirection yet.
- The 10-minute per-step timeout is generous but not infinite. Hashcat and Metasploit installs occasionally exceed it on slow networks; re-request the failed step.
