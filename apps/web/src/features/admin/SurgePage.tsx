// Admin — live surge dashboard.
// Shows current multiplier per (city, service) with the last-computed
// demand/supply snapshot + a mini timeline for the past 24h.
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { serviceLabel } from '@/lib/format';
import type { ServiceType } from '@/lib/types';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface CardRow {
  id: number;
  city: string;
  service: ServiceType;
  surge_multiplier: number;
  auto_surge: boolean;
  surge_multiplier_floor: number;
  surge_multiplier_cap: number;
  active: boolean;
  latest: {
    multiplier: number;
    active_riders: number;
    pending_orders: number;
    computed_at: string;
  } | null;
}

interface HistoryPoint {
  multiplier: number;
  active_riders: number;
  pending_orders: number;
  computed_at: string;
}

export default function SurgePage() {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ cards: CardRow[] }>('/admin/surge/current');
      setCards(res.cards);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  // Refresh every 15s so admin sees the auto-cron effect live.
  useEffect(() => {
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, []);

  async function runNow() {
    setBusy(true);
    try {
      const res = await api.post<{ updated: number }>('/admin/surge/run');
      toast.success(`Recomputed. Updated ${res.updated} rate card${res.updated === 1 ? '' : 's'}.`);
      await load();
      if (expanded) await loadHistory(expanded);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory(key: string) {
    const [city, service] = key.split('::');
    if (!city || !service) return;
    setHistoryLoading(true);
    try {
      const res = await api.get<{ points: HistoryPoint[] }>(`/admin/surge/history?city=${encodeURIComponent(city)}&service=${service}&hours=24`);
      setHistory(res.points);
    } finally { setHistoryLoading(false); }
  }

  useEffect(() => {
    if (expanded) void loadHistory(expanded);
    else setHistory([]);
  }, [expanded]);

  const autoCards = useMemo(() => cards.filter((c) => c.auto_surge), [cards]);
  const staticCards = useMemo(() => cards.filter((c) => !c.auto_surge), [cards]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Dynamic surge</h1>
          <p className="text-xs text-slate-500">
            Auto-cron runs every 2 minutes. Cards without auto-surge use whatever multiplier admin set on the Rate cards page.
          </p>
        </div>
        <button onClick={runNow} disabled={busy} className="btn-primary">{busy ? '…' : 'Run now'}</button>
      </div>

      {loading && Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card mb-2"><Skeleton className="h-6 w-full" /></div>
      ))}

      {!loading && cards.length === 0 && (
        <EmptyState icon="⚡" title="No active rate cards" description="Create rate cards on the Rate cards page and they'll appear here." />
      )}

      {/* Auto-surge cards */}
      {autoCards.length > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Auto-surge · {autoCards.length}</h2>
          <div className="space-y-2 mb-6">
            {autoCards.map((c) => {
              const key = `${c.city}::${c.service}`;
              return (
                <div key={c.id} className="card p-0 overflow-hidden">
                  <button
                    onClick={() => setExpanded(expanded === key ? null : key)}
                    className="w-full p-3 text-left hover:bg-surface-muted transition"
                  >
                    <div className="flex items-center gap-3">
                      <MultiplierChip mult={c.surge_multiplier} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{serviceLabel(c.service)} · {c.city}</div>
                        <div className="text-xs text-slate-500">
                          Range {c.surge_multiplier_floor.toFixed(1)}–{c.surge_multiplier_cap.toFixed(1)}×
                          {c.latest && ` · ${c.latest.active_riders} riders · ${c.latest.pending_orders} pending`}
                          {c.latest && <span className="ml-2">· {timeAgo(c.latest.computed_at)}</span>}
                        </div>
                      </div>
                      <span className="text-slate-400 text-xs">{expanded === key ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {expanded === key && (
                    <div className="p-3 border-t border-surface-border bg-surface-muted">
                      <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Last 24h</div>
                      {historyLoading ? (
                        <Skeleton className="h-24 w-full" />
                      ) : history.length === 0 ? (
                        <p className="text-sm text-slate-500 text-center py-4">No data yet — first sample lands with the next cron.</p>
                      ) : (
                        <MiniChart points={history} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Static cards */}
      {staticCards.length > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Static · {staticCards.length}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {staticCards.map((c) => (
              <div key={c.id} className="card p-3">
                <div className="flex items-center gap-2">
                  <MultiplierChip mult={c.surge_multiplier} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{serviceLabel(c.service)}</div>
                    <div className="text-[11px] text-slate-500">{c.city}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MultiplierChip({ mult }: { mult: number }) {
  const hot = mult >= 1.5;
  const warm = mult > 1.0 && mult < 1.5;
  return (
    <div className={cn(
      'font-mono font-bold rounded-lg px-2 py-1 min-w-[3.25rem] text-center flex-shrink-0',
      hot   && 'bg-red-100 text-red-700 border border-red-400',
      warm  && 'bg-amber-100 text-amber-800 border border-amber-400',
      !hot && !warm && 'bg-emerald-50 text-emerald-700 border border-emerald-300',
    )}>
      {mult.toFixed(1)}×
    </div>
  );
}

function MiniChart({ points }: { points: HistoryPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.multiplier));
  return (
    <>
      <div className="flex items-end gap-[1px] h-20">
        {points.map((p, i) => {
          const pct = Math.round((p.multiplier / max) * 100);
          return (
            <div
              key={i}
              className={cn(
                'flex-1 rounded-t',
                p.multiplier >= 1.5 ? 'bg-red-500' : p.multiplier > 1 ? 'bg-amber-400' : 'bg-emerald-400',
              )}
              style={{ height: `${Math.max(3, pct)}%` }}
              title={`${new Date(p.computed_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${p.multiplier.toFixed(2)}× · ${p.active_riders}r / ${p.pending_orders}p`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>{new Date(points[0]!.computed_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
        <span>Now</span>
      </div>
    </>
  );
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
