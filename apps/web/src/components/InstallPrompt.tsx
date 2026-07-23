// PWA install prompt.
// - Chrome/Edge/Android: captures the native `beforeinstallprompt` event and
//   surfaces a subtle bottom banner. Tapping "Install" triggers the browser's
//   own install dialog.
// - iOS Safari: no such event; we show one-time instructions instead.
// A dismissal is remembered in localStorage for 30 days so we don't nag.
import { useEffect, useState } from 'react';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'goride:install-dismissed-at';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function recentlyDismissed(): boolean {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    const t = parseInt(v, 10);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* noop */ }
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export default function InstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(recentlyDismissed());

  useEffect(() => {
    if (dismissed || isStandalone()) return;

    // Android / Chrome / Edge path
    const onBip = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    window.addEventListener('beforeinstallprompt', onBip);

    // iOS path — no beforeinstallprompt available. Show hint after a small
    // delay so it doesn't fight the first paint.
    let t: number | undefined;
    if (isIos()) {
      t = window.setTimeout(() => setShowIos(true), 3000);
    }

    // If the app finishes installing, hide instantly.
    const onInstalled = () => { setEvt(null); setShowIos(false); markDismissed(); };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
      if (t) window.clearTimeout(t);
    };
  }, [dismissed]);

  async function install() {
    if (!evt) return;
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === 'dismissed') markDismissed();
    } catch { /* user closed dialog */ }
    setEvt(null);
  }

  function dismiss() {
    markDismissed();
    setDismissed(true);
    setEvt(null);
    setShowIos(false);
  }

  if (dismissed) return null;

  if (evt) {
    return (
      <div className="fixed inset-x-3 bottom-3 z-40 max-w-md mx-auto card bg-surface-strong text-white shadow-xl border-none flex items-center gap-3 p-3 animate-slide-up">
        <div className="h-10 w-10 rounded-xl bg-brand-500 grid place-items-center flex-shrink-0 text-surface-strong font-bold">
          Go
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Install GoRide</div>
          <div className="text-xs text-slate-300 truncate">Faster launches, home-screen shortcut.</div>
        </div>
        <button
          type="button"
          onClick={install}
          className="btn-primary py-1.5 px-3 text-xs flex-shrink-0"
        >
          Install
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="text-slate-400 hover:text-white text-xl leading-none px-1"
        >
          ×
        </button>
      </div>
    );
  }

  if (showIos) {
    return (
      <div className="fixed inset-x-3 bottom-3 z-40 max-w-md mx-auto card bg-surface-strong text-white shadow-xl border-none p-3 animate-slide-up">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand-500 grid place-items-center flex-shrink-0 text-surface-strong font-bold">
            Go
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Add GoRide to Home Screen</div>
            <div className="text-xs text-slate-300 mt-0.5">
              Tap <span className="inline-block px-1 rounded bg-slate-700">Share</span> then{' '}
              <span className="inline-block px-1 rounded bg-slate-700">Add to Home Screen</span>.
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="text-slate-400 hover:text-white text-xl leading-none px-1"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return null;
}
