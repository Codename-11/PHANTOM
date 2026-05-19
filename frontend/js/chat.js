/**
 * Chat rendering and interaction logic
 * Enhanced with:
 *  - Real-time typing animation (character by character)
 *  - AI thinking/reasoning display (shown before the answer)
 *  - FIXED: Auto-scroll now works correctly during streaming
 *  - Image message support (OSINT)
 */
window.Chat = {
  messagesEl: null,
  currentAssistantEl: null,
  currentContent: '',
  renderedContent: '',
  isStreaming: false,
  // Typing animation state
  typingQueue: [],
  typingTimer: null,
  typingSpeed: 22, // ms per character — slightly slower for visible effect
  // Thinking state
  currentThinkingEl: null,
  thinkingContent: '',
  // Auto-scroll control: user can scroll up to pause, near-bottom = resume
  _userScrolled: false,

  init() {
    this.messagesEl = document.getElementById('messages');
    this._chatArea = document.getElementById('chat-area');

    // Detect when user manually scrolls up (pause auto-scroll)
    this._chatArea.addEventListener('scroll', () => {
      const threshold = 80;
      const distFromBottom = this._chatArea.scrollHeight - this._chatArea.scrollTop - this._chatArea.clientHeight;
      this._userScrolled = distFromBottom > threshold;
    });

  },

  clear() {
    this.messagesEl.innerHTML = '';
    this.currentAssistantEl = null;
    this.currentContent = '';
    this.renderedContent = '';
    this.currentThinkingEl = null;
    this.thinkingContent = '';
    this.typingQueue = [];
    this._userScrolled = false;
    if (this.typingTimer) {
      cancelAnimationFrame(this.typingTimer);
      this.typingTimer = null;
    }
  },

  showWelcome() {
    document.getElementById('welcome-screen').style.display = 'flex';
    this.messagesEl.style.display = 'none';
  },

  hideWelcome() {
    document.getElementById('welcome-screen').style.display = 'none';
    this.messagesEl.style.display = 'flex';
  },

  addUserMessage(content, imageDataUrl) {
    this.hideWelcome();
    this._userScrolled = false; // reset on new user message
    const el = document.createElement('div');
    el.className = 'message user';
    if (imageDataUrl) {
      const img = document.createElement('img');
      img.src = imageDataUrl;
      img.className = 'msg-image';
      img.alt = 'Uploaded image';
      el.appendChild(img);
      if (content) {
        const textEl = document.createElement('div');
        textEl.textContent = content;
        textEl.style.marginTop = '8px';
        el.appendChild(textEl);
      }
    } else {
      el.textContent = content;
    }
    this.messagesEl.appendChild(el);
    this.scrollToBottom(true);
  },

  /**
   * Show AI thinking/reasoning text — displayed BEFORE the answer
   */
  addThinkingChunk(text) {
    this.hideWelcome();

    if (!this.currentThinkingEl) {
      this.currentThinkingEl = document.createElement('div');
      this.currentThinkingEl.className = 'message thinking';

      const label = document.createElement('span');
      label.className = 'thinking-label';
      label.textContent = '🧠 Thinking...';
      this.currentThinkingEl.appendChild(label);

      const contentEl = document.createElement('div');
      contentEl.className = 'thinking-content';
      this.currentThinkingEl.appendChild(contentEl);

      this.messagesEl.appendChild(this.currentThinkingEl);
      this.thinkingContent = '';
    }

    this.thinkingContent += text;
    const contentEl = this.currentThinkingEl.querySelector('.thinking-content');
    if (contentEl) {
      contentEl.textContent = this.thinkingContent;
      // Auto-scroll the thinking content box itself
      contentEl.scrollTop = contentEl.scrollHeight;
    }
    this.scrollToBottom();
  },

  /**
   * End thinking — fade it slightly, update label
   */
  endThinking() {
    if (this.currentThinkingEl) {
      this.currentThinkingEl.classList.add('thinking-done');
      const label = this.currentThinkingEl.querySelector('.thinking-label');
      if (label) label.textContent = '🧠 Thought process';
    }
    this.currentThinkingEl = null;
    this.thinkingContent = '';
  },

  startAssistantMessage() {
    this.hideWelcome();

    // End any thinking block (thinking already shown above)
    this.endThinking();

    this.currentContent = '';
    this.renderedContent = '';
    this.typingQueue = [];
    this.currentAssistantEl = document.createElement('div');
    this.currentAssistantEl.className = 'message assistant';

    // Add typing indicator dots
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    this.currentAssistantEl.appendChild(typing);

    this.messagesEl.appendChild(this.currentAssistantEl);
    this.isStreaming = true;
    this.scrollToBottom(true);

    // Start the typing animation loop
    this._startTypingLoop();
  },

  appendChunk(text) {
    if (!this.currentAssistantEl) {
      this.startAssistantMessage();
    }

    // Remove typing indicator dots on first chunk
    const typing = this.currentAssistantEl.querySelector('.typing-indicator');
    if (typing) typing.remove();

    // Add text to full content buffer
    this.currentContent += text;

    // Queue only the NEW characters for typing animation
    for (const char of text) {
      this.typingQueue.push(char);
    }
  },

  /**
   * Typing animation loop — renders characters gradually, not all at once
   * FIXED: scrollToBottom now called after every render to keep up
   */
  _startTypingLoop() {
    let lastTime = 0;

    const animate = (timestamp) => {
      if (!this.isStreaming && this.typingQueue.length === 0) {
        return; // Stop the loop
      }

      if (this.typingQueue.length > 0) {
        const elapsed = timestamp - lastTime;

        // Adaptive speed: speed up when queue grows to prevent lag
        let speed = this.typingSpeed;
        if (this.typingQueue.length > 200) speed = 1;
        else if (this.typingQueue.length > 100) speed = 3;
        else if (this.typingQueue.length > 50) speed = 6;
        else if (this.typingQueue.length > 20) speed = 8;

        if (elapsed >= speed) {
          // Batch size also adapts to prevent falling behind
          const batchSize = Math.min(
            this.typingQueue.length,
            this.typingQueue.length > 200 ? 30 :
            this.typingQueue.length > 100 ? 15 :
            this.typingQueue.length > 50 ? 8 :
            this.typingQueue.length > 20 ? 4 : 2
          );

          for (let i = 0; i < batchSize; i++) {
            if (this.typingQueue.length > 0) {
              this.renderedContent += this.typingQueue.shift();
            }
          }

          // Re-render markdown with what we've typed so far
          if (this.currentAssistantEl) {
            this.currentAssistantEl.innerHTML = window.renderMarkdown(this.renderedContent);
          }

          // FIXED: Force scroll to bottom after each render frame
          this.scrollToBottom();
          lastTime = timestamp;
        }
      }

      this.typingTimer = requestAnimationFrame(animate);
    };

    this.typingTimer = requestAnimationFrame(animate);
  },

  endAssistantMessage() {
    if (this.currentAssistantEl) {
      // Remove any remaining typing indicator
      const typing = this.currentAssistantEl.querySelector('.typing-indicator');
      if (typing) typing.remove();

      // Flush any remaining queued characters
      if (this.typingQueue.length > 0) {
        this.renderedContent += this.typingQueue.join('');
        this.typingQueue = [];
      }

      // Final full render
      if (this.renderedContent || this.currentContent) {
        this.currentAssistantEl.innerHTML = window.renderMarkdown(this.renderedContent || this.currentContent);
      }
    }

    if (this.typingTimer) {
      cancelAnimationFrame(this.typingTimer);
      this.typingTimer = null;
    }

    this.currentAssistantEl = null;
    this.currentContent = '';
    this.renderedContent = '';
    this.isStreaming = false;
    this._userScrolled = false;

    // End thinking too
    this.endThinking();
    // Final scroll to bottom
    this.scrollToBottom(true);
  },

  addToolCall(data) {
    this.hideWelcome();
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.id = `tool-${data.id}`;

    const argsPreview = typeof data.args === 'object'
      ? (data.args.command || data.args.path || data.args.query || data.args.name || data.args.url || JSON.stringify(data.args).substring(0, 80))
      : '';

    card.innerHTML = `
      <div class="tool-card-header" onclick="this.nextElementSibling.classList.toggle('expanded')">
        <span>⚡ ${data.name}</span>
        <span style="flex:1;margin-left:8px;opacity:0.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(argsPreview)}</span>
        <span class="tool-status running"><span class="spinner"></span></span>
      </div>
      <div class="tool-card-body expanded"></div>
    `;

    this.messagesEl.appendChild(card);
    this.scrollToBottom(true);
  },

  /**
   * Live tool output — stream text into the tool card body in real-time
   */
  updateToolProgress(data) {
    const card = document.getElementById(`tool-${data.id}`);
    if (card) {
      const body = card.querySelector('.tool-card-body');
      if (body) {
        body.textContent += data.text;
        body.classList.add('expanded');
        // Auto-scroll the body to bottom
        body.scrollTop = body.scrollHeight;
      }
    }
    this.scrollToBottom();
  },

  addToolResult(data) {
    const card = document.getElementById(`tool-${data.id}`);
    if (card) {
      const status = card.querySelector('.tool-status');
      status.className = 'tool-status done';
      status.textContent = '✓';

      const body = card.querySelector('.tool-card-body');
      body.textContent = data.result || 'No output';
    }
    this.scrollToBottom();
  },

  addSystemMessage(content) {
    const el = document.createElement('div');
    el.className = 'message system';
    el.textContent = content;
    this.messagesEl.appendChild(el);
    this.scrollToBottom(true);
  },

  addErrorMessage(content) {
    const el = document.createElement('div');
    el.className = 'message error';
    el.textContent = content;
    this.messagesEl.appendChild(el);
    this.scrollToBottom(true);
  },

  /**
   * Render full conversation history from API
   */
  renderHistory(messages) {
    this.clear();
    if (!messages || messages.length === 0) {
      this.showWelcome();
      return;
    }

    this.hideWelcome();

    for (const msg of messages) {
      if (msg.role === 'user') {
        const el = document.createElement('div');
        el.className = 'message user';
        el.textContent = msg.content;
        this.messagesEl.appendChild(el);
      } else if (msg.role === 'assistant') {
        if (msg.content) {
          // Strip <think> blocks and show them before the answer
          let displayContent = msg.content;
          const thinkMatch = displayContent.match(/<think>([\s\S]*?)<\/think>/);
          if (thinkMatch) {
            const thinkEl = document.createElement('div');
            thinkEl.className = 'message thinking thinking-done';
            thinkEl.innerHTML = `<span class="thinking-label">🧠 Thought process</span><div class="thinking-content">${this.escapeHtml(thinkMatch[1].trim())}</div>`;
            this.messagesEl.appendChild(thinkEl);
            displayContent = displayContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
          }

          if (displayContent) {
            const el = document.createElement('div');
            el.className = 'message assistant';
            el.innerHTML = window.renderMarkdown(displayContent);
            this.messagesEl.appendChild(el);
          }
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            let args = {};
            try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch {}
            const argsPreview = args.command || args.path || args.query || args.name || '';
            const card = document.createElement('div');
            card.className = 'tool-card';
            card.innerHTML = `
              <div class="tool-card-header" onclick="this.nextElementSibling.classList.toggle('expanded')">
                <span>⚡ ${tc.function.name}</span>
                <span style="flex:1;margin-left:8px;opacity:0.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(argsPreview)}</span>
                <span class="tool-status done">✓</span>
              </div>
              <div class="tool-card-body">Loading...</div>
            `;
            this.messagesEl.appendChild(card);
          }
        }
      } else if (msg.role === 'tool') {
        const cards = this.messagesEl.querySelectorAll('.tool-card');
        const lastCard = cards[cards.length - 1];
        if (lastCard) {
          const body = lastCard.querySelector('.tool-card-body');
          if (body) body.textContent = msg.content || 'No output';
        }
      }
    }
    this.scrollToBottom(true);
  },

  /**
   * FIXED: Reliable scroll to bottom
   * force=true bypasses the user-scrolled check (use on new messages)
   */
  scrollToBottom(force = false) {
    if (!this._chatArea) return;
    if (force || !this._userScrolled) {
      // Use double rAF to ensure DOM has updated before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (this._chatArea) {
            this._chatArea.scrollTop = this._chatArea.scrollHeight;
          }
        });
      });
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
};

// ──────────────────────────────────────────────────────────────────────
// Cockpit summary renderer (kit-aligned)
// Fetches /api/runs, /api/findings, /api/scopes, /api/assets, /api/toolpacks
// in parallel and paints the cockpit panels on the welcome screen. If all
// sources are empty, leaves #cockpit hidden so the feature-card fallback
// remains visible. Safe to call repeatedly (idempotent re-render).
// ──────────────────────────────────────────────────────────────────────
async function renderCockpit() {
  const root = document.getElementById('cockpit');
  if (!root) return;
  try {
    const [runs, findings, scopes, assets, toolpacks] = await Promise.all([
      fetch('/api/runs?limit=10').then(r => r.json()).catch(() => []),
      fetch('/api/findings?limit=20').then(r => r.json()).catch(() => []),
      fetch('/api/scopes').then(r => r.json()).catch(() => []),
      fetch('/api/assets?limit=20').then(r => r.json()).catch(() => []),
      fetch('/api/toolpacks').then(r => r.json()).catch(() => []),
    ]);

    const runList   = Array.isArray(runs)      ? runs      : (runs?.runs           || []);
    const findList  = Array.isArray(findings)  ? findings  : (findings?.findings   || []);
    const scopeList = Array.isArray(scopes)    ? scopes    : (scopes?.scopes       || []);
    const assetList = Array.isArray(assets)    ? assets    : (assets?.assets       || []);
    const tpList    = Array.isArray(toolpacks) ? toolpacks : (toolpacks?.toolpacks || []);

    // If everything is empty, leave the cockpit hidden so the feature-card
    // fallback shows. Otherwise reveal the cockpit.
    const anyData = runList.length || findList.length || scopeList.length || assetList.length || tpList.length;
    if (!anyData) {
      root.classList.add('hidden');
      return;
    }
    root.classList.remove('hidden');

    // ── KPI strip (6 tiles) ──
    const kpis = _computeCockpitKpis({ runList, findList, scopeList, assetList });
    const kpiHost = document.getElementById('cockpit-kpi');
    if (kpiHost) {
      kpiHost.innerHTML = kpis.map(k => `
        <div class="stat ${k.cls || ''}">
          <span class="stat-label">${_cpEscape(k.label)}</span>
          <span class="stat-value">${_cpEscape(k.value)}</span>
          <span class="stat-delta">${_cpEscape(k.delta || '')}</span>
        </div>
      `).join('');
    }

    // ── Live runs ──
    const running = runList.filter(r => r.status === 'running').length;
    const runsSub = document.getElementById('cockpit-runs-sub');
    if (runsSub) runsSub.textContent = `GOVERNED · ${running} ACTIVE`;
    const runsList = document.getElementById('cockpit-runs-list');
    if (runsList) {
      runsList.innerHTML = runList.slice(0, 6).map(r => {
        const idShort = (r.title || (r.id ? String(r.id).slice(0, 8) : 'untitled'));
        const dur = r.duration_ms != null
          ? `${Math.round(r.duration_ms / 1000)}s`
          : (r.started_at && r.completed_at
              ? `${Math.max(0, Math.round((new Date(r.completed_at) - new Date(r.started_at)) / 1000))}s`
              : '—');
        return `
          <div class="cockpit-run-row" data-route="runs">
            <span class="dot ${_cpEscape(r.status || '')}"></span>
            <span class="id">${_cpEscape(idShort)}</span>
            <span class="meta">${_cpEscape(r.model || '—')}</span>
            <span class="ttl">${_cpEscape(r.scope_name || r.scope?.name || 'no scope')}</span>
            <span class="dur">${_cpEscape(dur)}</span>
          </div>
        `;
      }).join('') || '<div style="padding:14px;color:var(--fg-3);font-size:12px;">No runs yet.</div>';
    }

    // ── Untriaged alerts (open findings, severity ≥ high) ──
    const alerts = findList
      .filter(f => f.status === 'open' && ['critical', 'high'].includes(f.severity))
      .slice(0, 5);
    const alertsSub = document.getElementById('cockpit-alerts-sub');
    if (alertsSub) alertsSub.textContent = `${alerts.length} NEW · 60M`;
    const alertsList = document.getElementById('cockpit-alerts-list');
    if (alertsList) {
      alertsList.innerHTML = alerts.map(f => `
        <div class="cockpit-alert-row ${_cpSevClass(f.severity)}" data-route="alerts">
          <span class="tick" aria-hidden="true"></span>
          <span class="alert-id">${_cpEscape(f.id ? String(f.id).slice(0, 8) : '')}</span>
          <div class="alert-body">
            <div class="title">${_cpEscape(f.title || 'untitled')}</div>
            <div class="meta">${_cpEscape(String(f.severity || '').toUpperCase())}</div>
          </div>
          <span class="alert-age">${_cpEscape(_cpTimeAgo(f.first_seen_at || f.created_at) || '—')}</span>
        </div>
      `).join('') || '<div style="padding:14px;color:var(--fg-3);font-size:12px;">No untriaged alerts.</div>';
    }

    // ── Policy decisions 24h ──
    // The API doesn't expose policy aggregates yet; estimate from run replay
    // shape (when available) and otherwise show a "no decisions in window"
    // empty state. Tool-call count is a soft proxy for "allowed" decisions.
    const allowed = runList.reduce((a, r) => a + (r.replay?.toolCalls?.length || r.tool_calls_count || 0), 0);
    const blocked = runList.reduce((a, r) => a + (r.replay?.blockedActions || r.blocked_count || 0), 0);
    const expiredCount = runList.filter(r => r.summary && /expired/i.test(r.summary)).length;
    const total = Math.max(1, allowed + blocked);
    const polSub = document.getElementById('cockpit-policy-sub');
    if (polSub) polSub.textContent = `${allowed + blocked} DECISIONS`;
    const polBody = document.getElementById('cockpit-policy-body');
    if (polBody) {
      const hasReasons = blocked > 0 || expiredCount > 0;
      polBody.innerHTML = `
        <div class="cockpit-policy-bar allowed">
          <span class="lbl">Allowed</span>
          <div class="bar"><i style="width: ${Math.round(100 * allowed / total)}%"></i></div>
          <span class="ct">${allowed}</span>
        </div>
        <div class="cockpit-policy-bar blocked">
          <span class="lbl">Blocked</span>
          <div class="bar"><i style="width: ${Math.round(100 * blocked / total)}%"></i></div>
          <span class="ct">${blocked}</span>
        </div>
        ${hasReasons
          ? `<ul class="cockpit-policy-reasons" style="list-style:none;margin:0;padding:0;">
              <li><span>online-bruteforce</span><span class="ct">${blocked}</span></li>
              <li><span>scope expired</span><span class="ct">${expiredCount}</span></li>
            </ul>`
          : `<ul class="cockpit-policy-reasons">
              <li style="color:var(--fg-3);">No blocked decisions in window.</li>
            </ul>`}
      `;
    }

    // ── Toolpack availability ──
    const tpSub = document.getElementById('cockpit-toolpacks-sub');
    if (tpSub) tpSub.textContent = `${tpList.length} REGISTERED`;
    const tpHost = document.getElementById('cockpit-toolpacks-list');
    if (tpHost) {
      tpHost.innerHTML = tpList.slice(0, 6).map(tp => {
        const risk = String(tp.riskClass || tp.risk || tp.risk_class || 'low').toLowerCase();
        const riskCls = ['low', 'med', 'medium', 'high', 'crit', 'critical'].includes(risk)
          ? (risk === 'medium' ? 'med' : risk === 'critical' ? 'crit' : risk)
          : 'low';
        const ready = tp.available !== false && tp.ready !== false;
        return `
          <div class="cockpit-toolpack-row">
            <span class="dot ${ready ? '' : 'warn'}"></span>
            <span class="name">${_cpEscape(tp.name || tp.id || 'unknown')}</span>
            <span class="risk ${riskCls}">${_cpEscape(String(risk).toUpperCase())}</span>
            <span class="meta" style="font-family:var(--font-mono);font-size:var(--fs-10,10px);color:var(--fg-3,#6a7587);">${ready ? 'READY' : 'CHECK'}</span>
          </div>
        `;
      }).join('') || '<div style="padding:14px;color:var(--fg-3);font-size:12px;">No toolpacks registered.</div>';
    }

    // ── Asset health movers (proxy: severity-weighted open findings) ──
    const findingsByAsset = findList.reduce((m, f) => {
      const aid = f.assetId || f.asset_id;
      if (!aid) return m;
      m[aid] = (m[aid] || 0) + _cpSevWeight(f.severity);
      return m;
    }, {});
    const movers = assetList
      .map(a => ({ ...a, score: findingsByAsset[a.id] || 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    const moversSub = document.getElementById('cockpit-movers-sub');
    if (moversSub) moversSub.textContent = `${movers.length} TRACKED`;
    const moversHost = document.getElementById('cockpit-movers-list');
    if (moversHost) {
      moversHost.innerHTML = movers.map(a => {
        const health = Math.max(20, 100 - a.score * 12);
        const cls = health < 40 ? 'critical' : health < 70 ? 'attention' : '';
        return `
          <div class="cockpit-mover-row ${cls}">
            <span class="name">${_cpEscape(a.name || a.id || 'unnamed asset')}</span>
            <div class="bar"><i style="width:${health}%"></i></div>
            <span class="delta">${health}/100</span>
          </div>
        `;
      }).join('') || '<div style="padding:14px;color:var(--fg-3);font-size:12px;">No assets tracked.</div>';
    }
  } catch (err) {
    console.warn('Cockpit render failed:', err);
  }
}

function _computeCockpitKpis({ runList, findList, scopeList, assetList }) {
  const running   = runList.filter(r => r.status === 'running').length;
  const failed    = runList.filter(r => r.status === 'failed').length;
  const completed = runList.filter(r => r.status === 'completed').length;
  const openCrit  = findList.filter(f => f.status === 'open' && f.severity === 'critical').length;
  const openHigh  = findList.filter(f => f.status === 'open' && f.severity === 'high').length;
  return [
    { label: 'Active runs',   value: String(running),          delta: `${completed} done · ${failed} failed`, cls: 'cy' },
    { label: 'Critical open', value: String(openCrit),         delta: 'untriaged',  cls: openCrit ? 'crit' : 'ok' },
    { label: 'High open',     value: String(openHigh),         delta: 'untriaged',  cls: openHigh ? 'high' : 'ok' },
    { label: 'Scopes',        value: String(scopeList.length), delta: 'authorized' },
    { label: 'Assets',        value: String(assetList.length), delta: 'tracked' },
    { label: 'Runs (all)',    value: String(runList.length),   delta: '7d window' },
  ];
}

function _cpSevClass(s) {
  return ({ critical: 'crit', high: 'high', medium: 'med', low: 'low', info: 'info' })[s] || 'info';
}
function _cpSevWeight(s) {
  return ({ critical: 5, high: 3, medium: 2, low: 1, info: 0 })[s] || 0;
}
function _cpEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function _cpTimeAgo(iso) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 60000;
  if (!isFinite(d) || d < 0) return '';
  return d < 60 ? `${Math.round(d)}m ago`
       : d < 1440 ? `${Math.round(d / 60)}h ago`
       : `${Math.round(d / 1440)}d ago`;
}

// Expose for diagnostics / hot-reload triggers.
window.renderCockpit = renderCockpit;

// ──────────────────────────────────────────────────────────────────────
// Dash page module — owns the cockpit summary surface.
// Router calls Dash.show() whenever the dash route activates. init() is
// idempotent and wires the refresh control once.
// ──────────────────────────────────────────────────────────────────────
window.Dash = {
  _wired: false,
  init() {
    if (this._wired) return;
    this._wired = true;
    const refreshBtn = document.getElementById('cockpit-runs-refresh');
    if (refreshBtn && !refreshBtn._cockpitWired) {
      refreshBtn._cockpitWired = true;
      refreshBtn.addEventListener('click', () => renderCockpit());
    }
  },
  show() {
    this.init();
    renderCockpit();
  },
};
