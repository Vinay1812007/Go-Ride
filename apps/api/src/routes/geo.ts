// Public geocoding/routing endpoints — authenticated to prevent abuse, cached in KV.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../lib/auth';
import { autocomplete, reverse, route as routeGeo } from '../lib/geo';

const geo = new Hono<AppEnv>();

geo.get('/autocomplete', requireAuth, async (c) => {
  const q = c.req.query('q') ?? '';
  const cc = c.req.query('cc') ?? 'in';
  const results = await autocomplete(c.env, q, cc);
  return c.json({ results });
});

geo.get('/reverse', requireAuth, async (c) => {
  const lat = parseFloat(c.req.query('lat') ?? '');
  const lng = parseFloat(c.req.query('lng') ?? '');
  if (isNaN(lat) || isNaN(lng)) return c.json({ error: { code: 'bad_request' } }, 400);
  const label = await reverse(c.env, lat, lng);
  return c.json({ label, lat, lng });
});

geo.post('/route', requireAuth, async (c) => {
  const b = (await c.req.json().catch(() => null)) as { pickup?: { lat: number; lng: number }; drop?: { lat: number; lng: number } } | null;
  if (!b?.pickup || !b?.drop) return c.json({ error: { code: 'bad_request' } }, 400);
  const r = await routeGeo(c.env, b.pickup, b.drop);
  return c.json(r);
});

export default geo;
