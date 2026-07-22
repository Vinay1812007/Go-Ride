// Rider (Captain) app shell — Day 2 milestone.
// Provides the online/offline toggle + earnings snapshot; offer card,
// KYC onboarding, trip lifecycle screens are Day 2 work.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function CaptainShell() {
  const { profile, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'offline' | 'online' | 'on_trip'>('offline');
  const [error, setError] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<{ today: number; week: number } | null>(null);

  useEffect(() => {
    api.get<{ rider: { status: 'offline' | 'online' | 'on_trip' } | null }>('/auth/me').then((r) => {
      if (r.rider) setStatus(r.rider.status);
    }).catch(() => {});
    api.get<{ transactions: Array<{ type: string; amount: number; created_at: string }> }>('/riders/earnings').then((r) => {
      const now = Date.now();
      const today = r.transactions.filter((t) => Date.now() - new Date(t.created_at).getTime() < 24 * 3_600_000 && t.type === 'trip_earning').reduce((s, t) => s + Number(t.amount), 0);
      const week  = r.transactions.filter((t) => Date.now() - new Date(t.created_at).getTime() < 7 * 24 * 3_600_000 && t.type === 'trip_earning').reduce((s, t) => s + Number(t.amount), 0);
      setEarnings({ today: Math.round(today), week: Math.round(week) });
      // silence unused
      void now;
    }).catch(() => {});
  }, []);

  async function toggle() {
    setBusy(true); setError(null);
    try {
      if (status === 'offline') {
        await api.post('/riders/online');
        setStatus('online');
      } else {
        await api.post('/riders/offline');
        setStatus('offline');
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to toggle');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full bg-surface-muted">
      <header className="bg-surface-strong text-white px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs opacity-80">Captain</div>
            <div className="font-bold">{profile?.full_name}</div>
          </div>
          <button onClick={signOut} className="text-xs opacity-80">Sign out</button>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-md mx-auto">
        <div className="card">
          <div className="text-sm text-slate-500 mb-2">You are</div>
          <div className={`text-2xl font-bold mb-3 ${status === 'online' ? 'text-green-600' : status === 'on_trip' ? 'text-brand-600' : 'text-slate-500'}`}>
            {status === 'online' ? 'ONLINE' : status === 'on_trip' ? 'ON TRIP' : 'OFFLINE'}
          </div>
          <button
            onClick={toggle}
            disabled={busy || status === 'on_trip'}
            className={status === 'offline' ? 'btn-primary w-full' : 'btn-secondary w-full'}
          >
            {busy ? '…' : status === 'offline' ? 'Go online' : 'Go offline'}
          </button>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="card">
            <div className="text-xs text-slate-500">Today</div>
            <div className="text-2xl font-bold">₹{earnings?.today ?? 0}</div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500">This week</div>
            <div className="text-2xl font-bold">₹{earnings?.week ?? 0}</div>
          </div>
        </div>

        <div className="card text-sm text-slate-500">
          <p className="font-medium text-surface-strong mb-1">Coming in Day 2</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Job offer screen with 20-second Accept / Reject</li>
            <li>Trip flow: Arrived → OTP → Start → Complete → Cash collect</li>
            <li>Foreground GPS streaming (Capacitor)</li>
            <li>KYC upload + status</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
