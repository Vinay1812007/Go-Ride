import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin, broadcast } from '../lib/supabase';
import { createOrderBody, cancelBody, rateBody } from '../lib/schemas';
import { quoteInternal } from './fare';
import { dispatch } from '../lib/dispatch';
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

  const { data: inserted, error } = await db
    .from('orders')
    .insert({
      order_no: orderNo,
      customer_id: c.get('userId'),
      service: body.service,
      status: 'searching',
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
    .select('id, order_no, otp, share_token')
    .single();
  if (error || !inserted) return c.json({ error: { code: 'insert_failed', message: error?.message } }, 500);

  // Kick off dispatch (don't block the response longer than needed).
  c.executionCtx.waitUntil(dispatch(c.env, inserted.id).catch((e) => console.warn('dispatch', e)));

  return c.json({
    id: inserted.id,
    order_no: inserted.order_no,
    otp: inserted.otp,
    tracking_url: `/t/${inserted.order_no}?k=${inserted.share_token}`,
    fare: breakup.total,
    fare_breakup: breakup,
    distance_km: breakup.km,
    duration_min: breakup.minutes,
  });
});

// -------- GET / — list customer's orders --------
orders.get('/', requireAuth, requireRole('customer'), async (c) => {
  const uid = c.get('userId')!;
  const { data } = await admin(c.env)
    .from('orders')
    .select('id, order_no, service, status, pickup_address, drop_address, fare_final, fare_estimate, created_at, completed_at')
    .eq('customer_id', uid)
    .order('created_at', { ascending: false })
    .limit(50);
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
