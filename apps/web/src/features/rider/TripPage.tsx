// Full trip lifecycle for the rider — accepted → arrived → start (OTP) →
// picked_up/in_transit → complete → cash collect + rate customer.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import MapView from '@/components/MapView';
import StatusStepper from '@/components/ui/StatusStepper';
import ChatDrawer from '@/components/ChatDrawer';
import SosButton from '@/components/SosButton';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useChatUnread } from '@/hooks/useChatUnread';
import { inr, serviceLabel, statusLabel } from '@/lib/format';
import type { OrderStatus } from '@/lib/types';

interface Order {
  id: string;
  order_no: string;
  service: string;
  status: OrderStatus;
  pickup_lat: number; pickup_lng: number; pickup_address: string;
  drop_lat: number;   drop_lng: number;   drop_address: string;
  route_polyline?: string;
  fare_estimate?: number;
  fare_final?: number;
  fare_breakup?: { rider_earning?: number; commission?: number };
  payment_method: 'cash' | 'upi' | 'wallet';
  customer_id: string;
  parcel_details?: { receiver_name: string; receiver_phone: string; contents: string; weight_kg: number };
  food_details?: {
    items: Array<{ menu_item_id: string; name: string; qty: number; price: number }>;
    instructions?: string | null;
    subtotal: number;
  };
}

export default function TripPage() {
  const { orderId } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const { unread, drawerOpen, openDrawer, closeDrawer } = useChatUnread(orderId, 'rider');
  const chatEnabled = !!order && ['accepted', 'arrived', 'picked_up', 'in_transit'].includes(order.status);

  useEffect(() => {
    if (!orderId) return;
    api.get<{ order: Order }>(`/orders/${orderId}`)
      .then((r) => setOrder(r.order))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Order not found'));
  }, [orderId]);

  // Subscribe to status broadcasts so we know if customer cancels
  useEffect(() => {
    if (!orderId) return;
    const ch = supabase.channel(`order:${orderId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'status' }, (msg) => {
        setOrder((o) => o ? { ...o, status: msg.payload.status } : o);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orderId]);

  async function doAction(path: string, body?: unknown, onSuccess?: (r: any) => void) {
    if (!orderId) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ status?: OrderStatus; fare_final?: number }>(`/rides/${orderId}${path}`, body);
      if (res.status) setOrder((o) => o ? { ...o, status: res.status! } : o);
      if (res.fare_final != null) setOrder((o) => o ? { ...o, fare_final: res.fare_final } : o);
      onSuccess?.(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  function openNav(lat: number, lng: number) {
    // Open external map app: Google Maps on Android will use it; iOS uses maps.apple.com fallback.
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    window.open(url, '_blank');
  }

  if (error && !order) return <div className="h-full grid place-items-center text-red-600 p-4">{error}</div>;
  if (!order) return <div className="h-full grid place-items-center">Loading trip…</div>;

  const isParcel = order.service.startsWith('parcel_');
  const nextAction = getNextAction(order.status, isParcel);
  const showOtpInput = order.status === 'arrived';
  const showCashCollect = (order.status === 'completed' || order.status === 'delivered');
  const cashAmount = order.fare_final ?? order.fare_estimate ?? 0;
  const showSos = ['accepted', 'arrived', 'picked_up', 'in_transit'].includes(order.status);

  return (
    <div className="h-full flex flex-col">
      {showSos && (
        <SosButton orderId={order.id} fallback={{ lat: order.pickup_lat, lng: order.pickup_lng }} />
      )}
      <div className="absolute inset-0">
        <MapView
          pickup={{ lat: order.pickup_lat, lng: order.pickup_lng }}
          drop={{ lat: order.drop_lat, lng: order.drop_lng }}
          routePolyline={order.route_polyline}
        />
      </div>

      <header className="absolute top-0 inset-x-0 z-20 p-3 flex justify-between items-start gap-2">
        <div className="rounded-xl bg-white shadow-card px-3 py-2 text-xs font-medium">
          #{order.order_no}
        </div>
        <div className="flex gap-2">
          <button
            onClick={openDrawer}
            className="relative rounded-xl bg-white shadow-card px-3 py-2 text-xs font-medium"
            aria-label="Chat with customer"
          >
            💬 Chat
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 grid place-items-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          <div className="rounded-xl bg-white shadow-card px-3 py-2 text-xs">
            {serviceLabel(order.service as any)}
          </div>
        </div>
      </header>

      <ChatDrawer
        orderId={order.id}
        open={drawerOpen}
        onClose={closeDrawer}
        myRole="rider"
        otherLabel="Customer"
        chatEnabled={chatEnabled}
      />

      <div className="sheet z-10" style={{ bottom: 0 }}>
        <div className="sheet-handle" />
        <div className="px-5 pb-6 pt-1">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="text-lg font-bold">{statusLabel(order.status)}</div>
            <div className="text-sm text-slate-500">
              {isParcel ? 'Delivery' : 'Ride'} · {inr(cashAmount)}
            </div>
          </div>
          <StatusStepper status={order.status} />

          {/* Food order — items list, visible from acceptance so captain knows
              what to collect from the restaurant */}
          {order.service === 'food' && order.food_details && (
            <div className="mt-4 rounded-xl bg-surface-muted p-3 text-sm">
              <div className="text-xs uppercase text-slate-400 mb-1">Pick up from restaurant</div>
              <ul className="space-y-1">
                {order.food_details.items.map((it) => (
                  <li key={it.menu_item_id} className="flex justify-between">
                    <span>{it.qty} × {it.name}</span>
                    <span className="text-slate-500">{inr(it.qty * it.price)}</span>
                  </li>
                ))}
              </ul>
              {order.food_details.instructions && (
                <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded-md px-2 py-1 text-amber-900">
                  📝 {order.food_details.instructions}
                </div>
              )}
            </div>
          )}

          {/* Parcel receiver details (visible after picked_up) */}
          {isParcel && order.parcel_details && ['arrived', 'picked_up', 'in_transit'].includes(order.status) && (
            <div className="mt-4 rounded-xl bg-surface-muted p-3 text-sm">
              <div className="text-xs uppercase text-slate-400 mb-1">Deliver to</div>
              <div className="font-semibold">{order.parcel_details.receiver_name}</div>
              <div className="text-slate-600 text-xs">
                <a href={`tel:${order.parcel_details.receiver_phone}`} className="underline">
                  {order.parcel_details.receiver_phone}
                </a>
                {' · '}
                {order.parcel_details.contents} · {order.parcel_details.weight_kg} kg
              </div>
            </div>
          )}

          {/* OTP entry */}
          {showOtpInput && (
            <div className="mt-4 rounded-xl bg-brand-50 border border-brand-500 p-3">
              <div className="text-xs uppercase tracking-wider text-brand-700 mb-1">
                {isParcel ? 'Ask sender for pickup OTP' : 'Ask customer for start OTP'}
              </div>
              <input
                inputMode="numeric"
                maxLength={4}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="input mt-1 text-center text-2xl font-bold tracking-widest"
                placeholder="0000"
              />
              <button
                onClick={() => doAction('/start', { otp })}
                disabled={busy || otp.length !== 4}
                className="btn-primary w-full mt-3"
              >
                {busy ? '…' : 'Start trip'}
              </button>
            </div>
          )}

          {/* Cash collect + rating */}
          {showCashCollect && (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-emerald-50 border border-emerald-500 p-4 text-center">
                <div className="text-xs uppercase tracking-wider text-emerald-700">
                  Collect {order.payment_method === 'cash' ? 'cash' : 'UPI'}
                </div>
                <div className="text-4xl font-bold text-emerald-900 mt-1">{inr(cashAmount)}</div>
                <div className="text-xs text-emerald-700 mt-1">
                  Your earning: {inr(order.fare_breakup?.rider_earning)}
                </div>
              </div>

              <div className="card">
                <div className="text-sm font-medium mb-2">Rate customer</div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRating(n)}
                      className={`text-3xl ${n <= rating ? 'text-brand-500' : 'text-slate-300'}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => nav('/captain', { replace: true })}
                  className="btn-primary w-full mt-3"
                >
                  Done — back home
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

          {/* Primary action button */}
          {nextAction && !showOtpInput && !showCashCollect && (
            <div className="mt-4 grid grid-cols-5 gap-2">
              <button
                onClick={() => openNav(
                  nextAction.direction === 'pickup' ? order.pickup_lat : order.drop_lat,
                  nextAction.direction === 'pickup' ? order.pickup_lng : order.drop_lng,
                )}
                className="col-span-2 btn-ghost border border-surface-border h-14"
              >
                Navigate
              </button>
              <button
                onClick={() => doAction(nextAction.actionPath)}
                disabled={busy}
                className="col-span-3 btn-primary h-14"
              >
                {busy ? '…' : nextAction.label}
              </button>
            </div>
          )}

          {['searching', 'cancelled_customer', 'cancelled_rider', 'no_rider_found'].includes(order.status) && (
            <button
              onClick={() => nav('/captain', { replace: true })}
              className="btn-ghost w-full mt-4"
            >
              Back to home
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface NextAction { label: string; actionPath: string; direction: 'pickup' | 'drop' }

function getNextAction(status: OrderStatus, _isParcel: boolean): NextAction | null {
  switch (status) {
    case 'accepted':
      return { label: 'I have arrived', actionPath: '/arrived', direction: 'pickup' };
    case 'picked_up':
    case 'in_transit':
      return { label: 'Complete trip', actionPath: '/complete', direction: 'drop' };
    default:
      return null;
  }
}
