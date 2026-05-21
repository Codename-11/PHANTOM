// ChatPage tests — jsdom has no WebSocket, so we inject a tiny mock via the
// page's socketOptions.wsFactory seam. Covers: sending a message (outbound
// 'chat' frame + user bubble), rendering an inbound run event (response_start
// + chunk → assistant bubble), and an inline approval card round-trip
// (approval_request → card → approval_response frame).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';

import { renderWithProviders } from '@/test/test-utils';
import { ChatPage } from './Chat';

// ── Mock WebSocket ──────────────────────────────────────────────────────

const OPEN = 1;

class MockSocket {
  static OPEN = OPEN;
  static last: MockSocket | null = null;

  url: string;
  readyState = OPEN;
  OPEN = OPEN;
  sent: string[] = [];

  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockSocket.last = this;
    // Open on next tick so the hook's onopen wiring is registered first.
    setTimeout(() => {
      this.readyState = OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  // Test helper: simulate an inbound server frame.
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  sentFrames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function renderChat() {
  const factory = (url: string) => new MockSocket(url) as unknown as WebSocket;
  return renderWithProviders(<ChatPage socketOptions={{ wsFactory: factory }} />);
}

beforeEach(() => {
  MockSocket.last = null;
  // useScopes() calls apiFetch('/api/scopes'); stub a quiet empty list.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

describe('ChatPage', () => {
  it('sends a chat message and renders the user bubble', async () => {
    renderChat();
    // Wait for the socket to open (Send enabled).
    await waitFor(() => {
      expect(screen.getByTestId('chat-connection')).toHaveAttribute('data-state', 'open');
    });

    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'enumerate the lab subnet' } });
    fireEvent.click(screen.getByTestId('chat-send'));

    // User bubble rendered.
    expect(screen.getByText('enumerate the lab subnet')).toBeInTheDocument();

    // Outbound 'chat' frame sent over the socket.
    const frames = MockSocket.last!.sentFrames();
    const chatFrame = frames.find((f) => f.type === 'chat');
    expect(chatFrame).toBeTruthy();
    expect(chatFrame!.content).toBe('enumerate the lab subnet');
  });

  it('renders an inbound run event (assistant chunk)', async () => {
    renderChat();
    await waitFor(() => {
      expect(screen.getByTestId('chat-connection')).toHaveAttribute('data-state', 'open');
    });

    const sock = MockSocket.last!;
    act(() => {
      sock.emit({ type: 'response_start', conversationId: 'conv-1' });
      sock.emit({ type: 'chunk', content: 'Scanning ', conversationId: 'conv-1' });
      sock.emit({ type: 'chunk', content: 'now.', conversationId: 'conv-1' });
      sock.emit({ type: 'response_end', conversationId: 'conv-1' });
    });

    await waitFor(() => {
      expect(screen.getByText(/Scanning now\./)).toBeInTheDocument();
    });
  });

  it('renders an inline approval card and sends approval_response on approve', async () => {
    renderChat();
    await waitFor(() => {
      expect(screen.getByTestId('chat-connection')).toHaveAttribute('data-state', 'open');
    });

    const sock = MockSocket.last!;
    act(() => {
      sock.emit({
        type: 'approval_request',
        approvalId: 'appr-xyz',
        toolCallId: 'tc-1',
        name: 'run_command',
        args: { command: 'nmap -sV 10.0.0.0/24' },
        kind: 'ask',
        risk: 'high',
        reason: 'Active scan requires approval',
        scopeId: 'scope-a',
        scopeName: 'Lab subnet',
        conversationId: 'conv-1',
      });
    });

    // Card visible with action preview.
    await waitFor(() => {
      expect(screen.getByText(/Approval required: run_command/)).toBeInTheDocument();
    });
    expect(screen.getByText(/nmap -sV 10\.0\.0\.0\/24/)).toBeInTheDocument();

    // Approve.
    fireEvent.click(screen.getByText('Approve'));

    // Outbound approval_response frame.
    await waitFor(() => {
      const frame = sock.sentFrames().find((f) => f.type === 'approval_response');
      expect(frame).toBeTruthy();
      expect(frame!.approvalId).toBe('appr-xyz');
      expect(frame!.decision).toBe('approve');
    });

    // Card settled.
    expect(screen.getByTestId('approval-status')).toHaveTextContent(/Approved/);
  });
});
