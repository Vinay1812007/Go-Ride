// Admin SOS emergency queue. Live-refreshed every 10s (tighter than
// other pages because SOS is time-critical).
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/cn';

type Status = 'open' | 'acknowledged' | 'resolved' | 'false_alarm';
type Filter = 'active' | 'open' | 'acknowledged' | 'resolved' | 'all';

interface Customer { full_name: string; phone?: string | null; email?: string | null }
interface Alert {
  id: string;
  profile_id: string;
  role: 'customer' | 'rider' | 'admin' | 'restaurant_partner';
  order_id?: string | null;
  lat: number;
  lng: number;
  note?: string | null;
  status: Status;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  created_at: string;
  profiles?: Customer;
}

export default function SosPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('active');
  const [busy, setBusy] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Alert | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [falseAlarm, setFalseAlarm] = useState(false);
  const toast = useToast();

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await api.get<{ alerts: Alert[] }>(`/admin/sos?status=${filter}`);
      setAlerts(res.alerts);
    } catch (e) {
      if (!silent) toast.error(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      if (!silent) setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter]);
  useEffect(() => {
    const t = setInterval(() => void load(true), 10_000);
    return () => clearInterval(t);
  }, [filter]);

  // Live subscribe to the global SOS channel — new alerts pop in without
  // waiting for the 10s refresh.
  useEffect(() => {
    const ch = supabase.channel('sos:global', { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'alert' }, () => void load(true))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function ack(a: Alert) {
    setBusy(a.id);
    try {
      await api.post(`/admin/sos/${a.id}/acknowledge`);
      toast.success('Acknowledged — customer sees this');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Acknowledge failed');
    } finally {
      setBusy(null);
    }
  }

  async function submitResolve() {
    if (!resolving) return;
    setBusy(resolving.id);
    try {
      await api.post(`/admin/sos/${resolving.id}/resolve`, {
        note: resolveNote.trim() || undefined,
        false_alarm: falseAlarm,
      });
      toast.success(falseAlarm ? 'Marked false alarm' : 'Resolved');
      setResolving(null); setResolveNote(''); setFalseAlarm(false);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Resolve failed');
    } finally {
      setBusy(null);
    }
  }

  const activeCount = useMemo(
    () => alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged').length,
    [alerts],
  );

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-red-600">🚨</span>
            SOS emergency queue
          </h1>
          <p className="text-xs text-slate-500">Live — refreshes every 10s. Realtime push on new alerts.</p>
        </div>
        <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
          {(['active', 'open', 'acknowledged', 'resolved', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${filter === f ? 'bg-surface-strong text-white' : 'text-slate-600'}`}
            >
              {f === 'active' ? `Active (${activeCount})` : f}
            </button>
          ))}
        </div>
      </div>

      {loading && Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card mb-2 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
      ))}

      {!loading && alerts.length === 0 && (
        <EmptyState
          icon="🕊️"
          title="No alerts in this view"
          description={filter === 'active' ? 'All quiet. Nothing needs a first-responder right now.' : 'Try a different filter.'}
        />
      )}

      <div className="space-y-3">
        {alerts.map((a) => (
          <AlertCard
            key={a.id}
            alert={a}
            busy={busy === a.id}
            onAck={() => ack(a)}
            onResolve={() => { setResolving(a); setResolveNote(''); setFalseAlarm(false); }}
          />
        ))}
      </div>

      {/* Resolve modal */}
      {resolving && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => setResolving(null)}>
          <div className="card bg-white max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">Resolve SOS</h2>
            <p className="text-xs text-slate-500 mb-3">
              {resolving.profiles?.full_name ?? '(unknown)'} · {resolving.role} · {new Date(resolving.created_at).toLocaleString()}
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium">Resolution note</span>
                <textarea
                  rows={3}
                  className="input mt-1"
                  placeholder="e.g. Contacted customer, situation resolved. Trip continued."
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  maxLength={500}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={falseAlarm} onChange={(e) => setFalseAlarm(e.target.checked)} className="h-4 w-4 accent-brand-500" />
                <span>Mark as false alarm (accidental press, test, etc.)</span>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setResolving(null)} className="btn-ghost">Cancel</button>
              <button
                onClick={submitResolve}
                disabled={busy === resolving.id}
                className="btn-primary bg-emerald-600 hover:bg-emerald-700"
              >
                {busy === resolving.id ? '…' : (falseAlarm ? 'Mark false alarm' : 'Mark resolved')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert: a, busy, onAck, onResolve }: {
  alert: Alert;
  busy: boolean;
  onAck: () => void;
  onResolve: () => void;
}) {
  const isOpen = a.status === 'open';
  const isAck  = a.status === 'acknowledged';
  const done   = a.status === 'resolved' || a.status === 'false_alarm';

  return (
    <div className={cn(
      'card',
      isOpen && 'border-l-8 border-l-red-600 bg-red-50/50',
      isAck  && 'border-l-8 border-l-amber-500 bg-amber-50/40',
    )}>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold">{a.profiles?.full_name ?? '(unknown)'}</span>
            <span className="chip text-[10px] capitalize">{a.role}</span>
            {a.order_id && <span className="text-xs font-mono text-slate-500">Order {a.order_id.slice(0, 8)}…</span>}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {a.profiles?.phone && <a href={`tel:${a.profiles.phone}`} className="underline text-brand-800 font-semibold">📞 {a.profiles.phone}</a>}
            {a.profiles?.email && <span className="ml-2">{a.profiles.email}</span>}
          </div>
        </div>
        <StatusPill status={a.status} />
      </div>

      {a.note && (
        <div className="mt-2 rounded-xl bg-white border border-red-300 p-3 text-sm">
          {a.note}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-slate-600 flex-wrap">
        <span>📍 {a.lat.toFixed(5)}, {a.lng.toFixed(5)}</span>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`}
          target="_blank"
          rel="noreferrer"
          className="text-brand-800 underline font-semibold"
        >
          Open in Maps →
        </a>
        <span className="text-slate-400">·</span>
        <span>Triggered {timeAgo(a.created_at)}</span>
      </div>

      {a.resolution_note && (
        <div className="mt-2 text-xs text-slate-500">
          <strong>Resolution:</strong> {a.resolution_note}
        </div>
      )}

      {!done && (
        <div className="mt-3 flex gap-2">
          {isOpen && (
            <button onClick={onAck} disabled={busy} className="btn-primary flex-1 py-2">
              {busy ? '…' : '👋 Acknowledge — I\'m on it'}
            </button>
          )}
          <button onClick={onResolve} disabled={busy} className={cn('flex-1 py-2 rounded-xl font-semibold', isOpen ? 'btn-ghost border border-surface-border' : 'btn-primary bg-emerald-600 hover:bg-emerald-700')}>
            ✓ Resolve
          </button>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    open:         'bg-red-100 text-red-800 border border-red-400 animate-pulse',
    acknowledged: 'bg-amber-100 text-amber-800 border border-amber-400',
    resolved:     'bg-emerald-50 text-emerald-800 border border-emerald-400',
    false_alarm:  'bg-slate-100 text-slate-600 border border-slate-300',
  };
  const label: Record<Status, string> = {
    open:         'OPEN',
    acknowledged: 'Acknowledged',
    resolved:     '✓ Resolved',
    false_alarm:  'False alarm',
  };
  return <span className={`chip ${map[status]} font-semibold`}>{label[status]}</span>;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
