// Captain — instant withdrawal page (₹ to UPI / bank, 1×/day).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import Badge from '@/components/ui/Badge';
import { inr } from '@/lib/format';

interface WithdrawStatus {
  balance: number;
  min_amount: number;
  methods: string[];
  used_today: number;
  max_per_day: number;
  can_withdraw: boolean;
  recent: Array<{
    id: string; amount: number; status: string; requested_at: string;
    paid_at: string | null; method: string; destination: string;
  }>;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  paid: 'success', pending: 'warning', processing: 'info', failed: 'danger',
};

export default function WithdrawPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<WithdrawStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'upi' | 'bank'>('upi');
  const [destination, setDestination] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get<WithdrawStatus>('/riders/withdraw/status');
      setData(r);
      if (r.methods[0]) setMethod(r.methods[0] as 'upi' | 'bank');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt <= 0) return toast.error('Enter a valid amount');
    if (!destination.trim())          return toast.error(method === 'upi' ? 'Enter UPI ID' : 'Enter account details');
    setBusy(true);
    try {
      const r = await api.post<{ new_balance: number }>('/riders/withdraw', {
        amount: amt, method, destination: destination.trim(),
      });
      toast.success(`₹${amt} withdrawal initiated. New balance ₹${r.new_balance}`);
      setAmount(''); setDestination('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Withdrawal failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* Header */}
      <div className="bg-surface-strong text-white p-4 pb-8">
        <button onClick={() => nav(-1)} className="text-white/80 text-sm mb-4">← Back</button>
        <div className="text-xs uppercase tracking-wider text-white/60">Available balance</div>
        {loading ? (
          <Skeleton className="h-10 w-40 mt-2 bg-white/20" />
        ) : (
          <div className="text-4xl font-bold mt-1">{inr(data?.balance ?? 0)}</div>
        )}
        <div className="mt-3 flex gap-2 flex-wrap">
          {!loading && data && (
            <>
              <Badge tone="info">Min ₹{data.min_amount}</Badge>
              <Badge tone={data.can_withdraw ? 'success' : 'warning'}>
                {data.used_today}/{data.max_per_day} today
              </Badge>
            </>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="p-4 -mt-4 space-y-4">
        <div className="card p-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Amount (₹)</label>
            <input
              type="number" inputMode="decimal" min={data?.min_amount ?? 100}
              value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="input mt-1 text-2xl font-bold"
              disabled={!data?.can_withdraw || busy}
            />
            {/* Quick amounts */}
            <div className="flex gap-2 mt-2">
              {[500, 1000, 2000, data?.balance ?? 0].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i).slice(0, 4).map((v, i) => (
                <button
                  key={i} type="button" disabled={busy || v > (data?.balance ?? 0)}
                  onClick={() => setAmount(String(v))}
                  className="chip disabled:opacity-40"
                >
                  {i === 3 ? 'All' : `₹${v}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Method</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {(data?.methods ?? ['upi', 'bank']).map((m) => (
                <button
                  key={m} type="button" disabled={busy}
                  onClick={() => setMethod(m as 'upi' | 'bank')}
                  className={`p-3 rounded-xl border-2 font-semibold transition ${
                    method === m ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  {m === 'upi' ? '⚡ UPI' : '🏦 Bank'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {method === 'upi' ? 'UPI ID' : 'Account details'}
            </label>
            <input
              value={destination} onChange={(e) => setDestination(e.target.value)}
              placeholder={method === 'upi' ? 'yourname@upi' : 'Bank name / IFSC / A/C number'}
              className="input mt-1" disabled={busy}
            />
          </div>

          <button
            onClick={submit}
            disabled={busy || !data?.can_withdraw || !amount || !destination}
            className="btn btn-primary w-full h-14 text-base"
          >
            {busy ? 'Processing…' : data && !data.can_withdraw ? 'Daily limit reached' : 'Withdraw now'}
          </button>
          {data && !data.can_withdraw && (
            <p className="text-xs text-slate-500 text-center">
              You've used all daily withdrawals. Try again tomorrow.
            </p>
          )}
        </div>

        {/* Recent history */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">Recent withdrawals</h3>
          <div className="card divide-y divide-slate-100">
            {loading ? (
              <div className="p-4 space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            ) : (data?.recent ?? []).length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-sm">No withdrawals yet.</div>
            ) : (data?.recent ?? []).map((w) => (
              <div key={w.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{inr(w.amount)}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {w.method.toUpperCase()} · {w.destination}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {new Date(w.requested_at).toLocaleString()}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[w.status] ?? 'neutral'}>{w.status}</Badge>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
