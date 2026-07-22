// Public share-trip page — no login required, token in URL.
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import MapView from '@/components/MapView';
import StatusStepper from '@/components/ui/StatusStepper';
import { api } from '@/lib/api';
import type { OrderStatus } from '@/lib/types';
import { statusLabel } from '@/lib/format';

export default function PublicTrackPage() {
  const { orderNo } = useParams();
  const [params] = useSearchParams();
  const token = params.get('k') ?? '';
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderNo || !token) { setError('Missing token'); return; }
    fetch(`${import.meta.env.VITE_API_URL}/t/${orderNo}?k=${token}`)
      .then(r => r.json())
      .then((r) => {
        if (r.error) setError(r.error.message ?? 'Not found');
        else setData(r);
      })
      .catch(() => setError('Failed to load'));
  }, [orderNo, token]);

  if (error) return <div className="h-full grid place-items-center text-slate-500">{error}</div>;
  if (!data) return <div className="h-full grid place-items-center">Loading…</div>;

  const o = data.order;
  const status: OrderStatus = o.status;
  const rider = (o as any).riders?.profiles;

  return (
    <div className="h-full flex flex-col">
      <div className="absolute inset-0">
        <MapView
          pickup={{ lat: o.pickup_lat, lng: o.pickup_lng }}
          drop={{ lat: o.drop_lat, lng: o.drop_lng }}
          rider={data.last_location ? { lat: data.last_location.lat, lng: data.last_location.lng, heading: data.last_location.heading } : null}
          routePolyline={o.route_polyline}
        />
      </div>
      <div className="sheet z-10" style={{ bottom: 0 }}>
        <div className="sheet-handle" />
        <div className="px-5 pb-5 pt-1">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-xs text-slate-500">Order #{o.order_no}</div>
              <div className="text-lg font-bold">{statusLabel(status)}</div>
            </div>
            {rider && (
              <div className="text-right">
                <div className="text-sm font-semibold">{rider.full_name}</div>
                <div className="text-xs text-slate-500">★ {rider.rating?.toFixed?.(1) ?? '5.0'}</div>
              </div>
            )}
          </div>
          <StatusStepper status={status} />
          <div className="mt-4 text-xs text-slate-500 space-y-1">
            <div>Pickup: {o.pickup_address}</div>
            <div>Drop: {o.drop_address}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
