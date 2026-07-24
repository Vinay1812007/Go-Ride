// Dispatch fan-out per §6. Called after an order is created.
import type { Env } from './env';
import { admin, broadcast } from './supabase';
import { haversineKm } from './geo';
import { googleRouteMatrix } from './google';
import { sendToProfile } from './push';

// Bike/scooter customers accept scooter riders and vice-versa. Cabs & autos strict.
export function candidateVehicles(service: string): string[] {
  switch (service) {
    case 'bike':
    case 'scooter':
      return ['bike', 'scooter'];
    case 'parcel_bike':
    case 'parcel_scooter':
      return ['parcel_bike', 'parcel_scooter'];
    default:
      return [service];
  }
}

// The inverse: given a rider's vehicle_type, which service types are they eligible for?
export function servicesForVehicle(vehicle: string): string[] {
  switch (vehicle) {
    case 'bike':
    case 'scooter':
      return ['bike', 'scooter', 'parcel_bike', 'parcel_scooter'];  // rider can do parcel too
    case 'parcel_bike':
    case 'parcel_scooter':
      return ['parcel_bike', 'parcel_scooter'];
    default:
      return [vehicle];
  }
}

export interface DispatchOptions {
  radiusKm?: number;
  maxRiders?: number;
  offerTtlSec?: number;
}

// Round 1: 5 km / 5 riders / 20 s. Caller may retry with wider radius per §6.
export async function dispatch(
  env: Env,
  orderId: string,
  opts: DispatchOptions = {},
): Promise<number> {
  const radiusKm = opts.radiusKm ?? 5;
  const maxRiders = opts.maxRiders ?? 5;
  const offerTtl = opts.offerTtlSec ?? 20;
  const db = admin(env);

  const { data: order, error: orderErr } = await db
    .from('orders')
    .select('id, service, city, pickup_lat, pickup_lng, status')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr || !order) throw new Error('order not found');
  if (order.status !== 'searching') return 0;

  const vehicles = candidateVehicles(order.service);
  // 5 min forgiveness — GPS heartbeats can hiccup on residential WiFi, and
  // browsers may throttle background pings. Losing riders after 60s made
  // dispatch fragile.
  const staleAfter = new Date(Date.now() - 5 * 60_000).toISOString();

  const { data: candidates, error: rerr } = await db
    .from('riders')
    .select('id, last_lat, last_lng')
    .in('vehicle_type', vehicles)
    .ilike('city', order.city)                    // case-insensitive
    .eq('status', 'online')
    .eq('kyc', 'approved')
    .gte('last_seen', staleAfter);
  if (rerr) throw rerr;
  if (!candidates || candidates.length === 0) return 0;

  // First-pass: haversine filter to trim candidates to a manageable set for
  // the Matrix API call (Matrix bills per pair).
  const nearby = candidates
    .map((r) => ({
      ...r,
      d:
        r.last_lat != null && r.last_lng != null
          ? haversineKm(order.pickup_lat, order.pickup_lng, r.last_lat, r.last_lng)
          : Infinity,
    }))
    .filter((r) => r.d <= radiusKm * 1.4) // widen 40% before the Matrix re-rank
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(maxRiders * 2, 10));

  // Second-pass: if Google is configured, re-rank by real driving distance
  // via Route Matrix. Falls back silently to the haversine order on any
  // error — dispatch keeps working even when credits run out.
  let ranked = nearby;
  if (env.GOOGLE_MAPS_API_KEY && nearby.length > 1) {
    try {
      const matrix = await googleRouteMatrix(
        env,
        nearby.filter((r) => r.last_lat != null && r.last_lng != null).map((r) => ({ lat: r.last_lat as number, lng: r.last_lng as number })),
        [{ lat: order.pickup_lat, lng: order.pickup_lng }],
      );
      // Overlay real distance where the Matrix gave us a value.
      const drivingByIdx = new Map<number, number>();
      for (const cell of matrix) {
        if (cell.status === 'ok') drivingByIdx.set(cell.origin, cell.distance_km);
      }
      ranked = nearby
        .map((r, i) => ({ ...r, d: drivingByIdx.get(i) ?? r.d }))
        .sort((a, b) => a.d - b.d);
    } catch (e) {
      console.warn('dispatch: matrix failed → haversine fallback:', (e as Error).message);
    }
  }
  ranked = ranked.filter((r) => r.d <= radiusKm).slice(0, maxRiders);

  if (ranked.length === 0) return 0;

  // Insert offers (skip riders that already have a pending offer for this order).
  const now = new Date();
  const expiresAt = new Date(now.getTime() + offerTtl * 1000).toISOString();
  const rows = ranked.map((r) => ({
    order_id: orderId,
    rider_id: r.id,
    expires_at: expiresAt,
  }));
  const { error: insErr } = await db.from('job_offers').upsert(rows, {
    onConflict: 'order_id,rider_id',
    ignoreDuplicates: true,
  });
  if (insErr) console.warn('offer upsert warn', insErr.message);

  // Fan-out on Realtime — rider apps subscribe to rider:{id}
  await Promise.all(
    ranked.map((r) =>
      broadcast(env, `rider:${r.id}`, 'offer', {
        order_id: orderId,
        expires_at: expiresAt,
        distance_km: Number(r.d.toFixed(2)),
      }),
    ),
  );

  // Push notification fan-out — for captains who have the app backgrounded.
  // Realtime is the primary channel; push is a "wake up" nudge. Fire-and-
  // forget so a slow FCM call doesn't stall dispatch.
  Promise.all(
    ranked.map((r) => sendToProfile(env, r.id, {
      title: 'New ride request',
      body: `Pickup ${r.d.toFixed(1)} km away · tap to accept`,
      data: { order_id: orderId, kind: 'offer' },
      clickAction: `/captain/trip/${orderId}`,
    })),
  ).catch((e) => console.warn('offer push', e));

  return ranked.length;
}

// When a rider goes online, immediately look for orders they could serve —
// searching or no_rider_found in their city, within a 10-minute window.
// Directly inserts job_offers for this rider so they see them instantly,
// and resets stalled no_rider_found orders back to searching (so the
// customer's UI updates from red to yellow).
export async function wakePendingForRider(
  env: Env,
  riderId: string,
  riderCity: string,
  riderVehicle: string,
): Promise<number> {
  const db = admin(env);
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const services = servicesForVehicle(riderVehicle);
  const { data: orders } = await db
    .from('orders')
    .select('id, service, status, pickup_lat, pickup_lng')
    .in('status', ['searching', 'no_rider_found'])
    .in('service', services)
    .ilike('city', riderCity)
    .gte('created_at', cutoff)
    .limit(10);
  if (!orders || orders.length === 0) return 0;

  const toReset = orders.filter((o) => o.status === 'no_rider_found').map((o) => o.id);
  if (toReset.length > 0) {
    await db.from('orders').update({ status: 'searching' }).in('id', toReset);
    await Promise.all(
      toReset.map((id) => broadcast(env, `order:${id}`, 'status', { status: 'searching' })),
    );
  }

  const expiresAt = new Date(Date.now() + 25_000).toISOString();
  const rows = orders.map((o) => ({ order_id: o.id, rider_id: riderId, expires_at: expiresAt }));
  await db.from('job_offers').upsert(rows, { onConflict: 'order_id,rider_id', ignoreDuplicates: true });

  await Promise.all(
    orders.map((o) => broadcast(env, `rider:${riderId}`, 'offer', {
      order_id: o.id,
      expires_at: expiresAt,
    })),
  );
  return orders.length;
}

// Called every minute by the cron trigger — flips scheduled orders whose
// pickup time is within LEAD_MINUTES into 'searching' and kicks off dispatch.
// Why lead time: rider search + accept + drive-to-pickup takes several
// minutes. Starting exactly at scheduled_at leaves the customer waiting.
// LEAD_MINUTES = 5 gives us a small pre-dispatch window without paging the
// captain too early.
export async function promoteScheduled(env: Env): Promise<{ promoted: number }> {
  const LEAD_MINUTES = 5;
  const db = admin(env);
  const nowIso = new Date().toISOString();
  const dueBefore = new Date(Date.now() + LEAD_MINUTES * 60_000).toISOString();

  // Atomic-per-row flip: guard on status='scheduled' so if two cron ticks race
  // (or a customer manually taps "Start now"), only one wins.
  const { data: due } = await db
    .from('orders')
    .update({ status: 'searching', dispatch_started_at: nowIso })
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', dueBefore)
    .select('id');

  const rows = due ?? [];
  for (const o of rows) {
    // Fire-and-forget — one failing order shouldn't block the others.
    dispatch(env, o.id).catch((e) => console.warn('promoteScheduled dispatch', o.id, e));
    await broadcast(env, `order:${o.id}`, 'status', { status: 'searching' }).catch(() => {});
  }
  return { promoted: rows.length };
}

// Called every minute by the cron trigger — expires offers, retries widening,
// and marks abandoned orders no_rider_found after 60s.
export async function sweepOffers(env: Env): Promise<{ expired: number; noRider: number }> {
  const db = admin(env);
  const nowIso = new Date().toISOString();

  // Expire offers past deadline.
  const { data: expired } = await db
    .from('job_offers')
    .update({ response: 'expired', responded_at: nowIso })
    .lte('expires_at', nowIso)
    .is('response', null)
    .select('id, order_id');
  const expiredCount = expired?.length ?? 0;

  // Orders still searching after 60s → widen or fail.
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: stuck } = await db
    .from('orders')
    .select('id, created_at')
    .eq('status', 'searching')
    .lte('created_at', cutoff);
  if (!stuck) return { expired: expiredCount, noRider: 0 };

  let noRider = 0;
  for (const o of stuck) {
    const ageSec = (Date.now() - new Date(o.created_at).getTime()) / 1000;
    if (ageSec > 120) {
      // Two round attempts exhausted.
      await db
        .from('orders')
        .update({ status: 'no_rider_found', cancelled_at: nowIso })
        .eq('id', o.id)
        .eq('status', 'searching');
      await broadcast(env, `order:${o.id}`, 'status', { status: 'no_rider_found' });
      noRider++;
    } else if (ageSec > 60) {
      // Second attempt at 8 km.
      await dispatch(env, o.id, { radiusKm: 8 }).catch(() => {});
    }
  }
  return { expired: expiredCount, noRider };
}
