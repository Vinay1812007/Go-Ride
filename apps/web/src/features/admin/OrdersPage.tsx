// Admin — orders list with status filter, re-dispatch, and dispatch diagnostic.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr, serviceLabel, statusLabel } from '@/lib/format';
import type { OrderStatus, ServiceType } from '@/lib/types';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import Spinner from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

interface OrderRow {
  id: string;
  order_no: string;
  service: ServiceType;
  status: OrderStatus;
  city: string;
  pickup_address: string;
  drop_address: string;
  fare_estimate?: number;
  fare_final?: number;
  distance_km?: number;
  created_at: string;
  rider_id?: string | null;
  cancelled_reason?: string | null;
}

interface DispatchReport {
  order: { id: string; service: string; city: string; status: string; age_seconds: number };
  total_riders: number;
  eligible_count: number;
  within_5km: number;
  within_10km: number;
  riders: Array<{
    rider_id: string;
    name?: string;
    status: string;
    vehicle_type: string;
    city: string;
    kyc: string;
    last_seen: string | null;
    distance_km: number | null;
    eligible: boolean;
    reasons: string[];
  }>;
}

const FILTERS: Array<{ label: string; value: OrderStatus | 'searching_only' | 'all' }> = [
  { label: 'Searching', value: 'searching_only' },
  { label: 'Active',    value: 'accepted' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed',    value: 'no_rider_found' },
  { label: 'All',       value: 'all' },
];

export default function OrdersPage() {
  const [filter, setFilter] = useState<typeof FILTERS[number]['value']>('all');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<DispatchReport | null>(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const url = filter === 'all'
        ? '/admin/orders'
        : filter === 'searching_only'
          ? '/admin/orders?status=searching'
          : `/admin/orders?status=${filter}`;
      const res = await api.get<{ orders: OrderRow[] }>(url);
      setOrders(res.orders);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter]);

  // Refresh every 15s so admins can watch dispatch live
  useEffect(() => {
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  // eslint-disable-next-line
  }, [filter]);

  async function redispatch(orderId: string) {
    setBusy(orderId);
    try {
      const res = await api.post<{ offers_sent: number }>(`/admin/orders/${orderId}/redispatch`);
      toast.success(`Re-dispatched — ${res.offers_sent} offer(s) sent to nearest captains.`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Re-dispatch failed');
    } finally {
      setBusy(null);
    }
  }

  async function showDiagnose(orderId: string) {
    setReport(null); setBusy(orderId);
    try {
      const r = await api.get<DispatchReport>(`/admin/orders/${orderId}/dispatch-report`);
      setReport(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Diagnose failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Orders</h1>
        <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                filter === f.value ? 'bg-surface-strong text-white' : 'text-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && orders.length === 0 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left p-3">Order</th>
                <th className="text-left p-3">Service</th>
                <th className="text-left p-3">Route</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Fare</th>
                <th className="text-left p-3">When</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t border-surface-border">
                  <td className="p-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-16" /></td>
                  <td className="p-3 space-y-1"><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-32" /></td>
                  <td className="p-3"><Skeleton className="h-6 w-24" rounded="full" /></td>
                  <td className="p-3 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                  <td className="p-3"><Skeleton className="h-3 w-16" /></td>
                  <td className="p-3"><Skeleton className="h-7 w-20 ml-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {orders.length === 0 && !loading && (
        <EmptyState
          icon="📋"
          title={`No ${filter === 'all' ? '' : filter.replace('_', ' ')} orders`}
          description="Once customers or partners book, they'll appear here in real time."
        />
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs text-slate-500 uppercase">
            <tr>
              <th className="text-left p-3">Order</th>
              <th className="text-left p-3">Service</th>
              <th className="text-left p-3">Route</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Fare</th>
              <th className="text-left p-3">When</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const isStuck = o.status === 'searching' || o.status === 'no_rider_found';
              const age = Math.round((Date.now() - new Date(o.created_at).getTime()) / 1000);
              return (
                <tr key={o.id} className="border-t border-surface-border align-top">
                  <td className="p-3 font-mono text-xs">{o.order_no}</td>
                  <td className="p-3">{serviceLabel(o.service)}</td>
                  <td className="p-3 max-w-xs">
                    <div className="text-xs text-slate-500 truncate">↑ {o.pickup_address}</div>
                    <div className="text-xs text-slate-500 truncate">↓ {o.drop_address}</div>
                  </td>
                  <td className="p-3">
                    <StatusChip status={o.status} />
                    {o.cancelled_reason && (
                      <div className="text-[10px] text-slate-500 mt-1">{o.cancelled_reason}</div>
                    )}
                  </td>
                  <td className="p-3 text-right font-medium">{inr(o.fare_final ?? o.fare_estimate)}</td>
                  <td className="p-3 text-xs text-slate-500">
                    {age < 60 ? `${age}s ago` : age < 3600 ? `${Math.round(age/60)}m ago` : new Date(o.created_at).toLocaleString()}
                  </td>
                  <td className="p-3 text-right space-y-1">
                    <button
                      onClick={() => showDiagnose(o.id)}
                      disabled={busy === o.id}
                      className="btn-ghost text-xs px-2 py-1 border border-surface-border"
                    >
                      Diagnose
                    </button>
                    {isStuck && (
                      <button
                        onClick={() => redispatch(o.id)}
                        disabled={busy === o.id}
                        className="btn-primary text-xs px-2 py-1 ml-1 inline-flex items-center gap-1"
                      >
                        {busy === o.id ? <Spinner className="h-3 w-3" /> : null}
                        Re-dispatch
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {report && <DispatchReportModal report={report} onClose={() => setReport(null)} />}
    </div>
  );
}

function StatusChip({ status }: { status: OrderStatus }) {
  const styles: Record<OrderStatus, string> = {
    searching:          'bg-amber-50 text-amber-800 border border-amber-400',
    accepted:           'bg-blue-50 text-blue-800 border border-blue-400',
    arrived:            'bg-blue-50 text-blue-800 border border-blue-400',
    picked_up:          'bg-indigo-50 text-indigo-800 border border-indigo-400',
    in_transit:         'bg-indigo-50 text-indigo-800 border border-indigo-400',
    delivered:          'bg-emerald-50 text-emerald-800 border border-emerald-400',
    completed:          'bg-emerald-50 text-emerald-800 border border-emerald-400',
    cancelled_customer: 'bg-slate-100 text-slate-600 border border-slate-300',
    cancelled_rider:    'bg-slate-100 text-slate-600 border border-slate-300',
    no_rider_found:     'bg-red-50 text-red-800 border border-red-400',
  };
  return <span className={`chip ${styles[status]}`}>{statusLabel(status)}</span>;
}

function DispatchReportModal({ report, onClose }: { report: DispatchReport; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-5 border-b border-surface-border sticky top-0 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Dispatch report</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Order status: {report.order.status} · Age: {report.order.age_seconds}s · City: {report.order.city} · Service: {report.order.service}
              </p>
            </div>
            <button onClick={onClose} className="text-2xl text-slate-500">×</button>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
            <div className="bg-surface-muted rounded-lg p-2">
              <div className="text-slate-500">Total riders</div>
              <div className="text-lg font-bold">{report.total_riders}</div>
            </div>
            <div className="bg-surface-muted rounded-lg p-2">
              <div className="text-slate-500">Eligible</div>
              <div className="text-lg font-bold">{report.eligible_count}</div>
            </div>
            <div className="bg-surface-muted rounded-lg p-2">
              <div className="text-slate-500">Within 5 km</div>
              <div className="text-lg font-bold">{report.within_5km}</div>
            </div>
            <div className="bg-surface-muted rounded-lg p-2">
              <div className="text-slate-500">Within 10 km</div>
              <div className="text-lg font-bold">{report.within_10km}</div>
            </div>
          </div>
        </header>

        <div className="p-5">
          {report.total_riders === 0 && (
            <div className="text-sm text-slate-500 text-center py-6">
              No riders exist in the system yet. Onboard a captain and approve KYC first.
            </div>
          )}
          <div className="space-y-2">
            {report.riders.map((r) => (
              <div
                key={r.rider_id}
                className={`rounded-xl p-3 border ${r.eligible ? 'border-emerald-400 bg-emerald-50' : 'border-surface-border bg-white'}`}
              >
                <div className="flex items-baseline justify-between">
                  <div className="font-medium">{r.name ?? r.rider_id.slice(0, 8)}</div>
                  <div className="text-xs text-slate-500">
                    {r.distance_km != null ? `${r.distance_km} km away` : 'no gps'}
                  </div>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {r.vehicle_type} · {r.city} · kyc: {r.kyc} · status: {r.status}
                  {r.last_seen && <> · seen {Math.round((Date.now() - new Date(r.last_seen).getTime()) / 1000)}s ago</>}
                </div>
                {r.reasons.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.reasons.map((reason) => (
                      <span key={reason} className="chip bg-red-50 text-red-700 border border-red-300 text-[10px]">
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
