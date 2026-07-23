// Admin — riders list with KYC approve/reject + block.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { serviceLabel } from '@/lib/format';
import type { ServiceType } from '@/lib/types';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import Spinner from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

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
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const url = filter === 'all' ? '/admin/riders' : `/admin/riders?kyc=${filter}`;
      const res = await api.get<{ riders: RiderRow[] }>(url);
      setRiders(res.riders);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load riders');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter]);

  async function decide(riderId: string, decision: 'approved' | 'rejected') {
    setDecisionBusy(riderId);
    try {
      await api.post(`/admin/riders/${riderId}/kyc?decision=${decision}`);
      toast.success(decision === 'approved' ? 'Captain approved.' : 'Captain rejected.');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Decision failed');
    } finally {
      setDecisionBusy(null);
    }
  }

  async function toggleBlock(profileId: string, blocked: boolean) {
    try {
      await api.post(`/admin/profiles/${profileId}/block?blocked=${blocked}`);
      toast.success(blocked ? 'Captain blocked.' : 'Captain unblocked.');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Block failed');
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

      {loading && riders.length === 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-24 mt-2" />
                </div>
                <Skeleton className="h-6 w-16" rounded="full" />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {Array.from({ length: 6 }).map((_, j) => <Skeleton key={j} className="h-3 w-full" />)}
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 flex-1" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && riders.length === 0 && (
        <EmptyState
          icon={filter === 'pending' ? '👥' : filter === 'approved' ? '✓' : '✗'}
          title={
            filter === 'pending'  ? 'No pending KYC applications' :
            filter === 'approved' ? 'No approved captains yet' :
            filter === 'rejected' ? 'No rejected applications' :
            'No captains in the system'
          }
          description={
            filter === 'pending'
              ? 'New captain applications will appear here for KYC review.'
              : 'Ask captains to sign up at goride-captain.pages.dev'
          }
        />
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
                  className="btn-primary flex-1 h-10 inline-flex items-center justify-center gap-1"
                >
                  {decisionBusy === r.id && <Spinner className="h-3 w-3" />}
                  Approve
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
