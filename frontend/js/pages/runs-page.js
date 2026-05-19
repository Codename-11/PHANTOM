window.RunsPage = {
  runs: [],
  selectedRunId: null,
  currentRun: null,
  activeTab: 'trace',
  replay: {
    timer: null,
    playing: false,
    index: 0,
    total: 0,
    blockedIndex: -1,
    events: [],
  },

  init() {
    document.getElementById('refresh-runs-btn')?.addEventListener('click', () => this.loadRuns());
    window.addEventListener('phantom:route', (event) => {
      if (event.detail?.route === 'runs') this.loadRuns();
    });
    window.addEventListener('phantom:trace', (event) => {
      const runId = event.detail?.runId;
      if (runId && (window.Router?.current === 'runs')) this.loadRuns(runId);
    });
    this.bindStaticControls();
    if (window.Router?.current === 'runs') setTimeout(() => this.loadRuns(this.selectedRunId), 0);
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
  },

  async loadRuns(selectRunId = this.selectedRunId) {
    const list = document.getElementById('runs-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-msg">Loading runs…</div>';
    try {
      const res = await fetch('/api/runs?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.runs = await res.json();
      this.renderRunsList();
      const runToSelect = selectRunId || this.runs[0]?.id;
      if (runToSelect) await this.selectRun(runToSelect);
      else this.renderEmptyDetail();
    } catch (err) {
      list.innerHTML = `<div class="empty-msg danger">Failed to load runs: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderRunsList() {
    const list = document.getElementById('runs-list');
    if (!this.runs.length) {
      list.innerHTML = '<div class="empty-msg">No runs yet. Send a chat message to create one.</div>';
      return;
    }
    list.innerHTML = '';
    this.runs.forEach((run) => {
      const item = document.createElement('button');
      item.className = `run-list-item${run.id === this.selectedRunId ? ' active' : ''}`;
      item.innerHTML = `
        <span class="run-status ${this.escapeHtml(run.status)}"></span>
        <span class="run-list-body">
          <strong>${this.escapeHtml(run.title || run.goal || 'Untitled Run')}</strong>
          <small>${this.escapeHtml(run.model || 'model unknown')} · ${this.escapeHtml(run.scope?.name || 'no scope')} · ${this.escapeHtml(run.started_at || '')}</small>
        </span>
      `;
      item.addEventListener('click', () => this.selectRun(run.id));
      list.appendChild(item);
    });
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
      this.renderTraceTimeline(run);
      this.renderGraphPreview(run);
      this.renderArtifactGrid(run);
      this.renderSnapshot(run);
      this.renderOutput(run);
      this.renderMetaDrawer(run);
      this.setupReplay(run);
      this.setActiveTab(this.activeTab || 'trace');
    } catch (err) {
      if (traceEl) traceEl.innerHTML = `<div class="empty-msg danger">Failed to load run: ${this.escapeHtml(err.message)}</div>`;
    }
  },

  renderEmptyDetail() {
    this.currentRun = null;
    const traceEl = document.getElementById('run-trace-timeline');
    if (traceEl) traceEl.innerHTML = '<div class="empty-msg">Select a run to inspect the trace timeline.</div>';
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
    const toolpack = (run.prompt_snapshot?.toolpacks || []).map((p) => p.name).join(', ') || 'no toolpack';
    const scopeName = run.scope?.name || 'no scope';
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
        <span class="run-hd-pill kind-cyan">${this.escapeHtml(toolpack)}</span>
        <span class="run-hd-pill kind-policy">scope: ${this.escapeHtml(scopeName)}</span>
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
    const traceCt = run.replay?.eventCount ?? (run.events || []).length;
    const artCt = run.replay?.artifactCount ?? (run.artifacts || []).length;
    const tCt = document.getElementById('run-tab-trace-ct'); if (tCt) tCt.textContent = String(traceCt);
    const aCt = document.getElementById('run-tab-artifacts-ct'); if (aCt) aCt.textContent = String(artCt);
  },

  renderTraceTimeline(run) {
    const el = document.getElementById('run-trace-timeline');
    if (!el) return;
    const events = run.events || [];
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
    const lastAssistant = [...events].reverse().find((e) => e.type === 'message.assistant' || e.type === 'assistant.message' || (e.role === 'assistant' && e.content));
    if (lastAssistant) {
      el.textContent = lastAssistant.content || lastAssistant.output_preview || lastAssistant.outputPreview || JSON.stringify(lastAssistant, null, 2);
      return;
    }
    const replay = run.replay || {};
    el.textContent = `events: ${replay.eventCount ?? events.length}\nartifacts: ${replay.artifactCount ?? (run.artifacts || []).length}\ntool calls: ${replay.toolCalls?.length ?? 0}\nblocked: ${replay.blockedActions ?? 0}`;
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
    const isToolCallStarted = (event.type === 'tool.call' || event.type === 'tool_call')
      && event.status === 'started';
    const engagingAnim = isToolCallStarted
      ? `<span class="trace-event-anim">${window.StateIcons?.engaging?.(24) || ''}</span>`
      : '';
    const dataIdx = typeof index === 'number' ? ` data-event-idx="${index}"` : '';
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
