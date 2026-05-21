// Dependency-free toast system. shadcn's canonical toast pulls in
// @radix-ui/react-toast; PHANTOM's bundle guardrail (see lib/utils.ts
// rationale + react-migration memory) says don't add Radix packs without
// a budget check, so this is a small self-contained context + portal.
//
// Usage:
//   const { toast } = useToast();
//   toast({ title: 'Saved', variant: 'success' });
// Mount <Toaster /> once near the app root (done in App.tsx via AppShell).
import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

type ToastVariant = 'default' | 'success' | 'error' | 'warn';

interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastInput, 'description'>> {
  id: number;
  description?: string;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const timers = React.useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = ++counter;
      const record: ToastRecord = {
        id,
        title: input.title,
        description: input.description,
        variant: input.variant ?? 'default',
        duration: input.duration ?? 4500,
      };
      setToasts((prev) => [...prev, record]);
      const timer = setTimeout(() => dismiss(id), record.duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  React.useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}

const variantAccent: Record<ToastVariant, string> = {
  default: 'border-l-[var(--cy-2)]',
  success: 'border-l-[var(--ok)]',
  error: 'border-l-[var(--danger)]',
  warn: 'border-l-[var(--warn)]',
};

function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          data-testid="toast"
          data-variant={t.variant}
          className={cn(
            'pointer-events-auto rounded-md border border-border border-l-4 bg-card px-3.5 py-2.5 text-card-foreground shadow-lg',
            'animate-in slide-in-from-right-4 fade-in-0 duration-200 motion-reduce:animate-none',
            variantAccent[t.variant],
          )}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-[12px] text-muted-foreground">{t.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export default ToastProvider;
