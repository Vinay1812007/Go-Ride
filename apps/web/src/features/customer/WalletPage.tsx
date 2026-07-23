import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';

interface Entry {
  id: string;
  delta: number;
  reason: string;
  order_id?: string | null;
  note?: string | null;
  created_at: string;
}

interface Payload {
  balance: number;
  entries: Entry[];
  referral_code: string | null;
  referred_by: string | null;
}

const REASON_LABELS: Record<string, string> = {
  signup_bonus:              'Signup bonus',
  referral_bonus_referrer:   'Referral bonus (friend)',
  referral_bonus_referee:    'Welcome bonus',
  promo_credit:              'Promo credit',
  refund:                    'Refund',
  trip_debit:                'Applied to trip',
  top_up:                    'Top-up',
  adjustment:                'Support adjustment',
};

function reasonLabel(r: string): string {
  return REASON_LABELS[r] ?? r.replace(/_/g, ' ');
}

export default function WalletPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refCode, setRefCode] = useState('');
  const [applying, setApplying] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<Payload>('/wallet');
      setData(res);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function share() {
    if (!data?.referral_code) return;
    const url = `${location.origin}/?ref=${data.referral_code}`;
    const text = `Join GoRide with my code ${data.referral_code} and we both get ₹50–100 credit.`;
    if (navigator.share) {
      try { await navigator.share({ title: 'GoRide referral', text, url }); } catch { /* dismissed */ }
    } else {
      try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast.success('Referral link copied');
      } catch { toast.error('Could not copy'); }
    }
  }

  async function applyRef() {
    const c = refCode.trim().toUpperCase();
    if (!c) return;
    setApplying(true);
    try {
      await api.post('/wallet/apply-referral', { code: c });
      toast.success('Referral applied — you\'ll get ₹50 credit on your first trip');
      setRefCode('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not apply');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="h-full bg-surface-muted">
      <header className="bg-white border-b border-surface-border sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="text-slate-500 text-lg leading-none">←</Link>
          <h1 className="font-bold">Wallet</h1>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4 space-y-3">
        {/* Balance hero */}
        <div className="card bg-gradient-to-br from-brand-500 to-brand-600 text-surface-strong">
          <div className="text-xs uppercase tracking-wider opacity-80">Available balance</div>
          {loading || !data ? (
            <Skeleton className="h-9 w-40 mt-1" />
          ) : (
            <div className="text-3xl font-bold mt-1">{inr(data.balance)}</div>
          )}
          <p className="text-xs opacity-80 mt-2">
            Applied automatically at checkout when you tick "Use wallet balance."
          </p>
        </div>

        {/* Referral */}
        {data?.referral_code && (
          <div className="card">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Refer a friend</div>
            <div className="text-sm mb-3">
              Share your code — you get <strong>₹100</strong> and they get <strong>₹50</strong> credit
              after their first trip.
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-surface-muted p-3">
              <div className="font-mono font-bold text-xl tracking-widest flex-1">
                {data.referral_code}
              </div>
              <button onClick={share} className="btn-primary py-2 px-3 text-sm">Share</button>
            </div>
          </div>
        )}

        {/* Apply someone else's code — only if not already referred */}
        {data && !data.referred_by && (
          <div className="card">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
              Got a friend's code?
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Enter it now — you'll get ₹50 credit on your first completed trip.
            </p>
            <div className="flex gap-2">
              <input
                value={refCode}
                onChange={(e) => setRefCode(e.target.value.toUpperCase())}
                placeholder="Friend's code"
                maxLength={20}
                className="input flex-1 font-mono uppercase"
              />
              <button
                onClick={applyRef}
                disabled={applying || refCode.trim().length < 3}
                className="btn-ghost border border-brand-500 text-brand-800 px-4 font-semibold"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        {/* Ledger */}
        <div className="card p-0 overflow-hidden">
          <div className="p-3 text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-surface-border">
            History
          </div>
          {loading && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between items-center p-3 border-b border-surface-border last:border-none">
              <div className="space-y-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
          {!loading && data && data.entries.length === 0 && (
            <EmptyState
              icon="💳"
              title="No wallet activity yet"
              description="Credits and debits appear here."
            />
          )}
          {data?.entries.map((e) => (
            <div key={e.id} className="flex justify-between items-center p-3 border-b border-surface-border last:border-none">
              <div>
                <div className="text-sm font-medium">{reasonLabel(e.reason)}</div>
                <div className="text-xs text-slate-500">
                  {new Date(e.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  {e.note ? ' · ' + e.note : ''}
                </div>
              </div>
              <div className={`font-bold ${e.delta >= 0 ? 'text-emerald-700' : 'text-slate-800'}`}>
                {e.delta >= 0 ? '+' : ''}{inr(e.delta)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
