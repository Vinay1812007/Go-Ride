// Customer-facing endpoints — profile view/edit and settings.
// The customer app calls these from the new Settings page.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../lib/auth';
import { admin } from '../lib/supabase';

const customer = new Hono<AppEnv>();

customer.get('/profile', requireAuth, async (c) => {
  const uid = c.get('userId')!;
  const { data } = await admin(c.env)
    .from('profiles')
    .select('id, full_name, phone, email, avatar_url, rating, created_at')
    .eq('id', uid)
    .maybeSingle();
  return c.json({ profile: data });
});

customer.patch('/profile', requireAuth, async (c) => {
  const uid = c.get('userId')!;
  const body = await c.req.json().catch(() => null) as null | {
    full_name?: string; phone?: string; avatar_url?: string; email?: string;
  };
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const patch: Record<string, unknown> = {};
  if (typeof body.full_name  === 'string' && body.full_name.trim()) patch.full_name  = body.full_name.trim();
  if (typeof body.phone      === 'string')                          patch.phone      = body.phone;
  if (typeof body.avatar_url === 'string')                          patch.avatar_url = body.avatar_url;
  if (typeof body.email      === 'string')                          patch.email      = body.email;
  if (Object.keys(patch).length === 0) return c.json({ ok: true, unchanged: true });
  const { error } = await admin(c.env).from('profiles').update(patch).eq('id', uid);
  if (error) return c.json({ error: { code: 'update_failed', message: error.message } }, 500);
  return c.json({ ok: true });
});

// Ride history — orders where the caller is the customer.
customer.get('/rides', requireAuth, async (c) => {
  const uid = c.get('userId')!;
  const limit = Math.min(50, parseInt(c.req.query('limit') ?? '20', 10));
  const { data } = await admin(c.env)
    .from('orders')
    .select('id, order_no, service, status, pickup_address, drop_address, fare_final, distance_km, created_at, completed_at')
    .eq('customer_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return c.json({ rides: data ?? [] });
});

export default customer;
