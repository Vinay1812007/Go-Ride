import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../lib/auth';
import { admin } from '../lib/supabase';
import { fareQuoteBody } from '../lib/schemas';
import { computeFare, type RateCard } from '../lib/fare';
import { route as routeGeo } from '../lib/geo';
import { z } from 'zod';

// Local wrapper (Hono's zValidator is optional; we do minimal parsing to keep deps light).
async function parseJson<T extends z.ZodTypeAny>(c: any, schema: T) {
  try {
    const body = await c.req.json();
    return schema.parse(body);
  } catch (e) {
    return null;
  }
}

const fare = new Hono<AppEnv>();

fare.post('/quote', requireAuth, async (c) => {
  const body = await parseJson(c, fareQuoteBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);

  const { data: card } = await admin(c.env)
    .from('rate_cards')
    .select('*')
    .eq('city', body.city)
    .eq('service', body.service)
    .eq('active', true)
    .maybeSingle();
  if (!card) return c.json({ error: { code: 'no_rate_card', message: 'No active rate card for this city+service' } }, 404);

  const r = await routeGeo(c.env, body.pickup, body.drop);
  const breakup = computeFare(r.distance_km, r.duration_min, card as unknown as RateCard);

  return c.json({
    service: body.service,
    city: body.city,
    distance_km: breakup.km,
    duration_min: breakup.minutes,
    polyline: r.polyline,
    fare: breakup.total,
    fare_breakup: breakup,
  });
});

export default fare;

// Small helper re-export used by orders route so it can quote server-side too.
export async function quoteInternal(
  env: any,
  input: { pickup: { lat: number; lng: number }; drop: { lat: number; lng: number }; service: string; city: string },
) {
  const { data: card } = await admin(env)
    .from('rate_cards')
    .select('*')
    .eq('city', input.city)
    .eq('service', input.service)
    .eq('active', true)
    .maybeSingle();
  if (!card) throw new Error('no rate card');
  const r = await routeGeo(env, input.pickup, input.drop);
  const breakup = computeFare(r.distance_km, r.duration_min, card as unknown as RateCard);
  return { breakup, route: r, card };
}
