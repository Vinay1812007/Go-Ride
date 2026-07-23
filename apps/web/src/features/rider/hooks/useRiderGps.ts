// GPS heartbeat for a signed-in rider.
// - watchPosition while enabled
// - throttled to 1 POST per 5 seconds (per spec §10)
// - attaches order_id when the rider is on a trip
// - silent-fail on offline / permission-denied so the UI doesn't crash
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';

interface Options {
  enabled: boolean;
  orderId?: string | null;
  intervalMs?: number;
}

export function useRiderGps({ enabled, orderId, intervalMs = 5_000 }: Options) {
  const lastSentAt = useRef(0);
  const orderIdRef = useRef<string | null>(orderId ?? null);
  useEffect(() => { orderIdRef.current = orderId ?? null; }, [orderId]);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return;

    let cancelled = false;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        const now = Date.now();
        if (now - lastSentAt.current < intervalMs) return;
        lastSentAt.current = now;

        void api.post('/rides/location', {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : undefined,
          speed_kmh: Number.isFinite(pos.coords.speed) && pos.coords.speed != null
            ? Math.round(pos.coords.speed * 3.6 * 10) / 10
            : undefined,
          order_id: orderIdRef.current ?? undefined,
        }).catch(() => { /* silent — network burps are fine */ });
      },
      (err) => { console.warn('gps error', err.code, err.message); },
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 },
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled, intervalMs]);
}
