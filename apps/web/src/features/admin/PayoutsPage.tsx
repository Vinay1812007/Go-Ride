// Admin — weekly rider payouts queue.
//
// Runs every Monday 04:00 UTC via a Worker cron; this page also has a
// Run now button for on-demand batches. Pending rows are the queue that
// needs the finance team to action; paid rows are the audit trail with
// bank reference numbers.
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

interface Payout {
  id: string;
  rider_id: string;
  period_start: string;
  period_end: string;
  gross: number;
  commission: number;
  net: number;
  trips: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  bank_ref?: string | null;
  note?: string | null;
  paid_at?: string | null;
  created_at: string;
  riders?: {
    vehicle_number: string;
    vehicle_type: string;
    profiles?: { full_name: string; email?: string | null; phone?: string | null };
  };
}

type Filter = 'pending' | 'paid' | 'all';

export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('pending');
  const [running, setRunning] = useState(false);
  const [marking, setMarking] = useState<Payout | null>(null);
  const [bankRef, setBankRef] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ payouts: Payout[] }>(`/admin/payouts?status=${filter}`);
      setPayouts(res.payouts);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load payouts');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter]);

  async function runNow() {
    if (!confirm('Run the payout batch for the previous week?\n\nThis is idempotent — transactions already covered by a payout are skipped, so it\'s safe to click even if the Monday cron already ran.')) return;
    setRunning(true);
    try {
      const res = await api.post<{ created: number }>('/admin/payouts/run');
      toast.success(`Created ${res.created} payout row${res.created === 1 ? '' : 's'}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  async function markPaid() {
    if (!marking) return;
    if (bankRef.trim().length < 3) return toast.error('Bank reference required');
    setSaving(true);
    try {
      await api.post(`/admin/payouts/${marking.id}/mark-paid`, {
        bank_ref: bankRef.trim(),
        note: note.trim() || undefined,
      });
      toast.success('Marked as paid');
      setMarking(null); setBankRef(''); setNote('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function cancel(p: Payout) {
    if (!confirm(`Cancel payout for ${p.riders?.profiles?.full_name ?? 'this rider'}?\n\nThe covered transactions become eligible for the next run.`)) return;
    try {
      await api.post(`/admin/payouts/${p.id}/cancel`);
      toast.success('Payout cancelled');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Cancel failed');
    }
  }

  const totals = useMemo(() => {
    let net = 0, gross = 0, commission = 0, trips = 0;
    for (const p of payouts) {
      net += Number(p.net); gross += Number(p.gross); commission += Number(p.commission); trips += p.trips;
    }
    return { net, gross, commission, trips };
  }, [payouts]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payouts</h1>
          <p className="text-xs text-slate-500">
            Weekly rider settlements. Auto-runs every Monday 04:00 UTC — click <em>Run now</em> for out-of-band batches.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
            {(['pending', 'paid', 'all'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${filter === f ? 'bg-surface-strong text-white' : 'text-slate-600'}`}
              >
                {f}
              </button>
            ))}
          </div>
          <button onClick={runNow} disabled={running} className="btn-primary">
            {running ? '…' : 'Run now'}
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <SummaryCard label="Rows" value={String(payouts.length)} />
        <SummaryCard label="Trips" value={String(totals.trips)} />
        <SummaryCard label="Gross earnings" value={inr(totals.gross)} />
        <SummaryCard label="Net to riders" value={inr(totals.net)} highlight />
      </div>

      {loading && (
        <div className="card p-0 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3 border-b border-surface-border last:border-none">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64 mt-1" />
            </div>
          ))}
        </div>
      )}

      {!loading && payouts.length === 0 && (
        <EmptyState
          icon="💸"
          title={filter === 'pending' ? 'No pending payouts' : 'No payouts to show'}
          description={
            filter === 'pending'
              ? 'The queue is empty. Either the last run has been settled, or no trips completed in the last window.'
              : 'Try a different filter, or click Run now to batch the previous week.'
          }
          cta={filter === 'pending' && payouts.length === 0 ? { label: 'Run payout batch now', onClick: runNow } : undefined}
        />
      )}

      {!loading && payouts.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Rider</th>
                <th className="p-3 text-left">Period</th>
                <th className="p-3 text-right">Trips</th>
                <th className="p-3 text-right">Gross</th>
                <th className="p-3 text-right">Comm.</th>
                <th className="p-3 text-right">Net</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-t border-surface-border">
                  <td className="p-3">
                    <div className="font-medium truncate max-w-[180px]">
                      {p.riders?.profiles?.full_name ?? '(unknown)'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {p.riders?.vehicle_number} · {p.riders?.profiles?.phone ?? p.riders?.profiles?.email ?? '—'}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="text-xs">
                      {new Date(p.period_start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      {' – '}
                      {new Date(p.period_end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </div>
                  </td>
                  <td className="p-3 text-right">{p.trips}</td>
                  <td className="p-3 text-right">{inr(p.gross)}</td>
                  <td className="p-3 text-right text-slate-500">{inr(p.commission)}</td>
                  <td className="p-3 text-right font-bold">{inr(p.net)}</td>
                  <td className="p-3">
                    <StatusChip status={p.status} />
                    {p.status === 'paid' && p.bank_ref && (
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">Ref: {p.bank_ref}</div>
                    )}
                  </td>
                  <td className="p-3 text-right space-x-1">
                    {p.status === 'pending' && (
                      <>
                        <button onClick={() => { setMarking(p); setBankRef(''); setNote(''); }} className="chip">Mark paid</button>
                        <button onClick={() => cancel(p)} className="chip text-red-600">Cancel</button>
                      </>
                    )}
                    {p.status === 'paid' && p.paid_at && (
                      <span className="text-xs text-slate-500">
                        {new Date(p.paid_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mark-paid modal */}
      {marking && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => setMarking(null)}>
          <div className="card bg-white max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">Mark payout as paid</h2>
            <p className="text-xs text-slate-500 mb-3">
              {marking.riders?.profiles?.full_name} · {inr(marking.net)} · {new Date(marking.period_start).toLocaleDateString()} – {new Date(marking.period_end).toLocaleDateString()}
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium">Bank reference / UTR</span>
                <input
                  autoFocus
                  className="input mt-1 font-mono"
                  placeholder="e.g. IMPS/UPI reference"
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                  maxLength={80}
                />
                <span className="text-[10px] text-slate-500">Shown to the rider in their payouts list.</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Note (optional)</span>
                <input
                  className="input mt-1"
                  placeholder="e.g. Adjusted for cash collection"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={300}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setMarking(null)} className="btn-ghost">Cancel</button>
              <button onClick={markPaid} disabled={saving || bankRef.trim().length < 3} className="btn-primary">
                {saving ? '…' : 'Mark paid'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card ${highlight ? 'bg-gradient-to-br from-brand-50 to-white' : ''}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function StatusChip({ status }: { status: Payout['status'] }) {
  const map: Record<Payout['status'], string> = {
    pending:   'bg-amber-50 text-amber-800 border border-amber-400',
    paid:      'bg-emerald-50 text-emerald-800 border border-emerald-400',
    failed:    'bg-red-50 text-red-800 border border-red-400',
    cancelled: 'bg-slate-100 text-slate-600 border border-slate-300',
  };
  const label: Record<Payout['status'], string> = {
    pending:   '⏱ Pending',
    paid:      '✓ Paid',
    failed:    '✕ Failed',
    cancelled: 'Cancelled',
  };
  return <span className={`chip ${map[status]}`}>{label[status]}</span>;
}
