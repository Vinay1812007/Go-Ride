// Captain (rider) shell. Routes:
//   /captain           — home (status + earnings + KYC banner + live offer overlay)
//   /captain/onboard   — first-time onboarding form
//   /captain/trip/:id  — trip lifecycle
// The shell owns the realtime offer subscription and the GPS heartbeat.
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { inr } from '@/lib/format';
import OnboardPage from './OnboardPage';
import TripPage from './TripPage';
import OfferCard from './OfferCard';
import { useOffers } from './hooks/useOffers';
import { useRiderGps } from './hooks/useRiderGps';

interface Rider {
  status: 'offline' | 'online' | 'on_trip';
  vehicle_type: string;
  vehicle_number: string;
  kyc: 'pending' | 'approved' | 'rejected';
  city: string;
  wallet_balance: number;
  total_trips: number;
}

interface MeResponse {
  profile: { id: string; full_name: string; rating: number };
  rider: Rider | null;
}

interface Earnings {
  today: number;
  week: number;
}

function useMe() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      const r = await api.get<MeResponse>('/auth/me');
      setMe(r);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  return { me, loading, refresh: load };
}

function useCurrentTrip(uid: string | null, isOnTrip: boolean) {
  const [tripId, setTripId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid || !isOnTrip) { setTripId(null); return; }
    void (async () => {
      const { data } = await supabase
        .from('orders')
        .select('id')
        .eq('rider_id', uid)
        .in('status', ['accepted', 'arrived', 'picked_up', 'in_transit'])
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setTripId(data.id);
    })();
  }, [uid, isOnTrip]);
  return tripId;
}

function HomePage({ me, refresh }: { me: MeResponse | null; refresh: () => Promise<void> }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);

  const rider = me?.rider ?? null;
  const status = rider?.status ?? 'offline';
  const uid = me?.profile.id ?? null;

  // Live offers (only when online)
  const { offers, dismiss } = useOffers({ uid, enabled: status === 'online' });

  // GPS heartbeat (while online — trip page will also mount its own with order_id)
  useRiderGps({ enabled: status === 'online' });

  // Currently active trip? Auto-navigate.
  const tripId = useCurrentTrip(uid, status === 'on_trip');
  useEffect(() => {
    if (tripId) nav(`/captain/trip/${tripId}`, { replace: true });
  }, [tripId, nav]);

  // Earnings summary
  useEffect(() => {
    api.get<{ transactions: Array<{ type: string; amount: number; created_at: string }> }>('/riders/earnings')
      .then((r) => {
        const dayMs = 86_400_000;
        const now = Date.now();
        const today = r.transactions
          .filter((t) => now - new Date(t.created_at).getTime() < dayMs && t.type === 'trip_earning')
          .reduce((s, t) => s + Number(t.amount), 0);
        const week = r.transactions
          .filter((t) => now - new Date(t.created_at).getTime() < 7 * dayMs && t.type === 'trip_earning')
          .reduce((s, t) => s + Number(t.amount), 0);
        setEarnings({ today: Math.round(today), week: Math.round(week) });
      })
      .catch(() => { /* silent */ });
  }, []);

  async function toggle() {
    setBusy(true); setError(null);
    try {
      if (status === 'offline') {
        await api.post('/riders/online');
      } else {
        await api.post('/riders/offline');
      }
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to toggle');
    } finally {
      setBusy(false);
    }
  }

  const kycBlocked = rider?.kyc !== 'approved';

  return (
    <div className="min-h-full bg-surface-muted">
      {/* Show live offer overlay when one arrives */}
      {offers.length > 0 && <OfferCard offer={offers[0]!} onDismiss={dismiss} />}

      <header className="bg-surface-strong text-white px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs opacity-80">Captain</div>
            <div className="font-bold">{me?.profile.full_name ?? '…'}</div>
          </div>
          <NavLink to="/" className="text-xs opacity-80 underline">
            Switch to rider
          </NavLink>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-md mx-auto">
        {/* KYC banner */}
        {rider?.kyc === 'pending' && (
          <div className="rounded-xl bg-amber-50 border border-amber-500 p-3 text-sm">
            <div className="font-semibold text-amber-900">KYC review pending</div>
            <div className="text-amber-800 text-xs mt-0.5">
              An admin will approve your account shortly. You can go online once approved.
            </div>
          </div>
        )}
        {rider?.kyc === 'rejected' && (
          <div className="rounded-xl bg-red-50 border border-red-500 p-3 text-sm">
            <div className="font-semibold text-red-900">KYC rejected</div>
            <div className="text-red-800 text-xs mt-0.5">Please contact support to re-apply.</div>
          </div>
        )}

        {/* Status card */}
        <div className="card">
          <div className="text-sm text-slate-500 mb-2">You are</div>
          <div className={`text-3xl font-bold mb-3 ${
            status === 'online' ? 'text-emerald-600' :
            status === 'on_trip' ? 'text-brand-600' :
            'text-slate-400'
          }`}>
            {status === 'on_trip' ? 'ON TRIP' : status.toUpperCase()}
          </div>
          <button
            onClick={toggle}
            disabled={busy || kycBlocked || status === 'on_trip'}
            className={status === 'offline' ? 'btn-primary w-full h-14 text-lg' : 'btn-secondary w-full h-14 text-lg'}
          >
            {busy ? '…' : kycBlocked ? 'Awaiting KYC approval' : status === 'offline' ? 'Go online' : 'Go offline'}
          </button>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          {status === 'online' && (
            <p className="text-xs text-slate-500 mt-2 text-center">
              Location is being shared while you're online.
            </p>
          )}
        </div>

        {/* Vehicle info */}
        {rider && (
          <div className="card flex items-center gap-3">
            <div className="text-3xl">
              {rider.vehicle_type === 'auto' ? '🛺' :
               rider.vehicle_type.startsWith('cab_') ? '🚗' :
               rider.vehicle_type === 'parcel_truck' ? '🚚' : '🛵'}
            </div>
            <div className="flex-1">
              <div className="text-xs text-slate-500 uppercase">Your ride</div>
              <div className="font-semibold">{rider.vehicle_number}</div>
              <div className="text-xs text-slate-500">{rider.city}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">Trips</div>
              <div className="font-bold text-lg">{rider.total_trips}</div>
            </div>
          </div>
        )}

        {/* Earnings */}
        <div className="grid grid-cols-2 gap-3">
          <div className="card">
            <div className="text-xs text-slate-500">Today</div>
            <div className="text-2xl font-bold">{inr(earnings?.today ?? 0)}</div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500">This week</div>
            <div className="text-2xl font-bold">{inr(earnings?.week ?? 0)}</div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 pt-2">
          Pull to refresh. Offers arrive automatically while online.
        </p>
      </div>
    </div>
  );
}

export default function CaptainShell() {
  const { me, loading, refresh } = useMe();

  if (loading) return <div className="h-full grid place-items-center">Loading…</div>;

  // Signed in but not yet a rider? Send to onboarding.
  const needsOnboarding = !me?.rider;

  return (
    <Routes>
      <Route
        index
        element={
          needsOnboarding
            ? <Navigate to="/captain/onboard" replace />
            : <HomePage me={me} refresh={refresh} />
        }
      />
      <Route path="onboard" element={<OnboardPage />} />
      <Route path="trip/:orderId" element={<TripPageWithGps />} />
      <Route path="*" element={<Navigate to="/captain" replace />} />
    </Routes>
  );
}

// Wrap TripPage in the GPS heartbeat during on-trip.
function TripPageWithGps() {
  const orderId = window.location.pathname.split('/').pop();
  useRiderGps({ enabled: true, orderId });
  return <TripPage />;
}
