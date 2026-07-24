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
import EarningsPage from './EarningsPage';
import LeaderboardPage from './LeaderboardPage';
import WithdrawPage from './WithdrawPage';
import IncentivesPage from './IncentivesPage';
import CaptainSettingsPage from './CaptainSettingsPage';
import { useOffers } from './hooks/useOffers';
import { useRiderGps } from './hooks/useRiderGps';
import LoadingScreen from '@/components/ui/LoadingScreen';

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
  const [tripEndedFlash, setTripEndedFlash] = useState<string | null>(null);

  const rider = me?.rider ?? null;
  const status = rider?.status ?? 'offline';
  const uid = me?.profile.id ?? null;

  // Listen for 'trip_ended' broadcasts (customer cancel, admin force-cancel)
  // so the captain shell instantly reflects that they're free again.
  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel(`rider:${uid}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'trip_ended' }, async (msg) => {
        const reason = msg.payload?.reason ?? 'ended';
        setTripEndedFlash(
          reason === 'cancelled_customer' ? 'Customer cancelled — you\'re free to accept new trips.' :
          reason === 'cancelled_rider'    ? 'Trip cancelled.' :
          'Trip ended.',
        );
        await refresh();
        setTimeout(() => setTripEndedFlash(null), 6000);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, refresh]);

  // Also refresh profile when tab regains focus — cheap safety net.
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

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
        // Try to send an initial position on go-online so dispatch has a
        // fresh location right away, not after the first heartbeat.
        let initialLoc: { lat: number; lng: number } | undefined;
        try {
          const pos = await new Promise<GeolocationPosition>((res, rej) => {
            navigator.geolocation.getCurrentPosition(res, rej, {
              enableHighAccuracy: true, timeout: 8_000, maximumAge: 0,
            });
          });
          initialLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          // No location permission or timed out — still allow going online,
          // heartbeat will pick up the position once granted.
        }
        await api.post('/riders/online', initialLoc);
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
        <div className="flex items-center justify-between gap-3">
          <NavLink to="/captain/settings" className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-90 transition">
            <div className="w-11 h-11 rounded-full bg-brand-500 text-surface-strong flex items-center justify-center font-bold text-lg flex-shrink-0">
              {(me?.profile.full_name ?? 'C').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs opacity-80">Captain</div>
              <div className="font-bold truncate">{me?.profile.full_name ?? '…'}</div>
            </div>
          </NavLink>
          <NavLink to="/captain/settings" className="text-white/80 hover:text-white p-2" aria-label="Settings">
            <svg className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>
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

        {tripEndedFlash && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-500 p-3 text-sm text-emerald-800">
            {tripEndedFlash}
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
            disabled={busy || kycBlocked}
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
          {status === 'on_trip' && (
            <p className="text-xs text-slate-500 mt-2 text-center">
              Tapping "Go offline" while on trip will drop you from the current job.
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

        {/* Earnings — tap through to the full dashboard */}
        <NavLink
          to="/captain/earnings"
          className="grid grid-cols-2 gap-3 group"
          aria-label="View full earnings"
        >
          <div className="card transition group-hover:shadow-lg">
            <div className="text-xs text-slate-500">Today</div>
            <div className="text-2xl font-bold">{inr(earnings?.today ?? 0)}</div>
          </div>
          <div className="card transition group-hover:shadow-lg">
            <div className="text-xs text-slate-500 flex items-center justify-between">This week <span className="text-slate-400">→</span></div>
            <div className="text-2xl font-bold">{inr(earnings?.week ?? 0)}</div>
          </div>
        </NavLink>

        {/* Quick actions */}
        <div className="grid grid-cols-3 gap-2">
          <NavLink to="/captain/withdraw" className="card flex flex-col items-center py-3 hover:shadow-lg transition">
            <div className="text-2xl mb-1">💰</div>
            <div className="text-xs font-semibold">Withdraw</div>
          </NavLink>
          <NavLink to="/captain/incentives" className="card flex flex-col items-center py-3 hover:shadow-lg transition bg-gradient-to-b from-brand-50 to-white">
            <div className="text-2xl mb-1">🎯</div>
            <div className="text-xs font-semibold">Incentives</div>
          </NavLink>
          <NavLink to="/captain/leaderboard" className="card flex flex-col items-center py-3 hover:shadow-lg transition">
            <div className="text-2xl mb-1">🏆</div>
            <div className="text-xs font-semibold">Leaderboard</div>
          </NavLink>
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

  if (loading) return <LoadingScreen label="Getting your captain profile…" />;

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
      <Route path="earnings" element={<EarningsPage />} />
      <Route path="leaderboard" element={<LeaderboardPage />} />
      <Route path="withdraw" element={<WithdrawPage />} />
      <Route path="incentives" element={<IncentivesPage />} />
      <Route path="settings" element={<CaptainSettingsPage />} />
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
