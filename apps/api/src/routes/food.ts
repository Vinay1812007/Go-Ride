// Public browse endpoints for the food vertical.
// No auth required — customers can shop before signing in (though they
// need auth to actually place the order via /orders).
import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { admin } from '../lib/supabase';

const food = new Hono<AppEnv>();

// GET /food/restaurants?city=&cuisine=&q=
// Returns active restaurants ordered by rating. `q` is a case-insensitive
// name match, useful for the browse search input.
food.get('/restaurants', async (c) => {
  const city    = c.req.query('city')    ?? 'Hyderabad';
  const cuisine = c.req.query('cuisine');
  const q       = c.req.query('q');

  let query = admin(c.env)
    .from('restaurants')
    .select('id, name, cuisine, description, address, city, lat, lng, image_url, avg_prep_min, min_order, rating')
    .eq('city', city)
    .eq('active', true)
    .order('rating', { ascending: false })
    .limit(100);
  if (cuisine) query = query.eq('cuisine', cuisine);
  if (q)       query = query.ilike('name', `%${q}%`);

  const { data, error } = await query;
  if (error) return c.json({ error: { code: 'query_failed', message: error.message } }, 500);

  // Also compute the distinct cuisine list so the client can render chips.
  const cuisines = Array.from(new Set((data ?? []).map((r) => r.cuisine))).sort();

  return c.json({ restaurants: data ?? [], cuisines });
});

// GET /food/restaurants/:id — restaurant + its menu grouped by category
food.get('/restaurants/:id', async (c) => {
  const db = admin(c.env);
  const id = c.req.param('id');

  const [{ data: restaurant, error: rErr }, { data: items, error: mErr }] = await Promise.all([
    db.from('restaurants')
      .select('id, name, cuisine, description, address, city, lat, lng, phone, image_url, avg_prep_min, min_order, rating, active')
      .eq('id', id)
      .maybeSingle(),
    db.from('menu_items')
      .select('id, name, description, price, category, image_url, is_veg, available, sort_order')
      .eq('restaurant_id', id)
      .eq('available', true)
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true }),
  ]);
  if (rErr || mErr) return c.json({ error: { code: 'query_failed' } }, 500);
  if (!restaurant || !restaurant.active) return c.json({ error: { code: 'not_found' } }, 404);

  // Group items by category, preserving the insertion order (category ASC).
  const menu: Array<{ category: string; items: typeof items }> = [];
  for (const it of items ?? []) {
    const last = menu[menu.length - 1];
    if (last && last.category === it.category) last.items!.push(it);
    else menu.push({ category: it.category, items: [it] });
  }

  return c.json({ restaurant, menu });
});

export default food;
