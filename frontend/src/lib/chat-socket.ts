// useChatSocket — encapsulates the PHANTOM chat WebSocket lifecycle.
//
// Speaks the exact protocol implemented by the `ws` connection handler in
// server/index.js (see the `case 'chat':` block ~line 301 and requestApproval
// ~line 176). Inbound message types handled:
//   conversation_created  → adopt the server-assigned conversationId
//   response_start        → open a streaming assistant bubble
//   thinking              → append to the live "thinking" block
//   chunk                 → append assistant text (markdown re-rendered live)
//   tool_call             → close the assistant bubble, add a running tool card
//   tool_progress         → stream live text into the matching tool card
//   tool_result           → mark the tool card done + attach result
//   approval_request      → render an inline approval card (ask | allow-once)
//   artifact_created      → record an artifact reference (rendered as a chip)
//   title_updated         → expose the auto-generated conversation title
//   response_end          → close the assistant bubble, mark idle
//   error                 → push an error bubble, mark idle
//   pong                  → keepalive ack (ignored)
//
// Outbound message types sent:
//   chat              { content, conversationId, scopeId, profileId,
//                       operatorOverride, toolpackIds, uiContext }
//   stop              {}                       — aborts the active run
//   approval_response { approvalId, decision, note, batch }
//   ping              {}                       — keepalive
//
// WS URL derivation: we connect to a SAME-ORIGIN ws(s)://<host>/ws so the
// dev Vite proxy (forwards /ws → API server) and production (React served by
// the API server itself) both work without config. https → wss, http → ws.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── Transcript model ────────────────────────────────────────────────────

export type ApprovalKind = 'ask' | 'allow-once';
export type ApprovalDecision = 'approve' | 'deny';

export interface ApprovalRequest {
  approvalId: string;
  toolCallId?: string | null;
  name: string;
  args?: unknown;
  kind: ApprovalKind;
  risk?: string | null;
  reason?: string | null;
  gate?: string | null;
  scopeId?: string | null;
  scopeName?: string | null;
}

export interface ArtifactRef {
  id: string;
  title?: string;
  type?: string;
  contentUrl?: string;
}

export type TranscriptItem =
  | { kind: 'user'; id: string; content: string }
  | { kind: 'assistant'; id: string; content: string; streaming: boolean }
  | { kind: 'thinking'; id: string; content: string; done: boolean }
  | {
      kind: 'tool';
      id: string; // tool call id
      name: string;
      argsPreview: string;
      output: string;
      status: 'running' | 'done' | 'waiting';
    }
  | {
      kind: 'approval';
      id: string; // approvalId
      request: ApprovalRequest;
      resolved: null | { decision: ApprovalDecision; note: string; batch: boolean };
    }
  | { kind: 'system'; id: string; content: string }
  | { kind: 'error'; id: string; content: string }
  | { kind: 'artifact'; id: string; artifact: ArtifactRef };

// ── Outbound payloads ───────────────────────────────────────────────────

export interface OperatorOverride {
  enabled: boolean;
  reason?: string;
}

export interface SendChatOptions {
  scopeId?: string | null;
  profileId?: string | null;
  toolpackIds?: string[];
  operatorOverride?: OperatorOverride;
  uiContext?: Record<string, unknown> | null;
}

export interface ApprovalResponseInput {
  approvalId: string;
  decision: ApprovalDecision;
  note?: string;
  batch?: { remaining: number; scopeId: string | null; risk: string | null } | null;
}

export type ConnectionState = 'connecting' | 'open' | 'closed';

// ── WS URL ────────────────────────────────────────────────────────────────

// Same-origin URL so the dev Vite proxy and prod both resolve correctly.
// Guarded for non-browser/test environments where `location` is absent.
export function deriveWsUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost/ws';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

let _uid = 0;
function uid(prefix: string): string {
  _uid += 1;
  return `${prefix}-${Date.now()}-${_uid}`;
}

function argsPreview(args: unknown): string {
  if (args && typeof args === 'object') {
    const a = args as Record<string, unknown>;
    const pick = a.command ?? a.path ?? a.query ?? a.name ?? a.url;
    if (typeof pick === 'string') return pick;
    try {
      return JSON.stringify(args).slice(0, 120);
    } catch {
      return '';
    }
  }
  return args == null ? '' : String(args);
}

interface ServerMessage {
  type: string;
  conversationId?: string;
  runId?: string;
  content?: string;
  message?: string;
  // tool_call / tool_result / tool_progress
  id?: string;
  name?: string;
  args?: unknown;
  result?: string;
  text?: string;
  // approval_request
  approvalId?: string;
  toolCallId?: string | null;
  kind?: ApprovalKind;
  risk?: string | null;
  reason?: string | null;
  gate?: string | null;
  scopeId?: string | null;
  scopeName?: string | null;
  // title_updated
  title?: string;
  // artifact_created
  artifact?: ArtifactRef;
}

export interface UseChatSocketResult {
  transcript: TranscriptItem[];
  connection: ConnectionState;
  isProcessing: boolean;
  conversationId: string | null;
  title: string | null;
  sendChat: (content: string, opts?: SendChatOptions) => void;
  stop: () => void;
  respondApproval: (input: ApprovalResponseInput) => void;
  clear: () => void;
}

// `wsFactory` is injectable so tests can pass a mock WebSocket (jsdom has no
// WS). In the browser it defaults to the global WebSocket.
export interface UseChatSocketOptions {
  url?: string;
  wsFactory?: (url: string) => WebSocket;
  autoConnect?: boolean;
}

export function useChatSocket(opts: UseChatSocketOptions = {}): UseChatSocketResult {
  const url = opts.url ?? deriveWsUrl();
  const autoConnect = opts.autoConnect ?? true;
  const wsFactory = useMemo(
    () => opts.wsFactory ?? ((u: string) => new WebSocket(u)),
    [opts.wsFactory],
  );

  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [isProcessing, setIsProcessing] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);
  // Live assistant bubble id so streamed chunks land in the same item.
  const assistantId = useRef<string | null>(null);
  const thinkingId = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  const append = useCallback((item: TranscriptItem) => {
    setTranscript((prev) => [...prev, item]);
  }, []);

  const handleMessage = useCallback((msg: ServerMessage) => {
    // Session isolation: ignore messages for a different conversation, mirroring
    // the legacy guard. conversation_created / title_updated / pong always pass.
    if (
      msg.conversationId &&
      conversationIdRef.current &&
      msg.conversationId !== conversationIdRef.current &&
      msg.type !== 'conversation_created' &&
      msg.type !== 'title_updated' &&
      msg.type !== 'pong'
    ) {
      return;
    }

    switch (msg.type) {
      case 'conversation_created': {
        conversationIdRef.current = msg.conversationId ?? null;
        setConversationId(msg.conversationId ?? null);
        break;
      }
      case 'response_start': {
        const id = uid('assistant');
        assistantId.current = id;
        thinkingId.current = null;
        append({ kind: 'assistant', id, content: '', streaming: true });
        setIsProcessing(true);
        break;
      }
      case 'thinking': {
        const chunk = msg.content ?? '';
        setTranscript((prev) => {
          if (thinkingId.current) {
            return prev.map((it) =>
              it.kind === 'thinking' && it.id === thinkingId.current
                ? { ...it, content: it.content + chunk }
                : it,
            );
          }
          const id = uid('thinking');
          thinkingId.current = id;
          return [...prev, { kind: 'thinking', id, content: chunk, done: false }];
        });
        break;
      }
      case 'chunk': {
        const chunk = msg.content ?? '';
        setTranscript((prev) => {
          if (assistantId.current) {
            return prev.map((it) =>
              it.kind === 'assistant' && it.id === assistantId.current
                ? { ...it, content: it.content + chunk, streaming: true }
                : it,
            );
          }
          const id = uid('assistant');
          assistantId.current = id;
          return [...prev, { kind: 'assistant', id, content: chunk, streaming: true }];
        });
        break;
      }
      case 'tool_call': {
        // Close the current assistant bubble + thinking block.
        closeStreaming();
        append({
          kind: 'tool',
          id: String(msg.id),
          name: String(msg.name ?? 'tool'),
          argsPreview: argsPreview(msg.args),
          output: '',
          status: 'running',
        });
        break;
      }
      case 'tool_progress': {
        setTranscript((prev) =>
          prev.map((it) =>
            it.kind === 'tool' && it.id === String(msg.id)
              ? { ...it, output: it.output + (msg.text ?? '') }
              : it,
          ),
        );
        break;
      }
      case 'tool_result': {
        setTranscript((prev) =>
          prev.map((it) =>
            it.kind === 'tool' && it.id === String(msg.id)
              ? { ...it, status: 'done', output: msg.result ?? it.output ?? 'No output' }
              : it,
          ),
        );
        break;
      }
      case 'approval_request': {
        closeStreaming();
        const request: ApprovalRequest = {
          approvalId: String(msg.approvalId),
          toolCallId: msg.toolCallId ?? null,
          name: String(msg.name ?? 'tool'),
          args: msg.args,
          kind: msg.kind === 'allow-once' ? 'allow-once' : 'ask',
          risk: msg.risk ?? null,
          reason: msg.reason ?? null,
          gate: msg.gate ?? null,
          scopeId: msg.scopeId ?? null,
          scopeName: msg.scopeName ?? null,
        };
        append({ kind: 'approval', id: request.approvalId, request, resolved: null });
        // Flip the matching tool card (if present) to "waiting".
        if (msg.toolCallId) {
          setTranscript((prev) =>
            prev.map((it) =>
              it.kind === 'tool' && it.id === String(msg.toolCallId)
                ? { ...it, status: 'waiting' }
                : it,
            ),
          );
        }
        break;
      }
      case 'artifact_created': {
        if (msg.artifact) {
          append({ kind: 'artifact', id: uid('artifact'), artifact: msg.artifact });
        }
        break;
      }
      case 'title_updated': {
        if (msg.title) setTitle(msg.title);
        break;
      }
      case 'response_end': {
        closeStreaming();
        setIsProcessing(false);
        break;
      }
      case 'error': {
        closeStreaming();
        append({ kind: 'error', id: uid('error'), content: msg.message ?? 'Unknown error' });
        setIsProcessing(false);
        break;
      }
      case 'pong':
        break;
      default:
        break;
    }

    function closeStreaming() {
      setTranscript((prev) =>
        prev.map((it) => {
          if (it.kind === 'assistant' && it.id === assistantId.current) {
            return { ...it, streaming: false };
          }
          if (it.kind === 'thinking' && it.id === thinkingId.current) {
            return { ...it, done: true };
          }
          return it;
        }),
      );
      assistantId.current = null;
      thinkingId.current = null;
    }
  }, [append]);

  const connect = useCallback(() => {
    closedByUs.current = false;
    setConnection('connecting');
    let ws: WebSocket;
    try {
      ws = wsFactory(url);
    } catch {
      setConnection('closed');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttempts.current = 0;
      setConnection('open');
      if (pingTimer.current) clearInterval(pingTimer.current);
      pingTimer.current = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 30000);
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      handleMessage(msg);
    };

    ws.onclose = () => {
      setConnection('closed');
      if (pingTimer.current) {
        clearInterval(pingTimer.current);
        pingTimer.current = null;
      }
      if (!closedByUs.current && reconnectAttempts.current < 8) {
        reconnectAttempts.current += 1;
        const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      // onclose will fire and drive reconnect; nothing extra needed.
    };
  }, [url, wsFactory, handleMessage]);

  useEffect(() => {
    if (!autoConnect) return;
    connect();
    return () => {
      closedByUs.current = true;
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try {
        wsRef.current?.close();
      } catch {
        /* noop */
      }
    };
    // connect identity changes only when url/factory change, which should
    // recreate the socket — intended.
  }, [autoConnect, connect]);

  const sendChat = useCallback(
    (content: string, sendOpts: SendChatOptions = {}) => {
      const ws = wsRef.current;
      const text = content.trim();
      if (!text) return;
      append({ kind: 'user', id: uid('user'), content: text });
      if (!ws || ws.readyState !== ws.OPEN) {
        append({
          kind: 'error',
          id: uid('error'),
          content: 'Not connected to server. Trying to reconnect…',
        });
        connect();
        return;
      }
      setIsProcessing(true);
      ws.send(
        JSON.stringify({
          type: 'chat',
          content: text,
          conversationId: conversationIdRef.current,
          scopeId: sendOpts.scopeId ?? null,
          profileId: sendOpts.profileId ?? null,
          operatorOverride: sendOpts.operatorOverride ?? { enabled: false },
          toolpackIds: sendOpts.toolpackIds ?? [],
          uiContext: sendOpts.uiContext ?? { route: 'chat' },
        }),
      );
    },
    [append, connect],
  );

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
    }
  }, []);

  const respondApproval = useCallback(
    (input: ApprovalResponseInput) => {
      const ws = wsRef.current;
      // Settle the card locally regardless of socket state.
      setTranscript((prev) =>
        prev.map((it) =>
          it.kind === 'approval' && it.id === input.approvalId
            ? {
                ...it,
                resolved: {
                  decision: input.decision,
                  note: input.note ?? '',
                  batch: !!input.batch && (input.batch.remaining ?? 0) > 0,
                },
              }
            : it,
        ),
      );
      if (!ws || ws.readyState !== ws.OPEN) return;
      ws.send(
        JSON.stringify({
          type: 'approval_response',
          approvalId: input.approvalId,
          decision: input.decision,
          note: input.note ?? '',
          batch: input.batch ?? null,
        }),
      );
    },
    [],
  );

  const clear = useCallback(() => {
    setTranscript([]);
    setTitle(null);
    setIsProcessing(false);
    assistantId.current = null;
    thinkingId.current = null;
  }, []);

  return {
    transcript,
    connection,
    isProcessing,
    conversationId,
    title,
    sendChat,
    stop,
    respondApproval,
    clear,
  };
}
