// D2C Partner API — §8. Auth via X-API-Key.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { admin } from '../lib/supabase';
import { requirePartner } from '../lib/auth';
import { partnerCreateOrderBody, fareQuoteBody } from '../lib/schemas';
import { quoteInternal } from './fare';
import { dispatch } from '../lib/dispatch';
import { shareToken, hmacHex } from '../lib/hmac';
import { haversineKm } from '../lib/geo';
import type { z } from 'zod';

const partner = new Hono<AppEnv>();

async function parse<T extends z.ZodTypeAny>(c: any, s: T) {
  try {
    return s.parse(await c.req.json());
  } catch {
    return null;
  }
}

partner.use('*', requirePartner);

// POST /quotes
partner.post('/quotes', async (c) => {
  const body = await parse(c, fareQuoteBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const { breakup, route } = await quoteInternal(c.env, body);
  return c.json({
    distance_km: breakup.km,
    eta_min: breakup.minutes,
    fare: breakup.total,
    fare_breakup: breakup,
    polyline: route.polyline,
  });
});

// POST /orders — idempotent on (partner_id, reference_id)
partner.post('/orders', async (c) => {
  const body = await parse(c, partnerCreateOrderBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const partnerId = c.get('partnerId')!;
  const db = admin(c.env);

  // Idempotency
  const { data: existing } = await db
    .from('orders')
    .select('id, order_no, share_token')
    .eq('partner_id', partnerId)
    .eq('partner_reference_id', body.reference_id)
    .maybeSingle();
  if (existing) {
    return c.json({
      id: existing.id,
      order_no: existing.order_no,
      tracking_url: `/t/${existing.order_no}?k=${existing.share_token}`,
      idempotent: true,
    });
  }

  const { breakup, route, card } = await quoteInternal(c.env, {
    pickup: body.pickup,
    drop: body.drop,
    service: body.service,
    city: body.city,
  });
  if (body.parcel && card.parcel_weight_limit_kg && body.parcel.weight_kg > card.parcel_weight_limit_kg) {
    return c.json({ error: { code: 'overweight', message: `Max weight ${card.parcel_weight_limit_kg} kg` } }, 400);
  }

  const { data: nums } = await db.rpc('generate_order_no');
  const orderNo = (nums as unknown as string) ?? `GR-${Date.now()}`;
  const token = await shareToken(c.env.SHARE_TOKEN_SECRET, orderNo);
  const otp = String(Math.floor(1000 + Math.random() * 9000));

  // Partner orders carry customer_id=null and partner_id set. The 0003
  // migration relaxed the not-null constraint with a check that at least
  // one of the two IDs is present.
  const { data: inserted, error } = await db
    .from('orders')
    .insert({
      order_no: orderNo,
      customer_id: null,
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
      otp,
      parcel_details: body.parcel ?? null,
      partner_id: partnerId,
      partner_reference_id: body.reference_id,
      share_token: token,
    })
    .select('id, order_no, share_token')
    .single();
  if (error || !inserted) return c.json({ error: { code: 'insert_failed', message: error?.message } }, 500);

  c.executionCtx.waitUntil(dispatch(c.env, inserted.id).catch(() => {}));

  return c.json({
    id: inserted.id,
    order_no: inserted.order_no,
    tracking_url: `/t/${inserted.order_no}?k=${inserted.share_token}`,
    otp,
    fare: breakup.total,
    fare_breakup: breakup,
  });
});

// GET /orders — list
partner.get('/orders', async (c) => {
  const status = c.req.query('status');
  const partnerId = c.get('partnerId')!;
  let q = admin(c.env).from('orders').select('id, order_no, status, service, pickup_address, drop_address, fare_final, fare_estimate, created_at').eq('partner_id', partnerId).order('created_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return c.json({ orders: data ?? [] });
});

// GET /orders/:id — full status + last location
partner.get('/orders/:id', async (c) => {
  const partnerId = c.get('partnerId')!;
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('*, riders(id, vehicle_number, vehicle_type)').eq('id', c.req.param('id')).eq('partner_id', partnerId).maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);
  let location = null;
  if (order.rider_id) {
    const { data: loc } = await db
      .from('rider_locations')
      .select('lat, lng, heading, recorded_at')
      .eq('order_id', order.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    location = loc;
  }
  return c.json({ order, location });
});

// POST /orders/:id/cancel
partner.post('/orders/:id/cancel', async (c) => {
  const partnerId = c.get('partnerId')!;
  const body = await c.req.json().catch(() => ({}));
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('status').eq('id', c.req.param('id')).eq('partner_id', partnerId).maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);
  if (['completed', 'delivered', 'cancelled_customer', 'cancelled_rider'].includes(order.status)) {
    return c.json({ error: { code: 'already_final' } }, 409);
  }
  if (order.status === 'picked_up' || order.status === 'in_transit') {
    return c.json({ error: { code: 'in_progress', message: 'Cannot cancel after pickup' } }, 409);
  }
  await db.from('orders').update({ status: 'cancelled_customer', cancelled_reason: body.reason ?? 'partner_cancelled', cancelled_at: new Date().toISOString() }).eq('id', c.req.param('id'));
  return c.json({ ok: true });
});

// GET /serviceability?lat=&lng=
partner.get('/serviceability', async (c) => {
  const lat = parseFloat(c.req.query('lat') ?? '');
  const lng = parseFloat(c.req.query('lng') ?? '');
  if (isNaN(lat) || isNaN(lng)) return c.json({ error: { code: 'bad_request' } }, 400);
  const { data } = await admin(c.env).from('service_areas').select('*').eq('active', true);
  const inArea = (data ?? []).find(
    (a) => haversineKm(lat, lng, a.center_lat, a.center_lng) <= a.radius_km,
  );
  return c.json({ serviceable: !!inArea, city: inArea?.city ?? null });
});

// ---------- Webhook dispatch (called from status transitions) ----------
export async function fireWebhook(env: any, partnerId: string, event: string, orderId: string, payload: unknown) {
  const db = admin(env);
  const { data: p } = await db.from('partners').select('webhook_url, webhook_secret').eq('id', partnerId).maybeSingle();
  if (!p?.webhook_url || !p.webhook_secret) return;
  const body = JSON.stringify({ event, order_id: orderId, at: new Date().toISOString(), ...(payload as object) });
  const sig = await hmacHex(p.webhook_secret, body);
  await db.from('webhook_deliveries').insert({
    partner_id: partnerId,
    order_id: orderId,
    event_type: event,
    payload: JSON.parse(body),
  });
  const res = await fetch(p.webhook_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GoRide-Signature': `${env.WEBHOOK_SIGNING_VERSION}=${sig}`,
    },
    body,
  }).catch(() => null);
  if (res) {
    await db.from('webhook_deliveries').update({ status_code: res.status, delivered_at: new Date().toISOString() }).eq('partner_id', partnerId).eq('order_id', orderId).eq('event_type', event);
  }
}

export default partner;
