// Chat — the conversational "start an authorized operation" surface.
//
// React translation of the legacy frontend/js/chat.js + the WS wiring that
// lived in frontend/js/app.js. Renders a streaming transcript (assistant
// text, AI thinking blocks, tool cards with live output, inline approval
// cards) plus a composer with a scope selector and a stop control. All
// WebSocket plumbing is in useChatSocket (lib/chat-socket.ts), which speaks
// the server protocol verbatim.
//
// Renders INSIDE the shared AppShell — no sidebar/nav here, just a <main>.

import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { renderMarkdown } from '@/lib/chat-markdown';
import {
  useChatSocket,
  type ApprovalRequest,
  type TranscriptItem,
  type UseChatSocketOptions,
} from '@/lib/chat-socket';
import { useScopes } from '@/lib/scopes';

// ── Approval card ─────────────────────────────────────────────────────────

function approvalArgPreview(args: unknown): string {
  if (args && typeof args === 'object') {
    const a = args as Record<string, unknown>;
    const pick = a.command ?? a.path ?? a.url ?? a.query;
    if (typeof pick === 'string') return pick;
    try {
      return JSON.stringify(args).slice(0, 160);
    } catch {
      return '';
    }
  }
  return args == null ? '' : String(args);
}

interface ApprovalCardProps {
  request: ApprovalRequest;
  resolved: null | { decision: 'approve' | 'deny'; note: string; batch: boolean };
  onRespond: (input: {
    decision: 'approve' | 'deny';
    note: string;
    batch: { remaining: number; scopeId: string | null; risk: string | null } | null;
  }) => void;
}

function ApprovalCard({ request, resolved, onRespond }: ApprovalCardProps) {
  const isAllowOnce = request.kind === 'allow-once';
  const [note, setNote] = useState('');
  const [batchOn, setBatchOn] = useState(false);
  const [batchCount, setBatchCount] = useState(5);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const headline = isAllowOnce
    ? `Blocked: ${request.name}`
    : `Approval required: ${request.name}`;
  const sub = isAllowOnce
    ? 'Operator can grant a one-time exception.'
    : 'Operator approval required by scope policy.';
  const approveLabel = isAllowOnce ? 'Allow once' : 'Approve';
  const denyLabel = isAllowOnce ? 'Stay denied' : 'Deny';

  // Risk color via tokens (never hardcoded hex).
  const risk = (request.risk || '').toLowerCase();
  const riskColor =
    risk === 'critical' || risk === 'high'
      ? 'var(--warn-2)'
      : risk === 'low'
        ? 'var(--ok-2)'
        : 'var(--cy-2)';

  const send = (decision: 'approve' | 'deny') => {
    if (resolved) return;
    const batch =
      decision === 'approve' && batchOn && batchCount > 0
        ? { remaining: batchCount, scopeId: request.scopeId ?? null, risk: request.risk ?? null }
        : null;
    onRespond({ decision, note: note.trim(), batch });
  };

  // Keyboard shortcuts: y = approve, n = deny, Enter = approve (Esc blurs note).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (resolved) return;
    const inNote =
      e.target instanceof HTMLElement && e.target.tagName === 'INPUT' && e.target.dataset.note === '1';
    if (e.key === 'Escape' && inNote) {
      (e.target as HTMLElement).blur();
      return;
    }
    if (inNote && e.key !== 'Enter') return;
    const k = e.key.toLowerCase();
    if (k === 'y') {
      e.preventDefault();
      send('approve');
    } else if (k === 'n') {
      e.preventDefault();
      send('deny');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      send('approve');
    }
  };

  useEffect(() => {
    if (!resolved) {
      const t = setTimeout(() => cardRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [resolved]);

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-approval-id={request.approvalId}
      data-kind={isAllowOnce ? 'allow-once' : 'ask'}
      data-resolved={resolved ? resolved.decision : undefined}
      className="rounded-md border bg-card p-3 outline-none"
      style={{ borderColor: isAllowOnce ? 'var(--warn-2)' : 'var(--cy-2)' }}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="text-base leading-none">
          {isAllowOnce ? '⚠' : '🛡'}
        </span>
        <div className="flex-1 min-w-0">
          <strong className="block text-sm text-foreground">{headline}</strong>
          <small className="text-[12px] text-muted-foreground">{sub}</small>
        </div>
        {request.risk ? (
          <Badge
            className="bg-transparent font-mono uppercase"
            style={{ color: riskColor, borderColor: riskColor }}
          >
            {request.risk}
          </Badge>
        ) : null}
      </div>

      <dl className="mt-2 space-y-1 text-[12px]">
        <div className="flex gap-2">
          <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground w-14 shrink-0">
            Reason
          </dt>
          <dd className="text-foreground">{request.reason || 'No reason given.'}</dd>
        </div>
        {request.scopeName ? (
          <div className="flex gap-2">
            <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground w-14 shrink-0">
              Scope
            </dt>
            <dd className="text-foreground">{request.scopeName}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground w-14 shrink-0">
            Action
          </dt>
          <dd className="min-w-0">
            <code className="font-mono text-[11px] text-[var(--fg-2)] break-all">
              {approvalArgPreview(request.args)}
            </code>
          </dd>
        </div>
      </dl>

      {resolved ? (
        <p
          className="mt-2 font-mono text-[11px]"
          style={{ color: resolved.decision === 'approve' ? 'var(--ok-2)' : 'var(--warn-2)' }}
          data-testid="approval-status"
        >
          {resolved.decision === 'approve'
            ? `${isAllowOnce ? 'Allowed once' : 'Approved'} · executing${resolved.batch ? ` · batch ×${batchCount}` : ''}`
            : 'Denied'}
        </p>
      ) : (
        <>
          <label className="mt-2 block">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Note (optional, recorded in audit trace)
            </span>
            <Input
              data-note="1"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. covered by today's ROE"
              className="mt-1"
            />
          </label>

          {!isAllowOnce ? (
            <label className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={batchOn}
                onChange={(e) => setBatchOn(e.target.checked)}
                aria-label="Approve next matching calls"
              />
              <span>Approve next</span>
              <input
                type="number"
                min={1}
                max={100}
                value={batchCount}
                onChange={(e) => setBatchCount(parseInt(e.target.value, 10) || 0)}
                className="w-14 rounded border border-[var(--line-2)] bg-[var(--bg-3)] px-1 py-0.5 font-mono text-[12px]"
              />
              <span>
                matching <code className="font-mono">{request.risk || 'risky'}</code> calls
              </span>
            </label>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <Button variant="destructive" size="sm" onClick={() => send('deny')} data-decision="deny">
              {denyLabel}
            </Button>
            <span className="flex-1 font-mono text-[10px] text-muted-foreground">
              <kbd>y</kbd> approve · <kbd>n</kbd> deny · <kbd>Enter</kbd> submit
            </span>
            <Button variant="primary" size="sm" onClick={() => send('approve')} data-decision="approve">
              {approveLabel}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Transcript items ────────────────────────────────────────────────────

function AssistantBubble({ content, streaming }: { content: string; streaming: boolean }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return (
    <div className="rounded-md bg-[var(--bg-2)] px-3 py-2" data-role="assistant" data-streaming={streaming}>
      {content ? (
        <div
          className="prose prose-invert max-w-none text-sm leading-relaxed [&_p]:my-1"
          // Sanitized by DOMPurify in renderMarkdown.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : streaming ? (
        <span className="font-mono text-xs text-muted-foreground" aria-label="thinking">
          …
        </span>
      ) : null}
    </div>
  );
}

function ToolCard({
  item,
}: {
  item: Extract<TranscriptItem, { kind: 'tool' }>;
}) {
  const statusLabel =
    item.status === 'done' ? '✓' : item.status === 'waiting' ? 'WAIT' : '…';
  const statusColor =
    item.status === 'done'
      ? 'var(--ok-2)'
      : item.status === 'waiting'
        ? 'var(--warn-2)'
        : 'var(--cy-2)';
  return (
    <details className="rounded-md border border-border bg-card" open data-tool-id={item.id}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
        <span className="font-mono">⚡ {item.name}</span>
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {item.argsPreview}
        </span>
        <span className="font-mono text-[11px]" style={{ color: statusColor }} data-tool-status={item.status}>
          {statusLabel}
        </span>
      </summary>
      {item.output ? (
        <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 font-mono text-[11px] text-[var(--fg-2)]">
          {item.output}
        </pre>
      ) : null}
    </details>
  );
}

function ThinkingBlock({ content, done }: { content: string; done: boolean }) {
  return (
    <details className="rounded-md border border-dashed border-border bg-[var(--bg-2)]" open={!done}>
      <summary className="cursor-pointer px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        🧠 {done ? 'Thought process' : 'Thinking…'}
      </summary>
      <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] text-[var(--fg-3)]">
        {content}
      </div>
    </details>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export interface ChatPageProps {
  // Test seam: lets Chat.test.tsx inject a mock WebSocket factory.
  socketOptions?: UseChatSocketOptions;
}

export function ChatPage({ socketOptions }: ChatPageProps = {}) {
  const { toast } = useToast();
  const chat = useChatSocket(socketOptions);
  const { data: scopes } = useScopes();
  const [draft, setDraft] = useState('');
  const [scopeId, setScopeId] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new transcript items (best-effort; jsdom is a noop).
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.transcript]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || chat.isProcessing) return;
    chat.sendChat(draft, { scopeId: scopeId || null, uiContext: { route: 'chat', selectedScopeId: scopeId || null } });
    setDraft('');
  };

  const onApprovalResponse = (
    approvalId: string,
    input: {
      decision: 'approve' | 'deny';
      note: string;
      batch: { remaining: number; scopeId: string | null; risk: string | null } | null;
    },
  ) => {
    chat.respondApproval({ approvalId, ...input });
    toast({
      title: input.decision === 'approve' ? 'Approved' : 'Denied',
      description: input.batch ? `Batch ×${input.batch.remaining} armed` : undefined,
      variant: input.decision === 'approve' ? 'success' : 'warn',
    });
  };

  const connLabel =
    chat.connection === 'open' ? 'Connected' : chat.connection === 'connecting' ? 'Connecting…' : 'Disconnected';
  const connColor =
    chat.connection === 'open' ? 'var(--ok-2)' : chat.connection === 'connecting' ? 'var(--cy-2)' : 'var(--warn-2)';

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground font-sans">
      <div className="mx-auto flex w-full max-w-[900px] flex-1 flex-col px-4 py-4">
        <header className="mb-3 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              Start an authorized operation
            </p>
            <h1 className="text-2xl font-semibold text-foreground">{chat.title || 'Chat'}</h1>
          </div>
          <Tooltip content="WebSocket /ws — live run + approval stream" side="bottom">
            <span
              className="flex items-center gap-1.5 font-mono text-[11px]"
              style={{ color: connColor }}
              data-testid="chat-connection"
              data-state={chat.connection}
            >
              <span aria-hidden="true">●</span>
              {connLabel}
            </span>
          </Tooltip>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 space-y-2 overflow-y-auto pb-4"
          data-testid="chat-transcript"
          aria-live="polite"
        >
          {chat.transcript.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-card px-6 py-8 text-center">
              <p className="mb-1 font-mono text-xs uppercase tracking-[0.08em] text-[var(--fg-2)]">
                No messages yet
              </p>
              <p className="text-[13px] text-[var(--fg-3)]">
                Describe an operation. Tool calls become governed runs; risky actions
                surface inline approval cards.
              </p>
            </div>
          ) : (
            chat.transcript.map((item) => {
              switch (item.kind) {
                case 'user':
                  return (
                    <div key={item.id} className="flex justify-end" data-role="user">
                      <div className="max-w-[80%] rounded-md bg-[var(--cy-3)] px-3 py-2 text-sm text-[var(--cy-fg)] whitespace-pre-wrap break-words">
                        {item.content}
                      </div>
                    </div>
                  );
                case 'assistant':
                  return <AssistantBubble key={item.id} content={item.content} streaming={item.streaming} />;
                case 'thinking':
                  return <ThinkingBlock key={item.id} content={item.content} done={item.done} />;
                case 'tool':
                  return <ToolCard key={item.id} item={item} />;
                case 'approval':
                  return (
                    <ApprovalCard
                      key={item.id}
                      request={item.request}
                      resolved={item.resolved}
                      onRespond={(input) => onApprovalResponse(item.request.approvalId, input)}
                    />
                  );
                case 'artifact':
                  return (
                    <div key={item.id} className="flex items-center gap-2 text-[12px]" data-role="artifact">
                      <Badge variant="outline" className="font-mono">
                        {item.artifact.type || 'artifact'}
                      </Badge>
                      {item.artifact.contentUrl ? (
                        <a
                          href={item.artifact.contentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[var(--cy-2)] hover:underline"
                        >
                          {item.artifact.title || item.artifact.id} ↗
                        </a>
                      ) : (
                        <span className="text-foreground">{item.artifact.title || item.artifact.id}</span>
                      )}
                    </div>
                  );
                case 'system':
                  return (
                    <p key={item.id} className="text-center font-mono text-[11px] text-muted-foreground">
                      {item.content}
                    </p>
                  );
                case 'error':
                  return (
                    <div
                      key={item.id}
                      role="alert"
                      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      {item.content}
                    </div>
                  );
                default:
                  return null;
              }
            })
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={onSubmit} className="mt-2 border-t border-border pt-3" data-testid="chat-composer">
          <div className="mb-2 flex items-center gap-2">
            <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Scope
            </label>
            <select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              aria-label="Active scope"
              data-testid="chat-scope-select"
              className="rounded border border-[var(--line-2)] bg-[var(--bg-3)] px-2 py-1 font-mono text-[12px] text-foreground"
            >
              <option value="">No scope</option>
              {(scopes ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e);
                }
              }}
              placeholder="Describe the operation… (Enter to send, Shift+Enter for newline)"
              rows={2}
              aria-label="Message"
              data-testid="chat-input"
              className="flex-1 resize-none rounded-md border border-[var(--line-2)] bg-[var(--bg-3)] px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--cy-2)]"
            />
            {chat.isProcessing ? (
              <Button type="button" variant="destructive" onClick={chat.stop} data-testid="chat-stop">
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                disabled={!draft.trim() || chat.connection !== 'open'}
                data-testid="chat-send"
              >
                Send
              </Button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}

export default ChatPage;
