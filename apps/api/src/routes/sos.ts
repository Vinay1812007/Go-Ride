// SOS emergency endpoints — customer or rider triggers, admins see the queue.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../lib/auth';
import { admin, broadcast } from '../lib/supabase';
import { sendToProfile } from '../lib/push';

const sos = new Hono<AppEnv>();
sos.use('*', requireAuth);

const triggerBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  note: z.string().max(500).optional(),
  order_id: z.string().uuid().optional(),
});

// POST /sos — customer or captain triggers.
// Rate-limited implicitly: the client shouldn't spam, but we don't enforce
// server-side beyond one row per press. Duplicate alerts help admins gauge
// urgency and are cheap to store.
sos.post('/', async (c) => {
  let body: z.infer<typeof triggerBody>;
  try { body = triggerBody.parse(await c.req.json()); }
  catch { return c.json({ error: { code: 'bad_request' } }, 400); }
  const uid = c.get('userId')!;
  const role = c.get('userRole')!;
  if (role !== 'customer' && role !== 'rider') {
    return c.json({ error: { code: 'forbidden', message: 'Only customers and riders can trigger SOS' } }, 403);
  }
  const db = admin(c.env);

  const { data: alert, error } = await db
    .from('sos_alerts')
    .insert({
      profile_id: uid,
      role,
      order_id: body.order_id ?? null,
      lat: body.lat,
      lng: body.lng,
      note: body.note ?? null,
    })
    .select('id')
    .single();
  if (error || !alert) return c.json({ error: { code: 'insert_failed', message: error?.message } }, 500);

  // Broadcast on a global SOS channel — any admin dashboard subscribed sees
  // it instantly. Also push notifications to all admin profiles.
  c.executionCtx.waitUntil(
    broadcast(c.env, 'sos:global', 'alert', { id: alert.id, role, lat: body.lat, lng: body.lng, order_id: body.order_id ?? null, note: body.note ?? null })
      .catch(() => {}),
  );
  c.executionCtx.waitUntil(pushToAllAdmins(c.env, role, body.order_id, body.note).catch(() => {}));

  return c.json({ id: alert.id });
});

async function pushToAllAdmins(env: any, role: string, orderId?: string, note?: string) {
  const { data: admins } = await admin(env).from('profiles').select('id').eq('role', 'admin').limit(50);
  await Promise.all((admins ?? []).map((a) => sendToProfile(env, a.id, {
    title: `🚨 SOS from ${role}`,
    body: note ? note.slice(0, 150) : 'Tap to open admin SOS queue',
    data: { kind: 'sos', order_id: orderId ?? '' },
    clickAction: '/admin/sos',
  })));
}

export default sos;
