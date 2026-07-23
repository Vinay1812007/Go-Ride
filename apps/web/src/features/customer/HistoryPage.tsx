import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { OrderSummary } from '@/lib/types';
import { inr, serviceLabel, statusLabel } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

export default function HistoryPage() {
  const nav = useNavigate();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<{ orders: OrderSummary[] }>('/orders')
      .then((r) => setOrders(r.orders))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="h-full bg-surface-muted">
      <header className="bg-white border-b border-surface-border px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Link to="/" className="text-slate-500 text-lg leading-none">←</Link>
        <h1 className="font-bold">Your trips</h1>
      </header>
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
        {!loading && orders.length === 0 && (
          <EmptyState
            icon="🛺"
            title="No trips yet"
            description="Your booked rides, deliveries, and completed trips will show up here."
            cta={{ label: 'Book a ride', onClick: () => nav('/') }}
          />
        )}
        {orders.map((o, i) => (
          <Link
            key={o.id}
            to={`/track/${o.id}`}
            className="block card animate-fade-in"
            style={{ animationDelay: `${Math.min(i * 40, 200)}ms`, animationFillMode: 'backwards' }}
          >
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
