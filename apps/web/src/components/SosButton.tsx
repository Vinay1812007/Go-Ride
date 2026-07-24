// Floating SOS button for the trip screens (customer + captain).
//
// Two-step: tap the red button → confirm sheet with an optional note →
// send. Debounced against double-taps for 30s so a panicked press-and-
// hold doesn't spam the queue.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getCurrentPosition } from '@/lib/geo';
import BottomSheet from '@/components/ui/BottomSheet';
import { useToast } from '@/components/ui/Toast';

interface Props {
  orderId?: string;
  // Fallback location if GPS refuses — usually the pickup or a last-known.
  fallback?: { lat: number; lng: number };
}

const DEBOUNCE_MS = 30_000;

export default function SosButton({ orderId, fallback }: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<number>(() => {
    try {
      const v = localStorage.getItem('goride:sos:last');
      return v ? parseInt(v, 10) : 0;
    } catch { return 0; }
  });
  const toast = useToast();
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);

  // Tick the cooldown display every second while it's active.
  useEffect(() => {
    if (!lastSentAt) return;
    const tick = () => {
      const remaining = Math.max(0, DEBOUNCE_MS - (Date.now() - lastSentAt));
      setCooldownRemaining(Math.ceil(remaining / 1000));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [lastSentAt]);

  async function send() {
    if (sending) return;
    if (Date.now() - lastSentAt < DEBOUNCE_MS) {
      toast.error('SOS already sent moments ago. Support is on the way.');
      return;
    }
    setSending(true);
    try {
      // Grab freshest GPS, fall back if the browser refuses.
      let pos: { lat: number; lng: number };
      try {
        pos = await getCurrentPosition();
      } catch {
        if (!fallback) throw new Error('Location unavailable — allow location and try again');
        pos = fallback;
      }
      await api.post('/sos', {
        lat: pos.lat,
        lng: pos.lng,
        note: note.trim() || undefined,
        order_id: orderId,
      });
      const now = Date.now();
      setLastSentAt(now);
      try { localStorage.setItem('goride:sos:last', String(now)); } catch { /* private mode */ }
      setOpen(false);
      setNote('');
      toast.success('SOS sent. Support has been alerted with your location.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : (e as Error).message ?? 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const inCooldown = cooldownRemaining > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-30 h-12 w-12 rounded-full bg-red-600 text-white font-bold shadow-2xl grid place-items-center hover:bg-red-700 active:scale-95 transition"
        aria-label="SOS emergency"
        title="Emergency"
      >
        <span className="text-xs leading-tight">SOS</span>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="🚨 Emergency SOS">
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Sending an SOS alerts our support team immediately with your live location
            {orderId ? ' and current trip details' : ''}.
          </p>
          <label className="block">
            <span className="text-sm font-medium">Note (optional)</span>
            <textarea
              rows={3}
              className="input mt-1"
              placeholder="e.g. Feeling unsafe, driver is aggressive, following me…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </label>
          {inCooldown && (
            <div className="rounded-xl bg-amber-50 border border-amber-300 p-3 text-sm text-amber-900">
              SOS sent recently. If you're in immediate danger, call <a href="tel:112" className="font-bold underline">112</a> (India emergency) directly. You can send another SOS in {cooldownRemaining}s.
            </div>
          )}
          {!inCooldown && (
            <div className="rounded-xl bg-red-50 border border-red-300 p-3 text-xs text-red-900">
              If you're in immediate physical danger, call <a href="tel:112" className="font-bold underline">112</a> or your local emergency number first. Then send this SOS so our team can help.
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="btn-ghost flex-1">Cancel</button>
            <button
              onClick={send}
              disabled={sending || inCooldown}
              className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-50"
            >
              {sending ? 'Sending…' : inCooldown ? `Wait ${cooldownRemaining}s` : 'Send SOS'}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
