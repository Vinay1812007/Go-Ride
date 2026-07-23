// Admin — customer-support wallet tool.
// Two-pane layout: left = search + list of matches; right = selected
// customer's ledger + credit/debit form.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

interface ProfileMatch {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  role: 'customer' | 'rider' | 'admin';
  balance: number;
  referral_code?: string | null;
  referred_by?: string | null;
  blocked?: boolean;
}

interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  order_id?: string | null;
  note?: string | null;
  created_at: string;
}

interface WalletDetail {
  profile: ProfileMatch;
  balance: number;
  entries: LedgerEntry[];
}

const REASON_LABELS: Record<string, string> = {
  signup_bonus:              'Signup bonus',
  referral_bonus_referrer:   'Referral bonus (referred a friend)',
  referral_bonus_referee:    'Welcome bonus',
  promo_credit:              'Promo credit',
  refund:                    'Refund',
  trip_debit:                'Trip debit',
  top_up:                    'Top-up',
  adjustment:                'Support adjustment',
};
function reasonLabel(r: string): string {
  return REASON_LABELS[r] ?? r.replace(/_/g, ' ');
}

export default function WalletAdminPage() {
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<ProfileMatch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WalletDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Adjust form
  const [delta, setDelta] = useState<number>(100);
  const [sign, setSign] = useState<'+' | '-'>('+');
  const [reason, setReason] = useState<'adjustment' | 'refund' | 'top_up' | 'promo_credit'>('adjustment');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // Debounced search
  useEffect(() => {
    if (q.trim().length < 2) { setMatches([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<{ profiles: ProfileMatch[] }>(`/admin/profiles/search?q=${encodeURIComponent(q.trim())}`);
        if (!cancelled) setMatches(res.profiles);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof ApiError ? e.message : 'Search failed');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  async function selectProfile(p: ProfileMatch) {
    setSelectedId(p.id);
    setLoadingDetail(true);
    try {
      const res = await api.get<WalletDetail>(`/admin/wallet/${p.id}`);
      setDetail(res);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Load failed');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function submit() {
    if (!detail) return;
    if (delta <= 0) return toast.error('Amount must be greater than 0');
    if (note.trim().length < 3) return toast.error('Note is required (min 3 chars)');
    setSaving(true);
    try {
      const signedDelta = sign === '-' ? -delta : delta;
      await api.post(`/admin/wallet/${detail.profile.id}`, {
        delta: signedDelta,
        reason,
        note: note.trim(),
      });
      toast.success(`${sign === '+' ? 'Credited' : 'Debited'} ${inr(delta)}`);
      setNote('');
      setDelta(100);
      // Refresh
      await selectProfile(detail.profile);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Wallet & credits</h1>
        <p className="text-xs text-slate-500">
          Support tool — look up a customer by email, phone, or name; credit or debit their wallet with an audit note.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Left: search + matches ─────────────────────────────────── */}
        <div className="card p-0 overflow-hidden">
          <div className="p-3 border-b border-surface-border">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search email, phone, or name (min 2 chars)"
              className="input"
            />
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {searching && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-3 border-b border-surface-border last:border-none space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            ))}
            {!searching && q.trim().length >= 2 && matches.length === 0 && (
              <EmptyState icon="🔎" title="No matches" description="Try a different search — full email or phone number works best." />
            )}
            {!searching && q.trim().length < 2 && (
              <EmptyState icon="👤" title="Start typing" description="Search finds customers, captains, and admins by any of email / phone / name." />
            )}
            {matches.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProfile(p)}
                className={`w-full text-left p-3 border-b border-surface-border last:border-none hover:bg-surface-muted transition ${selectedId === p.id ? 'bg-brand-50 border-l-4 border-l-brand-500' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-medium truncate">
                    {p.full_name}
                    {p.blocked && <span className="ml-2 text-xs text-red-600">(blocked)</span>}
                  </div>
                  <div className="text-xs text-slate-500 uppercase">{p.role}</div>
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {p.email ?? '—'} · {p.phone ?? '—'}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className={`text-xs font-mono ${p.balance > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
                    Wallet: {inr(p.balance)}
                  </span>
                  {p.referral_code && (
                    <span className="text-[10px] text-slate-500 font-mono">{p.referral_code}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: detail + adjust form ───────────────────────────── */}
        <div className="card p-0 overflow-hidden">
          {!detail && !loadingDetail && (
            <EmptyState icon="💳" title="Select a customer" description="Click a search result on the left to view their ledger and adjust their balance." />
          )}
          {loadingDetail && (
            <div className="p-4 space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {detail && !loadingDetail && (
            <div>
              {/* Header + balance */}
              <div className="p-4 border-b border-surface-border bg-gradient-to-br from-brand-50 to-white">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="font-bold text-lg">{detail.profile.full_name}</div>
                    <div className="text-xs text-slate-500">{detail.profile.email ?? '—'} · {detail.profile.phone ?? '—'}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      ID: <code className="font-mono">{detail.profile.id.slice(0, 8)}…</code>
                      {detail.profile.referral_code && <> · Code: <span className="font-mono">{detail.profile.referral_code}</span></>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500 uppercase tracking-wider">Balance</div>
                    <div className="text-2xl font-bold">{inr(detail.balance)}</div>
                  </div>
                </div>
              </div>

              {/* Adjust form */}
              <div className="p-4 border-b border-surface-border bg-surface-muted">
                <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Credit or debit</div>
                <div className="flex items-stretch gap-2 mb-3">
                  <div className="flex bg-white rounded-lg border border-surface-border overflow-hidden">
                    <button
                      onClick={() => setSign('+')}
                      className={`px-3 text-sm font-bold ${sign === '+' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}
                    >
                      + Credit
                    </button>
                    <button
                      onClick={() => setSign('-')}
                      className={`px-3 text-sm font-bold ${sign === '-' ? 'bg-red-500 text-white' : 'text-slate-500'}`}
                    >
                      − Debit
                    </button>
                  </div>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={delta}
                    onChange={(e) => setDelta(parseFloat(e.target.value || '0'))}
                    className="input flex-1"
                    placeholder="Amount ₹"
                  />
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value as typeof reason)}
                    className="input"
                    style={{ maxWidth: '140px' }}
                  >
                    <option value="adjustment">Adjustment</option>
                    <option value="refund">Refund</option>
                    <option value="top_up">Top-up</option>
                    <option value="promo_credit">Promo credit</option>
                  </select>
                </div>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Audit note (visible in the customer's wallet history)"
                  maxLength={300}
                  className="input mb-2"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={submit}
                    disabled={saving || delta <= 0 || note.trim().length < 3}
                    className="btn-primary flex-1"
                  >
                    {saving ? '…' : `${sign === '+' ? 'Credit' : 'Debit'} ${inr(delta)}`}
                  </button>
                  {sign === '-' && delta > detail.balance && (
                    <div className="text-xs text-amber-700">
                      Will go negative
                    </div>
                  )}
                </div>
              </div>

              {/* Ledger */}
              <div className="max-h-[45vh] overflow-y-auto">
                <div className="p-3 text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-surface-border sticky top-0 bg-white">
                  History
                </div>
                {detail.entries.length === 0 && (
                  <EmptyState icon="🗒️" title="No ledger entries" description="This customer hasn't had any wallet activity yet." />
                )}
                {detail.entries.map((e) => (
                  <div key={e.id} className="flex justify-between items-start p-3 border-b border-surface-border last:border-none">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{reasonLabel(e.reason)}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(e.created_at).toLocaleString(undefined, {
                          day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
                        })}
                        {e.note ? ' · ' + e.note : ''}
                      </div>
                    </div>
                    <div className={`font-mono font-bold ${e.delta >= 0 ? 'text-emerald-700' : 'text-slate-800'}`}>
                      {e.delta >= 0 ? '+' : ''}{inr(e.delta)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
