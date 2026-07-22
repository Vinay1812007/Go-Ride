// Public share-tracking page data. No auth — validated by HMAC token in URL.
import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { admin } from '../lib/supabase';
import { verifyShareToken } from '../lib/hmac';

const tracking = new Hono<AppEnv>();

tracking.get('/:orderNo', async (c) => {
  const orderNo = c.req.param('orderNo');
  const token = c.req.query('k') ?? '';
  const ok = await verifyShareToken(c.env.SHARE_TOKEN_SECRET, orderNo, token);
  if (!ok) return c.json({ error: { code: 'invalid_token' } }, 403);
  const db = admin(c.env);
  const { data: order } = await db
    .from('orders')
    .select('order_no, status, service, pickup_address, drop_address, pickup_lat, pickup_lng, drop_lat, drop_lng, route_polyline, distance_km, duration_min, fare_estimate, fare_final, created_at, accepted_at, arrived_at, picked_at, completed_at, cancelled_at, riders(id, vehicle_number, vehicle_type, profiles!inner(full_name, rating, avatar_url))')
    .eq('order_no', orderNo)
    .maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);

  let last_location = null;
  if ((order as any).riders?.id) {
    const { data: loc } = await db
      .from('rider_locations')
      .select('lat, lng, heading, recorded_at')
      .eq('order_id', (order as any).id ?? null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    last_location = loc;
  }
  return c.json({ order, last_location });
});

export default tracking;
