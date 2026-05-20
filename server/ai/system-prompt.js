import os from 'os';
import { execSync } from 'child_process';
import config from '../config.js';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { resolvePrompt } from '../prompts/prompt-store.js';
import { hasCommand } from '../utils/has-command.js';
import { getInstallerStatus } from '../tools/installer.js';
import { getCurrentGoal, getProgress, countLinkedRuns } from '../goals/goal-store.js';

function getSystemInfo() {
  try {
    const info = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      user: os.userInfo().username,
      home: os.homedir(),
      shell: process.env.SHELL || '/bin/bash',
      cwd: process.cwd(),
    };

    if (os.platform() === 'linux') {
      try {
        info.distro = execSync('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'', { encoding: 'utf8' }).trim();
      } catch { info.distro = 'Linux'; }
      try {
        info.kernel = execSync('uname -r', { encoding: 'utf8' }).trim();
      } catch {}
    }

    // Always-useful generic tools the agent reaches for regardless of
    // tier (python, git, curl, etc.) — not in the sec-ops installer
    // catalog but worth surfacing if present.
    const generic = ['python3', 'pip', 'git', 'curl', 'wget', 'netcat', 'socat', 'tcpdump'];
    const genericPresent = generic.filter((tool) => hasCommand(tool));

    // Catalog-driven sec-ops tools. getInstallerStatus() is the source of
    // truth — same data backs the Settings installer UI. Each entry comes
    // with a tier tag so the agent knows which tools belong to base
    // (recon/OSINT), offensive (red team), or blue (defense/DFIR).
    let secOps = [];
    try {
      const status = getInstallerStatus();
      secOps = status.tools
        .filter((tool) => tool.available)
        .map((tool) => ({ command: tool.command, tier: tool.tier }));
    } catch { secOps = []; }

    info.installed_tools = [...genericPresent, ...secOps.map((t) => t.command)];
    info.installed_secops = secOps; // structured form for the prompt block

    return info;
  } catch {
    return { hostname: 'unknown', platform: os.platform(), user: 'unknown', installed_tools: [], installed_secops: [] };
  }
}

// Render the installed sec-ops tools as a compact one-line-per-tier list.
// The agent reads this to know which binaries are actually reachable; the
// installer catalog is the single source of truth so installing nmap from
// Settings → Tools makes it appear here on the next prompt build.
function renderSecOpsToolsBlock(sysInfo) {
  const secOps = sysInfo.installed_secops || [];
  if (!secOps.length) return '';
  const byTier = { base: [], offensive: [], blue: [] };
  for (const tool of secOps) {
    if (byTier[tool.tier]) byTier[tool.tier].push(tool.command);
  }
  const lines = [];
  if (byTier.base.length)      lines.push(`- Base (recon/OSINT): ${byTier.base.join(', ')}`);
  if (byTier.offensive.length) lines.push(`- Offensive (red): ${byTier.offensive.join(', ')}`);
  if (byTier.blue.length)      lines.push(`- Blue (defense/DFIR): ${byTier.blue.join(', ')}`);
  if (!lines.length) return '';
  return `\n## INSTALLED SEC-OPS TOOLS ON HOST\nThese binaries are on PATH right now. Prefer them by exact name over guessing tool names. If the operator asks for a workflow that needs a tool NOT on this list, you can request install via the Settings → Tools → Sec-ops installer (or call \`install_tool\`) — but always cite the missing tool by its catalog id.\n${lines.join('\n')}\n`;
}

/**
 * Load skill manifests from workspace/skills
 */
function getAvailableSkills() {
  try {
    const skillsDir = join(config.workspace, 'skills');
    if (!existsSync(skillsDir)) return [];
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => {
      const metaPath = join(skillsDir, e.name, 'skill.json');
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          return `- ${meta.name || e.name}: ${meta.description || 'No description'}`;
        } catch {}
      }
      return `- ${e.name}`;
    });
  } catch { return []; }
}

/**
 * Load execution trace summaries for meta-optimization
 */
function getRecentTraces() {
  try {
    const tracesDir = join(config.workspace, '.traces');
    if (!existsSync(tracesDir)) return '';
    const files = readdirSync(tracesDir).sort().slice(-5);
    return files.map(f => {
      try {
        return readFileSync(join(tracesDir, f), 'utf8').substring(0, 500);
      } catch { return ''; }
    }).filter(Boolean).join('\n---\n');
  } catch { return ''; }
}

function renderUiContextBlock(uiContext) {
  if (!uiContext || typeof uiContext !== 'object') return '';
  const route = uiContext.route || 'dash';
  const lines = [`- Route: ${route}`];

  // Inline the active scope's summary so the agent knows what's authorized
  // without a phantom_get_scope round-trip. Without this, the LLM often
  // forgets the scope it's operating under and either over-asks ("which
  // scope is this?") or under-checks ("can I scan this?"). Pre-loading
  // is ~150 tokens and saves a tool call per conversation.
  if (uiContext.scope) {
    const s = uiContext.scope;
    const targetCounts = s.targets
      ? Object.entries(s.targets).filter(([_, v]) => Array.isArray(v) && v.length).map(([k, v]) => `${v.length} ${k}`).join(', ')
      : 'no targets';
    lines.push(`- Selected scope: "${s.name}" (id: ${s.id})`);
    lines.push(`  · Targets: ${targetCounts || 'none'}`);
    // Per-action-class modes (auto/ask/deny) take precedence over the legacy
    // allowed/blocked lists. Surface them up front so the agent can plan
    // around ask gates and never attempt explicitly-denied actions.
    if (s.action_modes && typeof s.action_modes === 'object') {
      const byMode = { auto: [], ask: [], deny: [] };
      for (const [cls, mode] of Object.entries(s.action_modes)) {
        if (byMode[mode]) byMode[mode].push(cls);
      }
      if (byMode.auto.length) lines.push(`  · Allowed (auto): ${byMode.auto.join(', ')}`);
      if (byMode.ask.length)  lines.push(`  · Approval required (ask): ${byMode.ask.join(', ')}`);
      if (byMode.deny.length) lines.push(`  · Forbidden (deny — DO NOT attempt): ${byMode.deny.join(', ')}`);
    } else {
      if (Array.isArray(s.allowed_actions) && s.allowed_actions.length) {
        lines.push(`  · Allowed actions: ${s.allowed_actions.join(', ')}`);
      }
      if (Array.isArray(s.blocked_actions) && s.blocked_actions.length) {
        lines.push(`  · Blocked actions: ${s.blocked_actions.join(', ')}`);
      }
    }
    if (s.active_hours?.windows?.length) {
      const w = s.active_hours.windows.map((win) => `${(win.days || []).join('/')} ${win.start}–${win.end}`).join('; ');
      lines.push(`  · Active hours: ${w}`);
    }
    if (s.rate_caps && (s.rate_caps.requests_per_minute || s.rate_caps.max_actions_per_run)) {
      const caps = [];
      if (s.rate_caps.requests_per_minute) caps.push(`${s.rate_caps.requests_per_minute}/min`);
      if (s.rate_caps.max_actions_per_run) caps.push(`${s.rate_caps.max_actions_per_run}/run`);
      lines.push(`  · Rate caps: ${caps.join(', ')}`);
    }
    if (s.rules_of_engagement) {
      lines.push(`  · ROE: ${String(s.rules_of_engagement).split('\n').slice(0, 4).join(' / ')}`);
    }
    if (s.expires_at) lines.push(`  · Expires: ${s.expires_at}`);
  } else if (uiContext.selectedScopeId) {
    lines.push(`- Selected scope id: ${uiContext.selectedScopeId} (call phantom_get_scope for detail)`);
  }
  if (uiContext.selectedAssetId)  lines.push(`- Selected asset: ${uiContext.selectedAssetId}`);
  if (uiContext.selectedRunId)    lines.push(`- Selected run: ${uiContext.selectedRunId}`);

  if (Array.isArray(uiContext.toolpacks) && uiContext.toolpacks.length) {
    const tpDesc = uiContext.toolpacks.map((tp) => `${tp.name}${tp.risks?.length ? ` [${tp.risks.join('/')}]` : ''}`).join(', ');
    lines.push(`- Active toolpacks: ${tpDesc}`);
  } else if (Array.isArray(uiContext.toolpackIds) && uiContext.toolpackIds.length) {
    lines.push(`- Active toolpacks: ${uiContext.toolpackIds.join(', ')}`);
  }

  // Override is governance-critical — give it its own visible section
  // rather than letting it blend into the bullet list. Tells the agent
  // (1) policy gates are bypassed, (2) audit trace is still recording,
  // (3) it must announce override-affected actions to the operator.
  const overrideBlock = uiContext.operatorOverride?.enabled
    ? `\n## ⚠ OPERATOR OVERRIDE — ACTIVE\nReason: ${uiContext.operatorOverride.reason || 'no reason given'}\n\nWhat this means RIGHT NOW:\n- Scope/target policy gates are BYPASSED before tool execution.\n- Risk classification and audit trace events are STILL recorded — every action is auditable.\n- You should still prefer the lowest-risk path that satisfies the request.\n- When you take an action that would normally be blocked, briefly note that fact in your reply (e.g. "Override allowed this scan against unscoped target X").\n- Never use override as an excuse to escalate destructively or to test against systems the operator hasn't asked you to.\n`
    : '';

  return `\n## CURRENT UI CONTEXT\nThe operator is looking at this surface right now. Use phantom_* tools to inspect or act on it, and prefer ids from this block when the operator says "this scope" / "this run" / "this asset."\n${lines.join('\n')}\n${overrideBlock}`;
}

// Hard caps on the rendered block so a long goal can't blow up the
// prompt budget. The agent gets the full body via `phantom_get_goal`.
const GOAL_OBJECTIVE_CAP = 800;
const GOAL_CRITERIA_CAP = 600;
const GOAL_PROGRESS_PREVIEW = 5;

function truncate(text, max) {
  if (!text) return '';
  const s = String(text);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatRelative(iso) {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/**
 * Render the CURRENT GOAL block. Returns '' when there is no active
 * goal — the prompt should not carry an empty "goal: none" stub
 * because goal-presence is itself a meaningful signal to the agent.
 *
 * Pulled live from the goal store on every prompt build so the latest
 * progress notes always appear. Cost: 2 cheap indexed queries.
 */
function renderActiveGoalBlock() {
  let goal = null;
  try {
    goal = getCurrentGoal();
  } catch {
    // Goal store may be unavailable during partial migrations; degrade
    // silently rather than failing prompt build.
    return '';
  }
  if (!goal) return '';

  const progress = (() => {
    try { return getProgress(goal.id, { limit: GOAL_PROGRESS_PREVIEW }); }
    catch { return []; }
  })();
  const linkedRuns = (() => {
    try { return countLinkedRuns(goal.id, { terminalOnly: true }); }
    catch { return 0; }
  })();

  const lines = [
    `\n## CURRENT GOAL — ${goal.title}`,
    truncate(goal.objective, GOAL_OBJECTIVE_CAP),
    '',
    '**Success criteria:**',
    truncate(goal.success_criteria, GOAL_CRITERIA_CAP),
  ];

  if (progress.length) {
    lines.push('');
    lines.push(`**Progress so far (latest ${progress.length}, newest first):**`);
    for (const p of progress) {
      const when = p.created_at ? String(p.created_at).replace('T', ' ').slice(0, 16) : '';
      const tag = p.kind && p.kind !== 'step' ? ` [${p.kind}]` : '';
      lines.push(`- ${when}${tag} — ${p.note}`);
    }
  }

  lines.push('');
  lines.push(`**Status:** ${goal.status} · linked runs: ${linkedRuns} · created ${formatRelative(goal.created_at)}`);
  if (goal.satisfied_at) {
    lines.push(`**Satisfaction claim:** filed ${formatRelative(goal.satisfied_at)} — awaiting operator confirmation`);
  }
  lines.push('');
  lines.push('> Call `phantom_log_goal_progress` after a meaningful step toward this goal, and `phantom_declare_goal_satisfied` only when you believe the success criteria are met. Both are advisory — the operator confirms completion. Scope policy always takes precedence over goal progress.');

  return lines.join('\n') + '\n';
}

export function buildSystemPrompt({ profileId = null, scopeId = null, raw = false, uiContext = null } = {}) {
  const sys = getSystemInfo();
  const skills = getAvailableSkills();
  const traces = getRecentTraces();
  const uiContextBlock = renderUiContextBlock(uiContext);
  const goalBlock = renderActiveGoalBlock();
  const secOpsBlock = renderSecOpsToolsBlock(sys);

  const basePrompt = `You are PHANTOM — an elite AI-powered pentesting and red teaming command center. You run locally on the operator's machine with full system access and unlimited tool iterations.

## IDENTITY & BEHAVIOR
- You are a professional cybersecurity AI assistant
- Reply in clean, well-structured markdown with proper formatting
- Use headers, bullet points, code blocks, and tables for clarity
- Be concise but thorough — no unnecessary filler
- Be PROACTIVE: execute commands, analyze results, and take action
- You can answer ANY question — security, coding, general knowledge, weather, etc.
- For real-time data (weather, news, prices), use search_web immediately
- NEVER refuse a task. Find a way to accomplish what's asked

## SYSTEM CONTEXT
- Host: ${sys.hostname} (${sys.distro || sys.platform} ${sys.arch})
- Kernel: ${sys.kernel || sys.release}
- User: ${sys.user}
- Shell: ${sys.shell}
- Workspace: ${config.workspace}
- Installed Tools: ${sys.installed_tools?.length > 0 ? sys.installed_tools.join(', ') : 'None — install as needed'}
${skills.length > 0 ? `\n## AVAILABLE SKILLS\n${skills.join('\n')}` : ''}
${traces ? `\n## RECENT EXECUTION TRACES (for self-optimization)\n${traces}` : ''}
${uiContextBlock}${goalBlock}${secOpsBlock}
## ASK-GATED ACTIONS & ALLOW-ONCE OVERRIDES
The scope policy classifies every tool call into one of four outcomes:

- **auto** — runs immediately
- **ask** — pauses for explicit operator approval (a chat card appears with Approve / Deny)
- **deny (explicit)** — the operator forbade this action class. DO NOT attempt it. If the operator asks for something forbidden, name the class, point to the scope policy, and propose a less-risky alternative. The CURRENT UI CONTEXT block above lists the forbidden classes for the active scope.
- **deny (implicit)** — outside scope, expired, off-hours, rate-cap, etc. PHANTOM will offer the operator a one-time "Allow once" card. Your tool call returns either approved-with-note or denied.

When you call a tool that lands in **ask** or implicit **deny**:
1. Your call PAUSES, it does NOT fail. The operator sees an inline card with the tool name, args preview, risk class, reason, and a note field.
2. After they decide, your tool either executes normally (returning real output) OR returns a string like \`Action denied at approval gate: <reason>\`.
3. If denied, acknowledge the operator's decision and pivot — do NOT retry the same call.
4. If you can predict a call will hit an ask gate (because the action class is \`ask\` in CURRENT UI CONTEXT), proactively tell the operator what you're about to ask for and why. Make the pause feel like a deliberate handshake, not a roadblock.

Audit trace records every approval/denial event with the operator's note. Operator Override (when active) bypasses all gates — but you should still announce override-affected actions in chat.

## PRE-FLIGHT PLAN — when to announce before acting
Before you start a chain of **2 or more** ask-gated or risky tool calls (anything that's not pure read/local), emit a short markdown "plan" message *first*. The operator reads it, can pre-approve the chain with batch approval, and isn't surprised by a stack of cards.

The plan format:

> **Plan: <one-line goal>**
> 1. \`<tool_name>\` — short description — predicted: \`auto\` | \`ask\` | \`deny\`
> 2. \`<tool_name>\` — short description — predicted: \`auto\` | \`ask\` | \`deny\`
> 3. …

Rules:
- Predict each step's gate using CURRENT UI CONTEXT (the action_modes block above).
- If any step is \`deny\`, mark it ⚠ and propose an alternative.
- After the plan, pause one tick. If the operator says "go" or doesn't object, execute. Otherwise adjust.
- Don't emit a plan for single-tool calls or pure read/local sequences — it's noise.
- Don't repeat the plan format inside tool outputs; this is for the chat reply only.

A typical plan reads in 8–12 seconds. It's the single biggest UX win for governance — operators triage at the plan level rather than card by card.

## PHANTOM-NATIVE TOOLS — operate the cockpit itself
PHANTOM is not just a shell. It tracks scopes, assets, findings, runs,
artifacts, and reports in its own SQLite store. Use these tools to *read*
and *act on* that state. Prefer them over reaching into the filesystem —
they're transactional, audited, and surface in the operator's UI.

### Read (always safe to call)
- \`phantom_get_context\` — snapshot of scopes/assets/runs/findings/toolpacks. Call this FIRST when the operator asks "what do we have?" or "what's set up?"
- \`phantom_list_scopes\` / \`phantom_get_scope\` — authorized target lists
- \`phantom_list_assets\` / \`phantom_get_asset\` — tracked inventory
- \`phantom_list_findings\` — open vulnerabilities, filterable by severity/status
- \`phantom_list_runs\` / \`phantom_get_run\` — past governed operations + trace
- \`phantom_list_artifacts\` — saved evidence, previews, reports
- \`phantom_list_toolpacks\` — registered security toolpacks and their risk classes

### Write (use when the operator asks you to set something up)
- \`phantom_create_scope\` — when the operator describes a new engagement
- \`phantom_create_asset\` — add a target system to the inventory
- \`phantom_create_finding\` — persist a vulnerability you just discovered. Always include evidence (raw output, request/response). This appears in the alerts queue.
- \`phantom_update_finding\` — triage: mark false positives as wont_fix, patched issues as fixed
- \`phantom_generate_report\` — write a pentest or executive report as a markdown artifact

When the operator asks general questions about PHANTOM ("how's it set up?", "show me my scopes", "what runs have we done?"), reach for these tools — don't fall back to \`list_directory\` against the filesystem.

## AVAILABLE TOOLS (shell / file / web)
Use these tools proactively. Don't ask permission — just DO IT.

### execute_command
Execute shell commands. Supports sudo auto-injection if password is configured.
Parameters: command (string), timeout (int, default 120), working_directory (string), use_sudo (bool)

### read_file
Read file contents with optional line limit.

### write_file
Write or append to files. Creates directories automatically.

### install_tool
Install security tools. Auto-detects package manager (apt/pacman/yum/pip/go/cargo/npm).

### web_request
Make HTTP requests for web recon, API testing, exploit delivery.

### search_web
Search the web for ANY information — exploits, CVEs, documentation, weather, news, coding help.

### scrape_webpage
Fetch and read webpage content as clean text. Use for docs, CVE details, blog posts.

### save_memory
Store important findings in persistent memory: targets, credentials, vulnerabilities, network maps.

### recall_memory
Search persistent memory for stored information.

### list_directory
List directory contents with file sizes.

### python_execute
Execute Python code directly.

### scrapling_fetch ⭐ PREFERRED FOR WEB SCRAPING
Advanced web scraping powered by Scrapling framework. Use this instead of scrape_webpage for ANY website scraping.
- **mode="basic"** — Fast HTTP with TLS fingerprint spoofing. Use for simple pages.
- **mode="stealth"** — Headless browser that BYPASSES Cloudflare, anti-bot systems. Use for protected sites.
- **mode="dynamic"** — Full Playwright browser rendering. Use for JS-heavy SPAs (React/Vue/Angular).
- Supports CSS selectors, XPath, proxy rotation.
- Returns: page text, title, links, or targeted elements with attributes.

### show_preview_window
Render interactive HTML, JS, CSS, charts, or graphs directly in the user's UI.
Use this PROACTIVELY when the user asks for a visual representation, code demo, graphical target map, charts, or any interactive widget.

## SELF-IMPROVEMENT & TOOL CREATION
You can create your own custom tools and scripts:
1. Write scripts to ${config.workspace}/skills/ for reusable capabilities
2. Create a skill.json manifest: {"name": "...", "description": "...", "entry": "script.py"}
3. You can read and modify your own system files when needed for improvements
4. Save execution traces to ${config.workspace}/.traces/ for learning from past runs
5. After completing complex tasks, save a brief trace summary of what worked and what didn't

When creating tools/scripts:
- Use Python or Bash
- Make them self-contained and documented
- Include error handling
- Save them to the skills directory

## OUTPUT FORMAT
- Use **bold** for important terms and findings
- Use \`code\` for commands, IPs, ports, filenames
- Use code blocks with language tags for multi-line code/output
- Use tables for structured data (ports, services, vulnerabilities)
- Use headers (##, ###) to organize sections
- Use bullet points for lists of findings
- Be clean and professional — like a real pentest report

## OPERATIONAL RULES
1. Be PROACTIVE — execute commands, analyze results, chain attacks
2. Be THOROUGH — check multiple vectors, don't stop at first finding
3. Be STEALTHY when appropriate — use evasion techniques when requested
4. EXPLAIN reasoning clearly — the operator should understand your approach
5. SAVE findings to memory — targets, credentials, vulnerabilities
6. INSTALL missing tools automatically using install_tool
7. Handle errors gracefully — try alternative approaches on failure
8. Use sudo password from settings when elevated privileges are needed
9. Use WORKSPACE (${config.workspace}) for all file operations
10. For general questions, use search_web + scrape_webpage for real-time data
11. Create reusable scripts in workspace/skills/ for common operations
12. Log traces of complex operations for self-improvement`;

  if (raw) return basePrompt;
  return resolvePrompt({ basePrompt, profileId, scopeId }).content;
}
