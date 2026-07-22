import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MapView from '@/components/MapView';
import VehicleSelector, { type VehicleQuote } from '@/components/VehicleSelector';
import BottomSheet from '@/components/ui/BottomSheet';
import { api } from '@/lib/api';
import type { LatLng, ServiceType, QuoteResult } from '@/lib/types';
import { inr } from '@/lib/format';

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
            city: import.meta.env.VITE_DEFAULT_CITY,
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
    setSubmitting(true); setError(null);
    try {
      const res = await api.post<{ id: string; order_no: string; otp: string }>('/orders', {
        service: selected,
        city: import.meta.env.VITE_DEFAULT_CITY,
        pickup: { lat: state.pickup.lat, lng: state.pickup.lng, address: state.pickup.address },
        drop:   { lat: state.drop.lat, lng: state.drop.lng, address: state.drop.address },
        payment_method: 'cash',
        parcel: isParcel ? parcel : undefined,
      });
      nav(`/track/${res.id}`, { replace: true });
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
                  ? `Continue · ${inr(quotes[selected]?.fare)}`
                  : `Confirm · ${inr(quotes[selected]?.fare)}`
                : 'Select a vehicle'}
          </button>
        </div>
      </div>

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
