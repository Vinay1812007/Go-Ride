// Admin panel router.
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import Spinner from '@/components/ui/Spinner';
import Skeleton from '@/components/ui/Skeleton';
import RidersPage from './RidersPage';
import OrdersPage from './OrdersPage';
import RateCardsPage from './RateCardsPage';
import LiveMapPage from './LiveMapPage';
import ReportsPage from './ReportsPage';
import PartnersPage from './PartnersPage';
import PromosPage from './PromosPage';
import RestaurantsPage from './RestaurantsPage';
import WalletAdminPage from './WalletAdminPage';
import PayoutsPage from './PayoutsPage';
import CitiesPage from './CitiesPage';
import SurgePage from './SurgePage';
import SupportPage from './SupportPage';
import SosPage from './SosPage';

interface Ops {
  kpi: {
    online_riders: number;
    on_trip_riders: number;
    active_orders: number;
    searching_orders: number;
    revenue_today: number;
    failed_today: number;
    cancelled_today: number;
    open_tickets: number;
    awaiting_tickets: number;
    pending_payouts: number;
    pending_payable: number;
    surge_hot_cards: number;
  };
  surge: Array<{ city: string; service: string; surge_multiplier: number; auto_surge: boolean }>;
  active_orders: Array<{ id: string; order_no: string; service: string; status: string; city: string; pickup_address: string; drop_address: string; fare_estimate?: number; created_at: string; accepted_at?: string | null }>;
  live_captains: Array<{ id: string; city: string; vehicle_type: string; status: string; last_seen: string; profiles: { full_name: string } | { full_name: string }[] }>;
  recent_cancels: Array<{ id: string; order_no: string; service: string; status: string; cancelled_reason?: string | null; cancelled_at: string; fare_estimate?: number }>;
  orders_24h: Array<{ hour: string; total: number; failed: number; cancelled: number }>;
}

function Dashboard() {
  const [ops, setOps] = useState<Ops | null>(null);
  const [seeding, setSeeding] = useState<'seed' | 'purge' | null>(null);
  const toast = useToast();

  const loadOps = () => api.get<Ops>('/admin/ops-dashboard').then(setOps).catch(() => {});
  useEffect(() => {
    let alive = true;
    const load = () => api.get<Ops>('/admin/ops-dashboard').then((v) => { if (alive) setOps(v); }).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function seedDemo() {
    if (!confirm('Load demo data? This creates 5 captains, 3 customers, and 15 sample orders.')) return;
    setSeeding('seed');
    try {
      const res = await api.post<{ captains: number; customers: number; orders: number }>('/admin/dev/seed-demo');
      toast.success(`Loaded ${res.captains} captains, ${res.customers} customers, ${res.orders} orders.`);
      await loadOps();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Seed failed');
    } finally {
      setSeeding(null);
    }
  }

  async function purgeDemo() {
    if (!confirm('Delete all demo data? This removes every user with @goride.demo email and their orders.')) return;
    setSeeding('purge');
    try {
      const res = await api.post<{ deleted: number; orders: number }>('/admin/dev/purge-demo');
      toast.success(`Purged ${res.deleted} demo profile(s) and ${res.orders ?? 0} order(s).`);
      await loadOps();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Purge failed');
    } finally {
      setSeeding(null);
    }
  }

  const k = ops?.kpi;
  const maxOrders24 = Math.max(1, ...(ops?.orders_24h?.map((b) => b.total) ?? [1]));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Operations dashboard</h1>
        <p className="text-xs text-slate-500">Auto-refreshes every 15s.</p>
      </div>

      {/* KPI grid — 6 primary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Online captains" value={k?.online_riders ?? '–'} sub={k ? `${k.on_trip_riders} on trip` : ''} />
        <KpiCard label="Active orders"  value={k?.active_orders ?? '–'}   sub={k ? `${k.searching_orders} searching` : ''} />
        <KpiCard label="Revenue today"  value={inr(k?.revenue_today ?? 0)} />
        <KpiCard label="Cancelled today" value={k?.cancelled_today ?? '–'} tone={k && k.cancelled_today > 0 ? 'warn' : 'ok'} />
        <KpiCard label="Failed today"    value={k?.failed_today ?? '–'}    tone={k && k.failed_today > 0 ? 'bad' : 'ok'} sub="no captain found" />
        <KpiCard label="Hot surge cards" value={k?.surge_hot_cards ?? 0}   tone={k && k.surge_hot_cards > 0 ? 'warn' : 'ok'} sub="> 1.0×" />
      </div>

      {/* Queues row — ticket queue + payout queue */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NavLink to="/admin/support" className="card hover:shadow-lg transition">
          <div className="flex items-baseline justify-between">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Support</div>
            <span className="text-slate-400">→</span>
          </div>
          <div className="mt-1 flex items-baseline gap-4">
            <div>
              <div className="text-2xl font-bold">{k?.open_tickets ?? '–'}</div>
              <div className="text-xs text-slate-500">Open</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-brand-800">{k?.awaiting_tickets ?? '–'}</div>
              <div className="text-xs text-slate-500">Awaiting customer</div>
            </div>
          </div>
        </NavLink>
        <NavLink to="/admin/payouts" className="card hover:shadow-lg transition">
          <div className="flex items-baseline justify-between">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Payouts</div>
            <span className="text-slate-400">→</span>
          </div>
          <div className="mt-1 flex items-baseline gap-4">
            <div>
              <div className="text-2xl font-bold">{k?.pending_payouts ?? '–'}</div>
              <div className="text-xs text-slate-500">Pending</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{inr(k?.pending_payable ?? 0)}</div>
              <div className="text-xs text-slate-500">Payable</div>
            </div>
          </div>
        </NavLink>
      </div>

      {/* 24-hour orders histogram */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Orders · last 24 hours</div>
          <div className="text-xs text-slate-500">
            {ops?.orders_24h?.reduce((s, b) => s + b.total, 0) ?? 0} total
          </div>
        </div>
        {ops ? (
          <div className="flex items-end gap-[2px] h-24">
            {ops.orders_24h.map((b, i) => {
              const pct = Math.round((b.total / maxOrders24) * 100);
              const successful = b.total - b.failed - b.cancelled;
              return (
                <div key={i} className="flex-1 flex flex-col justify-end gap-[1px]" title={`${b.hour} — ${b.total} orders (${b.failed} failed, ${b.cancelled} cancelled)`}>
                  {b.cancelled > 0 && <div className="bg-slate-400" style={{ height: `${(b.cancelled / maxOrders24) * 100}%` }} />}
                  {b.failed    > 0 && <div className="bg-red-500"  style={{ height: `${(b.failed / maxOrders24) * 100}%`    }} />}
                  {successful  > 0 && <div className="bg-brand-500" style={{ height: `${(successful / maxOrders24) * 100}%` }} />}
                  {b.total === 0 && <div className="bg-slate-100" style={{ height: `${Math.max(3, pct)}%` }} />}
                </div>
              );
            })}
          </div>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
          <span><span className="inline-block w-2 h-2 bg-brand-500 mr-1" />Completed / in-progress</span>
          <span><span className="inline-block w-2 h-2 bg-red-500 mr-1" />No captain found</span>
          <span><span className="inline-block w-2 h-2 bg-slate-400 mr-1" />Cancelled</span>
        </div>
      </div>

      {/* Two-column live lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Active orders */}
        <div className="card p-0 overflow-hidden">
          <div className="p-3 border-b border-surface-border flex items-baseline justify-between">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Live orders</div>
            <NavLink to="/admin/orders" className="text-xs text-slate-500 hover:text-surface-strong">See all →</NavLink>
          </div>
          {!ops && <div className="p-3"><Skeleton className="h-16 w-full" /></div>}
          {ops && ops.active_orders.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-500">No active orders right now.</div>
          )}
          {ops?.active_orders.map((o) => (
            <div key={o.id} className="p-3 border-b border-surface-border last:border-none">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-mono">{o.order_no}</div>
                <StatusPill status={o.status} />
              </div>
              <div className="text-xs text-slate-500 truncate mt-1">
                {o.pickup_address} → {o.drop_address}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                <span>{o.service}</span>
                <span>·</span>
                <span>{new Date(o.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                {o.fare_estimate != null && <><span>·</span><span>{inr(o.fare_estimate)}</span></>}
              </div>
            </div>
          ))}
        </div>

        {/* Live captains */}
        <div className="card p-0 overflow-hidden">
          <div className="p-3 border-b border-surface-border flex items-baseline justify-between">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Live captains</div>
            <NavLink to="/admin/live-map" className="text-xs text-slate-500 hover:text-surface-strong">Map →</NavLink>
          </div>
          {!ops && <div className="p-3"><Skeleton className="h-16 w-full" /></div>}
          {ops && ops.live_captains.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-500">No captains online right now.</div>
          )}
          {ops?.live_captains.map((r) => {
            const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
            return (
              <div key={r.id} className="p-3 border-b border-surface-border last:border-none flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${r.status === 'on_trip' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p?.full_name ?? '(unknown)'}</div>
                  <div className="text-xs text-slate-500">{r.vehicle_type} · {r.city}</div>
                </div>
                <div className="text-[10px] text-slate-500 flex-shrink-0">
                  {r.status === 'on_trip' ? 'On trip' : timeAgo(r.last_seen)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hot surge cards */}
      {ops && ops.surge.length > 0 && (
        <div className="card">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Surge active</div>
            <NavLink to="/admin/surge" className="text-xs text-slate-500 hover:text-surface-strong">See all →</NavLink>
          </div>
          <div className="flex flex-wrap gap-2">
            {ops.surge.map((s) => {
              const hot = s.surge_multiplier >= 1.5;
              return (
                <span key={`${s.city}-${s.service}`} className={`chip py-1 ${hot ? 'bg-red-100 text-red-700 border border-red-400' : 'bg-amber-50 text-amber-800 border border-amber-400'}`}>
                  {s.service} · {s.city} <span className="font-mono font-bold ml-1">{s.surge_multiplier.toFixed(1)}×</span>
                  {s.auto_surge && <span className="text-[9px] opacity-70 ml-1">AUTO</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent cancellations */}
      {ops && ops.recent_cancels.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="p-3 border-b border-surface-border text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Recent cancellations
          </div>
          {ops.recent_cancels.map((o) => (
            <div key={o.id} className="p-3 border-b border-surface-border last:border-none flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm">
                  <span className="font-mono">{o.order_no}</span>
                  <span className="text-xs text-slate-500 ml-2 capitalize">{o.status.replace('cancelled_', 'by ')}</span>
                </div>
                <div className="text-xs text-slate-500 truncate">{o.cancelled_reason ?? '(no reason)'}</div>
              </div>
              <div className="text-[10px] text-slate-500 flex-shrink-0">{timeAgo(o.cancelled_at)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Demo data controls — one-click population for screenshots/pilots */}
      <div className="card border-dashed border-2 border-surface-border bg-surface-muted/60 mt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Demo data</div>
            <p className="text-xs text-slate-500 mt-1 max-w-md">
              Populate the dashboard with 5 captains around Hyderabad, 3 customers, and 15 sample
              orders. Idempotent — safe to re-run.
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={seedDemo}
              disabled={!!seeding}
              className="btn-primary py-2 inline-flex items-center gap-1"
            >
              {seeding === 'seed' && <Spinner className="h-3 w-3" />}
              Load demo data
            </button>
            <button
              onClick={purgeDemo}
              disabled={!!seeding}
              className="btn-ghost py-2 border border-surface-border text-red-600 inline-flex items-center gap-1"
            >
              {seeding === 'purge' && <Spinner className="h-3 w-3" />}
              Purge demo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminShell() {
  const links = [
    { to: '/admin',            label: 'Dashboard' },
    { to: '/admin/live-map',   label: 'Live map' },
    { to: '/admin/orders',     label: 'Orders' },
    { to: '/admin/riders',     label: 'Riders' },
    { to: '/admin/cities',      label: 'Cities' },
    { to: '/admin/rate-cards',  label: 'Rate cards' },
    { to: '/admin/surge',       label: 'Surge' },
    { to: '/admin/promos',      label: 'Promos' },
    { to: '/admin/restaurants', label: 'Restaurants' },
    { to: '/admin/sos',         label: '🚨 SOS' },
    { to: '/admin/support',     label: 'Support' },
    { to: '/admin/wallet',      label: 'Wallet & credits' },
    { to: '/admin/payouts',     label: 'Payouts' },
    { to: '/admin/reports',     label: 'Reports' },
    { to: '/admin/partners',    label: 'Partners' },
  ];
  return (
    <div className="h-full flex">
      <aside className="w-56 bg-surface-strong text-white flex-shrink-0 hidden md:block">
        <div className="p-4 font-bold">GoRide Admin</div>
        <nav className="flex flex-col">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/admin'}
              className={({ isActive }) => `px-4 py-2 text-sm ${isActive ? 'bg-brand-500 text-surface-strong' : 'hover:bg-slate-800'}`}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="" element={<Dashboard />} />
          <Route path="live-map" element={<LiveMapPage />} />
          <Route path="cities" element={<CitiesPage />} />
          <Route path="rate-cards" element={<RateCardsPage />} />
          <Route path="surge" element={<SurgePage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="sos" element={<SosPage />} />
          <Route path="promos" element={<PromosPage />} />
          <Route path="restaurants" element={<RestaurantsPage />} />
          <Route path="wallet" element={<WalletAdminPage />} />
          <Route path="payouts" element={<PayoutsPage />} />
          <Route path="riders" element={<RidersPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="partners" element={<PartnersPage />} />
          <Route path="*" element={<div className="p-4 text-slate-500">Coming in Day 3.</div>} />
        </Routes>
      </main>
    </div>
  );
}

// ── Helpers used by the ops dashboard ─────────────────────────────────────
function KpiCard({ label, value, sub, tone }: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const border =
    tone === 'bad'  ? 'border-red-300 bg-red-50/60' :
    tone === 'warn' ? 'border-amber-300 bg-amber-50/60' :
    '';
  return (
    <div className={`card ${border}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    searching:  'bg-amber-50 text-amber-800 border border-amber-400',
    accepted:   'bg-blue-50 text-blue-800 border border-blue-400',
    arrived:    'bg-blue-50 text-blue-800 border border-blue-400',
    picked_up:  'bg-indigo-50 text-indigo-800 border border-indigo-400',
    in_transit: 'bg-indigo-50 text-indigo-800 border border-indigo-400',
  };
  return <span className={`chip py-0 text-[10px] ${map[status] ?? 'bg-slate-100 text-slate-600 border border-slate-300'}`}>{status.replace('_', ' ')}</span>;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
