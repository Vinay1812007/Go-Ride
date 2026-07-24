// Restaurant-partner portal endpoints.
//
// Every handler is guarded by requireRole('restaurant_partner') AND
// re-checks the caller's linked restaurant_id, so a partner can only
// ever see their own restaurant's data — even if RLS were somehow
// bypassed (Worker uses the service-role client).
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin } from '../lib/supabase';
import { menuItemUpsertBody } from '../lib/schemas';

const partnerRest = new Hono<AppEnv>();

partnerRest.use('*', requireAuth, requireRole('restaurant_partner'));

async function myRestaurantId(c: any): Promise<string | null> {
  const uid = c.get('userId')!;
  const { data } = await admin(c.env)
    .from('profiles')
    .select('restaurant_id')
    .eq('id', uid)
    .maybeSingle();
  return (data?.restaurant_id as string | null) ?? null;
}

// GET /me — profile + linked restaurant + today's counters (orders, revenue).
partnerRest.get('/me', async (c) => {
  const rid = await myRestaurantId(c);
  if (!rid) return c.json({ error: { code: 'no_restaurant' } }, 404);
  const db = admin(c.env);
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const [
    { data: profile },
    { data: restaurant },
    { data: todaysOrders },
    { count: itemCount },
  ] = await Promise.all([
    db.from('profiles').select('id, full_name, email, phone').eq('id', c.get('userId')!).maybeSingle(),
    db.from('restaurants').select('*').eq('id', rid).maybeSingle(),
    db.from('orders').select('fare_final, fare_estimate, status').eq('restaurant_id', rid).gte('created_at', startOfToday),
    db.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', rid),
  ]);

  let todayRevenue = 0, todayOrders = 0;
  for (const o of todaysOrders ?? []) {
    if (['completed', 'delivered'].includes(o.status)) {
      todayRevenue += Number(o.fare_final ?? o.fare_estimate ?? 0);
      todayOrders++;
    }
  }
  return c.json({
    profile,
    restaurant,
    today: { orders: todayOrders, revenue: todayRevenue },
    menu_item_count: itemCount ?? 0,
  });
});

// GET /orders?status= — this restaurant's food orders, most recent first.
partnerRest.get('/orders', async (c) => {
  const rid = await myRestaurantId(c);
  if (!rid) return c.json({ error: { code: 'no_restaurant' } }, 404);
  const status = c.req.query('status');
  let q = admin(c.env)
    .from('orders')
    .select('id, order_no, status, service, pickup_address, drop_address, food_details, fare_estimate, fare_final, created_at, accepted_at, picked_at, completed_at, rider_id')
    .eq('restaurant_id', rid)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return c.json({ orders: data ?? [] });
});

// GET /menu — full menu including unavailable items.
partnerRest.get('/menu', async (c) => {
  const rid = await myRestaurantId(c);
  if (!rid) return c.json({ error: { code: 'no_restaurant' } }, 404);
  const { data } = await admin(c.env)
    .from('menu_items')
    .select('id, restaurant_id, name, description, price, category, image_url, is_veg, available, sort_order, created_at')
    .eq('restaurant_id', rid)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });
  return c.json({ items: data ?? [] });
});

// POST /menu — upsert menu item; enforced to this restaurant.
partnerRest.post('/menu', async (c) => {
  const rid = await myRestaurantId(c);
  if (!rid) return c.json({ error: { code: 'no_restaurant' } }, 404);
  let body: z.infer<typeof menuItemUpsertBody>;
  try { body = menuItemUpsertBody.parse(await c.req.json()); }
  catch { return c.json({ error: { code: 'bad_request' } }, 400); }
  if (body.restaurant_id !== rid) {
    return c.json({ error: { code: 'restaurant_mismatch' } }, 403);
  }
  const db = admin(c.env);
  const { id, ...upsert } = body;
  const query = id
    ? db.from('menu_items').update(upsert).eq('id', id).eq('restaurant_id', rid).select().single()
    : db.from('menu_items').insert(upsert).select().single();
  const { data, error } = await query;
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ item: data });
});

// DELETE /menu/:itemId — hard delete (menu items have no downstream FKs).
partnerRest.delete('/menu/:itemId', async (c) => {
  const rid = await myRestaurantId(c);
  if (!rid) return c.json({ error: { code: 'no_restaurant' } }, 404);
  const { error } = await admin(c.env)
    .from('menu_items')
    .delete()
    .eq('id', c.req.param('itemId'))
    .eq('restaurant_id', rid);
  if (error) return c.json({ error: { code: 'delete_failed', message: error.message } }, 500);
  return c.json({ ok: true });
});

// PATCH /restaurant — partner-editable fields on their own restaurant.
// Deliberately narrow: they can toggle open/close, adjust prep time, edit
// description + phone + image. Cannot change city / lat / lng / min_order
// (those are business-critical, admin only).
const restaurantEditBody = z.object({
  description: z.string().max(500).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  image_url: z.string().url().max(500).nullable().optional(),
  avg_prep_min: z.number().int().positive().max(180).optional(),
  active: z.boolean().optional(),
});
partnerRest.patch('/restaurant', async (c) => {
  const rid = await myRestaurantId(c);
  if (!rid) return c.json({ error: { code: 'no_restaurant' } }, 404);
  let body: z.infer<typeof restaurantEditBody>;
  try { body = restaurantEditBody.parse(await c.req.json()); }
  catch { return c.json({ error: { code: 'bad_request' } }, 400); }
  const { data, error } = await admin(c.env)
    .from('restaurants')
    .update(body)
    .eq('id', rid)
    .select()
    .single();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ restaurant: data });
});

export default partnerRest;
