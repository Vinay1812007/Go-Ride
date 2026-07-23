// Tiny toast system — provider at the root, useToast() hook everywhere.
// No external deps. Top-right stack on desktop, top-center on mobile.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  message: string;
  variant: Variant;
  timeoutMs: number;
}

interface ToastCtx {
  show: (message: string, opts?: { variant?: Variant; timeoutMs?: number }) => void;
  success: (m: string, ms?: number) => void;
  error:   (m: string, ms?: number) => void;
  info:    (m: string, ms?: number) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, opts?: { variant?: Variant; timeoutMs?: number }) => {
    const t: Toast = {
      id: nextId++,
      message,
      variant: opts?.variant ?? 'info',
      timeoutMs: opts?.timeoutMs ?? 4000,
    };
    setToasts((prev) => [...prev, t]);
  }, []);

  const ctx: ToastCtx = {
    show,
    success: (m, ms) => show(m, { variant: 'success', timeoutMs: ms }),
    error:   (m, ms) => show(m, { variant: 'error',   timeoutMs: ms ?? 6000 }),
    info:    (m, ms) => show(m, { variant: 'info',    timeoutMs: ms }),
  };

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <div className="fixed z-[100] top-4 inset-x-0 md:left-auto md:right-4 md:inset-x-auto pointer-events-none">
        <div className="flex flex-col items-center md:items-end gap-2 px-4">
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), toast.timeoutMs);
    return () => clearTimeout(t);
  }, [toast.id, toast.timeoutMs, onDismiss]);

  const styles: Record<Variant, string> = {
    success: 'bg-emerald-600 text-white border-emerald-600',
    error:   'bg-red-600 text-white border-red-600',
    info:    'bg-surface-strong text-white border-surface-strong',
  };
  const icons: Record<Variant, string> = { success: '✓', error: '⚠', info: 'ℹ' };

  return (
    <div
      className={cn(
        'pointer-events-auto max-w-sm w-full rounded-xl shadow-2xl border px-4 py-3 text-sm',
        'flex items-start gap-3 animate-slide-up',
        styles[toast.variant],
      )}
      role="status"
    >
      <span aria-hidden className="text-lg leading-none pt-0.5">{icons[toast.variant]}</span>
      <div className="flex-1 min-w-0">{toast.message}</div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="opacity-70 hover:opacity-100 text-lg leading-none pt-0.5"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
