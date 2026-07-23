import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import MapView from '@/components/MapView';
import StatusStepper from '@/components/ui/StatusStepper';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { LatLng, OrderStatus } from '@/lib/types';
import { inr, statusLabel, isFinalStatus } from '@/lib/format';

interface OrderDetail {
  id: string;
  order_no: string;
  status: OrderStatus;
  service: string;
  pickup_lat: number; pickup_lng: number; pickup_address: string;
  drop_lat: number;   drop_lng: number;   drop_address: string;
  route_polyline?: string;
  fare_estimate?: number;
  fare_final?: number;
  otp?: string;
  share_token?: string;
  rider_id?: string;
}

interface RiderCard {
  full_name: string;
  vehicle_number: string;
  vehicle_type: string;
  rating: number;
  avatar_url?: string | null;
}

export default function TrackingPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [rider, setRider] = useState<RiderCard | null>(null);
  const [riderPos, setRiderPos] = useState<(LatLng & { heading?: number }) | null>(null);
  const [rating, setRating] = useState<number>(0);

  // Initial fetch
  useEffect(() => {
    if (!id) return;
    void (async () => {
      const res = await api.get<{ order: OrderDetail }>(`/orders/${id}`);
      setOrder(res.order);
      if (res.order.rider_id) {
        const { data: rd } = await supabase
          .from('riders')
          .select('vehicle_number, vehicle_type, profiles!inner(full_name, rating, avatar_url)')
          .eq('id', res.order.rider_id)
          .maybeSingle();
        if (rd) {
          const p = (rd as any).profiles;
          setRider({
            full_name: p.full_name,
            vehicle_number: rd.vehicle_number,
            vehicle_type: rd.vehicle_type,
            rating: p.rating,
            avatar_url: p.avatar_url,
          });
        }
      }
    })();
  }, [id]);

  // Realtime channel
  useEffect(() => {
    if (!id) return;
    const channel = supabase.channel(`order:${id}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'status' }, (msg) => {
        setOrder((o) => o ? { ...o, status: msg.payload.status } : o);
        if (msg.payload.fare_final != null) {
          setOrder((o) => o ? { ...o, fare_final: msg.payload.fare_final } : o);
        }
      })
      .on('broadcast', { event: 'location' }, (msg) => {
        setRiderPos({ lat: msg.payload.lat, lng: msg.payload.lng, heading: msg.payload.heading });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [id]);

  async function cancel() {
    if (!order) return;
    const reason = prompt('Cancel reason?', 'Changed my mind') ?? 'cancelled';
    try {
      await api.post(`/orders/${order.id}/cancel`, { reason });
      setOrder({ ...order, status: 'cancelled_customer' });
    } catch (e) { /* toast */ }
  }

  async function submitRating() {
    if (!order || !rating) return;
    await api.post(`/orders/${order.id}/rate`, { rating });
    nav('/', { replace: true });
  }

  if (!order) return <LoadingScreen label="Loading your trip…" />;

  return (
    <div className="h-full flex flex-col">
      <div className="absolute inset-0">
        <MapView
          pickup={{ lat: order.pickup_lat, lng: order.pickup_lng }}
          drop={{ lat: order.drop_lat, lng: order.drop_lng }}
          rider={riderPos}
          routePolyline={order.route_polyline}
        />
      </div>

      <div className="sheet z-10" style={{ bottom: 0 }}>
        <div className="sheet-handle" />
        <div className="px-5 pb-6 pt-1">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <div className="text-xs text-slate-500">Order #{order.order_no}</div>
              <div className="text-lg font-bold">{statusLabel(order.status)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">Fare</div>
              <div className="text-lg font-bold">{inr(order.fare_final ?? order.fare_estimate)}</div>
            </div>
          </div>

          <StatusStepper status={order.status} />

          {order.otp && ['accepted', 'arrived'].includes(order.status) && (
            <div className="mt-4 rounded-xl bg-brand-50 border border-brand-500 p-3">
              <div className="text-xs uppercase tracking-wider text-brand-700">Start-trip OTP</div>
              <div className="text-3xl font-bold tracking-widest">{order.otp}</div>
              <div className="text-xs text-slate-500 mt-1">Share with your captain to start the trip.</div>
            </div>
          )}

          {rider && (
            <div className="mt-4 flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-slate-100 grid place-items-center text-xl">
                {rider.avatar_url ? <img src={rider.avatar_url} className="h-full w-full rounded-full" /> : '👤'}
              </div>
              <div className="flex-1">
                <div className="font-semibold">{rider.full_name}</div>
                <div className="text-xs text-slate-500">★ {rider.rating.toFixed(1)}</div>
              </div>
              <div className="text-right">
                <div className="chip">{rider.vehicle_number}</div>
                <div className="text-xs text-slate-500 mt-1">{rider.vehicle_type}</div>
              </div>
            </div>
          )}

          {!isFinalStatus(order.status) && order.status !== 'searching' && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a href="tel:+911234567890" className="btn-secondary">Call</a>
              {order.share_token && (
                <Link
                  to={`/t/${order.order_no}?k=${order.share_token}`}
                  target="_blank"
                  className="btn-ghost border border-surface-border"
                >
                  Share trip
                </Link>
              )}
            </div>
          )}

          {!isFinalStatus(order.status) && (
            <button onClick={cancel} className="btn-ghost w-full mt-3 text-red-600">
              Cancel order
            </button>
          )}

          {(order.status === 'completed' || order.status === 'delivered') && (
            <div className="mt-4 border-t border-surface-border pt-4">
              <div className="text-sm font-medium mb-2">Rate your captain</div>
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
                onClick={submitRating}
                disabled={!rating}
                className="btn-primary w-full mt-3"
              >
                Submit
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
