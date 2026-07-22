import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { OrderSummary } from '@/lib/types';
import { inr, serviceLabel, statusLabel } from '@/lib/format';

export default function HistoryPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<{ orders: OrderSummary[] }>('/orders').then((r) => setOrders(r.orders)).finally(() => setLoading(false));
  }, []);
  return (
    <div className="h-full bg-surface-muted">
      <header className="bg-white border-b border-surface-border px-4 py-3 flex items-center gap-3">
        <Link to="/" className="text-slate-500">←</Link>
        <h1 className="font-bold">Your trips</h1>
      </header>
      <div className="p-4 space-y-3 max-w-md mx-auto">
        {loading && <div className="text-center text-sm text-slate-500 py-10">Loading…</div>}
        {!loading && orders.length === 0 && (
          <div className="card text-center py-10 text-slate-500">
            <div className="text-4xl mb-2">🛺</div>
            <div className="text-sm">No trips yet.</div>
          </div>
        )}
        {orders.map((o) => (
          <Link key={o.id} to={`/track/${o.id}`} className="block card">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{serviceLabel(o.service)}</span>
              <span className="text-slate-500 text-xs">{new Date(o.created_at).toLocaleString()}</span>
            </div>
            <div className="text-sm text-slate-500 mt-1 truncate">{o.pickup_address} → {o.drop_address}</div>
            <div className="mt-2 flex items-center justify-between">
              <span className="chip">{statusLabel(o.status)}</span>
              <span className="font-bold">{inr(o.fare_final ?? o.fare_estimate)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
