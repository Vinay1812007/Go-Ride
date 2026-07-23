// Rider-side trip actions.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin, broadcast } from '../lib/supabase';
import { sendToProfile } from '../lib/push';
import { locationPingBody, startTripBody } from '../lib/schemas';
import type { z } from 'zod';

const rides = new Hono<AppEnv>();

async function parse<T extends z.ZodTypeAny>(c: any, s: T) {
  try {
    return s.parse(await c.req.json());
  } catch {
    return null;
  }
}

// GPS heartbeat — rider posts every ~5s while online or on trip.
rides.post('/location', requireAuth, requireRole('rider'), async (c) => {
  const body = await parse(c, locationPingBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const now = new Date().toISOString();

  // Insert location row (only if attached to an active order OR keep last N via prune).
  await db.from('rider_locations').insert({
    rider_id: uid,
    order_id: body.order_id ?? null,
    lat: body.lat,
    lng: body.lng,
    heading: body.heading ?? null,
    speed_kmh: body.speed_kmh ?? null,
    recorded_at: now,
  });
  await db.from('riders').update({ last_lat: body.lat, last_lng: body.lng, last_seen: now }).eq('id', uid);

  if (body.order_id) {
    await broadcast(c.env, `order:${body.order_id}`, 'location', {
      lat: body.lat,
      lng: body.lng,
      heading: body.heading,
      speed: body.speed_kmh,
      at: now,
    });
  }
  return c.json({ ok: true });
});

// Accept an offered job.
rides.post('/:orderId/accept', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const orderId = c.req.param('orderId');
  const db = admin(c.env);
  const nowIso = new Date().toISOString();

  // Atomic-ish: only claim if still searching.
  const { data: order } = await db
    .from('orders')
    .update({ status: 'accepted', rider_id: uid, accepted_at: nowIso })
    .eq('id', orderId)
    .eq('status', 'searching')
    .select('id, order_no, customer_id')
    .maybeSingle();
  if (!order) return c.json({ error: { code: 'gone', message: 'Order no longer available' } }, 409);

  await db
    .from('job_offers')
    .update({ response: 'accepted', responded_at: nowIso })
    .eq('order_id', orderId)
    .eq('rider_id', uid);
  await db
    .from('job_offers')
    .update({ response: 'expired', responded_at: nowIso })
    .eq('order_id', orderId)
    .neq('rider_id', uid)
    .is('response', null);
  await db.from('riders').update({ status: 'on_trip' }).eq('id', uid);

  await broadcast(c.env, `order:${orderId}`, 'status', { status: 'accepted', rider_id: uid });

  // Push to customer — captain accepted.
  c.executionCtx.waitUntil(
    sendToProfile(c.env, order.customer_id, {
      title: 'Captain on the way',
      body: `A captain is heading to pickup for order ${order.order_no}`,
      data: { order_id: orderId, kind: 'status', status: 'accepted' },
      clickAction: `/track/${orderId}`,
    }).catch(() => {}),
  );
  return c.json({ ok: true, order });
});

rides.post('/:orderId/reject', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const orderId = c.req.param('orderId');
  await admin(c.env)
    .from('job_offers')
    .update({ response: 'rejected', responded_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('rider_id', uid)
    .is('response', null);
  return c.json({ ok: true });
});

rides.post('/:orderId/arrived', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const orderId = c.req.param('orderId');
  const nowIso = new Date().toISOString();
  const { data } = await admin(c.env)
    .from('orders')
    .update({ status: 'arrived', arrived_at: nowIso })
    .eq('id', orderId)
    .eq('rider_id', uid)
    .eq('status', 'accepted')
    .select('id, order_no, customer_id, otp')
    .maybeSingle();
  if (!data) return c.json({ error: { code: 'invalid_transition' } }, 409);
  await broadcast(c.env, `order:${orderId}`, 'status', { status: 'arrived' });

  // Arrived push is high-value — customer needs to come out, share the OTP.
  c.executionCtx.waitUntil(
    sendToProfile(c.env, data.customer_id, {
      title: 'Captain has arrived',
      body: `Share OTP ${data.otp} to start the trip`,
      data: { order_id: orderId, kind: 'status', status: 'arrived' },
      clickAction: `/track/${orderId}`,
    }).catch(() => {}),
  );

  return c.json({ ok: true });
});

rides.post('/:orderId/start', requireAuth, requireRole('rider'), async (c) => {
  const body = await parse(c, startTripBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const orderId = c.req.param('orderId');
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('id, otp, rider_id, status, service').eq('id', orderId).maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);
  if (order.rider_id !== uid) return c.json({ error: { code: 'forbidden' } }, 403);
  if (order.status !== 'arrived') return c.json({ error: { code: 'invalid_transition' } }, 409);
  if (order.otp !== body.otp) return c.json({ error: { code: 'wrong_otp' } }, 400);
  const nowIso = new Date().toISOString();
  const nextStatus = order.service.startsWith('parcel_') ? 'picked_up' : 'in_transit';
  await db.from('orders').update({ status: nextStatus, picked_at: nowIso }).eq('id', orderId);
  await broadcast(c.env, `order:${orderId}`, 'status', { status: nextStatus });
  return c.json({ ok: true, status: nextStatus });
});

rides.post('/:orderId/complete', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const orderId = c.req.param('orderId');
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (!order || order.rider_id !== uid) return c.json({ error: { code: 'forbidden' } }, 403);
  if (!['picked_up', 'in_transit', 'arrived'].includes(order.status)) {
    return c.json({ error: { code: 'invalid_transition' } }, 409);
  }
  const nowIso = new Date().toISOString();
  const fareFinal = order.fare_estimate;
  const isParcel = String(order.service).startsWith('parcel_');
  const nextStatus = isParcel ? 'delivered' : 'completed';
  await db
    .from('orders')
    .update({
      status: nextStatus,
      completed_at: nowIso,
      fare_final: fareFinal,
      payment_status: order.payment_method === 'cash' ? 'paid' : 'pending',
    })
    .eq('id', orderId);

  // Book earnings + commission split.
  const breakup = order.fare_breakup as { rider_earning?: number; commission?: number } | null;
  if (breakup?.rider_earning) {
    await db.from('transactions').insert([
      { order_id: order.id, rider_id: uid, type: 'trip_earning', amount: breakup.rider_earning, note: 'Trip completed' },
      { order_id: order.id, rider_id: uid, type: 'commission', amount: -(breakup.commission ?? 0), note: 'Platform commission' },
    ]);
    try {
      await db.rpc('increment_rider_stats', { p_rider: uid });
    } catch { /* function optional; safe no-op */ }
  }
  await db.from('riders').update({ status: 'online' }).eq('id', uid);
  await broadcast(c.env, `order:${orderId}`, 'status', { status: nextStatus, fare_final: fareFinal });

  // Push trip-complete notification to the customer.
  c.executionCtx.waitUntil(
    sendToProfile(c.env, order.customer_id, {
      title: isParcel ? 'Delivered' : 'Trip completed',
      body: isParcel
        ? `Your parcel has been delivered. Fare ₹${fareFinal}.`
        : `Thanks for riding! Fare ₹${fareFinal}. Tap to rate your captain.`,
      data: { order_id: orderId, kind: 'status', status: nextStatus },
      clickAction: `/track/${orderId}`,
    }).catch(() => {}),
  );

  // Referral bonus — if this is the customer's FIRST completed trip and they
  // have a referred_by set, credit both parties. Amounts are tunable.
  c.executionCtx.waitUntil(maybeCreditReferralBonus(c.env, order.customer_id, orderId).catch(() => {}));

  return c.json({ ok: true, status: nextStatus, fare_final: fareFinal });
});

// Referral payout constants — tune in one place.
const REFERRER_BONUS = 100;   // ₹ credited to the person who shared their code
const REFEREE_BONUS  =  50;   // ₹ credited to the new customer

async function maybeCreditReferralBonus(env: any, customerId: string, orderId: string) {
  const db = admin(env);
  const { data: profile } = await db
    .from('profiles')
    .select('referred_by')
    .eq('id', customerId)
    .maybeSingle();
  if (!profile?.referred_by) return;

  // Guard: has this customer already been credited a referral bonus? We
  // check by looking for an existing referee-bonus ledger row for them.
  const { data: existing } = await db
    .from('wallet_ledger')
    .select('id')
    .eq('profile_id', customerId)
    .eq('reason', 'referral_bonus_referee')
    .limit(1);
  if (existing && existing.length > 0) return;

  await db.from('wallet_ledger').insert([
    {
      profile_id: profile.referred_by,
      delta: REFERRER_BONUS,
      reason: 'referral_bonus_referrer',
      order_id: orderId,
      note: `Bonus for referring a friend (first trip)`,
    },
    {
      profile_id: customerId,
      delta: REFEREE_BONUS,
      reason: 'referral_bonus_referee',
      order_id: orderId,
      note: `Welcome bonus — first trip complete`,
    },
  ]);
}

export default rides;
