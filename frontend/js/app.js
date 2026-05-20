/**
 * PHANTOM — Main Application Controller
 * Handles WebSocket, conversation management, and UI orchestration
 * New: Image OSINT (drag & drop person image → AI web search)
 * Fixed: Auto-scroll
 */
(function() {
  'use strict';

  // ─── Platform-aware modifier key chip ─────────────────────────────────────
  // Mac shows "Cmd", Windows / Linux show "Ctrl". Never the ⌘ glyph.
  (function applyModKeyLabel() {
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    const label = isMac ? 'Cmd' : 'Ctrl';
    document.querySelectorAll('.modkey').forEach(el => { el.textContent = label; });
    // Also update title attributes on elements that mention the shortcut
    document.querySelectorAll('[title*="Ctrl+K"], [title*="Cmd+K"], [title*="Ctrl/⌘"]').forEach(el => {
      el.title = el.title.replace(/(Ctrl|Cmd|⌘|Ctrl\/⌘)\+?K/gi, `${label}+K`);
    });
  })();

  // ─── Boot splash · packet-train inspection counter + fade on phantom:ready ───
  (function bootSplash() {
    const overlay = document.getElementById('splash-overlay');
    if (!overlay) return;
    const counter = document.getElementById('splash-counter')?.querySelector('b');
    let n = 42;
    const tick = counter
      ? setInterval(() => { n += 1; counter.textContent = String(n).padStart(4, '0'); }, 1200)
      : null;
    const hide = () => {
      if (overlay.classList.contains('is-hidden')) return;
      overlay.classList.add('is-hidden');
      if (tick) clearInterval(tick);
      setTimeout(() => { overlay.remove(); }, 600);
    };
    window.addEventListener('phantom:ready', hide, { once: true });
    setTimeout(hide, 2400); // hard fallback so splash never sticks
  })();

  // ─── State ───
  let ws = null;
  // currentConversationId is persisted to localStorage so the most recent
  // chat auto-resumes on page reload. Prior to this, every refresh reset
  // the ID to null and made it look like history didn't exist — but the
  // server had been storing messages all along; the operator just had to
  // manually click a sidebar conversation to surface them.
  const LAST_CONV_KEY = 'phantom:last-conversation';
  let currentConversationId = null;
  let conversations = [];
  let isProcessing = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 10;

  function setCurrentConversation(id) {
    currentConversationId = id;
    try {
      if (id) localStorage.setItem(LAST_CONV_KEY, id);
      else localStorage.removeItem(LAST_CONV_KEY);
    } catch { /* ignore quota / private-mode errors */ }
    // Broadcast so page modules (Runs, etc.) can re-scope their views to
    // the active conversation without polling localStorage on a timer.
    window.dispatchEvent(new CustomEvent('phantom:conversation', { detail: { id } }));
  }

  // Build the UI-context bundle sent on every chat message so the agent
  // knows which surface the operator is on and which scope/asset/run is
  // selected. The server uses this to default phantom_* tool args and to
  // print a "## CURRENT UI CONTEXT" block in the system prompt.
  function buildUiContext() {
    return {
      route: window.Router?.current || null,
      selectedScopeId: document.getElementById('active-scope-select')?.value || null,
      selectedAssetId: window.AssetPage?.selectedId || null,
      selectedRunId: window.RunsPage?.selectedId || null,
    };
  }

  // Pending image for OSINT (base64 data URL)
  let pendingImage = null;
  let pendingImageName = '';

  // ─── DOM References ───
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const convList = document.getElementById('conversation-list');
  const searchInput = document.getElementById('search-conversations');
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');
  const connectionBadge = document.getElementById('connection-status');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');

  // ─── Initialize ───
  Chat.init();
  window.Dash?.init?.();
  window.Router?.init?.();
  Settings.init();
  window.SettingsPage?.init?.();
  window.RunsPage?.init?.();
  window.GraphPage?.init?.();
  window.ArtifactsPage?.init?.();
  window.ApprovalsPage?.init?.();
  window.ScopePage?.init?.();
  Management.init();
  initCommandPalette();
  initRunConfigPopover();
  initScopeStripUpdater();
  connectWebSocket();
  loadConversations();
  checkSudoStatus();
  window.Goals?.init?.();
  window.CampaignsPage?.init?.();
  window.DiagnosticsCard?.init?.();
  window.OnboardingChecklist?.init?.();
  window.DashHero?.init?.();
  window.RegistryPage?.init?.();
  window.DemoWatermark?.init?.();
  // Paint the Dash diagnostics card immediately so first paint shows readiness.
  window.DiagnosticsCard?.show?.('dash');
  // initOperatorOverrideControl() is called later, after OverrideController
  // (a `const`) is declared. Calling it here would hit a temporal-dead-zone
  // ReferenceError because the function declaration is hoisted but the
  // const it references is not.
  initImageDrop();

  // ─── WebSocket ───
  // ─── Preview Panel Logic ───
  let lastPreviewHtml = '';
  let lastPreviewArtifact = null;
  const previewPanel = document.getElementById('preview-panel');
  const previewIframe = document.getElementById('preview-iframe');
  const previewTitle = document.getElementById('preview-title');
  const previewOpenArtifactBtn = document.getElementById('preview-open-artifact-btn');

  window.showPreview = function showPreview(htmlContent, title, artifact = null) {
    if (!previewPanel) return;
    lastPreviewHtml = htmlContent || '';
    lastPreviewArtifact = artifact || lastPreviewArtifact;

    if (title) previewTitle.textContent = title;

    if (artifact?.contentUrl) {
      previewIframe.removeAttribute('srcdoc');
      previewIframe.src = artifact.contentUrl;
      if (previewOpenArtifactBtn) {
        previewOpenArtifactBtn.href = artifact.contentUrl;
        previewOpenArtifactBtn.classList.remove('hidden');
      }
    } else {
      // Instead of directly writing to the document (which gets blocked without allow-same-origin),
      // we use srcdoc to safely render the content in the sandboxed iframe while the server persists it as an artifact.
      previewIframe.removeAttribute('src');
      previewIframe.srcdoc = htmlContent || '';
      if (previewOpenArtifactBtn) {
        previewOpenArtifactBtn.removeAttribute('href');
        previewOpenArtifactBtn.classList.add('hidden');
      }
    }

    previewPanel.classList.remove('hidden');

    // Attempt to shrink chat width so they can be side-by-side on large screens
    if (window.innerWidth > 1000) {
      document.querySelector('.main-content').style.width = '55vw';
    }
  }

  function hidePreview() {
    if (!previewPanel) return;
    previewPanel.classList.add('hidden');
    document.querySelector('.main-content').style.width = '100%';
  }

  document.getElementById('preview-close-btn')?.addEventListener('click', hidePreview);
  document.getElementById('preview-refresh-btn')?.addEventListener('click', () => {
    if (lastPreviewArtifact?.contentUrl) window.showPreview('', lastPreviewArtifact.title || previewTitle.textContent, lastPreviewArtifact);
    else if (lastPreviewHtml) window.showPreview(lastPreviewHtml, previewTitle.textContent);
  });

  // ─── WebSocket ───
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus(true);
      reconnectAttempts = 0;
      window.dispatchEvent(new CustomEvent('phantom:ready'));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    };

    ws.onclose = () => {
      setStatus(false);
      attemptReconnect();
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT) return;
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    setTimeout(connectWebSocket, delay);
  }

  function setStatus(online) {
    if (online) {
      statusDot.className = 'status-dot online';
      statusText.textContent = 'Connected';
      connectionBadge.className = 'status-chip-dot connection-badge online';
      connectionBadge.textContent = '●';
    } else {
      statusDot.className = 'status-dot';
      statusText.textContent = 'Disconnected';
      connectionBadge.className = 'status-chip-dot connection-badge offline';
      connectionBadge.textContent = '●';
    }
    document.getElementById('topbar-status-chip')?.setAttribute('data-state', online ? 'online' : 'offline');
  }

  // ─── Message Handler ───
  function handleMessage(msg) {
    if (msg.runId) {
      window.dispatchEvent(new CustomEvent('phantom:trace', { detail: msg }));
    }
    if (msg.type === 'artifact_created' && msg.artifact) {
      window.dispatchEvent(new CustomEvent('phantom:artifact', { detail: msg }));
    }
    // Surface run-completion as its own event so the Synthesis card and
    // trending panel can re-fetch without polling. trace.type carries the
    // canonical terminal events that the executor emits when a run ends.
    if (msg.runId && msg.trace && /^run\.(completed|failed|stopped)$/.test(msg.trace.type || '')) {
      window.dispatchEvent(new CustomEvent('phantom:run-complete', {
        detail: { runId: msg.runId, status: msg.trace.type.replace('run.', '') },
      }));
    }

    // Session isolation: only render messages for the active conversation
    if (msg.conversationId && currentConversationId && msg.conversationId !== currentConversationId) {
      if (msg.type !== 'conversation_created' && msg.type !== 'title_updated' && msg.type !== 'pong') {
        return;
      }
    }

    switch (msg.type) {
      case 'conversation_created':
        setCurrentConversation(msg.conversationId);
        loadConversations();
        break;

      case 'response_start':
        isProcessing = true;
        updateButtons();
        Chat.startAssistantMessage();
        break;

      case 'thinking':
        Chat.addThinkingChunk(msg.content);
        break;

      case 'chunk':
        Chat.appendChunk(msg.content);
        break;

      case 'tool_call':
        Chat.endAssistantMessage();
        Chat.addToolCall(msg);
        // Count tool calls that fire while override is active so the
        // overlay modal can surface a real-time "actions under override"
        // metric. Useful for after-session review.
        OverrideController.incrementEvents();
        break;

      case 'approval_request':
        // Policy evaluator decided this tool call needs operator approval
        // (or was implicit-denied but allow-once-eligible). Render the
        // chat card; the user clicks Approve/Deny and Chat dispatches a
        // `phantom:approval` CustomEvent that we forward back over WS.
        Chat.endAssistantMessage();
        Chat.addApprovalRequest(msg);
        break;

      case 'tool_progress':
        Chat.updateToolProgress(msg);
        break;

      case 'tool_result':
          if (msg.name === 'show_preview_window') {
            try {
              const resObj = typeof msg.result === 'string' ? JSON.parse(msg.result) : msg.result;
              if (resObj.html_content) {
                window.showPreview(resObj.html_content, resObj.title || 'Preview', msg.artifact || null);
                // modify msg.result to only show success message in chat
                msg.result = msg.artifact
                  ? `${resObj.message}\nArtifact saved: ${msg.artifact.title || msg.artifact.id}`
                  : resObj.message;
              }
            } catch (e) {
              console.error('Failed to parse show_preview_window result:', e);
            }
          }
        Chat.addToolResult(msg);
        break;

      case 'artifact_created':
        if (msg.artifact?.type === 'html' && msg.artifact?.metadata?.source === 'show_preview_window') {
          window.showPreview('', msg.artifact.title || 'Preview', msg.artifact);
        }
        break;

      case 'response_end':
        Chat.endAssistantMessage();
        isProcessing = false;
        updateButtons();
        break;

      case 'title_updated':
        loadConversations();
        break;

      case 'error':
        Chat.addErrorMessage(msg.message);
        isProcessing = false;
        updateButtons();
        break;

      case 'pong':
        break;
    }
  }

  // ─── Send Message ───
  function sendMessage() {
    const content = messageInput.value.trim();
    if ((!content && !pendingImage) || isProcessing) return;

    let finalContent = content;

    if (pendingImage) {
      // Build OSINT prompt with base64 image encoded as data URL
      const osintPrompt = content
        ? content
        : `I'm providing an image of a person for OSINT research. Please analyze this image and:
1. Describe physical features visible (age estimate, distinctive features, etc.)
2. Search the web for people matching this description
3. Use search_web to find any public information about this person
4. Check social media presence using search_web (LinkedIn, Twitter, Instagram, Facebook)
5. Use scrapling_fetch for deeper investigation of any relevant pages found
6. Compile all findings into a comprehensive OSINT report

Start the investigation immediately!`;

      Chat.addUserMessage(finalContent || '[image attached] OSINT analysis requested', pendingImage);

      // Send with image context embedded in message
      const imageMsg = `${osintPrompt}\n\n[IMAGE ATTACHED: ${pendingImageName || 'image.png'} — base64 encoded image of person to investigate]\nImage data: ${pendingImage}`;

      messageInput.value = '';
      messageInput.style.height = 'auto';
      clearPendingImage();
      updateButtons();

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'chat',
          content: imageMsg,
          conversationId: currentConversationId,
          scopeId: document.getElementById('active-scope-select')?.value || null,
          profileId: document.getElementById('prompt-profile-select')?.value || null,
          operatorOverride: operatorOverridePayload(),
          toolpackIds: selectedToolpackIds(),
          uiContext: buildUiContext(),
        }));
      } else {
        Chat.addErrorMessage('Not connected to server. Trying to reconnect...');
        connectWebSocket();
      }
      return;
    }

    Chat.addUserMessage(finalContent);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    updateButtons();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chat',
        content: finalContent,
        conversationId: currentConversationId,
        scopeId: document.getElementById('active-scope-select')?.value || null,
        profileId: document.getElementById('prompt-profile-select')?.value || null,
        operatorOverride: operatorOverridePayload(),
        toolpackIds: selectedToolpackIds(),
        uiContext: buildUiContext(),
      }));
    } else {
      Chat.addErrorMessage('Not connected to server. Trying to reconnect...');
      connectWebSocket();
    }
  }

  function selectedToolpackIds() {
    return Array.from(document.getElementById('active-toolpack-select')?.selectedOptions || []).map(option => option.value).filter(Boolean);
  }

  // ─── Operator Override controller ────────────────────────────────────────
  // Single source of truth for override state. Mirrors itself across four
  // surfaces:
  //   1. Sidebar entry (#sidebar-override-btn) — always-visible primary
  //   2. Persistent banner (#override-banner) — across all routes when ON
  //   3. Overlay modal (#override-modal) — deliberate-ceremony toggle UI
  //   4. Legacy run-config popover checkbox — kept for backwards compat,
  //      now driven by the controller instead of owning state.
  // Persisted to localStorage so it survives reloads — override is supposed
  // to feel like a thing you hold open, not a setting you toggle and forget.
  const OVERRIDE_STORE_KEY = 'phantom:operator-override';
  const OverrideController = {
    state: { enabled: false, reason: '', activations: 0, events: 0 },

    load() {
      try {
        const raw = localStorage.getItem(OVERRIDE_STORE_KEY);
        if (raw) Object.assign(this.state, JSON.parse(raw));
      } catch {}
    },
    save() {
      try { localStorage.setItem(OVERRIDE_STORE_KEY, JSON.stringify(this.state)); } catch {}
    },

    init() {
      this.load();
      // Legacy popover sync — keep the run-config-popover checkbox driven
      // by the controller so old keyboard flows still work.
      const popoverCb = document.getElementById('operator-override-enabled');
      const popoverReason = document.getElementById('operator-override-reason');
      if (popoverCb) {
        popoverCb.addEventListener('change', () => this.set({ enabled: popoverCb.checked }));
      }
      if (popoverReason) {
        popoverReason.addEventListener('input', () => this.set({ reason: popoverReason.value }));
      }

      // Sidebar entry
      const sidebarBtn = document.getElementById('sidebar-override-btn');
      sidebarBtn?.addEventListener('click', () => this.openModal());

      // Banner controls
      document.getElementById('override-banner-edit')?.addEventListener('click', () => this.openModal());
      document.getElementById('override-banner-end')?.addEventListener('click', () => {
        this.set({ enabled: false });
      });

      // Modal controls
      const modal = document.getElementById('override-modal');
      const modalToggle = document.getElementById('override-modal-toggle');
      const modalReason = document.getElementById('override-modal-reason');
      const saveBtn = document.getElementById('override-modal-save');
      const disableBtn = document.getElementById('override-modal-disable');

      modal?.querySelectorAll('[data-override-close]').forEach((el) => {
        el.addEventListener('click', () => this.closeModal());
      });
      modalToggle?.addEventListener('change', () => this.refreshModalChrome());
      saveBtn?.addEventListener('click', () => {
        const next = {
          enabled: !!modalToggle?.checked,
          reason: modalReason?.value?.trim() || '',
        };
        if (next.enabled && !next.reason) {
          // Require a reason on enable — modeled after sudo prompt UX.
          modalReason.focus();
          modalReason.classList.add('error');
          setTimeout(() => modalReason.classList.remove('error'), 1500);
          return;
        }
        this.set(next);
        this.closeModal();
      });
      disableBtn?.addEventListener('click', () => {
        this.set({ enabled: false });
        this.closeModal();
      });

      // Escape closes modal
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.hidden) this.closeModal();
      });

      this.render();
    },

    set(patch) {
      const wasEnabled = this.state.enabled;
      Object.assign(this.state, patch);
      // Default a reason on first enable so trace events always carry one.
      if (this.state.enabled && !this.state.reason) {
        this.state.reason = 'Local testing / fixture validation';
      }
      // Count session activations — every off→on edge increments.
      if (!wasEnabled && this.state.enabled) {
        this.state.activations = (this.state.activations || 0) + 1;
      }
      this.save();
      this.render();
    },

    incrementEvents() {
      if (!this.state.enabled) return;
      this.state.events = (this.state.events || 0) + 1;
      this.save();
      this.renderStats();
    },

    payload() {
      if (!this.state.enabled) return { enabled: false };
      return { enabled: true, reason: this.state.reason || 'Local testing / fixture validation' };
    },

    openModal() {
      const modal = document.getElementById('override-modal');
      if (!modal) return;
      modal.hidden = false;
      requestAnimationFrame(() => modal.classList.add('is-open'));
      // Sync modal inputs from state on open so cancel discards edits cleanly.
      const t = document.getElementById('override-modal-toggle');
      const r = document.getElementById('override-modal-reason');
      if (t) t.checked = this.state.enabled;
      if (r) r.value = this.state.reason || '';
      this.refreshModalChrome();
      setTimeout(() => r?.focus(), 80);
    },

    closeModal() {
      const modal = document.getElementById('override-modal');
      if (!modal) return;
      modal.classList.remove('is-open');
      setTimeout(() => { modal.hidden = true; }, 180);
    },

    refreshModalChrome() {
      const t = document.getElementById('override-modal-toggle');
      const label = document.getElementById('override-toggle-label');
      const sub = document.getElementById('override-toggle-sub');
      const disable = document.getElementById('override-modal-disable');
      const on = !!t?.checked;
      if (label) label.textContent = on ? 'Override will be ON' : 'Override is OFF';
      if (sub) sub.textContent = on
        ? 'Scope gates bypassed. Trace audit still records every action.'
        : 'Toggle on to bypass scope gates for this session.';
      if (disable) disable.disabled = !this.state.enabled;
    },

    renderStats() {
      const a = document.getElementById('override-stat-activations');
      const e = document.getElementById('override-stat-events');
      if (a) a.textContent = String(this.state.activations || 0);
      if (e) e.textContent = String(this.state.events || 0);
    },

    render() {
      const on = !!this.state.enabled;

      // body class — legacy CSS hook for tinting input-area, scope-warning etc.
      document.body.classList.toggle('operator-override-active', on);

      // Sidebar entry
      const btn = document.getElementById('sidebar-override-btn');
      if (btn) {
        btn.setAttribute('data-state', on ? 'on' : 'off');
        btn.setAttribute('aria-label', `Operator Override · ${on ? 'on' : 'off'}`);
        const stateEl = document.getElementById('sidebar-override-state');
        if (stateEl) stateEl.textContent = on ? 'ACTIVE' : 'OFF';
      }

      // Banner — show only when active.
      const banner = document.getElementById('override-banner');
      const reasonEl = document.getElementById('override-banner-reason');
      if (banner) {
        banner.hidden = !on;
        if (reasonEl) reasonEl.textContent = this.state.reason || '';
      }

      // Legacy popover checkbox + reason
      const popoverCb = document.getElementById('operator-override-enabled');
      const popoverReason = document.getElementById('operator-override-reason');
      if (popoverCb) popoverCb.checked = on;
      if (popoverReason) {
        popoverReason.disabled = !on;
        popoverReason.value = this.state.reason || '';
      }

      // Modal mirror (when open)
      const t = document.getElementById('override-modal-toggle');
      const r = document.getElementById('override-modal-reason');
      if (t) t.checked = on;
      if (r) r.value = this.state.reason || '';
      this.refreshModalChrome();
      this.renderStats();
    },
  };

  function initOperatorOverrideControl() {
    OverrideController.init();
  }

  function operatorOverridePayload() {
    return OverrideController.payload();
  }

  // Run the override controller initializer now that the const above is in
  // scope. Safe to call sync — it only touches DOM elements that exist
  // because this script is loaded at the bottom of <body>.
  initOperatorOverrideControl();

  // ─── Stop AI ───
  function stopAI() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
      Chat.addSystemMessage('⏹ Stop requested...');
    }
  }

  // ─── Button State Management ───
  function updateButtons() {
    if (isProcessing) {
      sendBtn.style.display = 'none';
      stopBtn.style.display = 'flex';
    } else {
      sendBtn.style.display = 'flex';
      stopBtn.style.display = 'none';
      sendBtn.disabled = !messageInput.value.trim() && !pendingImage;
    }
  }

  // ─── Image Drop / OSINT ───
  function initImageDrop() {
    const inputArea = document.getElementById('input-area');
    const inputContainer = document.querySelector('.input-container');

    // Create image preview area
    const previewEl = document.createElement('div');
    previewEl.id = 'image-preview-bar';
    previewEl.className = 'image-preview-bar hidden';
    previewEl.innerHTML = `
      <div class="image-preview-inner">
        <span class="image-preview-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </span>
        <img id="image-preview-thumb" src="" alt="preview" class="image-preview-thumb"/>
        <span id="image-preview-name" class="image-preview-name"></span>
        <span class="image-preview-badge">OSINT</span>
        <button id="image-preview-remove" class="image-preview-remove" title="Remove image" aria-label="Remove image">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;
    inputArea.insertBefore(previewEl, inputArea.firstChild);

    document.getElementById('image-preview-remove').addEventListener('click', clearPendingImage);

    // ── Create hidden file input for click-to-upload ──
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.id = 'osint-file-input';
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadImageFile(file);
      fileInput.value = '';
    });

    // ── Attach button in input bar (OSINT image) ──
    const imageBtn = document.createElement('button');
    imageBtn.id = 'image-osint-btn';
    imageBtn.className = 'image-osint-btn';
    imageBtn.title = 'Attach image for OSINT analysis';
    imageBtn.setAttribute('aria-label', 'Attach image for OSINT analysis');
    imageBtn.type = 'button';
    imageBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
      </svg>
    `;
    imageBtn.addEventListener('click', () => fileInput.click());
    inputContainer.insertBefore(imageBtn, inputContainer.querySelector('textarea'));

    // ── Drag and Drop on entire chat area & input ──
    const dropZone = document.getElementById('chat-area');

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
      if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('drag-over');
      }
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].type.startsWith('image/')) {
        loadImageFile(files[0]);
      }
    });

    // Also allow paste of images
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) loadImageFile(file);
          break;
        }
      }
    });
  }

  function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      pendingImage = e.target.result;
      pendingImageName = file.name;
      showImagePreview(e.target.result, file.name);
      updateButtons();
      messageInput.focus();
    };
    reader.readAsDataURL(file);
  }

  function showImagePreview(dataUrl, name) {
    const bar = document.getElementById('image-preview-bar');
    const thumb = document.getElementById('image-preview-thumb');
    const nameEl = document.getElementById('image-preview-name');
    thumb.src = dataUrl;
    nameEl.textContent = name || 'image.png';
    bar.classList.remove('hidden');
  }

  function clearPendingImage() {
    pendingImage = null;
    pendingImageName = '';
    const bar = document.getElementById('image-preview-bar');
    if (bar) bar.classList.add('hidden');
    const thumb = document.getElementById('image-preview-thumb');
    if (thumb) thumb.src = '';
    updateButtons();
  }

  // ─── Conversations ───
  async function loadConversations() {
    try {
      const res = await fetch('/api/conversations');
      conversations = await res.json();
      renderConversationList();
    } catch {}
  }

  function renderConversationList(filter = '') {
    convList.innerHTML = '';
    const filtered = filter
      ? conversations.filter(c => c.title.toLowerCase().includes(filter.toLowerCase()))
      : conversations;

    for (const conv of filtered) {
      const el = document.createElement('div');
      el.className = `conv-item${conv.id === currentConversationId ? ' active' : ''}`;
      el.innerHTML = `
        <span class="conv-icon">💬</span>
        <span class="conv-title">${escapeHtml(conv.title)}</span>
        <button class="conv-delete" title="Delete">✕</button>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('conv-delete')) {
          deleteConversation(conv.id);
          return;
        }
        selectConversation(conv.id);
      });

      convList.appendChild(el);
    }
  }

  async function selectConversation(id) {
    window.Router?.navigate?.('chat');
    setCurrentConversation(id);
    renderConversationList();

    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json();
      Chat.renderHistory(data.messages);
    } catch {
      Chat.addErrorMessage('Failed to load conversation');
    }

    sidebar.classList.remove('open');
    document.querySelector('.sidebar-scrim')?.classList.remove('is-active');
  }

  async function deleteConversation(id) {
    try {
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (currentConversationId === id) {
        setCurrentConversation(null);
        Chat.clear();
        Chat.showWelcome();
      }
      loadConversations();
    } catch {}
  }

  function newChat() {
    window.Router?.navigate?.('chat');
    setCurrentConversation(null);
    Chat.clear();
    Chat.showWelcome();
    renderConversationList();
    messageInput.focus();
  }

  // Auto-resume the most recently active conversation on page load. We try
  // the localStorage-pinned id first (matches the operator's last context),
  // and fall back to the newest conversation if that id is gone (e.g. they
  // deleted it from another tab). Skipped entirely if there's no history
  // yet, leaving the welcome screen visible.
  async function autoResumeConversation() {
    try {
      const res = await fetch('/api/conversations');
      const all = await res.json();
      if (!Array.isArray(all) || all.length === 0) return;
      let target = null;
      try {
        const pinned = localStorage.getItem(LAST_CONV_KEY);
        if (pinned) target = all.find((c) => c.id === pinned);
      } catch {}
      if (!target) target = all[0]; // newest first per API ordering
      if (target) await selectConversation(target.id);
    } catch { /* leave welcome screen visible on failure */ }
  }
  // Run after the initial conversation list paint so the sidebar shows
  // results even if the resume fails.
  setTimeout(autoResumeConversation, 50);

  // First-run onboarding wizard. Decides whether to auto-open based on
  // /api/onboarding/status (empty DB + sticky completion flag). Skipped
  // silently when the server is unreachable.
  setTimeout(() => { window.OnboardingWizard?.maybeOpen?.(); }, 800);

  // ─── Sudo Modal ───
  // Only auto-open in 'sudo' mode (bare-metal Linux/macOS where the agent
  // needs an interactive password to cache). 'root' (containerized) and
  // 'none' (Windows / no escalation path) skip the modal — root has no
  // sudo binary, and Windows uses the per-step elevatedCommand affordance.
  async function checkSudoStatus() {
    try {
      const res = await fetch('/api/system/info');
      const info = await res.json();
      if (info.elevationMode === 'sudo' && !info.sudoConfigured) {
        showSudoModal();
      }
    } catch {}
  }

  function showSudoModal() {
    const modal = document.getElementById('sudo-modal');
    modal.style.display = 'flex';

    const passInput = document.getElementById('sudo-modal-password');
    const validateBtn = document.getElementById('sudo-modal-validate');
    const skipBtn = document.getElementById('sudo-modal-skip');
    const toggleEye = document.getElementById('sudo-modal-toggle-eye');
    const feedback = document.getElementById('sudo-modal-feedback');

    setTimeout(() => passInput.focus(), 100);

    toggleEye.onclick = () => {
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
    };

    passInput.onkeydown = (e) => {
      if (e.key === 'Enter') validateSudoPassword();
    };

    validateBtn.onclick = () => validateSudoPassword();

    skipBtn.onclick = () => {
      modal.style.display = 'none';
    };

    async function validateSudoPassword() {
      const password = passInput.value.trim();
      if (!password) {
        feedback.className = 'sudo-modal-feedback error';
        feedback.textContent = '❌ Please enter a password';
        return;
      }

      validateBtn.disabled = true;
      validateBtn.textContent = '⏳ Validating...';
      feedback.className = 'sudo-modal-feedback';
      feedback.textContent = '';

      try {
        const res = await fetch('/api/sudo/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();

        if (data.valid) {
          feedback.className = 'sudo-modal-feedback success';
          feedback.textContent = '✅ ' + data.message;
          setTimeout(() => {
            modal.style.display = 'none';
          }, 1000);
        } else {
          feedback.className = 'sudo-modal-feedback error';
          feedback.textContent = '❌ ' + data.message;
        }
      } catch (err) {
        feedback.className = 'sudo-modal-feedback error';
        feedback.textContent = '❌ Connection error: ' + err.message;
      }

      validateBtn.disabled = false;
      validateBtn.textContent = '🔓 Validate & Grant Access';
    }
  }

  // ─── Input Handling ───
  messageInput.addEventListener('input', () => {
    updateButtons();
    autoResize();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const lines = messageInput.value.split('\n').length;
      if (lines <= 1) {
        e.preventDefault();
        sendMessage();
      }
    }
  });

  sendBtn.addEventListener('click', sendMessage);
  stopBtn.addEventListener('click', stopAI);
  newChatBtn.addEventListener('click', newChat);

  searchInput.addEventListener('input', () => {
    renderConversationList(searchInput.value);
  });

  // ─── Approval response forwarder ──────────────────────────────────────────
  // Chat.addApprovalRequest dispatches phantom:approval when the operator
  // clicks Approve/Deny on an approval card. Forward the decision back over
  // the WebSocket so the server-side requestApproval promise resolves.
  window.addEventListener('phantom:approval', (e) => {
    const detail = e.detail || {};
    if (!detail.approvalId || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'approval_response',
      approvalId: detail.approvalId,
      decision: detail.decision,  // 'approve' | 'deny'
      note: detail.note || '',
      // When the operator ticked "approve next N matching", batch carries
      // the server-side persistence hint (scopeId + risk + remaining count).
      batch: detail.batch || null,
    }));
  });

  // ─── Mobile sidebar scrim (Pass 16) ───
  // Append a single scrim node to <body>; mirror .sidebar.open → .is-active.
  // Click on scrim closes the drawer. Idempotent — only created once.
  let sidebarScrim = document.querySelector('.sidebar-scrim');
  if (!sidebarScrim) {
    sidebarScrim = document.createElement('div');
    sidebarScrim.className = 'sidebar-scrim';
    sidebarScrim.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sidebarScrim);
  }
  const syncScrim = () => {
    if (!sidebar) return;
    sidebarScrim.classList.toggle('is-active', sidebar.classList.contains('open'));
  };
  sidebarScrim.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    syncScrim();
  });

  sidebarToggle?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    syncScrim();
  });

  function autoResize() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  }

  // ─── PHANTOM SEC command palette ───
  function initCommandPalette() {
    const palette = document.getElementById('command-palette');
    const trigger = document.getElementById('command-palette-trigger');
    const input = document.getElementById('command-palette-input');
    const results = document.getElementById('command-palette-results');
    if (!palette || !input || !results) return;

    const commands = [
      { id: 'dash', label: 'Open Dash', detail: 'Live operational overview · KPIs · runs · alerts', route: 'dash', code: 'route:dash' },
      { id: 'chat', label: 'Open Chat', detail: 'Start or continue a governed operation', route: 'chat', code: 'route:chat' },
      { id: 'runs', label: 'Open Runs', detail: 'Review trace history, snapshots, policy decisions', route: 'runs', code: 'route:runs' },
      { id: 'graph', label: 'Open Graph', detail: 'Replay operational graph and blocked paths', route: 'graph', code: 'route:graph' },
      { id: 'artifacts', label: 'Open Artifacts', detail: 'Evidence, previews, exports, reports', route: 'artifacts', code: 'route:artifacts' },
      { id: 'scope', label: 'Open Assets / Scope', detail: 'Scope builder, assets, policy dry-run', route: 'scope', code: 'route:scope' },
      { id: 'settings', label: 'Open Settings', detail: 'Models, prompts, toolpacks, governance settings', route: 'settings', code: 'route:settings' },
      { id: 'new-chat', label: 'New chat', detail: 'Create a fresh operation context', action: () => newChatBtn?.click(), code: 'action:new' },
      { id: 'manage', label: 'Open Management', detail: 'MCP servers and skills', action: () => window.Management?.open?.(), code: 'panel:manage' },
    ];
    let activeIndex = 0;
    let rendered = commands;

    function openPalette() {
      palette.classList.remove('hidden');
      input.value = '';
      renderCommands('');
      requestAnimationFrame(() => input.focus());
    }
    function closePalette() {
      palette.classList.add('hidden');
    }
    function runCommand(command) {
      if (!command) return;
      closePalette();
      if (command.route) window.Router?.navigate?.(command.route);
      if (command.action) command.action();
    }
    function renderCommands(query) {
      const needle = query.trim().toLowerCase();
      rendered = commands.filter((command) => !needle || `${command.label} ${command.detail} ${command.code}`.toLowerCase().includes(needle));
      activeIndex = Math.min(activeIndex, Math.max(rendered.length - 1, 0));
      results.innerHTML = rendered.length ? rendered.map((command, index) => `
        <button class="command-result ${index === activeIndex ? 'active' : ''}" data-command-id="${escapeHtml(command.id)}" role="option" aria-selected="${index === activeIndex}">
          <span class="nav-glyph" aria-hidden="true">${escapeHtml(command.id.slice(0, 3).toUpperCase())}</span>
          <span><strong>${escapeHtml(command.label)}</strong><span>${escapeHtml(command.detail)}</span></span>
          <code>${escapeHtml(command.code)}</code>
        </button>`).join('') : '<div class="empty-msg">No commands match this query.</div>';
      results.querySelectorAll('[data-command-id]').forEach((button) => {
        button.addEventListener('click', () => runCommand(rendered.find((command) => command.id === button.dataset.commandId)));
      });
    }

    trigger?.addEventListener('click', openPalette);
    palette.querySelectorAll('[data-command-close]').forEach((el) => el.addEventListener('click', closePalette));
    input.addEventListener('input', () => renderCommands(input.value));
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openPalette();
        return;
      }
      if (palette.classList.contains('hidden')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex = Math.min(activeIndex + 1, rendered.length - 1);
        renderCommands(input.value);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        renderCommands(input.value);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        runCommand(rendered[activeIndex]);
      }
    });
  }

  // ─── Topbar run-config popover ────────────────────────────────────────────
  function initRunConfigPopover() {
    const strip = document.getElementById('active-scope-strip');
    const pop   = document.getElementById('run-config-popover');
    if (!strip || !pop) return;

    function setOpen(open) {
      pop.classList.toggle('hidden', !open);
      strip.setAttribute('aria-expanded', String(open));
    }
    strip.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(pop.classList.contains('hidden'));
    });
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pop.classList.contains('hidden')) setOpen(false);
    });
    pop.querySelectorAll('[data-run-config-close]').forEach((el) => el.addEventListener('click', () => setOpen(false)));
  }

  // ─── Dynamic breadcrumb ───────────────────────────────────────────────────
  (function initBreadcrumb() {
    const el = document.getElementById('top-bar-crumbs');
    if (!el) return;
    const labels = {
      dash: 'Dash', chat: 'Chat', runs: 'Runs', graph: 'Graph',
      alerts: 'Alerts', artifacts: 'Artifacts', scope: 'Assets / Scope', settings: 'Settings',
    };
    let ctx = null;
    function paint() {
      const route = window.Router?.current || 'dash';
      const here = labels[route] || route;
      el.innerHTML = '';
      const home = document.createElement('span'); home.className = 'here'; home.textContent = here;
      el.appendChild(home);
      if (ctx && ctx.label) {
        const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '›';
        const tail = document.createElement('span'); tail.className = 'ctx'; tail.textContent = ctx.label;
        el.appendChild(sep); el.appendChild(tail);
      }
    }
    window.addEventListener('phantom:route', () => { ctx = null; paint(); });
    window.addEventListener('phantom:context', (e) => { ctx = e.detail || null; paint(); });
    paint();
  })();

  // ─── Alerts bell · critical+high open count, polled every 60s ─────────────
  (function initAlertsBell() {
    const bell = document.getElementById('alerts-bell');
    const badge = document.getElementById('alerts-bell-count');
    if (!bell || !badge) return;

    async function refresh() {
      try {
        const res = await fetch('/api/findings?status=open&limit=200');
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data) ? data : (data.findings || []);
        const crit = rows.filter(f => f.severity === 'critical').length;
        const high = rows.filter(f => f.severity === 'high').length;
        const total = crit + high;
        if (total > 0) {
          badge.hidden = false;
          badge.textContent = total > 99 ? '99+' : String(total);
          bell.classList.toggle('has-crit', crit > 0);
          bell.classList.toggle('has-alerts', high > 0 && crit === 0);
        } else {
          badge.hidden = true;
          bell.classList.remove('has-crit', 'has-alerts');
        }
      } catch (_err) {
        // Silently skip — bell stays at last known state
      }
    }
    refresh();
    setInterval(refresh, 60000);
    window.addEventListener('phantom:findings-changed', refresh);
  })();

  // ─── Collapsible sidebar · 220 px expanded ↔ 56 px rail · persisted ──────
  (function initSidebarCollapse() {
    const sb  = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-collapse-btn');
    if (!sb || !btn) return;
    const KEY = 'phantom:sidebar-collapsed';
    const apply = (collapsed) => {
      sb.classList.toggle('collapsed', collapsed);
      btn.setAttribute('aria-pressed', String(collapsed));
      btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      btn.setAttribute('aria-label', btn.title);
    };
    // Restore persisted state (default: expanded)
    apply(localStorage.getItem(KEY) === '1');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = !sb.classList.contains('collapsed');
      apply(next);
      try { localStorage.setItem(KEY, next ? '1' : '0'); } catch (_e) { /* no-op */ }
    });
  })();

  // ─── Keep topbar scope-strip text in sync with #active-scope-select ───────
  function initScopeStripUpdater() {
    const select = document.getElementById('active-scope-select');
    const strip  = document.getElementById('active-scope-strip');
    if (!select || !strip) return;
    const nameEl = strip.querySelector('.name');
    const metaEl = strip.querySelector('.meta');
    const sync = () => {
      const opt = select.options[select.selectedIndex];
      const val = select.value || '';
      const label = opt ? opt.textContent : '';
      if (val) {
        if (nameEl) nameEl.textContent = label || 'Scope selected';
        if (metaEl) metaEl.textContent = '';
        strip.setAttribute('data-empty', 'false');
      } else {
        if (nameEl) nameEl.textContent = 'No scope selected';
        if (metaEl) metaEl.textContent = '';
        strip.setAttribute('data-empty', 'true');
      }
    };
    select.addEventListener('change', sync);
    // Re-sync on initial population by scope-page.js (it rebuilds <option>s).
    const observer = new MutationObserver(sync);
    observer.observe(select, { childList: true, subtree: true });
    sync();
  }

  // ─── Legacy decorative background hook intentionally disabled by the SEC UI kit ───
  function initMatrix() {
    const canvas = document.getElementById('matrix-bg');
    if (!canvas) return;
    return;
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const chars = '01';
    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);
    const drops = new Array(columns).fill(1);

    function draw() {
      ctx.fillStyle = 'rgba(13, 13, 13, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#22c55e';
      ctx.font = `${fontSize}px JetBrains Mono, monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.985) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    }

    setInterval(draw, 80);
  }

  // ─── Keepalive ───
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);

  // ─── Helpers ───
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
