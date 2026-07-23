// Full-screen job offer card with a 20-second countdown ring.
// Rider taps Accept → routes to /captain/trip/:id. Reject → dismisses locally.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { inr, km, minutes, serviceLabel } from '@/lib/format';
import type { Offer } from './hooks/useOffers';

interface Props {
  offer: Offer;
  onDismiss: (orderId: string) => void;
}

export default function OfferCard({ offer, onDismiss }: Props) {
  const nav = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState(20);
  const [busy, setBusy] = useState<null | 'accept' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);

  // Countdown
  useEffect(() => {
    const expiresAt = new Date(offer.expires_at).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [offer.expires_at]);

  useEffect(() => {
    if (secondsLeft <= 0 && !busy) onDismiss(offer.order_id);
  }, [secondsLeft, busy, offer.order_id, onDismiss]);

  async function accept() {
    setBusy('accept'); setError(null);
    try {
      await api.post(`/rides/${offer.order_id}/accept`);
      nav(`/captain/trip/${offer.order_id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not accept');
      setBusy(null);
      // If it's gone (409), dismiss it — someone else got it
      if (e instanceof ApiError && e.status === 409) onDismiss(offer.order_id);
    }
  }

  async function reject() {
    setBusy('reject');
    try {
      await api.post(`/rides/${offer.order_id}/reject`).catch(() => { /* fire-and-forget */ });
    } finally {
      onDismiss(offer.order_id);
    }
  }

  const o = offer.order;
  const earning = o.fare_breakup?.rider_earning ?? (o.fare_estimate != null ? Math.round(o.fare_estimate * 0.85) : null);

  // Countdown ring — SVG circle stroke-dashoffset based on remaining seconds
  const RING_R = 40;
  const RING_CIRC = 2 * Math.PI * RING_R;
  const ringProgress = (secondsLeft / 20) * RING_CIRC;

  return (
    <div className="fixed inset-0 z-[70] bg-surface-strong/95 backdrop-blur-sm flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-md p-4">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Countdown header */}
          <div className="bg-brand-500 px-6 py-5 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-surface-strong/70">
                New Trip · {serviceLabel(o.service)}
              </div>
              <div className="text-3xl font-bold text-surface-strong">{inr(earning ?? 0)}</div>
              <div className="text-xs text-surface-strong/70">Your earning</div>
            </div>
            <div className="relative h-24 w-24">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r={RING_R} stroke="rgba(15,23,42,0.15)" strokeWidth="8" fill="none" />
                <circle
                  cx="50" cy="50" r={RING_R}
                  stroke="#0F172A"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRC}
                  strokeDashoffset={RING_CIRC - ringProgress}
                  style={{ transition: 'stroke-dashoffset 250ms linear' }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-2xl font-bold text-surface-strong">
                {secondsLeft}
              </div>
            </div>
          </div>

          {/* Route */}
          <div className="p-5 space-y-3">
            <div className="flex items-start gap-3">
              <span className="mt-1 inline-block h-2 w-2 rounded-full bg-surface-strong" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase text-slate-400 font-medium">Pickup</div>
                <div className="text-sm truncate">{o.pickup_address}</div>
              </div>
              {offer.distance_km != null && (
                <span className="chip">{km(offer.distance_km)} away</span>
              )}
            </div>
            <div className="ml-1 h-4 w-px bg-slate-200" />
            <div className="flex items-start gap-3">
              <span className="mt-1 inline-block h-2 w-2 rounded-full bg-brand-500" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase text-slate-400 font-medium">Drop</div>
                <div className="text-sm truncate">{o.drop_address}</div>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-4 text-xs text-slate-500">
              <span>{km(o.distance_km)}</span>
              <span>·</span>
              <span>{minutes(o.duration_min)}</span>
              <span>·</span>
              <span>Fare {inr(o.fare_estimate)}</span>
            </div>
          </div>

          {error && <p className="px-5 pb-2 text-sm text-red-600">{error}</p>}

          {/* Actions */}
          <div className="grid grid-cols-5 gap-2 p-4 pt-0">
            <button
              onClick={reject}
              disabled={!!busy}
              className="col-span-2 h-14 rounded-2xl bg-slate-100 text-slate-600 font-semibold active:scale-95 transition disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={accept}
              disabled={!!busy}
              className="col-span-3 h-14 rounded-2xl bg-emerald-500 text-white font-bold active:scale-95 transition disabled:opacity-50"
            >
              {busy === 'accept' ? 'Accepting…' : 'Accept'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
