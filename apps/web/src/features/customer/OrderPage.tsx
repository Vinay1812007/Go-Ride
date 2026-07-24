import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MapView from '@/components/MapView';
import VehicleSelector, { type VehicleQuote } from '@/components/VehicleSelector';
import BottomSheet from '@/components/ui/BottomSheet';
import PromoInput from '@/components/PromoInput';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import { useCity } from '@/hooks/useCity';
import { api } from '@/lib/api';
import type { LatLng, ServiceType, QuoteResult } from '@/lib/types';
import { inr, scheduleLabel } from '@/lib/format';
import { cn } from '@/lib/cn';

interface OrderState {
  pickup: LatLng & { address: string };
  drop: LatLng & { address: string };
  category: 'ride' | 'parcel';
}

const RIDE_SERVICES: ServiceType[] = ['bike', 'auto', 'cab_4', 'cab_7'];
const PARCEL_SERVICES: ServiceType[] = ['parcel_bike', 'parcel_auto', 'parcel_truck'];

export default function OrderPage() {
  const nav = useNavigate();
  const state = useLocation().state as OrderState | null;

  const [quotes, setQuotes] = useState<Record<ServiceType, VehicleQuote>>({} as any);
  const [selected, setSelected] = useState<ServiceType | null>(null);
  const [polyline, setPolyline] = useState('');
  const [parcelOpen, setParcelOpen] = useState(false);
  const [parcel, setParcel] = useState({ weight_kg: 2, contents: '', receiver_name: '', receiver_phone: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Promo + wallet ─────────────────────────────────────────────────────
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState<number>(0);
  const [walletApply, setWalletApply] = useState(false);
  const { balance: walletBalance } = useWalletBalance();
  const { city } = useCity();

  // ── Scheduling ─────────────────────────────────────────────────────────
  // whenMode 'now' skips the picker; 'later' opens it inline. scheduledAt is
  // an ISO string in the user's local timezone (translated to UTC on submit
  // by the Date object). Bound: 31 min → 7d out to satisfy the API guard.
  const [whenMode, setWhenMode] = useState<'now' | 'later'>('now');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<string>('');
  const minLocal = useMemo(() => {
    // datetime-local expects "YYYY-MM-DDTHH:mm" in local time.
    const t = new Date(Date.now() + 31 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  }, []);
  const maxLocal = useMemo(() => {
    const t = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  }, []);

  const services = state?.category === 'parcel' ? PARCEL_SERVICES : RIDE_SERVICES;

  useEffect(() => {
    if (!state) { nav('/', { replace: true }); return; }
    const s = state; // narrow for the closure

    // Fetch a quote per candidate service in parallel.
    let cancelled = false;
    (async () => {
      // Initialize loading state
      const init: Record<string, VehicleQuote> = {};
      for (const svc of services) init[svc] = { service: svc, fare: 0, eta_min: 0, distance_km: 0, loading: true };
      setQuotes(init as any);

      const results = await Promise.allSettled(
        services.map((svc) =>
          api.post<QuoteResult>('/fare/quote', {
            pickup: { lat: s.pickup.lat, lng: s.pickup.lng },
            drop:   { lat: s.drop.lat, lng: s.drop.lng },
            service: svc,
            city: city,
          }),
        ),
      );

      if (cancelled) return;
      const next: Record<string, VehicleQuote> = {};
      results.forEach((r, i) => {
        const svc = services[i];
        if (!svc) return;
        if (r.status === 'fulfilled') {
          next[svc] = {
            service: svc,
            fare: r.value.fare,
            eta_min: r.value.duration_min,
            distance_km: r.value.distance_km,
          };
          if (!polyline && r.value.polyline) setPolyline(r.value.polyline);
        } else {
          next[svc] = { service: svc, fare: 0, eta_min: 0, distance_km: 0, unavailable: true };
        }
      });
      setQuotes(next as any);
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.pickup?.lat, state?.pickup?.lng, state?.drop?.lat, state?.drop?.lng, state?.category]);

  if (!state) return null;

  const isParcel = state.category === 'parcel';

  async function confirm() {
    if (!selected || !state) return;
    if (isParcel) {
      if (!parcelOpen) { setParcelOpen(true); return; }
      if (!parcel.contents || !parcel.receiver_name || !parcel.receiver_phone) {
        setError('Fill in receiver details before continuing');
        return;
      }
    }
    // Scheduling guard: if user chose 'later' but didn't pick a time yet,
    // open the picker instead of submitting.
    if (whenMode === 'later' && !scheduledAt) {
      setScheduleOpen(true);
      return;
    }
    setSubmitting(true); setError(null);
    try {
      const scheduledIso = whenMode === 'later' && scheduledAt
        ? new Date(scheduledAt).toISOString()
        : undefined;
      const res = await api.post<{ id: string; order_no: string; otp: string; status?: string }>('/orders', {
        service: selected,
        city: city,
        pickup: { lat: state.pickup.lat, lng: state.pickup.lng, address: state.pickup.address },
        drop:   { lat: state.drop.lat, lng: state.drop.lng, address: state.drop.address },
        payment_method: 'cash',
        parcel: isParcel ? parcel : undefined,
        scheduled_at: scheduledIso,
        promo_code: promoCode ?? undefined,
        wallet_apply: walletApply,
      });
      // Scheduled orders go to History → Upcoming; live orders go to Tracking.
      if (res.status === 'scheduled') {
        nav('/history?tab=upcoming', { replace: true });
      } else {
        nav(`/track/${res.id}`, { replace: true });
      }
    } catch (e: any) {
      setError(e.message ?? 'Could not create order');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="absolute top-0 inset-x-0 z-20 p-3">
        <button
          onClick={() => nav(-1)}
          className="rounded-xl bg-white shadow-card px-3 py-2 text-sm"
        >
          ← Back
        </button>
      </header>

      <div className="absolute inset-0">
        <MapView pickup={state.pickup} drop={state.drop} routePolyline={polyline} />
      </div>

      <div className="sheet z-10" style={{ bottom: 0 }}>
        <div className="sheet-handle" />
        <div className="px-5 pb-6 pt-1">
          <div className="mb-4">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span className="h-1.5 w-1.5 rounded-full bg-surface-strong" />
              <span className="truncate">{state.pickup.address}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              <span className="truncate">{state.drop.address}</span>
            </div>
          </div>

          <h2 className="text-lg font-bold mb-3">
            {isParcel ? 'Choose a delivery vehicle' : 'Choose a ride'}
          </h2>
          <VehicleSelector
            quotes={services.map((s) => quotes[s] ?? { service: s, fare: 0, eta_min: 0, distance_km: 0, loading: true })}
            selected={selected}
            onSelect={setSelected}
          />

          {/* Now / Later toggle */}
          <div className="mt-4 flex gap-2 bg-surface-muted rounded-xl p-1">
            <button
              type="button"
              onClick={() => { setWhenMode('now'); setScheduledAt(''); }}
              className={cn(
                'flex-1 text-sm py-2 rounded-lg font-medium transition',
                whenMode === 'now' ? 'bg-white shadow-card' : 'text-slate-500',
              )}
            >
              🕒 Pickup now
            </button>
            <button
              type="button"
              onClick={() => { setWhenMode('later'); setScheduleOpen(true); }}
              className={cn(
                'flex-1 text-sm py-2 rounded-lg font-medium transition',
                whenMode === 'later' ? 'bg-white shadow-card' : 'text-slate-500',
              )}
            >
              📅 Schedule
            </button>
          </div>
          {whenMode === 'later' && scheduledAt && (
            <button
              type="button"
              onClick={() => setScheduleOpen(true)}
              className="mt-2 w-full text-xs text-left px-3 py-2 rounded-lg bg-brand-50 border border-brand-200 text-brand-800"
            >
              Pickup {scheduleLabel(new Date(scheduledAt).toISOString())}
              <span className="text-brand-700 float-right">Change →</span>
            </button>
          )}

          {/* Promo + wallet */}
          {selected && (
            <div className="mt-4">
              <PromoInput
                service={selected}
                pickup={state.pickup}
                drop={state.drop}
                city={city}
                appliedCode={promoCode}
                appliedDiscount={promoDiscount}
                onApply={(c, d) => { setPromoCode(c); setPromoDiscount(d); }}
                onClear={() => { setPromoCode(null); setPromoDiscount(0); }}
                walletBalance={walletBalance}
                walletApply={walletApply}
                onWalletToggle={setWalletApply}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

          <button
            onClick={confirm}
            disabled={!selected || submitting}
            className="btn-primary w-full mt-4"
          >
            {submitting
              ? 'Confirming…'
              : selected
                ? isParcel && !parcelOpen
                  ? `Continue · ${inr(Math.max(0, (quotes[selected]?.fare ?? 0) - promoDiscount))}`
                  : whenMode === 'later'
                    ? `Schedule ride · ${inr(Math.max(0, (quotes[selected]?.fare ?? 0) - promoDiscount))}`
                    : `Confirm · ${inr(Math.max(0, (quotes[selected]?.fare ?? 0) - promoDiscount))}`
                : 'Select a vehicle'}
          </button>
        </div>
      </div>

      {/* Datetime picker sheet */}
      <BottomSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Pickup time"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Choose a pickup between 30 minutes and 7 days from now. We'll find
            you a captain about 5 minutes before pickup.
          </p>
          <input
            type="datetime-local"
            className="input"
            value={scheduledAt}
            min={minLocal}
            max={maxLocal}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          {scheduledAt && (
            <div className="text-sm rounded-xl bg-surface-muted p-3">
              Pickup <span className="font-semibold">{scheduleLabel(new Date(scheduledAt).toISOString())}</span>
            </div>
          )}
          <button
            onClick={() => { setWhenMode('later'); setScheduleOpen(false); }}
            disabled={!scheduledAt}
            className="btn-primary w-full"
          >
            Done
          </button>
        </div>
      </BottomSheet>

      {isParcel && (
        <BottomSheet
          open={parcelOpen}
          onClose={() => setParcelOpen(false)}
          title="Parcel details"
        >
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Weight (kg)</span>
              <input
                type="number"
                min={0.1}
                step={0.1}
                className="input mt-1"
                value={parcel.weight_kg}
                onChange={(e) => setParcel({ ...parcel, weight_kg: parseFloat(e.target.value || '0') })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Contents</span>
              <input
                className="input mt-1"
                placeholder="Documents, apparel, books…"
                value={parcel.contents}
                onChange={(e) => setParcel({ ...parcel, contents: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Receiver name</span>
              <input
                className="input mt-1"
                value={parcel.receiver_name}
                onChange={(e) => setParcel({ ...parcel, receiver_name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Receiver phone</span>
              <input
                type="tel"
                className="input mt-1"
                value={parcel.receiver_phone}
                onChange={(e) => setParcel({ ...parcel, receiver_phone: e.target.value })}
              />
            </label>

            <button onClick={confirm} className="btn-primary w-full mt-2">
              Book pickup
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
