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

// GET /analytics?days=30 — pre-aggregated dashboard payload:
//   • daily revenue + order-count timeline
//   • top items by quantity + revenue
//   • hour-of-day distribution (0-23)
//   • order status split
// Everything computed in memory here — restaurants are small enough that
// even a 90-day scan is trivial (a handful of hundred rows).
partnerRest.get('/analytics', async (c) => {
  const rid = await myRestaurantId(c);
  if (!rid) return c.json({ error: { code: 'no_restaurant' } }, 404);
  const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') ?? '30', 10)));
  const since = new Date(Date.now() - days * 86400_000);

  const { data: orders } = await admin(c.env)
    .from('orders')
    .select('id, status, food_details, fare_estimate, fare_final, created_at, completed_at')
    .eq('restaurant_id', rid)
    .gte('created_at', since.toISOString())
    .limit(10_000);

  const rows = orders ?? [];
  const isDone = (s: string) => s === 'completed' || s === 'delivered';

  // Timeline: last N days, ascending
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const perDay = new Map<string, { revenue: number; orders: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfToday - i * 86400_000).toISOString().slice(0, 10);
    perDay.set(d, { revenue: 0, orders: 0 });
  }

  const perItem = new Map<string, { name: string; qty: number; revenue: number }>();
  const perHour = new Array<number>(24).fill(0);
  const statusCounts: Record<string, number> = {};
  let totalRevenue = 0, totalOrders = 0;
  let todayOrders = 0, todayRevenue = 0;
  let weekOrders = 0, weekRevenue = 0;
  const day = new Date().getDay();
  const daysSinceMonday = (day + 6) % 7;
  const startOfWeek = startOfToday - daysSinceMonday * 86400_000;
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  let monthOrders = 0, monthRevenue = 0;

  for (const o of rows) {
    statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
    if (!isDone(o.status)) continue;
    const ts = new Date(o.created_at).getTime();
    const revenue = Number(o.fare_final ?? o.fare_estimate ?? 0);
    totalRevenue += revenue; totalOrders++;
    if (ts >= startOfToday) { todayOrders++; todayRevenue += revenue; }
    if (ts >= startOfWeek)  { weekOrders++;  weekRevenue  += revenue; }
    if (ts >= startOfMonth) { monthOrders++; monthRevenue += revenue; }

    const dayKey = new Date(o.created_at).toISOString().slice(0, 10);
    const bucket = perDay.get(dayKey);
    if (bucket) { bucket.revenue += revenue; bucket.orders += 1; }

    const hour = new Date(o.created_at).getHours();
    perHour[hour] = (perHour[hour] ?? 0) + 1;

    // Item aggregation from the food_details JSON snapshot.
    const fd = o.food_details as { items?: Array<{ menu_item_id: string; name: string; qty: number; price: number }> } | null;
    for (const it of fd?.items ?? []) {
      const key = it.menu_item_id;
      const row = perItem.get(key) ?? { name: it.name, qty: 0, revenue: 0 };
      row.qty += it.qty;
      row.revenue += Number(it.price) * it.qty;
      perItem.set(key, row);
    }
  }

  const timeline = Array.from(perDay, ([date, v]) => ({
    date,
    revenue: Math.round(v.revenue * 100) / 100,
    orders: v.orders,
  }));

  const topItems = Array.from(perItem, ([id, v]) => ({ id, ...v, revenue: Math.round(v.revenue * 100) / 100 }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  return c.json({
    days,
    totals: {
      today:      { orders: todayOrders, revenue: Math.round(todayRevenue * 100) / 100 },
      this_week:  { orders: weekOrders,  revenue: Math.round(weekRevenue  * 100) / 100 },
      this_month: { orders: monthOrders, revenue: Math.round(monthRevenue * 100) / 100 },
      window:     { orders: totalOrders, revenue: Math.round(totalRevenue * 100) / 100 },
    },
    timeline,
    top_items: topItems,
    hour_distribution: perHour,   // index = hour 0-23, value = order count
    status_counts: statusCounts,
  });
});

export default partnerRest;
