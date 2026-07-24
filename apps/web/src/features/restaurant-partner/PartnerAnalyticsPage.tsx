// Partner analytics dashboard — 3-bucket hero + daily-revenue bar chart
// + top items by qty + hour-of-day chart. All derived server-side from
// /partner-restaurant/analytics.
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { inr } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/cn';

interface Bucket { orders: number; revenue: number }
interface Analytics {
  days: number;
  totals: { today: Bucket; this_week: Bucket; this_month: Bucket; window: Bucket };
  timeline: Array<{ date: string; revenue: number; orders: number }>;
  top_items: Array<{ id: string; name: string; qty: number; revenue: number }>;
  hour_distribution: number[]; // length 24
  status_counts: Record<string, number>;
}

export default function PartnerAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<7 | 30 | 90>(30);

  useEffect(() => {
    setLoading(true);
    api.get<Analytics>(`/partner-restaurant/analytics?days=${days}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  const maxRevDay = useMemo(
    () => Math.max(1, ...(data?.timeline?.map((d) => d.revenue) ?? [1])),
    [data],
  );
  const maxHour = useMemo(
    () => Math.max(1, ...(data?.hour_distribution ?? [1])),
    [data],
  );
  const maxItemQty = useMemo(
    () => Math.max(1, ...(data?.top_items?.map((i) => i.qty) ?? [1])),
    [data],
  );

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold">Analytics</h1>
        <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
          {([7, 30, 90] as const).map((n) => (
            <button
              key={n}
              onClick={() => setDays(n)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium',
                days === n ? 'bg-surface-strong text-white' : 'text-slate-600',
              )}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      {/* 3-bucket hero */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <BucketCard label="Today"       bucket={data?.totals.today}      loading={loading} />
        <BucketCard label="This week"   bucket={data?.totals.this_week}  loading={loading} />
        <BucketCard label="This month"  bucket={data?.totals.this_month} loading={loading} />
      </div>

      {/* Daily revenue chart */}
      <div className="card mb-4">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Revenue · last {days} days</div>
          <div className="text-xs text-slate-500">
            Window total: <span className="font-semibold text-surface-strong">{inr(data?.totals.window.revenue ?? 0)}</span>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : data && data.timeline.some((d) => d.revenue > 0) ? (
          <div className="flex items-end gap-1 h-24">
            {data.timeline.map((d) => {
              const pct = Math.round((d.revenue / maxRevDay) * 100);
              const label = new Date(d.date).toLocaleDateString(undefined, { weekday: 'narrow' });
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${inr(d.revenue)} · ${d.orders} order${d.orders === 1 ? '' : 's'}`}>
                  <div
                    className={cn('w-full rounded-t', d.revenue > 0 ? 'bg-brand-500' : 'bg-slate-200')}
                    style={{ height: `${Math.max(3, pct)}%` }}
                  />
                  <div className="text-[10px] text-slate-500">{label}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-slate-500">No revenue in this window.</div>
        )}
      </div>

      {/* Top items */}
      <div className="card mb-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Top items (by qty sold)</div>
        {loading && Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="py-2"><Skeleton className="h-4 w-full" /></div>
        ))}
        {!loading && (!data || data.top_items.length === 0) && (
          <EmptyState icon="🍽️" title="Nothing sold yet" description="Items start appearing here once you have completed orders." />
        )}
        {!loading && data && data.top_items.length > 0 && (
          <div className="space-y-2">
            {data.top_items.map((it) => {
              const pct = Math.round((it.qty / maxItemQty) * 100);
              return (
                <div key={it.id} className="text-sm">
                  <div className="flex justify-between items-baseline">
                    <div className="truncate max-w-[60%] font-medium">{it.name}</div>
                    <div className="text-xs text-slate-500">{it.qty} sold · {inr(it.revenue)}</div>
                  </div>
                  <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hour-of-day */}
      <div className="card mb-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Orders by hour</div>
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : data && data.hour_distribution.some((h) => h > 0) ? (
          <>
            <div className="flex items-end gap-[2px] h-20">
              {data.hour_distribution.map((count, h) => {
                const pct = Math.round((count / maxHour) * 100);
                return (
                  <div
                    key={h}
                    className={cn('flex-1 rounded-t', count > 0 ? 'bg-brand-500' : 'bg-slate-200')}
                    style={{ height: `${Math.max(3, pct)}%` }}
                    title={`${h}:00 — ${count} order${count === 1 ? '' : 's'}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
            </div>
          </>
        ) : (
          <div className="py-6 text-center text-sm text-slate-500">No orders yet.</div>
        )}
      </div>

      {/* Status breakdown */}
      {data && Object.keys(data.status_counts).length > 0 && (
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Order status split</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.status_counts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
              <span key={status} className="chip">
                {status.replace(/_/g, ' ')}: <span className="font-semibold ml-1">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BucketCard({ label, bucket, loading }: { label: string; bucket?: Bucket; loading: boolean }) {
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
          <div className="text-xl font-bold">{inr(bucket?.revenue ?? 0)}</div>
          <div className="text-[11px] text-slate-500">{bucket?.orders ?? 0} order{bucket?.orders === 1 ? '' : 's'}</div>
        </>
      )}
    </div>
  );
}
