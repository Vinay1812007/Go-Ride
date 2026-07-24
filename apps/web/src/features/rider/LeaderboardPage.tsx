// Captain leaderboard — top 20 by earnings / trips over week / month.
// Gamification, not payouts — the actual money moves through /payouts.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { inr, serviceLabel } from '@/lib/format';
import type { ServiceType } from '@/lib/types';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

type Metric = 'earnings' | 'trips';
type Period = 'week' | 'month';

interface Row {
  rank: number;
  rider_id: string;
  display_name: string;
  vehicle_type?: string;
  trips: number;
  earnings: number;
  is_me: boolean;
  total_participants?: number;
}

interface Payload {
  metric: Metric;
  period: Period;
  city: string | null;
  top: Row[];
  me: Row | null;
}

export default function LeaderboardPage() {
  const [metric, setMetric] = useState<Metric>('earnings');
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    setLoading(true);
    api.get<Payload>(`/riders/leaderboard?metric=${metric}&period=${period}`)
      .then(setData)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [metric, period, toast]);

  return (
    <div className="min-h-full bg-surface-muted">
      <header className="bg-surface-strong text-white px-4 py-4">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <Link to="/captain" className="text-lg leading-none opacity-80">←</Link>
          <div>
            <div className="text-xs opacity-80">Leaderboard</div>
            <div className="font-bold">This {period}'s top captains</div>
          </div>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* Toggles */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
            {(['earnings', 'trips'] as Metric[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={cn(
                  'px-3 py-1 rounded-full text-sm font-medium capitalize',
                  metric === m ? 'bg-brand-500 text-surface-strong' : 'text-slate-600',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
            {(['week', 'month'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-3 py-1 rounded-full text-sm font-medium capitalize',
                  period === p ? 'bg-surface-strong text-white' : 'text-slate-600',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Podium — top 3 */}
        {!loading && data && data.top.length > 0 && (
          <div className="grid grid-cols-3 gap-2 items-end">
            {[1, 0, 2].map((idx) => {
              const r = data.top[idx];
              if (!r) return <div key={idx} />;
              const isCenter = idx === 0;
              return (
                <div
                  key={r.rider_id}
                  className={cn(
                    'card text-center relative',
                    isCenter ? 'py-6' : 'py-4',
                    r.is_me && 'ring-2 ring-brand-500',
                  )}
                >
                  <div className={cn('text-2xl mb-1', isCenter ? 'text-3xl' : '')}>
                    {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'}
                  </div>
                  <div className="text-sm font-semibold truncate">{r.display_name}</div>
                  <div className="text-lg font-bold mt-1">
                    {metric === 'earnings' ? inr(r.earnings) : `${r.trips} trips`}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {metric === 'earnings' ? `${r.trips} trip${r.trips === 1 ? '' : 's'}` : inr(r.earnings)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Ranks 4–20 */}
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card"><Skeleton className="h-5 w-full" /></div>
        ))}

        {!loading && data && data.top.length === 0 && (
          <EmptyState
            icon="🏁"
            title={`No trips this ${period} yet`}
            description={`Complete a trip to appear on this ${period}'s leaderboard.`}
          />
        )}

        {!loading && data && data.top.length > 3 && (
          <div className="card p-0 overflow-hidden">
            {data.top.slice(3).map((r) => <Row key={r.rider_id} row={r} metric={metric} />)}
          </div>
        )}

        {/* Your rank if outside top 20 */}
        {!loading && data?.me && (
          <>
            <div className="text-center text-xs text-slate-400 pt-2">You're ranked</div>
            <div className="card p-0 overflow-hidden ring-2 ring-brand-500">
              <Row row={data.me} metric={metric} />
              <div className="px-3 py-2 text-[10px] text-slate-500 bg-surface-muted">
                Rank #{data.me.rank} of {data.me.total_participants ?? '—'} captains this {period}.
              </div>
            </div>
          </>
        )}

        <p className="text-center text-xs text-slate-400 pt-4">
          Names shown as first name + last initial for privacy.
        </p>
      </div>
    </div>
  );
}

function Row({ row, metric }: { row: Row; metric: Metric }) {
  return (
    <div className={cn('flex items-center gap-3 p-3 border-b border-surface-border last:border-none', row.is_me && 'bg-brand-50')}>
      <div className={cn('w-8 h-8 rounded-full grid place-items-center text-sm font-bold flex-shrink-0', row.rank <= 3 ? 'bg-brand-500 text-surface-strong' : 'bg-slate-100 text-slate-600')}>
        {row.rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {row.display_name}
          {row.is_me && <span className="ml-2 text-[10px] text-brand-800 font-semibold uppercase">You</span>}
        </div>
        <div className="text-[11px] text-slate-500">
          {row.vehicle_type ? serviceLabel(row.vehicle_type as ServiceType) : '—'}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-bold">
          {metric === 'earnings' ? inr(row.earnings) : `${row.trips}`}
        </div>
        <div className="text-[10px] text-slate-500">
          {metric === 'earnings' ? `${row.trips} trip${row.trips === 1 ? '' : 's'}` : inr(row.earnings)}
        </div>
      </div>
    </div>
  );
}
