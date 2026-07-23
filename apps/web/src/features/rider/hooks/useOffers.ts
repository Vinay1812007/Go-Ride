// Realtime job-offer subscription for a signed-in rider.
// - Subscribes to Supabase channel `rider:{uid}` for push offers from Worker dispatch.
// - Also polls /riders/offers every 15s as a fallback (in case realtime drops).
// - Fetches full order rows for each offer so the card can show fare + addresses.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import type { ServiceType, OrderStatus } from '@/lib/types';

export interface Offer {
  order_id: string;
  order: {
    id: string;
    order_no: string;
    service: ServiceType;
    status: OrderStatus;
    pickup_address: string;
    drop_address: string;
    pickup_lat: number;
    pickup_lng: number;
    distance_km?: number;
    duration_min?: number;
    fare_estimate?: number;
    fare_breakup?: { rider_earning?: number };
  };
  expires_at: string;
  distance_km?: number;
}

interface Options {
  uid: string | null;
  enabled: boolean;
}

export function useOffers({ uid, enabled }: Options) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const seenOrderIds = useRef<Set<string>>(new Set());

  // Poll fallback + hydrate offer rows
  useEffect(() => {
    if (!uid || !enabled) { setOffers([]); return; }
    let alive = true;

    async function loadFromApi() {
      try {
        const res = await api.get<{ offers: Array<{ order_id: string; expires_at: string; orders: Offer['order'] }> }>(
          '/riders/offers',
        );
        if (!alive) return;
        const now = Date.now();
        const fresh = res.offers
          .filter((o) => new Date(o.expires_at).getTime() > now)
          .map((o) => ({ order_id: o.order_id, order: o.orders, expires_at: o.expires_at }));
        setOffers(fresh);
        fresh.forEach((o) => seenOrderIds.current.add(o.order_id));
      } catch { /* silent */ }
    }
    void loadFromApi();
    const t = setInterval(loadFromApi, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [uid, enabled]);

  // Realtime channel — instant offer push from Worker
  useEffect(() => {
    if (!uid || !enabled) return;
    const channel = supabase
      .channel(`rider:${uid}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'offer' }, async (msg) => {
        const orderId = msg.payload.order_id as string | undefined;
        if (!orderId || seenOrderIds.current.has(orderId)) return;
        seenOrderIds.current.add(orderId);
        try {
          const { order } = await api.get<{ order: Offer['order'] }>(`/orders/${orderId}`);
          setOffers((prev) => [
            {
              order_id: orderId,
              order,
              expires_at: msg.payload.expires_at,
              distance_km: msg.payload.distance_km,
            },
            ...prev,
          ]);
          try { navigator.vibrate?.([120, 60, 120]); } catch { /* iOS Safari */ }
        } catch { /* silent */ }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [uid, enabled]);

  // Auto-expire offers whose deadline passed
  useEffect(() => {
    if (offers.length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setOffers((prev) => prev.filter((o) => new Date(o.expires_at).getTime() > now));
    }, 1000);
    return () => clearInterval(t);
  }, [offers.length]);

  function dismiss(orderId: string) {
    setOffers((prev) => prev.filter((o) => o.order_id !== orderId));
  }

  return { offers, dismiss };
}
