// Public-ish (session-authed) endpoints about captains, safe to expose
// to the customer app for map decoration purposes.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../lib/auth';
import { admin } from '../lib/supabase';

const captains = new Hono<AppEnv>();

// Ghost captain markers around a lat/lng. Coarse-quantised to hide exact
// positions and reduce reads via KV caching (5s TTL).
captains.get('/nearby', requireAuth, async (c) => {
  const lat = parseFloat(c.req.query('lat') ?? '');
  const lng = parseFloat(c.req.query('lng') ?? '');
  const radiusKm = Math.min(15, Math.max(1, parseFloat(c.req.query('radius') ?? '5')));
  if (!isFinite(lat) || !isFinite(lng)) {
    return c.json({ error: { code: 'bad_request', message: 'lat/lng required' } }, 400);
  }

  // Coarse-quantise the cache key so nearby callers hit the same cell.
  const qLat = Math.round(lat * 200) / 200;   // ~500m
  const qLng = Math.round(lng * 200) / 200;
  const cacheKey = `nearby:${qLat}:${qLng}:${radiusKm}`;
  const cached = await c.env.CACHE.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'Content-Type': 'application/json' } });

  // Bounding box + haversine finalise. 1° lat ≈ 111km; longitude scales by cos(lat).
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const staleCutoff = new Date(Date.now() - 120_000).toISOString();  // last 2 min

  const { data } = await admin(c.env)
    .from('riders')
    .select('id, vehicle_type, last_lat, last_lng, last_seen')
    .eq('status', 'online')
    .gte('last_seen', staleCutoff)
    .gte('last_lat', lat - latDelta).lte('last_lat', lat + latDelta)
    .gte('last_lng', lng - lngDelta).lte('last_lng', lng + lngDelta)
    .limit(120);

  // Filter to radius + strip id (privacy) + jitter to hide exact position
  const captainsOut = (data ?? [])
    .filter((r) => r.last_lat != null && r.last_lng != null)
    .filter((r) => {
      const dLat = (r.last_lat! - lat) * 111;
      const dLng = (r.last_lng! - lng) * 111 * Math.cos((lat * Math.PI) / 180);
      return Math.hypot(dLat, dLng) <= radiusKm;
    })
    .slice(0, 60)
    .map((r) => ({
      vehicle_type: r.vehicle_type,
      // Jitter ±30m so exact positions can't be reconstructed
      lat: r.last_lat! + (Math.random() - 0.5) * 0.0006,
      lng: r.last_lng! + (Math.random() - 0.5) * 0.0006,
    }));

  const body = JSON.stringify({ captains: captainsOut, count: captainsOut.length });
  c.executionCtx.waitUntil(c.env.CACHE.put(cacheKey, body, { expirationTtl: 10 }));
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
});

export default captains;
