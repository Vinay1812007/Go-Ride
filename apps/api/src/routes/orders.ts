import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin, broadcast } from '../lib/supabase';
import { createOrderBody, cancelBody, rateBody, rescheduleBody } from '../lib/schemas';
import { quoteInternal } from './fare';
import { dispatch } from '../lib/dispatch';

// Booking a ride "for later" needs some sanity: at least 30 minutes out (so
// the cron's LEAD_MINUTES window isn't already past), at most 7 days out.
const SCHEDULE_MIN_MS = 30 * 60_000;
const SCHEDULE_MAX_MS = 7 * 24 * 60 * 60_000;

function validateScheduleWindow(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'invalid scheduled_at';
  const delta = t - Date.now();
  if (delta < SCHEDULE_MIN_MS) return 'must be at least 30 minutes from now';
  if (delta > SCHEDULE_MAX_MS) return 'cannot be more than 7 days from now';
  return null;
}
import { shareToken } from '../lib/hmac';
import type { z } from 'zod';

const orders = new Hono<AppEnv>();

function otp4(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function parse<T extends z.ZodTypeAny>(c: any, s: T) {
  try {
    return s.parse(await c.req.json());
  } catch {
    return null;
  }
}

// -------- POST / — create order --------
orders.post('/', requireAuth, requireRole('customer'), async (c) => {
  const body = await parse(c, createOrderBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);

  // Parcel-service payload sanity
  if (body.service.startsWith('parcel_') && !body.parcel) {
    return c.json({ error: { code: 'missing_parcel' } }, 400);
  }

  const { breakup, route, card } = await quoteInternal(c.env, {
    pickup: body.pickup,
    drop: body.drop,
    service: body.service,
    city: body.city,
  });

  // Parcel weight guard
  if (body.parcel && card.parcel_weight_limit_kg && body.parcel.weight_kg > card.parcel_weight_limit_kg) {
    return c.json(
      { error: { code: 'overweight', message: `Max weight ${card.parcel_weight_limit_kg} kg for this service` } },
      400,
    );
  }

  // Generate order_no + otp + share_token via SQL RPC helpers.
  const db = admin(c.env);
  const { data: nums } = await db.rpc('generate_order_no');
  const orderNo = (nums as unknown as string) ?? `GR-${Date.now()}`;
  const token = await shareToken(c.env.SHARE_TOKEN_SECRET, orderNo);

  // Branch: schedule for later vs dispatch now.
  const isScheduled = !!body.scheduled_at;
  if (isScheduled) {
    const err = validateScheduleWindow(body.scheduled_at!);
    if (err) return c.json({ error: { code: 'bad_schedule', message: err } }, 400);
  }

  const { data: inserted, error } = await db
    .from('orders')
    .insert({
      order_no: orderNo,
      customer_id: c.get('userId'),
      service: body.service,
      status: isScheduled ? 'scheduled' : 'searching',
      scheduled_at: isScheduled ? body.scheduled_at : null,
      city: body.city,
      pickup_lat: body.pickup.lat,
      pickup_lng: body.pickup.lng,
      pickup_address: body.pickup.address,
      drop_lat: body.drop.lat,
      drop_lng: body.drop.lng,
      drop_address: body.drop.address,
      distance_km: breakup.km,
      duration_min: breakup.minutes,
      route_polyline: route.polyline,
      fare_estimate: breakup.total,
      fare_breakup: breakup,
      payment_method: body.payment_method,
      otp: otp4(),
      parcel_details: body.parcel ?? null,
      share_token: token,
    })
    .select('id, order_no, otp, share_token, scheduled_at, status')
    .single();
  if (error || !inserted) return c.json({ error: { code: 'insert_failed', message: error?.message } }, 500);

  // Only kick off dispatch immediately for now-orders. Scheduled orders wait
  // for the minutely cron to promote them.
  if (!isScheduled) {
    c.executionCtx.waitUntil(dispatch(c.env, inserted.id).catch((e) => console.warn('dispatch', e)));
  }

  return c.json({
    id: inserted.id,
    order_no: inserted.order_no,
    otp: inserted.otp,
    status: inserted.status,
    scheduled_at: inserted.scheduled_at,
    tracking_url: `/t/${inserted.order_no}?k=${inserted.share_token}`,
    fare: breakup.total,
    fare_breakup: breakup,
    distance_km: breakup.km,
    duration_min: breakup.minutes,
  });
});

// -------- PATCH /:id/schedule — reschedule a scheduled order --------
orders.patch('/:id/schedule', requireAuth, requireRole('customer'), async (c) => {
  const body = await parse(c, rescheduleBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const err = validateScheduleWindow(body.scheduled_at);
  if (err) return c.json({ error: { code: 'bad_schedule', message: err } }, 400);

  const db = admin(c.env);
  const uid = c.get('userId')!;
  const { data, error } = await db
    .from('orders')
    .update({ scheduled_at: body.scheduled_at })
    .eq('id', c.req.param('id'))
    .eq('customer_id', uid)
    .eq('status', 'scheduled')       // guard: can't reschedule a live order
    .select('id, scheduled_at')
    .maybeSingle();
  if (error) return c.json({ error: { code: 'update_failed', message: error.message } }, 500);
  if (!data) return c.json({ error: { code: 'not_found_or_started' } }, 404);
  return c.json({ id: data.id, scheduled_at: data.scheduled_at });
});

// -------- POST /:id/start-now — customer chooses to dispatch a scheduled order early --------
orders.post('/:id/start-now', requireAuth, requireRole('customer'), async (c) => {
  const db = admin(c.env);
  const uid = c.get('userId')!;
  const { data, error } = await db
    .from('orders')
    .update({ status: 'searching', dispatch_started_at: new Date().toISOString() })
    .eq('id', c.req.param('id'))
    .eq('customer_id', uid)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: { code: 'update_failed', message: error.message } }, 500);
  if (!data) return c.json({ error: { code: 'not_found_or_started' } }, 404);
  c.executionCtx.waitUntil(dispatch(c.env, data.id).catch((e) => console.warn('start-now dispatch', e)));
  return c.json({ id: data.id, status: 'searching' });
});

// -------- GET / — list customer's orders --------
// ?upcoming=1 filters to scheduled orders (sorted by pickup time ascending).
// Everything else returns the flat history sorted by created_at desc.
orders.get('/', requireAuth, requireRole('customer'), async (c) => {
  const uid = c.get('userId')!;
  const upcoming = c.req.query('upcoming') === '1';
  const q = admin(c.env)
    .from('orders')
    .select('id, order_no, service, status, pickup_address, drop_address, fare_final, fare_estimate, scheduled_at, created_at, completed_at')
    .eq('customer_id', uid);
  if (upcoming) {
    q.eq('status', 'scheduled').order('scheduled_at', { ascending: true });
  } else {
    q.order('created_at', { ascending: false });
  }
  const { data } = await q.limit(50);
  return c.json({ orders: data ?? [] });
});

// -------- GET /:id — order detail --------
orders.get('/:id', requireAuth, async (c) => {
  const uid = c.get('userId')!;
  const role = c.get('userRole');
  const q = admin(c.env).from('orders').select('*').eq('id', c.req.param('id')).maybeSingle();
  const { data } = await q;
  if (!data) return c.json({ error: { code: 'not_found' } }, 404);
  if (role !== 'admin' && data.customer_id !== uid && data.rider_id !== uid) {
    return c.json({ error: { code: 'forbidden' } }, 403);
  }
  // Hide OTP from rider until arrival.
  if (role === 'rider' && data.status !== 'arrived') data.otp = null;
  return c.json({ order: data });
});

// -------- POST /:id/cancel --------
orders.post('/:id/cancel', requireAuth, async (c) => {
  const body = await parse(c, cancelBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const role = c.get('userRole');
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('*').eq('id', c.req.param('id')).maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);

  const isCustomer = order.customer_id === uid;
  const isRider = order.rider_id === uid;
  if (!isCustomer && !isRider && role !== 'admin') return c.json({ error: { code: 'forbidden' } }, 403);
  if (['completed', 'cancelled_customer', 'cancelled_rider', 'delivered'].includes(order.status)) {
    return c.json({ error: { code: 'already_final', message: 'Cannot cancel a finished order' } }, 409);
  }
  const nextStatus = isCustomer ? 'cancelled_customer' : 'cancelled_rider';
  await db
    .from('orders')
    .update({ status: nextStatus, cancelled_reason: body.reason, cancelled_at: new Date().toISOString() })
    .eq('id', order.id);
  await broadcast(c.env, `order:${order.id}`, 'status', { status: nextStatus });

  // Free the rider — status was 'on_trip' during the ride, put them back
  // to 'online' so they can accept new offers and the captain UI unfreezes.
  // Also expire any still-pending job_offers for this order.
  if (order.rider_id) {
    await db.from('riders').update({ status: 'online', last_seen: new Date().toISOString() }).eq('id', order.rider_id);
    await db.from('job_offers')
      .update({ response: 'expired', responded_at: new Date().toISOString() })
      .eq('order_id', order.id)
      .is('response', null);
    // Broadcast to the rider so their captain shell refreshes immediately
    await broadcast(c.env, `rider:${order.rider_id}`, 'trip_ended', {
      order_id: order.id,
      reason: nextStatus,
    });
  }
  return c.json({ ok: true, status: nextStatus });
});

// -------- POST /:id/rate — customer rates rider --------
orders.post('/:id/rate', requireAuth, requireRole('customer'), async (c) => {
  const body = await parse(c, rateBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('id, customer_id, rider_id, status').eq('id', c.req.param('id')).maybeSingle();
  if (!order || order.customer_id !== uid) return c.json({ error: { code: 'forbidden' } }, 403);
  if (order.status !== 'completed' && order.status !== 'delivered') {
    return c.json({ error: { code: 'not_completed' } }, 409);
  }
  await db.from('ratings').upsert(
    { order_id: order.id, by_customer: body.rating, comment: body.comment },
    { onConflict: 'order_id' },
  );
  // Recompute rider average (cheap enough at MVP scale).
  if (order.rider_id) {
    const { data: agg } = await db
      .from('ratings')
      .select('by_customer.avg()')
      .not('by_customer', 'is', null)
      .in('order_id', (
        await db.from('orders').select('id').eq('rider_id', order.rider_id)
      ).data?.map((r) => r.id) ?? []);
    const avg = (agg?.[0] as { avg?: number } | undefined)?.avg;
    if (avg) await db.from('profiles').update({ rating: Math.round(avg * 10) / 10 }).eq('id', order.rider_id);
  }
  return c.json({ ok: true });
});

export default orders;
