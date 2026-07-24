// Captain earnings dashboard.
//
// Three time buckets across the top (Today / This week / This month), a
// 14-day bar chart, and a scrollable per-trip ledger. Everything derived
// from GET /riders/earnings/summary + /riders/earnings/trips. CSV export
// hits /riders/earnings.csv via the shared downloadFile() helper.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, downloadFile } from '@/lib/api';
import { inr, serviceLabel } from '@/lib/format';
import type { ServiceType } from '@/lib/types';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface Bucket { earning: number; commission: number; trips: number }
interface Summary {
  today: Bucket;
  this_week: Bucket;
  this_month: Bucket;
  last_30d_earning: number;
  timeline: Array<{ date: string; earning: number; trips: number }>;
}

interface TripRow {
  order_id: string;
  order_no?: string;
  service?: ServiceType | string;
  pickup?: string;
  drop?: string;
  fare?: number;
  distance_km?: number;
  payment_method?: string;
  earning: number;
  commission: number;
  completed_at?: string;
}

interface Payout {
  id: string;
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
}

export default function EarningsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [downloading, setDownloading] = useState(false);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const toast = useToast();

  useEffect(() => {
    api.get<{ payouts: Payout[] }>('/riders/payouts')
      .then((r) => setPayouts(r.payouts))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoadingSummary(true);
    api.get<Summary>('/riders/earnings/summary')
      .then(setSummary)
      .catch(() => {})
      .finally(() => setLoadingSummary(false));
  }, []);

  useEffect(() => {
    setLoadingTrips(true);
    api.get<{ trips: TripRow[] }>(`/riders/earnings/trips?days=${days}`)
      .then((r) => setTrips(r.trips))
      .catch(() => {})
      .finally(() => setLoadingTrips(false));
  }, [days]);

  async function exportCsv() {
    setDownloading(true);
    try {
      await downloadFile(`/riders/earnings.csv?days=${days}`, `goride-earnings-${days}d.csv`);
      toast.success('Downloaded');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  // Chart bar scaling — highest earning becomes 100%.
  const maxDay = useMemo(
    () => Math.max(1, ...(summary?.timeline?.map((d) => d.earning) ?? [1])),
    [summary],
  );

  return (
    <div className="min-h-full bg-surface-muted">
      <header className="bg-surface-strong text-white px-4 py-4">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div className="flex items-center gap-3">
            <Link to="/captain" className="text-lg leading-none opacity-80">←</Link>
            <div>
              <div className="text-xs opacity-80">Earnings</div>
              <div className="font-bold">Trip history & payouts</div>
            </div>
          </div>
        </div>
      </header>

      <div className="p-4 max-w-md mx-auto space-y-4">
        {/* Three-bucket hero */}
        <div className="grid grid-cols-3 gap-2">
          <Bucket label="Today"   bucket={summary?.today}      loading={loadingSummary} />
          <Bucket label="This week"  bucket={summary?.this_week}  loading={loadingSummary} />
          <Bucket label="This month" bucket={summary?.this_month} loading={loadingSummary} />
        </div>

        {/* 14-day chart */}
        <div className="card">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Last 14 days</div>
            <div className="text-xs text-slate-500">
              Total: <span className="font-semibold text-surface-strong">{inr(summary?.last_30d_earning ?? 0)}</span>
              <span className="text-[10px] opacity-60"> · 30d</span>
            </div>
          </div>
          {loadingSummary ? (
            <Skeleton className="h-24 w-full" />
          ) : summary && summary.timeline.some((d) => d.earning > 0) ? (
            <div className="flex items-end gap-1 h-24">
              {summary.timeline.map((d) => {
                const pct = Math.round((d.earning / maxDay) * 100);
                const dayLabel = new Date(d.date).toLocaleDateString(undefined, { weekday: 'narrow' });
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${inr(d.earning)} (${d.trips} trip${d.trips === 1 ? '' : 's'})`}>
                    <div
                      className={cn('w-full rounded-t', d.earning > 0 ? 'bg-brand-500' : 'bg-slate-200')}
                      style={{ height: `${Math.max(3, pct)}%` }}
                    />
                    <div className="text-[10px] text-slate-500">{dayLabel}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-slate-500">No earnings in the last 14 days.</div>
          )}
        </div>

        {/* Range toggle + export */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
            {[7, 30, 90].map((n) => (
              <button
                key={n}
                onClick={() => setDays(n as 7 | 30 | 90)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium',
                  days === n ? 'bg-surface-strong text-white' : 'text-slate-600',
                )}
              >
                {n}d
              </button>
            ))}
          </div>
          <button
            onClick={exportCsv}
            disabled={downloading || trips.length === 0}
            className="btn-ghost border border-surface-border text-sm py-1.5 px-3"
          >
            {downloading ? '…' : '⤓ CSV'}
          </button>
        </div>

        {/* Payouts strip — visible whenever there's at least one row */}
        {payouts.length > 0 && (
          <div className="card p-0 overflow-hidden">
            <div className="p-3 text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-surface-border flex items-center justify-between">
              <span>Payouts</span>
              <span className="normal-case text-[10px] font-normal opacity-70">Weekly · every Monday</span>
            </div>
            {payouts.slice(0, 6).map((p) => (
              <div key={p.id} className="p-3 border-b border-surface-border last:border-none">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">
                      {new Date(p.period_start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      {' – '}
                      {new Date(p.period_end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="text-xs text-slate-500 ml-2">{p.trips} trip{p.trips === 1 ? '' : 's'}</span>
                  </div>
                  <div className="font-bold">{inr(p.net)}</div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                  <span
                    className={cn(
                      'chip py-0.5 text-[10px]',
                      p.status === 'paid'      && 'bg-emerald-50 text-emerald-800 border border-emerald-400',
                      p.status === 'pending'   && 'bg-amber-50 text-amber-800 border border-amber-400',
                      p.status === 'failed'    && 'bg-red-50 text-red-800 border border-red-400',
                      p.status === 'cancelled' && 'bg-slate-100 text-slate-600 border border-slate-300',
                    )}
                  >
                    {p.status === 'paid' ? '✓ Paid' : p.status === 'pending' ? '⏱ Pending' : p.status === 'failed' ? '✕ Failed' : 'Cancelled'}
                  </span>
                  <span className="text-slate-500">
                    Gross {inr(p.gross)} · Comm {inr(p.commission)}
                  </span>
                </div>
                {p.status === 'paid' && p.bank_ref && (
                  <div className="mt-1 text-[10px] text-slate-500 font-mono">Ref: {p.bank_ref}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Trip ledger */}
        <div className="card p-0 overflow-hidden">
          <div className="p-3 text-xs uppercase tracking-wider text-slate-500 font-semibold border-b border-surface-border">
            Trips
          </div>
          {loadingTrips && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3 border-b border-surface-border last:border-none space-y-1">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          ))}
          {!loadingTrips && trips.length === 0 && (
            <EmptyState
              icon="🛺"
              title="No trips in this window"
              description="Try widening the range or check back after your next trip."
            />
          )}
          {trips.map((t) => (
            <div key={t.order_id} className="p-3 border-b border-surface-border last:border-none">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {t.service ? serviceLabel(t.service as ServiceType) : 'Trip'}
                    {t.order_no && <span className="text-xs font-mono text-slate-500 ml-2">#{t.order_no}</span>}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {t.pickup ?? '—'} → {t.drop ?? '—'}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-emerald-700">+{inr(t.earning)}</div>
                  {t.commission > 0 && (
                    <div className="text-[10px] text-slate-400">−{inr(t.commission)} comm.</div>
                  )}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                {t.completed_at && (
                  <span>{new Date(t.completed_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                )}
                {t.distance_km != null && <span>{Number(t.distance_km).toFixed(1)} km</span>}
                {t.payment_method && <span className="uppercase">{t.payment_method}</span>}
                {t.fare != null && <span>fare {inr(t.fare)}</span>}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-slate-400 pt-2">
          Commission is the platform cut, already deducted from your earning.
        </p>
      </div>
    </div>
  );
}

function Bucket({ label, bucket, loading }: { label: string; bucket?: Bucket; loading: boolean }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      {loading ? (
        <>
          <Skeleton className="h-6 w-20 mt-1" />
          <Skeleton className="h-3 w-14 mt-1" />
        </>
      ) : (
        <>
          <div className="text-xl font-bold">{inr(bucket?.earning ?? 0)}</div>
          <div className="text-[11px] text-slate-500">
            {bucket?.trips ?? 0} trip{bucket?.trips === 1 ? '' : 's'}
          </div>
        </>
      )}
    </div>
  );
}
