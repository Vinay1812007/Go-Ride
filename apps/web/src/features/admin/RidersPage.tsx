// Admin — riders list with KYC approve/reject + block.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { serviceLabel } from '@/lib/format';
import type { ServiceType } from '@/lib/types';

type KycStatus = 'pending' | 'approved' | 'rejected';

interface RiderRow {
  id: string;
  status: 'offline' | 'online' | 'on_trip';
  vehicle_type: ServiceType;
  vehicle_number: string;
  vehicle_model?: string | null;
  license_number?: string | null;
  city: string;
  kyc: KycStatus;
  total_trips: number;
  wallet_balance: number;
  profiles: {
    full_name: string;
    phone: string | null;
    email: string | null;
    rating: number;
    blocked: boolean;
  };
}

const FILTERS: Array<{ label: string; value: KycStatus | 'all' }> = [
  { label: 'Pending',  value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'All',      value: 'all' },
];

export default function RidersPage() {
  const [filter, setFilter] = useState<KycStatus | 'all'>('pending');
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const url = filter === 'all' ? '/admin/riders' : `/admin/riders?kyc=${filter}`;
      const res = await api.get<{ riders: RiderRow[] }>(url);
      setRiders(res.riders);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load riders');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter]);

  async function decide(riderId: string, decision: 'approved' | 'rejected') {
    setDecisionBusy(riderId);
    try {
      await api.post(`/admin/riders/${riderId}/kyc?decision=${decision}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Decision failed');
    } finally {
      setDecisionBusy(null);
    }
  }

  async function toggleBlock(profileId: string, blocked: boolean) {
    try {
      await api.post(`/admin/profiles/${profileId}/block?blocked=${blocked}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Block failed');
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Riders</h1>
        <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                filter === f.value ? 'bg-surface-strong text-white' : 'text-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {loading && <div className="text-center text-sm text-slate-500 py-8">Loading…</div>}

      {!loading && riders.length === 0 && (
        <div className="card text-center py-10 text-slate-500">No riders in this bucket.</div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {riders.map((r) => (
          <div key={r.id} className="card">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="font-semibold">{r.profiles.full_name}</div>
                <div className="text-xs text-slate-500">
                  {r.profiles.email ?? '—'}
                  {r.profiles.phone && ` · ${r.profiles.phone}`}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  ★ {(r.profiles.rating ?? 5.0).toFixed(1)} · {r.total_trips} trips
                </div>
              </div>
              <KycBadge status={r.kyc} />
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-3">
              <div className="text-slate-500">Vehicle</div>
              <div>{serviceLabel(r.vehicle_type)}</div>
              <div className="text-slate-500">Plate</div>
              <div className="font-mono">{r.vehicle_number}</div>
              {r.vehicle_model && <>
                <div className="text-slate-500">Model</div>
                <div>{r.vehicle_model}</div>
              </>}
              <div className="text-slate-500">Licence</div>
              <div className="font-mono">{r.license_number ?? '—'}</div>
              <div className="text-slate-500">City</div>
              <div>{r.city}</div>
              <div className="text-slate-500">Status</div>
              <div>{r.status}</div>
            </dl>

            <div className="flex gap-2">
              {r.kyc !== 'approved' && (
                <button
                  onClick={() => decide(r.id, 'approved')}
                  disabled={decisionBusy === r.id}
                  className="btn-primary flex-1 h-10"
                >
                  {decisionBusy === r.id ? '…' : 'Approve'}
                </button>
              )}
              {r.kyc !== 'rejected' && (
                <button
                  onClick={() => decide(r.id, 'rejected')}
                  disabled={decisionBusy === r.id}
                  className="btn-ghost flex-1 h-10 text-red-600 border border-surface-border"
                >
                  Reject
                </button>
              )}
              <button
                onClick={() => toggleBlock(r.id, !r.profiles.blocked)}
                className="btn-ghost h-10 text-slate-500 border border-surface-border px-3"
                title={r.profiles.blocked ? 'Unblock' : 'Block'}
              >
                {r.profiles.blocked ? '🔓' : '🔒'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KycBadge({ status }: { status: KycStatus }) {
  const styles = {
    pending:  'bg-amber-50 text-amber-800 border border-amber-400',
    approved: 'bg-emerald-50 text-emerald-800 border border-emerald-400',
    rejected: 'bg-red-50 text-red-800 border border-red-400',
  } as const;
  return <span className={`chip ${styles[status]}`}>{status}</span>;
}
