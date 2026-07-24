// Saved places — customer-only CRUD.
// Home / Work are unique per profile (enforced by partial unique indexes);
// 'other' places can have many rows.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin } from '../lib/supabase';

const places = new Hono<AppEnv>();
places.use('*', requireAuth, requireRole('customer'));

// GET /places — my saved places, home + work first, then others by created_at
places.get('/', async (c) => {
  const uid = c.get('userId')!;
  const { data } = await admin(c.env)
    .from('saved_places')
    .select('id, label, address, lat, lng, place_type, created_at, updated_at')
    .eq('profile_id', uid)
    .order('place_type', { ascending: true })  // enum order: home < work < other
    .order('created_at', { ascending: false });
  return c.json({ places: data ?? [] });
});

const upsertBody = z.object({
  id:         z.string().uuid().optional(),
  label:      z.string().min(1).max(60),
  address:    z.string().min(3).max(300),
  lat:        z.number().min(-90).max(90),
  lng:        z.number().min(-180).max(180),
  place_type: z.enum(['home', 'work', 'other']).default('other'),
});

// POST /places — upsert. For home/work, if a row already exists we UPDATE
// it (no unique-violation error surfaced to the client). For 'other',
// always INSERT (unless id was given, in which case UPDATE).
places.post('/', async (c) => {
  let body: z.infer<typeof upsertBody>;
  try { body = upsertBody.parse(await c.req.json()); }
  catch { return c.json({ error: { code: 'bad_request' } }, 400); }
  const uid = c.get('userId')!;
  const db = admin(c.env);

  // Explicit ID → update in place (own only).
  if (body.id) {
    const { data, error } = await db
      .from('saved_places')
      .update({
        label: body.label,
        address: body.address,
        lat: body.lat,
        lng: body.lng,
        place_type: body.place_type,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('profile_id', uid)
      .select()
      .single();
    if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
    return c.json({ place: data });
  }

  // For home/work, replace any existing row of that type.
  if (body.place_type !== 'other') {
    const { data: existing } = await db
      .from('saved_places')
      .select('id')
      .eq('profile_id', uid)
      .eq('place_type', body.place_type)
      .maybeSingle();
    if (existing) {
      const { data, error } = await db
        .from('saved_places')
        .update({ label: body.label, address: body.address, lat: body.lat, lng: body.lng, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
      return c.json({ place: data });
    }
  }

  const { data, error } = await db
    .from('saved_places')
    .insert({ profile_id: uid, ...body })
    .select()
    .single();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ place: data });
});

// DELETE /places/:id
places.delete('/:id', async (c) => {
  const uid = c.get('userId')!;
  const { error } = await admin(c.env)
    .from('saved_places')
    .delete()
    .eq('id', c.req.param('id'))
    .eq('profile_id', uid);
  if (error) return c.json({ error: { code: 'delete_failed', message: error.message } }, 500);
  return c.json({ ok: true });
});

export default places;
