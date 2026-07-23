// Admin panel — Day 3 milestone. This is a working skeleton with live stats
// and rate-card list so the wiring is real; deep tables are Day 3.
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from '@/lib/api';
import { inr, serviceLabel } from '@/lib/format';
import type { ServiceType } from '@/lib/types';
import RidersPage from './RidersPage';

interface Stats { online_riders: number; active_orders: number; revenue_today: number }
interface RateCard { id: number; city: string; service: ServiceType; base_fare: number; base_km: number; per_km: number; per_min: number; min_fare: number; surge_multiplier: number; commission_pct: number; active: boolean }

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

function RateCards() {
  const [cards, setCards] = useState<RateCard[]>([]);
  useEffect(() => {
    api.get<{ rate_cards: RateCard[] }>('/admin/rate-cards').then((r) => setCards(r.rate_cards));
  }, []);
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Rate cards</h1>
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs text-slate-500 uppercase">
            <tr>
              <th className="text-left p-3">City</th>
              <th className="text-left p-3">Service</th>
              <th className="text-right p-3">Base</th>
              <th className="text-right p-3">Per km</th>
              <th className="text-right p-3">Per min</th>
              <th className="text-right p-3">Min</th>
              <th className="text-right p-3">Surge</th>
              <th className="text-right p-3">Comm %</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id} className="border-t border-surface-border">
                <td className="p-3">{c.city}</td>
                <td className="p-3">{serviceLabel(c.service)}</td>
                <td className="p-3 text-right">₹{c.base_fare} ({c.base_km} km)</td>
                <td className="p-3 text-right">₹{c.per_km}</td>
                <td className="p-3 text-right">₹{c.per_min}</td>
                <td className="p-3 text-right">₹{c.min_fare}</td>
                <td className="p-3 text-right">{c.surge_multiplier}x</td>
                <td className="p-3 text-right">{c.commission_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 mt-3">Editable CRUD form ships in Day 3. Changes take effect instantly across the fleet.</p>
    </div>
  );
}

export default function AdminShell() {
  const links = [
    { to: '/admin',            label: 'Dashboard' },
    { to: '/admin/orders',     label: 'Orders' },
    { to: '/admin/riders',     label: 'Riders' },
    { to: '/admin/rate-cards', label: 'Rate cards' },
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
          <Route path="rate-cards" element={<RateCards />} />
          <Route path="riders" element={<RidersPage />} />
          <Route path="*" element={<div className="p-4 text-slate-500">Coming in Day 3.</div>} />
        </Routes>
      </main>
    </div>
  );
}
