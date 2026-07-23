import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin } from '../lib/supabase';
import { onboardRiderBody } from '../lib/schemas';
import { wakePendingForRider } from '../lib/dispatch';
import type { z } from 'zod';

const riders = new Hono<AppEnv>();

async function parse<T extends z.ZodTypeAny>(c: any, s: T) {
  try {
    return s.parse(await c.req.json());
  } catch {
    return null;
  }
}

// Called after signup — user provides vehicle details, becomes rider role, KYC pending.
riders.post('/onboard', requireAuth, async (c) => {
  const body = await parse(c, onboardRiderBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);
  await db.from('profiles').update({ role: 'rider' }).eq('id', uid);
  const { error } = await db.from('riders').insert({
    id: uid,
    vehicle_type: body.vehicle_type,
    vehicle_number: body.vehicle_number,
    vehicle_model: body.vehicle_model,
    license_number: body.license_number,
    city: body.city,
    kyc: 'pending',
  });
  if (error && !error.message.includes('duplicate')) {
    return c.json({ error: { code: 'insert_failed', message: error.message } }, 500);
  }
  return c.json({ ok: true });
});

riders.post('/online', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const body = await c.req.json().catch(() => ({} as { lat?: number; lng?: number }));
  const { data } = await admin(c.env).from('riders').select('kyc, city, vehicle_type').eq('id', uid).maybeSingle();
  if (data?.kyc !== 'approved') {
    return c.json({ error: { code: 'kyc_required', message: 'Awaiting KYC approval' } }, 403);
  }
  const patch: Record<string, unknown> = { status: 'online', last_seen: new Date().toISOString() };
  if (typeof body.lat === 'number' && typeof body.lng === 'number') {
    patch.last_lat = body.lat;
    patch.last_lng = body.lng;
  }
  await admin(c.env).from('riders').update(patch).eq('id', uid);

  // Instantly offer any recent pending orders in the rider's city. Fires
  // in the background so the response doesn't block; the client will pick
  // up the resulting offers via the realtime channel + poll fallback.
  if (data?.city && data?.vehicle_type) {
    c.executionCtx.waitUntil(
      wakePendingForRider(c.env, uid, data.city, data.vehicle_type).catch((e) =>
        console.warn('wakePendingForRider', e),
      ),
    );
  }
  return c.json({ ok: true });
});

riders.post('/offline', requireAuth, requireRole('rider'), async (c) => {
  await admin(c.env).from('riders').update({ status: 'offline' }).eq('id', c.get('userId')!);
  return c.json({ ok: true });
});

// Earnings summary
riders.get('/earnings', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data } = await admin(c.env)
    .from('transactions')
    .select('type, amount, created_at, order_id')
    .eq('rider_id', uid)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  return c.json({ transactions: data ?? [] });
});

// Pending offers for me (fallback if realtime missed)
riders.get('/offers', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const now = new Date().toISOString();
  const { data } = await admin(c.env)
    .from('job_offers')
    .select('order_id, offered_at, expires_at, orders(*)')
    .eq('rider_id', uid)
    .is('response', null)
    .gte('expires_at', now)
    .order('offered_at', { ascending: false });
  return c.json({ offers: data ?? [] });
});

export default riders;
