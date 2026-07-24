// Live orders queue for a restaurant partner.
// Refresh every 15s so the queue stays warm without a full realtime setup.
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import type { OrderStatus } from '@/lib/types';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface FoodDetails {
  items: Array<{ menu_item_id: string; name: string; qty: number; price: number }>;
  instructions?: string | null;
  subtotal: number;
}

interface Order {
  id: string;
  order_no: string;
  status: OrderStatus;
  service: string;
  pickup_address: string;
  drop_address: string;
  food_details?: FoodDetails | null;
  fare_estimate?: number;
  fare_final?: number;
  created_at: string;
  accepted_at?: string | null;
  picked_at?: string | null;
  completed_at?: string | null;
  rider_id?: string | null;
}

type Filter = 'live' | 'today' | 'all';

const LIVE_STATUSES: OrderStatus[] = ['searching', 'accepted', 'arrived', 'picked_up', 'in_transit'];

export default function PartnerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('live');
  const toast = useToast();

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await api.get<{ orders: Order[] }>('/partner-restaurant/orders');
      setOrders(res.orders);
    } catch (e) {
      if (!silent) toast.error(e instanceof ApiError ? e.message : 'Failed to load orders');
    } finally {
      if (!silent) setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const t = setInterval(() => void load(true), 15_000);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => {
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    if (filter === 'live') return orders.filter((o) => LIVE_STATUSES.includes(o.status));
    if (filter === 'today') return orders.filter((o) => new Date(o.created_at).getTime() >= startOfToday);
    return orders;
  }, [orders, filter]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold">Orders</h1>
        <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
          {(['live', 'today', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium capitalize',
                filter === f ? 'bg-surface-strong text-white' : 'text-slate-600',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading && Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card mb-3 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      ))}

      {!loading && shown.length === 0 && (
        <EmptyState
          icon="🧾"
          title={filter === 'live' ? 'No live orders' : 'No orders in this window'}
          description={
            filter === 'live'
              ? 'Nothing being prepared or in transit right now.'
              : 'Try a different filter — everything you\'ve served will show under All.'
          }
        />
      )}

      <div className="space-y-3">
        {shown.map((o) => (
          <div key={o.id} className="card">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <div className="text-xs font-mono text-slate-500">#{o.order_no}</div>
                <div className="font-semibold">{new Date(o.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
              </div>
              <StatusBadge status={o.status} />
            </div>
            {o.food_details && (
              <ul className="mt-2 text-sm space-y-0.5">
                {o.food_details.items.map((i) => (
                  <li key={i.menu_item_id} className="flex justify-between">
                    <span>{i.qty} × {i.name}</span>
                    <span className="text-slate-500">{inr(i.qty * i.price)}</span>
                  </li>
                ))}
              </ul>
            )}
            {o.food_details?.instructions && (
              <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded-md px-2 py-1 text-amber-900">
                📝 {o.food_details.instructions}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
              <div className="truncate max-w-[60%]">→ {o.drop_address}</div>
              <div className="font-bold text-surface-strong">{inr(o.fare_final ?? o.fare_estimate ?? 0)}</div>
            </div>
            <div className="mt-1 flex gap-3 text-[10px] text-slate-500">
              {o.accepted_at && <span>Accepted {timeAgo(o.accepted_at)}</span>}
              {o.picked_at   && <span>Picked {timeAgo(o.picked_at)}</span>}
              {o.completed_at && <span>Completed {timeAgo(o.completed_at)}</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-slate-400 mt-4">Auto-refreshes every 15s.</p>
    </div>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const map: Partial<Record<OrderStatus, string>> = {
    searching:  'bg-amber-50 text-amber-800 border border-amber-400',
    accepted:   'bg-blue-50 text-blue-800 border border-blue-400',
    arrived:    'bg-blue-50 text-blue-800 border border-blue-400',
    picked_up:  'bg-indigo-50 text-indigo-800 border border-indigo-400',
    in_transit: 'bg-indigo-50 text-indigo-800 border border-indigo-400',
    delivered:  'bg-emerald-50 text-emerald-800 border border-emerald-400',
    completed:  'bg-emerald-50 text-emerald-800 border border-emerald-400',
  };
  const labels: Partial<Record<OrderStatus, string>> = {
    searching:  'Awaiting captain',
    accepted:   'Captain on way',
    arrived:    'Captain here',
    picked_up:  'Picked up',
    in_transit: 'On the way',
    delivered:  'Delivered',
    completed:  'Completed',
  };
  return <span className={`chip py-0.5 text-[10px] ${map[status] ?? 'bg-slate-100 text-slate-600 border border-slate-300'}`}>{labels[status] ?? status}</span>;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
