// Admin panel router.
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import Spinner from '@/components/ui/Spinner';
import RidersPage from './RidersPage';
import OrdersPage from './OrdersPage';
import RateCardsPage from './RateCardsPage';
import LiveMapPage from './LiveMapPage';
import ReportsPage from './ReportsPage';
import PartnersPage from './PartnersPage';

interface Stats { online_riders: number; active_orders: number; revenue_today: number }

function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [seeding, setSeeding] = useState<'seed' | 'purge' | null>(null);
  const toast = useToast();

  const loadStats = () => api.get<Stats>('/admin/stats').then(setS).catch(() => {});
  useEffect(() => {
    let alive = true;
    const load = () => api.get<Stats>('/admin/stats').then((v) => { if (alive) setS(v); }).catch(() => {});
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
      await loadStats();
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
      await loadStats();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Purge failed');
    } finally {
      setSeeding(null);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-3 gap-3">
        <div className="card"><div className="text-xs text-slate-500">Online riders</div><div className="text-3xl font-bold">{s?.online_riders ?? '–'}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Active orders</div><div className="text-3xl font-bold">{s?.active_orders ?? '–'}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Revenue today</div><div className="text-3xl font-bold">{inr(s?.revenue_today ?? 0)}</div></div>
      </div>
      <p className="text-xs text-slate-500">Stats refresh every 15s.</p>

      {/* Demo data controls — one-click population for screenshots/pilots */}
      <div className="card border-dashed border-2 border-surface-border bg-surface-muted/60 mt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Demo data</div>
            <p className="text-xs text-slate-500 mt-1 max-w-md">
              Populate the dashboard with 5 captains around Hyderabad, 3 customers, and 15 sample
              orders (completed, in-transit, cancelled, searching, no-rider-found) so screens
              have real activity to show. Idempotent — safe to re-run.
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
    { to: '/admin/rate-cards', label: 'Rate cards' },
    { to: '/admin/reports',    label: 'Reports' },
    { to: '/admin/partners',   label: 'Partners' },
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
          <Route path="rate-cards" element={<RateCardsPage />} />
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
