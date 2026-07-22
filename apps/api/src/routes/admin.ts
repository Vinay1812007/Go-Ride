import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin } from '../lib/supabase';
import { rateCardBody, refundBody } from '../lib/schemas';
import type { z } from 'zod';

const adminRoute = new Hono<AppEnv>();

async function parse<T extends z.ZodTypeAny>(c: any, s: T) {
  try {
    return s.parse(await c.req.json());
  } catch {
    return null;
  }
}

adminRoute.use('*', requireAuth, requireRole('admin'));

// ---- Dashboard live stats ----
adminRoute.get('/stats', async (c) => {
  const db = admin(c.env);
  const [{ count: onlineRiders }, { count: activeOrders }, { data: today }] = await Promise.all([
    db.from('riders').select('*', { count: 'exact', head: true }).eq('status', 'online'),
    db.from('orders').select('*', { count: 'exact', head: true }).in('status', ['searching', 'accepted', 'arrived', 'picked_up', 'in_transit']),
    db.from('orders').select('fare_final').eq('status', 'completed').gte('completed_at', new Date().toISOString().slice(0, 10)),
  ]);
  const revenueToday = (today ?? []).reduce((s, o) => s + Number(o.fare_final ?? 0), 0);
  return c.json({ online_riders: onlineRiders ?? 0, active_orders: activeOrders ?? 0, revenue_today: Math.round(revenueToday) });
});

// ---- Rate card CRUD ----
adminRoute.get('/rate-cards', async (c) => {
  const { data } = await admin(c.env).from('rate_cards').select('*').order('city').order('service');
  return c.json({ rate_cards: data ?? [] });
});

adminRoute.post('/rate-cards', async (c) => {
  const body = await parse(c, rateCardBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const { data, error } = await admin(c.env)
    .from('rate_cards')
    .upsert({ ...body, updated_at: new Date().toISOString() }, { onConflict: 'city,service' })
    .select()
    .single();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ rate_card: data });
});

// ---- Riders KYC + block ----
adminRoute.get('/riders', async (c) => {
  const status = c.req.query('kyc');
  let q = admin(c.env).from('riders').select('*, profiles!inner(full_name, phone, email, rating, blocked)');
  if (status) q = q.eq('kyc', status);
  const { data } = await q.limit(200);
  return c.json({ riders: data ?? [] });
});

adminRoute.post('/riders/:id/kyc', async (c) => {
  const decision = c.req.query('decision');
  if (!['approved', 'rejected'].includes(decision ?? '')) return c.json({ error: { code: 'bad_decision' } }, 400);
  await admin(c.env).from('riders').update({ kyc: decision }).eq('id', c.req.param('id'));
  return c.json({ ok: true });
});

adminRoute.post('/profiles/:id/block', async (c) => {
  const blocked = c.req.query('blocked') === 'true';
  await admin(c.env).from('profiles').update({ blocked }).eq('id', c.req.param('id'));
  return c.json({ ok: true });
});

// ---- Orders (filterable) ----
adminRoute.get('/orders', async (c) => {
  const status = c.req.query('status');
  let q = admin(c.env).from('orders').select('*').order('created_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return c.json({ orders: data ?? [] });
});

// ---- Refund / adjustment on completed order ----
adminRoute.post('/orders/:id/refund', async (c) => {
  const body = await parse(c, refundBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('id, rider_id, status, fare_final').eq('id', c.req.param('id')).maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);
  await db.from('transactions').insert({
    order_id: order.id,
    rider_id: order.rider_id,
    type: body.type,
    amount: body.type === 'refund' ? -Math.abs(body.amount) : body.amount,
    note: body.note,
    created_by: uid,
  });
  if (body.type === 'refund') {
    await db.from('orders').update({ payment_status: 'refunded' }).eq('id', order.id);
  }
  return c.json({ ok: true });
});

// ---- Partners ----
adminRoute.get('/partners', async (c) => {
  const { data } = await admin(c.env).from('partners').select('id, business_name, contact_email, api_key_prefix, webhook_url, active, rate_limit_per_min, created_at');
  return c.json({ partners: data ?? [] });
});

adminRoute.post('/partners', async (c) => {
  const body = await c.req.json();
  const rawKey = 'pk_live_' + crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder().encode(rawKey);
  const hashBuf = await crypto.subtle.digest('SHA-256', enc);
  const hash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const secret = crypto.randomUUID().replace(/-/g, '');
  const { data, error } = await admin(c.env)
    .from('partners')
    .insert({
      business_name: body.business_name,
      contact_email: body.contact_email,
      webhook_url: body.webhook_url,
      webhook_secret: secret,
      api_key_hash: hash,
      api_key_prefix: rawKey.slice(0, 12),
    })
    .select()
    .single();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  // Return plaintext key ONCE — never again.
  return c.json({ partner: data, api_key: rawKey, webhook_secret: secret });
});

// ---- Live riders (for live map panel) ----
adminRoute.get('/live-riders', async (c) => {
  const { data } = await admin(c.env)
    .from('riders')
    .select('id, city, last_lat, last_lng, status, vehicle_type, profiles!inner(full_name)')
    .in('status', ['online', 'on_trip'])
    .not('last_lat', 'is', null)
    .limit(500);
  return c.json({ riders: data ?? [] });
});

export default adminRoute;
