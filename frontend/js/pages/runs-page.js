window.RunsPage = {
  runs: [],
  selectedRunId: null,
  currentRun: null,
  activeTab: 'trace',
  // Default the sidebar filter to the conversation the operator is in.
  // 'this' = runs from the current conversation only; 'all' = global recents.
  scopeFilter: 'this',
  replay: {
    timer: null,
    playing: false,
    index: 0,
    total: 0,
    blockedIndex: -1,
    events: [],
  },
  // Debounce token for the live-trace listener. Each SSE chunk fires a
  // phantom:trace event; without debouncing, /api/runs + /replay refetch
  // 100+ times per assistant reply, causing visible lag and noisy logs.
  _traceDebounce: null,
  _pendingTraceRunId: null,

  init() {
    document.getElementById('refresh-runs-btn')?.addEventListener('click', () => this.loadRuns());
    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'runs') this.loadRuns();
    });
    // Debounced live update: coalesce chunk-rate phantom:trace events
    // (one per SSE token) into a single refetch ~300ms after the stream
    // pauses. The currently-selected run still feels live because the
    // chat dock owns the visible streaming view; the Runs page is the
    // forensic lens, so a small lag here is fine.
    window.addEventListener('phantom:trace', (event) => {
      const runId = event.detail?.runId;
      if (!runId || window.Router?.current !== 'runs') return;
      this._pendingTraceRunId = runId;
      if (this._traceDebounce) clearTimeout(this._traceDebounce);
      this._traceDebounce = setTimeout(() => {
        const target = this._pendingTraceRunId;
        this._traceDebounce = null;
        this._pendingTraceRunId = null;
        this.loadRuns(target);
      }, 300);
    });
    // When the active run terminates, re-fetch its synthesis so the card
    // updates from "running" to its final shape without a manual refresh.
    // Also flashes the Synthesis tab so the operator notices it landed.
    window.addEventListener('phantom:run-complete', (event) => {
      const runId = event.detail?.runId;
      if (!runId) return;
      if (this.selectedRunId === runId) this.loadSynthesis(runId);
      this.flashSynthesisTab();
    });
    // Repaint the sidebar when the operator switches conversations so the
    // "this conversation" filter follows their context without manual refresh.
    window.addEventListener('phantom:conversation', () => {
      if (window.Router?.current === 'runs') this.loadRuns();
    });
    this.bindStaticControls();
    if (window.Router?.current === 'runs') setTimeout(() => this.loadRuns(this.selectedRunId), 0);
  },

  // Resolve which conversation the operator is "in". app.js persists this
  // to localStorage on every selectConversation; we read it here rather than
  // reaching into the app.js IIFE.
  currentConversationId() {
    try { return localStorage.getItem('phantom:last-conversation') || null; }
    catch { return null; }
  },

  bindStaticControls() {
    const tabs = document.getElementById('run-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.addEventListener('click', (event) => {
        const btn = event.target.closest('.run-tab');
        if (!btn) return;
        this.setActiveTab(btn.dataset.tab);
      });
    }

    const playBtn = document.getElementById('run-replay-play-btn');
    const stepBtn = document.getElementById('run-replay-step-btn');
    const resetBtn = document.getElementById('run-replay-reset-btn');
    if (playBtn && !playBtn.dataset.bound) {
      playBtn.dataset.bound = '1';
      playBtn.addEventListener('click', () => this.replayToggle());
    }
    if (stepBtn && !stepBtn.dataset.bound) {
      stepBtn.dataset.bound = '1';
      stepBtn.addEventListener('click', () => this.replayStep());
    }
    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = '1';
      resetBtn.addEventListener('click', () => this.replayReset());
    }
  },

  setActiveTab(tab) {
    if (!tab) return;
    this.activeTab = tab;
    document.querySelectorAll('#run-tabs .run-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('#run-tab-body .run-tab-pane').forEach((pane) => {
      const match = pane.dataset.pane === tab;
      pane.classList.toggle('active', match);
      if (match) pane.removeAttribute('hidden');
      else pane.setAttribute('hidden', '');
    });
    // Evidence tab hydrates on first display via RunEvidenceTab.show.
    // Cheap re-fetch on every switch — the bundle is small and the
    // operator may have just exported something.
    if (tab === 'evidence' && this.selectedRunId) {
      const host = document.getElementById('run-evidence-pane');
      window.RunEvidenceTab?.show?.(host, this.selectedRunId);
    }
  },

  async loadRuns(selectRunId = this.selectedRunId) {
    const list = document.getElementById('runs-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-msg">Loading runs…</div>';
    try {
      // When the operator is in a conversation and the filter is on "this",
      // narrow the sidebar to that conversation's runs. The /api/runs endpoint
      // already supports a conversationId query param. Fall back to global
      // recents if the filter is 'all' or no conversation is pinned.
      const conversationId = this.currentConversationId();
      const params = new URLSearchParams({ limit: '50' });
      if (this.scopeFilter === 'this' && conversationId) {
        params.set('conversationId', conversationId);
      }
      const res = await fetch(`/api/runs?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.runs = await res.json();
      // If filtering to current conversation returned nothing but global has
      // runs, auto-fallback so the page isn't empty when the operator opens
      // it from a fresh conversation. Filter chip still shows "this" so they
      // can see the state and toggle back.
      if (this.scopeFilter === 'this' && conversationId && this.runs.length === 0) {
        const globalRes = await fetch('/api/runs?limit=50');
        if (globalRes.ok) {
          this.runs = await globalRes.json();
          this._filterFellBack = true;
        }
      } else {
        this._filterFellBack = false;
      }
      this.renderRunsList();
      this.renderScopeChip();
      const runToSelect = selectRunId || this.runs[0]?.id;
      if (runToSelect) await this.selectRun(runToSelect);
      else this.renderEmptyDetail();
    } catch (err) {
      list.innerHTML = `<div class="empty-msg danger">Failed to load runs: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  // Filter chip ("This conversation · 3" ↔ "All runs · 50") + click toggle.
  // Lives at the top of the sidebar so the scope is always visible — the
  // previous list silently mixed runs from every conversation, which made
  // it hard to find "what did the agent just do in this chat?".
  renderScopeChip() {
    const host = document.getElementById('runs-scope-chip');
    if (!host) return;
    const conversationId = this.currentConversationId();
    const total = this.runs.length;
    const active = this.scopeFilter === 'this' && conversationId && !this._filterFellBack;
    const label = active ? 'This conversation' : 'All runs';
    const hint = active ? `${total} matched` : `${total} recent · 50 max`;
    const fallback = this._filterFellBack ? `<small class="runs-scope-fallback">No runs in current conversation — showing recent.</small>` : '';
    host.innerHTML = `
      <button type="button" class="runs-scope-btn ${active ? 'is-active' : ''}" id="runs-scope-toggle"
              title="Switch between current conversation and all runs">
        <span class="lbl">${this.escapeHtml(label)}</span>
        <span class="ct">${this.escapeHtml(hint)}</span>
      </button>
      ${fallback}
    `;
    const btn = host.querySelector('#runs-scope-toggle');
    if (btn) {
      btn.addEventListener('click', () => {
        this.scopeFilter = this.scopeFilter === 'this' ? 'all' : 'this';
        this.loadRuns();
      });
    }
  },

  renderRunsList() {
    const list = document.getElementById('runs-list');
    if (!this.runs.length) {
      list.innerHTML = `
        <div class="empty-msg runs-empty">
          <strong>No runs yet.</strong>
          <p>Each chat turn that calls a tool becomes a run. Try one of:</p>
          <ul>
            <li><a href="#" data-runs-empty-action="chat">Start a new chat</a></li>
            <li><a href="#" data-runs-empty-action="onboarding">Re-open onboarding</a></li>
          </ul>
        </div>
      `;
      list.querySelectorAll('[data-runs-empty-action]').forEach((el) => {
        el.addEventListener('click', (event) => {
          event.preventDefault();
          if (el.dataset.runsEmptyAction === 'chat') window.Router?.navigate?.('chat');
          if (el.dataset.runsEmptyAction === 'onboarding') window.OnboardingWizard?.open?.();
        });
      });
      return;
    }
    list.innerHTML = '';
    this.runs.forEach((run) => {
      const item = document.createElement('button');
      item.className = `run-list-item${run.id === this.selectedRunId ? ' active' : ''}`;
      // Surface the goal as a second line when it differs from the title.
      // Most runs auto-title from the first 80 chars of the goal, so when
      // the goal IS the title we skip the duplicate — but when an operator
      // edited the title or the goal is longer, the goal preview adds value.
      const title = run.title || run.goal || 'Untitled Run';
      const goal = run.goal || '';
      const goalLine = goal && goal !== title && !title.startsWith(goal.slice(0, 40))
        ? `<small class="run-list-goal">${this.escapeHtml(goal.length > 80 ? goal.slice(0, 80) + '…' : goal)}</small>`
        : '';
      item.innerHTML = `
        <span class="run-status ${this.escapeHtml(run.status)}"></span>
        <span class="run-list-body">
          <strong>${this.escapeHtml(title)}</strong>
          ${goalLine}
          <small>${this.escapeHtml(run.model || 'model unknown')} · ${this.escapeHtml(run.scope?.name || 'no scope')} · ${this.escapeHtml(this.timeAgo(run.started_at) || run.started_at || '')}</small>
        </span>
      `;
      // Tooltip carries the full goal for runs where the displayed line is truncated.
      if (goal) item.title = goal;
      item.addEventListener('click', () => this.selectRun(run.id));
      list.appendChild(item);
    });
  },

  // Compact "5m ago" / "2h ago" / "3d ago" — easier to scan than ISO strings
  // in a dense sidebar. Falls back to the raw string if parsing fails.
  timeAgo(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const mins = (Date.now() - t) / 60000;
    if (mins < 0 || !Number.isFinite(mins)) return '';
    if (mins < 1) return 'just now';
    if (mins < 60) return `${Math.round(mins)}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  },

  async selectRun(id) {
    this.selectedRunId = id;
    this.renderRunsList();

    const traceEl = document.getElementById('run-trace-timeline');
    const hdEl = document.getElementById('run-detail-hd');
    const loadingIcon = window.StateIcons?.loading?.(40) || '';
    if (traceEl) traceEl.innerHTML = `<div class="run-loading-card">${loadingIcon}<div class="run-loading-cap">LOADING TRACE</div></div>`;
    if (hdEl) hdEl.innerHTML = '';

    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(id)}/replay`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const replayPayload = await res.json();
      const run = {
        ...replayPayload.run,
        events: replayPayload.events || [],
        artifacts: replayPayload.artifacts || [],
        replay: replayPayload.replay || {},
        graph: replayPayload.graph || null,
      };
      this.currentRun = run;
      this.renderDetailHeader(run);
      this.renderTabCounts(run);
      this.renderMessages(run);
      this.renderTraceTimeline(run);
      this.renderGraphPreview(run);
      this.renderArtifactGrid(run);
      this.renderSnapshot(run);
      this.renderOutput(run);
      this.renderMetaDrawer(run);
      this.setupReplay(run);
      this.loadSynthesis(run.id);
      // Synthesis is the operator's headline view — what happened, was the
      // goal met, what's next. Messages/Trace stay one click away.
      this.setActiveTab(this.activeTab || 'synthesis');
    } catch (err) {
      if (traceEl) traceEl.innerHTML = `<div class="empty-msg danger">Failed to load run: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderEmptyDetail() {
    this.currentRun = null;
    const traceEl = document.getElementById('run-trace-timeline');
    if (traceEl) traceEl.innerHTML = '<div class="empty-msg">Select a run to inspect the trace timeline.</div>';
    const synthEl = document.getElementById('run-synthesis');
    if (synthEl) synthEl.innerHTML = '<div class="empty-msg">Select a run to view its synthesis.</div>';
    const hdEl = document.getElementById('run-detail-hd');
    if (hdEl) hdEl.innerHTML = '';
    ['run-meta-run', 'run-meta-scope', 'run-meta-prompt'].forEach((id) => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
    const artEl = document.getElementById('run-meta-artifacts'); if (artEl) artEl.innerHTML = '';
    const tCt = document.getElementById('run-tab-trace-ct'); if (tCt) tCt.textContent = '';
    const aCt = document.getElementById('run-tab-artifacts-ct'); if (aCt) aCt.textContent = '';
    const cnt = document.getElementById('run-replay-counter'); if (cnt) cnt.textContent = '— / —';
    const fill = document.getElementById('run-replay-progress-fill'); if (fill) fill.style.width = '0%';
    const ts = document.getElementById('run-replay-ts'); if (ts) ts.textContent = '—';
  },

  renderDetailHeader(run) {
    const hdEl = document.getElementById('run-detail-hd');
    if (!hdEl) return;
    const idShort = run.id ? String(run.id).slice(0, 12) : '—';
    const status = run.status || 'unknown';
    // Toolpack metadata can land under a few keys depending on snapshot
    // vintage. Tolerate all of them, and accept either `[{id, name}]`
    // objects or bare id strings. Empty list → hide the pill entirely
    // rather than displaying a noisy "no toolpack" placeholder.
    const toolpackEntries = run.prompt_snapshot?.toolpacks
      || run.promptSnapshot?.toolpacks
      || run.toolpacks
      || [];
    const toolpackNames = toolpackEntries
      .map((p) => (typeof p === 'string' ? p : (p?.name || p?.id)))
      .filter(Boolean);
    const toolpackPill = toolpackNames.length
      ? `<span class="run-hd-pill kind-cyan" title="Toolpacks: ${this.escapeAttribute(toolpackNames.join(', '))}">${this.escapeHtml(toolpackNames.length === 1 ? toolpackNames[0] : `${toolpackNames.length} toolpacks`)}</span>`
      : '';
    // Profile pill — surfaces the prompt profile name when one was chosen.
    const profileName = run.prompt_snapshot?.profile?.name || run.promptSnapshot?.profile?.name;
    const profilePill = profileName
      ? `<span class="run-hd-pill kind-cyan">profile: ${this.escapeHtml(profileName)}</span>`
      : '';
    // Operator-override badge so the reader sees policy mode at a glance.
    const policyMode = run.prompt_snapshot?.governance?.policyMode || run.promptSnapshot?.governance?.policyMode;
    const overridePill = policyMode === 'operator-override'
      ? `<span class="run-hd-pill kind-policy" title="Operator Override active">⚠ override</span>`
      : '';
    const scopeName = run.scope?.name || null;
    const scopePill = scopeName
      ? `<span class="run-hd-pill kind-policy">scope: ${this.escapeHtml(scopeName)}</span>`
      : `<span class="run-hd-pill kind-policy muted">no scope</span>`;
    const started = run.started_at || '—';
    const ended = run.ended_at || '';
    const duration = this.computeDuration(run);
    const tsLine = ended ? `started ${this.escapeHtml(started)} · ${this.escapeHtml(duration)}` : `started ${this.escapeHtml(started)} · ${this.escapeHtml(duration)} elapsed`;
    const title = run.title || run.goal || 'Run';
    hdEl.innerHTML = `
      <div class="run-hd-row">
        <span class="run-hd-caption">RUN</span>
        <span class="run-hd-id">${this.escapeHtml(idShort)}</span>
        <span class="run-hd-pill status-${this.escapeHtml(status)}">${this.escapeHtml(status)}</span>
        ${toolpackPill}
        ${profilePill}
        ${scopePill}
        ${overridePill}
        <span class="run-hd-ts">${tsLine}</span>
      </div>
      <h2 class="run-hd-title">${this.escapeHtml(title)}</h2>
      <div class="run-hd-actions">
        <button class="btn btn-secondary btn-sm" data-run-action="rerun">↻ Replay</button>
        <button class="btn btn-secondary btn-sm" data-run-action="report">Generate report</button>
        <button class="btn btn-secondary btn-sm" data-run-action="evidence">Evidence bundle</button>
        <button class="btn btn-secondary btn-sm" data-run-action="summary">Executive summary</button>
        <button class="btn btn-secondary btn-sm" data-run-action="local-preview" ${this.hasHtmlArtifact(run) ? '' : 'disabled'}>Local preview</button>
        <button class="btn btn-secondary btn-sm" data-run-action="graph">Open graph</button>
      </div>
    `;
    hdEl.querySelectorAll('[data-run-action]').forEach((button) => {
      button.addEventListener('click', () => this.handleRunAction(run, button.dataset.runAction, button));
    });
  },

  computeDuration(run) {
    if (!run.started_at) return '—';
    const start = new Date(run.started_at);
    const end = run.ended_at ? new Date(run.ended_at) : new Date();
    if (Number.isNaN(start.getTime())) return '—';
    const diffMs = Math.max(0, end.getTime() - start.getTime());
    const m = Math.floor(diffMs / 60000);
    const s = Math.floor((diffMs % 60000) / 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  renderTabCounts(run) {
    // Count the AGGREGATED timeline, not raw events. A streaming reply emits
    // one trace event per token chunk — without aggregation a single chat
    // turn shows 170+ rows in the trace and dwarfs the actually-interesting
    // events (tool calls, policy decisions, artifact creations).
    const aggregated = this.aggregateTraceEvents(run.events || []);
    const traceCt = aggregated.length;
    const artCt = run.replay?.artifactCount ?? (run.artifacts || []).length;
    const msgCt = aggregated.filter((e) => e.type === 'assistant.reply' || e.type === 'tool.call.completed' || e.type === 'tool.call.blocked').length;
    const tCt = document.getElementById('run-tab-trace-ct'); if (tCt) tCt.textContent = String(traceCt);
    const aCt = document.getElementById('run-tab-artifacts-ct'); if (aCt) aCt.textContent = String(artCt);
    const mCt = document.getElementById('run-tab-messages-ct'); if (mCt) mCt.textContent = String(msgCt);
  },

  /**
   * Collapse consecutive `assistant.chunk` and `assistant.thinking` events
   * into a single synthetic event with the concatenated text. The raw event
   * stream is what the executor emits per SSE token — useful for forensics
   * but unreadable as a timeline (170+ rows per chat turn). We keep the
   * original seq range so replay scrubbing still works.
   */
  aggregateTraceEvents(events) {
    const out = [];
    let buffer = null;
    const aggregable = new Set(['assistant.chunk', 'assistant.thinking']);
    const syntheticType = { 'assistant.chunk': 'assistant.reply', 'assistant.thinking': 'assistant.thought' };

    const flush = () => {
      if (!buffer) return;
      out.push(buffer);
      buffer = null;
    };

    for (const event of events) {
      if (aggregable.has(event.type)) {
        if (buffer && buffer._sourceType === event.type) {
          buffer.output_preview = (buffer.output_preview || '') + (event.output_preview || '');
          buffer.seqEnd = event.seq;
          buffer._count += 1;
          continue;
        }
        flush();
        buffer = {
          id: event.id,
          seq: event.seq,
          seqEnd: event.seq,
          type: syntheticType[event.type],
          _sourceType: event.type,
          _count: 1,
          phase: event.phase,
          status: 'completed',
          output_preview: event.output_preview || '',
          created_at: event.created_at,
        };
        continue;
      }
      flush();
      out.push(event);
    }
    flush();
    return out;
  },

  renderTraceTimeline(run) {
    const el = document.getElementById('run-trace-timeline');
    if (!el) return;
    const events = this.aggregateTraceEvents(run.events || []);
    el.innerHTML = events.map((event, idx) => this.renderEvent(event, idx)).join('') || '<div class="empty-msg">No events recorded.</div>';
  },

  renderGraphPreview(run) {
    const el = document.getElementById('run-graph-preview');
    if (!el) return;
    const nodes = run.graph?.nodes?.length ?? 0;
    const edges = run.graph?.edges?.length ?? 0;
    el.innerHTML = `
      <div>${nodes} nodes · ${edges} edges</div>
      <a href="#" data-run-graph-link>Open in Graph →</a>
    `;
    el.querySelector('[data-run-graph-link]')?.addEventListener('click', (event) => {
      event.preventDefault();
      this.handleRunAction(run, 'graph', null);
    });
  },

  renderArtifactGrid(run) {
    const el = document.getElementById('run-artifact-grid');
    if (!el) return;
    const artifacts = run.artifacts || [];
    if (!artifacts.length) { el.innerHTML = '<div class="empty-msg">No artifacts captured for this run yet.</div>'; return; }
    el.innerHTML = artifacts.map((a) => `
      <a class="artifact-chip" href="${this.escapeAttribute(a.contentUrl || '#')}" target="_blank" rel="noopener">
        <span>${this.escapeHtml(a.type || 'artifact')}</span>
        <strong>${this.escapeHtml(a.title || a.id)}</strong>
      </a>
    `).join('');
  },

  // Pulses the Synthesis tab when a new run terminates so the operator
  // notices "ok, you have a fresh card to look at" without disrupting
  // whatever they were doing on another tab.
  flashSynthesisTab() {
    const btn = document.querySelector('#run-tabs .run-tab[data-tab="synthesis"]');
    if (!btn) return;
    btn.classList.remove('flash-ping');
    // Force a reflow so the class can be re-added and the animation restarts.
    // eslint-disable-next-line no-unused-expressions
    btn.offsetWidth;
    btn.classList.add('flash-ping');
    setTimeout(() => btn.classList.remove('flash-ping'), 2200);
  },

  // Synthesis tab — fetches the canonical end-of-run summary and hands it
  // to the shared renderer. Each next-step action routes back through
  // handleRunAction so the buttons reuse existing Rerun/Report/etc. plumbing.
  async loadSynthesis(runId) {
    const host = document.getElementById('run-synthesis');
    if (!host || !window.SynthesisCard) return;
    host.innerHTML = '<div class="empty-msg">Building synthesis…</div>';
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/synthesis`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const synthesis = await res.json();
      window.SynthesisCard.render(host, synthesis, {
        onAction: (action) => this.handleSynthesisAction(action),
      });
    } catch (err) {
      host.innerHTML = `<div class="empty-msg danger">Failed to build synthesis: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  handleSynthesisAction(action) {
    const run = this.currentRun;
    if (!run || !action) return;
    if (action === 'rerun')             return this.handleRunAction(run, 'rerun',   this.synthesisActionBtn(action));
    if (action === 'summary')           return this.handleRunAction(run, 'summary', this.synthesisActionBtn(action));
    if (action === 'review-trace')      return this.setActiveTab('trace');
    if (action === 'review-approvals')  { window.Router?.navigate?.('approvals'); return; }
    if (action === 'review-findings')   { window.Router?.navigate?.('alerts');    return; }
    if (action === 'edit-scope')        { window.Router?.navigate?.('scope');     return; }
  },

  // Lookup helper so synthesis actions can borrow the existing
  // button-with-spinner pattern used in renderDetailHeader.
  synthesisActionBtn(action) {
    return document.querySelector(`#run-detail-hd [data-run-action="${action}"]`) || null;
  },

  renderSnapshot(run) {
    const el = document.getElementById('run-snapshot');
    if (!el) return;
    try {
      const snap = run.prompt_snapshot || run.promptSnapshot || {};
      el.textContent = JSON.stringify(snap, null, 2);
    } catch {
      el.textContent = 'Snapshot unavailable.';
    }
  },

  renderOutput(run) {
    const el = document.getElementById('run-output');
    if (!el) return;
    const events = run.events || [];
    // Compose the final assistant reply from chunks. The previous code
    // searched for `message.assistant` / `assistant.message` event types
    // that never exist — chunks are emitted as `assistant.chunk`. Result:
    // the Output tab always fell through to the bare stats summary even
    // when the agent had said a full paragraph.
    const replyText = events
      .filter((e) => e.type === 'assistant.chunk')
      .map((e) => e.output_preview || '')
      .join('');
    const thinkingText = events
      .filter((e) => e.type === 'assistant.thinking')
      .map((e) => e.output_preview || '')
      .join('');

    if (replyText || thinkingText) {
      const blocks = [];
      if (thinkingText) {
        blocks.push(`<details class="run-output-thinking"><summary>🧠 Thinking · ${thinkingText.length} chars</summary><pre>${this.escapeHtml(thinkingText)}</pre></details>`);
      }
      if (replyText && window.renderMarkdown) {
        blocks.push(`<div class="run-output-reply">${window.renderMarkdown(replyText)}</div>`);
      } else if (replyText) {
        blocks.push(`<pre class="run-output-reply">${this.escapeHtml(replyText)}</pre>`);
      }
      el.innerHTML = blocks.join('');
      return;
    }
    const replay = run.replay || {};
    el.textContent = `events: ${replay.eventCount ?? events.length}\nartifacts: ${replay.artifactCount ?? (run.artifacts || []).length}\ntool calls: ${replay.toolCalls?.length ?? 0}\nblocked: ${replay.blockedActions ?? 0}`;
  },

  /**
   * Reconstruct the user → assistant → tool conversation from trace events
   * and render it chat-style. Operators looking at a run typically want
   * "what did the agent actually say and do?" — the raw trace stream
   * doesn't answer that; this tab does.
   */
  renderMessages(run) {
    const el = document.getElementById('run-messages');
    if (!el) return;
    const events = run.events || [];
    if (!events.length) { el.innerHTML = '<div class="empty-msg">No events recorded for this run.</div>'; return; }

    const turns = this.reconstructTurns(run, events);
    if (!turns.length) { el.innerHTML = '<div class="empty-msg">No assistant turns reconstructable from this run.</div>'; return; }

    el.innerHTML = turns.map((turn) => this.renderTurn(turn)).join('');
  },

  /**
   * Walk the (already-aggregated) events and produce chat-style "turns".
   * A turn is one of: user (the run goal), thinking, assistant, or tool.
   */
  reconstructTurns(run, rawEvents) {
    const events = this.aggregateTraceEvents(rawEvents);
    const turns = [];

    // The run's goal is the user's prompt — surface it as the opening
    // message so the reader has the question they're seeing answered.
    if (run.goal || run.title) {
      turns.push({ kind: 'user', text: run.goal || run.title });
    }

    // Track open tool calls so we can pair started → completed with their
    // input/output. metadata.toolCallId is the join key.
    const openTools = new Map();
    for (const event of events) {
      if (event.type === 'assistant.thought') {
        turns.push({ kind: 'thinking', text: event.output_preview || '' });
      } else if (event.type === 'assistant.reply') {
        turns.push({ kind: 'assistant', text: event.output_preview || '' });
      } else if (event.type === 'tool.call.started') {
        openTools.set(event.metadata?.toolCallId || event.id, {
          name: event.tool_name,
          input: event.input,
          startedAt: event.created_at,
        });
      } else if (event.type === 'tool.call.completed' || event.type === 'tool.call.failed') {
        const key = event.metadata?.toolCallId || event.id;
        const open = openTools.get(key) || { name: event.tool_name };
        openTools.delete(key);
        turns.push({
          kind: 'tool',
          name: event.tool_name || open.name,
          input: open.input,
          output: event.output_preview || '',
          failed: event.type === 'tool.call.failed' || event.status === 'failed',
        });
      } else if (event.type === 'tool.call.blocked') {
        turns.push({
          kind: 'tool',
          name: event.tool_name,
          input: event.input,
          output: event.output_preview || event.metadata?.decision?.reason || 'Blocked by policy',
          blocked: true,
        });
      }
    }
    return turns;
  },

  renderTurn(turn) {
    if (turn.kind === 'user') {
      return `<div class="run-msg run-msg-user"><div class="run-msg-label">USER</div><div class="run-msg-body">${this.escapeHtml(turn.text)}</div></div>`;
    }
    if (turn.kind === 'thinking') {
      return `<details class="run-msg run-msg-thinking"><summary>🧠 Thinking · ${turn.text.length} chars</summary><pre>${this.escapeHtml(turn.text)}</pre></details>`;
    }
    if (turn.kind === 'assistant') {
      const md = window.renderMarkdown ? window.renderMarkdown(turn.text) : `<pre>${this.escapeHtml(turn.text)}</pre>`;
      return `<div class="run-msg run-msg-assistant"><div class="run-msg-label">PHANTOM</div><div class="run-msg-body markdown-body">${md}</div></div>`;
    }
    if (turn.kind === 'tool') {
      const args = turn.input ? `<pre class="run-msg-tool-args">${this.escapeHtml(JSON.stringify(turn.input, null, 2))}</pre>` : '';
      const stateClass = turn.blocked ? 'blocked' : turn.failed ? 'failed' : 'done';
      const stateLabel = turn.blocked ? '🛡 BLOCKED' : turn.failed ? '✗ FAILED' : '✓ TOOL';
      return `<details class="run-msg run-msg-tool ${stateClass}">
        <summary><span class="run-msg-tool-state">${stateLabel}</span> <strong>${this.escapeHtml(turn.name || 'tool')}</strong></summary>
        ${args}
        <pre class="run-msg-tool-output">${this.escapeHtml(turn.output || '')}</pre>
      </details>`;
    }
    return '';
  },

  renderMetaDrawer(run) {
    const runEl = document.getElementById('run-meta-run');
    const scopeEl = document.getElementById('run-meta-scope');
    const promptEl = document.getElementById('run-meta-prompt');
    const artEl = document.getElementById('run-meta-artifacts');

    if (runEl) {
      runEl.innerHTML = this.kvRows([
        ['id', `<span class="mono">${this.escapeHtml(run.id || '—')}</span>`],
        ['status', this.escapeHtml(run.status || '—')],
        ['started', this.escapeHtml(run.started_at || '—')],
        ['ended', this.escapeHtml(run.ended_at || '—')],
        ['duration', this.escapeHtml(this.computeDuration(run))],
        ['model', this.escapeHtml(run.model || '—')],
        ['route', this.escapeHtml(run.provider_route || '—')],
      ]);
    }

    if (scopeEl) {
      const scope = run.scope || {};
      const targets = Array.isArray(scope.targets) ? scope.targets : (scope.targets ? String(scope.targets).split(',').map((t) => t.trim()) : []);
      const allows = Array.isArray(scope.allows) ? scope.allows : (Array.isArray(scope.allow) ? scope.allow : []);
      const blocks = Array.isArray(scope.blocks) ? scope.blocks : (Array.isArray(scope.block) ? scope.block : (Array.isArray(scope.denies) ? scope.denies : []));
      const expires = scope.expires_at || scope.expiresAt || scope.expires || '—';
      const targetsHtml = targets.length ? `<ul>${targets.map((t) => `<li>${this.escapeHtml(t)}</li>`).join('')}</ul>` : '—';
      const allowsHtml = allows.length ? allows.map((a) => `<span class="allow">${this.escapeHtml(a)}</span>`).join(' · ') : '—';
      const blocksHtml = blocks.length ? blocks.map((b) => `<span class="block">${this.escapeHtml(b)}</span>`).join(' · ') : '—';
      scopeEl.innerHTML = this.kvRows([
        ['name', this.escapeHtml(scope.name || '—')],
        ['targets', targetsHtml],
        ['allows', allowsHtml],
        ['blocks', blocksHtml],
        ['expires', this.escapeHtml(expires)],
      ]);
    }

    if (promptEl) {
      const ps = run.prompt_snapshot || run.promptSnapshot || {};
      const profileName = ps.profile?.name || ps.profileName || 'Default';
      const fragments = ps.fragments || ps.profile?.fragments || [];
      const fragLabel = Array.isArray(fragments) ? `${fragments.length} fragment${fragments.length === 1 ? '' : 's'}` : String(fragments);
      const redactionApplied = ps.redaction?.applied ?? ps.redactionApplied ?? true;
      const redactionHtml = redactionApplied ? '<span class="allow">applied</span>' : '<span class="block">not applied</span>';
      promptEl.innerHTML = this.kvRows([
        ['profile', this.escapeHtml(profileName)],
        ['fragments', this.escapeHtml(fragLabel)],
        ['redaction', redactionHtml],
      ]);
    }

    if (artEl) {
      const artifacts = run.artifacts || [];
      if (!artifacts.length) { artEl.innerHTML = '<li class="empty-msg">No artifacts</li>'; }
      else {
        artEl.innerHTML = artifacts.map((a) => `
          <li>
            <a href="${this.escapeAttribute(a.contentUrl || '#')}" target="_blank" rel="noopener">${this.escapeHtml(a.title || a.id)}</a>
            <span class="art-size">${this.escapeHtml(a.type || '')}</span>
          </li>
        `).join('');
      }
    }
  },

  kvRows(rows) {
    return rows.map(([k, v]) => `<dt>${this.escapeHtml(k)}</dt><dd>${v}</dd>`).join('');
  },

  setupReplay(run) {
    this.replayStopTimer();
    const events = run.events || [];
    const blockedIndex = events.findIndex((e) => e.type === 'tool.call.blocked' || e.type === 'scope.blocked' || e.status === 'blocked');
    this.replay.events = events;
    this.replay.total = events.length;
    this.replay.index = 0;
    this.replay.blockedIndex = blockedIndex;
    this.replay.playing = false;

    const blockedMark = document.getElementById('run-replay-blocked-mark');
    if (blockedMark) {
      if (blockedIndex >= 0 && events.length > 0) {
        const pct = (blockedIndex / Math.max(events.length - 1, 1)) * 100;
        blockedMark.style.left = `${pct}%`;
        blockedMark.removeAttribute('hidden');
      } else {
        blockedMark.setAttribute('hidden', '');
      }
    }
    this.updateReplayUI();

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && events.length > 0) {
      // auto-show first event highlighted but do not auto-play
    }
    const playBtn = document.getElementById('run-replay-play-btn');
    if (playBtn) playBtn.textContent = '▶';
  },

  replayToggle() {
    if (!this.replay.total) return;
    if (this.replay.playing) {
      this.replayStopTimer();
      this.replay.playing = false;
      const btn = document.getElementById('run-replay-play-btn'); if (btn) btn.textContent = '▶';
      return;
    }
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { this.replayStep(); return; }
    this.replay.playing = true;
    const btn = document.getElementById('run-replay-play-btn'); if (btn) btn.textContent = '⏸';
    if (this.replay.index >= this.replay.total) this.replay.index = 0;
    this.replay.timer = setInterval(() => {
      this.replay.index += 1;
      this.updateReplayUI();
      if (this.replay.index >= this.replay.total) {
        this.replayStopTimer();
        this.replay.playing = false;
        const b = document.getElementById('run-replay-play-btn'); if (b) b.textContent = '▶';
      }
    }, 600);
  },

  replayStep() {
    if (!this.replay.total) return;
    if (this.replay.index < this.replay.total) this.replay.index += 1;
    this.updateReplayUI();
  },

  replayReset() {
    this.replayStopTimer();
    this.replay.playing = false;
    this.replay.index = 0;
    const btn = document.getElementById('run-replay-play-btn'); if (btn) btn.textContent = '▶';
    this.updateReplayUI();
  },

  replayStopTimer() {
    if (this.replay.timer) { clearInterval(this.replay.timer); this.replay.timer = null; }
  },

  updateReplayUI() {
    const total = this.replay.total;
    const idx = Math.min(this.replay.index, total);
    const cnt = document.getElementById('run-replay-counter');
    if (cnt) cnt.textContent = total ? `${String(idx).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : '— / —';
    const fill = document.getElementById('run-replay-progress-fill');
    if (fill) fill.style.width = total ? `${(idx / total) * 100}%` : '0%';
    const ts = document.getElementById('run-replay-ts');
    const evt = this.replay.events[Math.max(0, idx - 1)];
    if (ts) ts.textContent = evt?.created_at || evt?.timestamp || evt?.ts || '—';

    // highlight current event row
    document.querySelectorAll('#run-trace-timeline .trace-event').forEach((el, i) => {
      el.classList.toggle('replay-current', i === idx - 1);
    });
    const active = document.querySelector('#run-trace-timeline .trace-event.replay-current');
    if (active && typeof active.scrollIntoView === 'function') {
      try { active.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* noop */ }
    }
  },

  policyModeLabel(governance = {}) {
    if (governance?.policyMode === 'operator-override') {
      const reason = governance.operatorOverride?.reason ? ` · ${governance.operatorOverride.reason}` : '';
      return `Operator Override${reason}`;
    }
    return 'Governed';
  },

  renderReplaySummary(replay) {
    if (!replay) return '<div class="empty-msg">Replay metadata unavailable.</div>';
    const pillClass = replay.complete ? 'completed' : 'failed';
    return `
      <div class="replay-card">
        <span class="run-pill ${pillClass}">${replay.complete ? 'Replay complete' : 'Replay incomplete'}</span>
        <div><strong>${this.escapeHtml(replay.eventCount)}</strong><span>events</span></div>
        <div><strong>${this.escapeHtml(replay.artifactCount)}</strong><span>artifacts</span></div>
        <div><strong>${this.escapeHtml(replay.toolCalls?.length || 0)}</strong><span>tool calls</span></div>
        <div><strong>${this.escapeHtml(replay.blockedActions || 0)}</strong><span>blocked</span></div>
      </div>
      ${replay.incompleteToolCalls ? `<div class="empty-msg danger">${this.escapeHtml(replay.incompleteToolCalls)} tool call(s) are missing terminal trace events.</div>` : ''}
    `;
  },

  renderEvent(event, index) {
    const preview = event.output_preview || event.outputPreview || event.tool_name || '';
    const isBlocked = event.type === 'tool.call.blocked' || event.type === 'scope.blocked';
    const isAggregateReply = event.type === 'assistant.reply' || event.type === 'assistant.thought';
    const isToolCallStarted = (event.type === 'tool.call' || event.type === 'tool_call')
      && event.status === 'started';
    const engagingAnim = isToolCallStarted
      ? `<span class="trace-event-anim">${window.StateIcons?.engaging?.(24) || ''}</span>`
      : '';
    const dataIdx = typeof index === 'number' ? ` data-event-idx="${index}"` : '';

    // Aggregated chunk events get a compact "Assistant reply · N chunks · M chars"
    // header so the trace tab stays scannable. Click to expand the full text.
    if (isAggregateReply) {
      const chunkCount = event._count || 1;
      const seqLabel = event.seqEnd && event.seqEnd !== event.seq ? `#${event.seq}–${event.seqEnd}` : `#${event.seq}`;
      const isThought = event.type === 'assistant.thought';
      const cls = isThought ? 'aggregated thought' : 'aggregated reply';
      const label = isThought ? '🧠 Thinking' : '💬 Assistant reply';
      return `
        <details class="trace-event completed ${cls}"${dataIdx}>
          <summary>
            <span class="trace-event-dot"></span>
            <span>${seqLabel}</span>
            <strong>${label}</strong>
            <small>${chunkCount} chunks · ${preview.length} chars</small>
          </summary>
          <pre>${this.escapeHtml(preview)}</pre>
        </details>
      `;
    }

    return `
      <div class="trace-event ${this.escapeHtml(isBlocked ? 'failed' : (event.status || ''))}"${dataIdx}>
        <div class="trace-event-dot"></div>
        <div class="trace-event-body">
          <div class="trace-event-title">
            ${engagingAnim}<span>#${event.seq}</span>
            <strong>${isBlocked ? '🛡️ ' : ''}${this.escapeHtml(event.type)}</strong>
            ${event.tool_name ? `<em>${this.escapeHtml(event.tool_name)}</em>` : ''}
          </div>
          ${preview ? `<pre>${this.escapeHtml(preview)}</pre>` : ''}
          ${event.metadata?.decision ? `<small class="policy-note">Risk: ${this.escapeHtml(event.metadata.risk || event.metadata.decision.risk || 'unknown')} · ${this.escapeHtml(event.metadata.decision.reason || 'policy decision')}</small>` : ''}
          ${event.type === 'tool.call.override' ? `<small class="policy-note">Operator Override · ${this.escapeHtml(event.metadata?.operatorOverride?.reason || 'test run')}</small>` : ''}
        </div>
      </div>
    `;
  },

  renderRunArtifacts(artifacts) {
    if (!artifacts.length) return '<div class="empty-msg">No artifacts captured for this run yet.</div>';
    return `<div class="run-artifact-chips">
      ${artifacts.map(artifact => `
        <a class="artifact-chip" href="${this.escapeAttribute(artifact.contentUrl)}" target="_blank" rel="noopener">
          <span>${this.escapeHtml(artifact.type || 'artifact')}</span>
          <strong>${this.escapeHtml(artifact.title || artifact.id)}</strong>
        </a>
      `).join('')}
    </div>`;
  },

  hasHtmlArtifact(run) {
    return (run.artifacts || []).some(artifact => artifact.type === 'html' && artifact.contentUrl);
  },

  async handleRunAction(run, action, button) {
    if (action === 'graph') {
      if (window.GraphPage) window.GraphPage.selectedRunId = run.id;
      window.Router?.navigate?.('graph');
      window.GraphPage?.loadGraph?.(run.id);
      return;
    }

    if (action === 'local-preview') {
      const artifact = (run.artifacts || []).find(item => item.type === 'html' && item.contentUrl);
      if (artifact) window.showPreview?.('', artifact.title || 'Preview', artifact);
      return;
    }

    if (action === 'rerun') {
      if (!button) return;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Creating rerun…';
      try {
        const templateRes = await fetch('/api/run-templates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceRunId: run.id, name: `Rerun ${run.title || run.id}` }),
        });
        if (!templateRes.ok) throw new Error(`HTTP ${templateRes.status}`);
        const template = await templateRes.json();
        const runRes = await fetch(`/api/run-templates/${encodeURIComponent(template.id)}/runs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: run.conversation_id, title: `After mitigation: ${run.title || 'rerun'}` }),
        });
        if (!runRes.ok) throw new Error(`HTTP ${runRes.status}`);
        const rerun = await runRes.json();
        await this.loadRuns(rerun.id);
      } catch (err) {
        button.textContent = `Failed: ${err.message}`;
        setTimeout(() => { button.textContent = original; button.disabled = false; }, 1800);
        return;
      }
      button.textContent = original;
      button.disabled = false;
      return;
    }

    const endpoints = {
      report: 'report',
      summary: 'summary',
      evidence: 'evidence',
    };
    const endpoint = endpoints[action];
    if (!endpoint || !button) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/artifacts/${endpoint}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const artifact = await res.json();
      window.dispatchEvent(new CustomEvent('phantom:artifact', { detail: { artifact, runId: run.id, conversationId: run.conversation_id } }));
      await this.selectRun(run.id);
      window.ArtifactsPage?.loadArtifacts?.(artifact.id);
    } catch (err) {
      button.textContent = `Failed: ${err.message}`;
      setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 1800);
      return;
    }
    button.textContent = original;
    button.disabled = false;
  },

  escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  },

  escapeAttribute(value) {
    return this.escapeHtml(value).replace(/"/g, '&quot;');
  },
};
