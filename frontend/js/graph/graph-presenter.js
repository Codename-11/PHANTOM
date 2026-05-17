(function attachGraphPresenter(global) {
  const TOOL_NAME_MAP = {
    execute_command: 'Shell command',
    python_execute: 'Python execution',
    web_request: 'Web request',
    show_preview_window: 'Preview window',
    read_file: 'Read file',
    write_file: 'Write file',
    search_files: 'Search files',
    create_artifact: 'Create artifact',
  };

  const EDGE_LABELS = {
    called: 'Called tool',
    blocked_by_policy: 'Blocked by policy',
    blocked_by: 'Blocked by',
    observed: 'Observed target',
    generated: 'Generated artifact',
    connected_to: 'Connected to',
  };

  const METADATA_LABELS = {
    eventId: 'Event',
    sourceEventId: 'Source event',
    toolCallId: 'Tool call',
    outputPreview: 'Output',
    input: 'Input',
    phase: 'Phase',
    risk: 'Risk',
    scopeId: 'Scope',
    scopeStatus: 'Scope status',
    policy: 'Policy',
    policyReason: 'Policy reason',
    fullCommand: 'Command',
    contentUrl: 'Content URL',
    downloadUrl: 'Download URL',
    mimeType: 'MIME type',
    source: 'Source',
    host: 'Host',
  };

  function titleCase(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function formatToolName(name) {
    const key = String(name || '').trim();
    if (!key) return 'Tool call';
    return TOOL_NAME_MAP[key] || titleCase(key);
  }

  function edgeExplanation(edge = {}) {
    if (edge.label && !['called', 'observed', 'generated', 'host', 'port', 'command', 'blocked command'].includes(edge.label)) {
      return titleCase(edge.label);
    }
    return EDGE_LABELS[edge.type] || titleCase(edge.type || 'relationship');
  }

  function wrapNodeLabel(value, { maxLineLength = 26, maxLines = 2 } = {}) {
    const title = String(value || '').replace(/\s+/g, ' ').trim();
    if (!title) return { title: '', lines: [''], truncated: false };
    const words = title.split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxLineLength || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
        if (lines.length === maxLines) break;
      }
    }
    if (lines.length < maxLines && current) lines.push(current);
    let truncated = lines.join(' ').length < title.length;
    while (lines.length > maxLines) {
      lines.pop();
      truncated = true;
    }
    if (truncated && lines.length) {
      const lastIndex = lines.length - 1;
      const maxLast = Math.max(1, maxLineLength - 1);
      lines[lastIndex] = `${lines[lastIndex].slice(0, maxLast).trimEnd()}…`;
    }
    return { title, lines: lines.length ? lines : [title.slice(0, maxLineLength)], truncated };
  }

  function isSecretKey(key) {
    return /secret|password|token|api[_-]?key|authorization|credential/i.test(String(key || ''));
  }

  function stringifyValue(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
      if (value.reason) return value.allowed === false ? `Denied — ${value.reason}` : String(value.reason);
      try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    }
    return String(value);
  }

  function summarizeMetadata(metadata = {}) {
    const rows = [];
    for (const [key, value] of Object.entries(metadata || {})) {
      const label = METADATA_LABELS[key] || titleCase(key);
      if (isSecretKey(key)) {
        rows.push({ key, label, value: '[REDACTED]', sensitive: true });
        continue;
      }
      const text = stringifyValue(value);
      if (!text) continue;
      rows.push({ key, label, value: text.length > 900 ? `${text.slice(0, 897)}…` : text });
    }
    return rows;
  }

  function eventKindLabel(event = {}) {
    if (event.toolDisplayName) return `${event.toolDisplayName} ${event.status || 'event'}`;
    return titleCase(String(event.type || 'event').replace(/^run\./, 'run '));
  }

  const api = {
    TOOL_NAME_MAP,
    EDGE_LABELS,
    formatToolName,
    edgeExplanation,
    wrapNodeLabel,
    summarizeMetadata,
    eventKindLabel,
    titleCase,
  };

  global.GraphPresenter = api;
})(typeof window !== 'undefined' ? window : globalThis);
