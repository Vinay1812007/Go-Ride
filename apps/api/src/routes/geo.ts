// Public geocoding/routing endpoints — authenticated to prevent abuse, cached in KV.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../lib/auth';
import { autocomplete, reverse, route as routeGeo } from '../lib/geo';
import { detectCity } from '../lib/cities';

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

// GET /geo/detect-city?lat=&lng= — returns the best-matching active service
// area, or { city: null } if the point is outside every one. Used by the
// customer app to auto-select a city when the user grants GPS. No auth
// required — this is a read-only lookup against public metadata.
geo.get('/detect-city', async (c) => {
  const lat = parseFloat(c.req.query('lat') ?? '');
  const lng = parseFloat(c.req.query('lng') ?? '');
  if (isNaN(lat) || isNaN(lng)) return c.json({ error: { code: 'bad_request' } }, 400);
  const area = await detectCity(c.env, lat, lng);
  if (!area) return c.json({ city: null });
  return c.json({
    city: area.city,
    display_name: area.display_name ?? area.city,
    country: area.country,
    timezone: area.timezone,
    center: { lat: area.center_lat, lng: area.center_lng },
  });
});

export default geo;
