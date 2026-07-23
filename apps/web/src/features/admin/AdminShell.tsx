// Admin panel router.
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from '@/lib/api';
import { inr } from '@/lib/format';
import RidersPage from './RidersPage';
import OrdersPage from './OrdersPage';
import RateCardsPage from './RateCardsPage';
import LiveMapPage from './LiveMapPage';
import ReportsPage from './ReportsPage';
import PartnersPage from './PartnersPage';

interface Stats { online_riders: number; active_orders: number; revenue_today: number }

function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.get<Stats>('/admin/stats').then((v) => { if (alive) setS(v); }).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-3 gap-3">
        <div className="card"><div className="text-xs text-slate-500">Online riders</div><div className="text-3xl font-bold">{s?.online_riders ?? '–'}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Active orders</div><div className="text-3xl font-bold">{s?.active_orders ?? '–'}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Revenue today</div><div className="text-3xl font-bold">{inr(s?.revenue_today ?? 0)}</div></div>
      </div>
      <p className="text-xs text-slate-500">Stats refresh every 15s. Full rider live-map, orders table, and reports come in Day 3.</p>
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
