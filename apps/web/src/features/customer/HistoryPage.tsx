import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import type { OrderSummary } from '@/lib/types';
import { inr, serviceLabel, statusLabel, scheduleLabel, scheduleCountdown } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

type Tab = 'past' | 'upcoming';

export default function HistoryPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialTab: Tab = params.get('tab') === 'upcoming' ? 'upcoming' : 'past';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      // We fetch both slices in parallel so switching tabs is instant.
      const [past, upcoming] = await Promise.all([
        api.get<{ orders: OrderSummary[] }>('/orders'),
        api.get<{ orders: OrderSummary[] }>('/orders?upcoming=1'),
      ]);
      // Merge into one list; separate at render time by tab.
      const seen = new Set<string>();
      const merged: OrderSummary[] = [];
      for (const o of [...upcoming.orders, ...past.orders]) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        merged.push(o);
      }
      setOrders(merged);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function switchTab(next: Tab) {
    setTab(next);
    const p = new URLSearchParams(params);
    if (next === 'upcoming') p.set('tab', 'upcoming'); else p.delete('tab');
    setParams(p, { replace: true });
  }

  const shown = useMemo(() => {
    if (tab === 'upcoming') return orders.filter((o) => o.status === 'scheduled');
    return orders.filter((o) => o.status !== 'scheduled');
  }, [orders, tab]);

  async function cancelScheduled(id: string) {
    if (!confirm('Cancel this scheduled ride?')) return;
    setBusy(id);
    try {
      await api.post(`/orders/${id}/cancel`, { reason: 'Customer cancelled scheduled ride' });
      toast.success('Scheduled ride cancelled');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not cancel');
    } finally {
      setBusy(null);
    }
  }

  async function startNow(id: string) {
    if (!confirm('Dispatch this ride right now? A captain will start looking immediately.')) return;
    setBusy(id);
    try {
      await api.post(`/orders/${id}/start-now`);
      toast.success('Looking for a captain now');
      nav(`/track/${id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not start');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-full bg-surface-muted">
      <header className="bg-white border-b border-surface-border px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Link to="/" className="text-slate-500 text-lg leading-none">←</Link>
        <h1 className="font-bold">Your trips</h1>
      </header>

      {/* Tabs */}
      <div className="max-w-md mx-auto px-4 pt-3">
        <div className="flex gap-1 bg-white rounded-xl p-1 border border-surface-border">
          <button
            onClick={() => switchTab('upcoming')}
            className={cn(
              'flex-1 text-sm py-2 rounded-lg font-medium transition',
              tab === 'upcoming' ? 'bg-brand-500 text-surface-strong' : 'text-slate-500',
            )}
          >
            Upcoming
          </button>
          <button
            onClick={() => switchTab('past')}
            className={cn(
              'flex-1 text-sm py-2 rounded-lg font-medium transition',
              tab === 'past' ? 'bg-brand-500 text-surface-strong' : 'text-slate-500',
            )}
          >
            History
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3 max-w-md mx-auto">
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card space-y-2">
            <div className="flex items-baseline justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-3 w-full" />
            <div className="flex items-center justify-between pt-1">
              <Skeleton className="h-6 w-24" rounded="full" />
              <Skeleton className="h-5 w-16" />
            </div>
          </div>
        ))}

        {!loading && shown.length === 0 && tab === 'upcoming' && (
          <EmptyState
            icon="📅"
            title="Nothing scheduled"
            description="Book a ride for later from the home screen and it'll appear here."
            cta={{ label: 'Book a ride', onClick: () => nav('/') }}
          />
        )}
        {!loading && shown.length === 0 && tab === 'past' && (
          <EmptyState
            icon="🛺"
            title="No trips yet"
            description="Your completed rides and deliveries will show up here."
            cta={{ label: 'Book a ride', onClick: () => nav('/') }}
          />
        )}

        {shown.map((o, i) => {
          const isScheduled = o.status === 'scheduled';
          return (
            <div
              key={o.id}
              className="card animate-fade-in space-y-2"
              style={{ animationDelay: `${Math.min(i * 40, 200)}ms`, animationFillMode: 'backwards' }}
            >
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{serviceLabel(o.service)}</span>
                <span className="text-slate-500 text-xs">
                  {isScheduled
                    ? scheduleCountdown(o.scheduled_at)
                    : new Date(o.created_at).toLocaleString()}
                </span>
              </div>
              {isScheduled && (
                <div className="text-sm font-semibold text-brand-800">
                  Pickup {scheduleLabel(o.scheduled_at)}
                </div>
              )}
              <div className="text-sm text-slate-500 truncate">
                {o.pickup_address} → {o.drop_address}
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="chip">{statusLabel(o.status)}</span>
                <span className="font-bold">{inr(o.fare_final ?? o.fare_estimate)}</span>
              </div>

              {isScheduled ? (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => startNow(o.id)}
                    disabled={busy === o.id}
                    className="btn-ghost flex-1 border border-surface-border text-sm py-2"
                  >
                    Start now
                  </button>
                  <button
                    onClick={() => cancelScheduled(o.id)}
                    disabled={busy === o.id}
                    className="btn-ghost flex-1 border border-surface-border text-sm py-2 text-red-600"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <Link
                  to={`/track/${o.id}`}
                  className="block text-center btn-ghost text-sm py-2 border border-surface-border"
                >
                  View trip →
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
