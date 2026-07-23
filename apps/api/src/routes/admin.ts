import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin } from '../lib/supabase';
import { rateCardBody, refundBody } from '../lib/schemas';
import { dispatch } from '../lib/dispatch';
import { haversineKm } from '../lib/geo';
import type { z } from 'zod';

const adminRoute = new Hono<AppEnv>();

async function parse<T extends z.ZodTypeAny>(c: any, s: T) {
  try {
    return s.parse(await c.req.json());
  } catch {
    return null;
  }
}

adminRoute.use('*', requireAuth, requireRole('admin'));

// ---- Dashboard live stats ----
adminRoute.get('/stats', async (c) => {
  const db = admin(c.env);
  const [{ count: onlineRiders }, { count: activeOrders }, { data: today }] = await Promise.all([
    db.from('riders').select('*', { count: 'exact', head: true }).eq('status', 'online'),
    db.from('orders').select('*', { count: 'exact', head: true }).in('status', ['searching', 'accepted', 'arrived', 'picked_up', 'in_transit']),
    db.from('orders').select('fare_final').eq('status', 'completed').gte('completed_at', new Date().toISOString().slice(0, 10)),
  ]);
  const revenueToday = (today ?? []).reduce((s, o) => s + Number(o.fare_final ?? 0), 0);
  return c.json({ online_riders: onlineRiders ?? 0, active_orders: activeOrders ?? 0, revenue_today: Math.round(revenueToday) });
});

// ---- Rate card CRUD ----
adminRoute.get('/rate-cards', async (c) => {
  const { data } = await admin(c.env).from('rate_cards').select('*').order('city').order('service');
  return c.json({ rate_cards: data ?? [] });
});

adminRoute.post('/rate-cards', async (c) => {
  const body = await parse(c, rateCardBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const { data, error } = await admin(c.env)
    .from('rate_cards')
    .upsert({ ...body, updated_at: new Date().toISOString() }, { onConflict: 'city,service' })
    .select()
    .single();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ rate_card: data });
});

// ---- Riders KYC + block ----
adminRoute.get('/riders', async (c) => {
  const status = c.req.query('kyc');
  let q = admin(c.env).from('riders').select('*, profiles!inner(full_name, phone, email, rating, blocked)');
  if (status) q = q.eq('kyc', status);
  const { data } = await q.limit(200);
  return c.json({ riders: data ?? [] });
});

adminRoute.post('/riders/:id/kyc', async (c) => {
  const decision = c.req.query('decision');
  if (!['approved', 'rejected'].includes(decision ?? '')) return c.json({ error: { code: 'bad_decision' } }, 400);
  await admin(c.env).from('riders').update({ kyc: decision }).eq('id', c.req.param('id'));
  return c.json({ ok: true });
});

adminRoute.post('/profiles/:id/block', async (c) => {
  const blocked = c.req.query('blocked') === 'true';
  await admin(c.env).from('profiles').update({ blocked }).eq('id', c.req.param('id'));
  return c.json({ ok: true });
});

// ---- Orders (filterable) ----
adminRoute.get('/orders', async (c) => {
  const status = c.req.query('status');
  let q = admin(c.env).from('orders').select('*').order('created_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return c.json({ orders: data ?? [] });
});

// ---- CSV exports ----
// Escape a value for CSV (RFC 4180): wrap in quotes if it contains comma,
// newline, or a double quote; double any embedded double quotes.
function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n');
  return header + '\n' + body + '\n';
}
function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

// GET /admin/exports/orders.csv?status=&from=&to=  → all matching orders,
// flattened, ready for Excel / Google Sheets.
adminRoute.get('/exports/orders.csv', async (c) => {
  const status = c.req.query('status');
  const from = c.req.query('from');
  const to = c.req.query('to');
  let q = admin(c.env)
    .from('orders')
    .select('order_no, service, status, city, pickup_address, drop_address, distance_km, duration_min, fare_estimate, fare_final, fare_breakup, payment_method, payment_status, customer_id, rider_id, cancelled_reason, created_at, accepted_at, picked_at, completed_at, cancelled_at')
    .order('created_at', { ascending: false })
    .limit(10_000);
  if (status) q = q.eq('status', status);
  if (from)   q = q.gte('created_at', from);
  if (to)     q = q.lte('created_at', to);
  const { data, error } = await q;
  if (error) return c.json({ error: { code: 'query_failed', message: error.message } }, 500);

  const flat = (data ?? []).map((o) => ({
    ...o,
    commission: (o.fare_breakup as { commission?: number } | null)?.commission ?? '',
    rider_earning: (o.fare_breakup as { rider_earning?: number } | null)?.rider_earning ?? '',
    fare_breakup: undefined,
  }));
  const columns = [
    'order_no', 'service', 'status', 'city',
    'pickup_address', 'drop_address',
    'distance_km', 'duration_min',
    'fare_estimate', 'fare_final', 'commission', 'rider_earning',
    'payment_method', 'payment_status',
    'customer_id', 'rider_id',
    'cancelled_reason',
    'created_at', 'accepted_at', 'picked_at', 'completed_at', 'cancelled_at',
  ];
  return csvResponse(csv(flat, columns), `goride-orders-${new Date().toISOString().slice(0, 10)}.csv`);
});

// GET /admin/exports/daily-revenue.csv?from=&to=  → per-day aggregate for
// completed orders — orders count, gross revenue, platform commission,
// rider payouts.
adminRoute.get('/exports/daily-revenue.csv', async (c) => {
  const from = c.req.query('from') ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const to = c.req.query('to');
  let q = admin(c.env)
    .from('orders')
    .select('completed_at, fare_final, fare_breakup, service, city')
    .in('status', ['completed', 'delivered'])
    .gte('completed_at', from)
    .order('completed_at', { ascending: true })
    .limit(20_000);
  if (to) q = q.lte('completed_at', to);
  const { data, error } = await q;
  if (error) return c.json({ error: { code: 'query_failed', message: error.message } }, 500);

  const byDay = new Map<string, { orders: number; revenue: number; commission: number; rider_earning: number }>();
  for (const o of data ?? []) {
    const day = String(o.completed_at).slice(0, 10);
    const bucket = byDay.get(day) ?? { orders: 0, revenue: 0, commission: 0, rider_earning: 0 };
    bucket.orders += 1;
    bucket.revenue += Number(o.fare_final ?? 0);
    const br = o.fare_breakup as { commission?: number; rider_earning?: number } | null;
    bucket.commission += Number(br?.commission ?? 0);
    bucket.rider_earning += Number(br?.rider_earning ?? 0);
    byDay.set(day, bucket);
  }
  const rows = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, b]) => ({
      day,
      orders: b.orders,
      revenue: b.revenue.toFixed(2),
      commission: b.commission.toFixed(2),
      rider_earning: b.rider_earning.toFixed(2),
    }));
  return csvResponse(
    csv(rows, ['day', 'orders', 'revenue', 'commission', 'rider_earning']),
    `goride-daily-revenue-${new Date().toISOString().slice(0, 10)}.csv`,
  );
});

// GET /admin/exports/rider-earnings.csv?from=&to=  → per-rider totals.
adminRoute.get('/exports/rider-earnings.csv', async (c) => {
  const from = c.req.query('from') ?? new Date(Date.now() - 30 * 86400_000).toISOString();
  const to = c.req.query('to');
  const db = admin(c.env);
  let q = db
    .from('transactions')
    .select('rider_id, type, amount, created_at')
    .in('type', ['trip_earning', 'commission', 'refund', 'adjustment'])
    .gte('created_at', from)
    .limit(50_000);
  if (to) q = q.lte('created_at', to);
  const { data: tx, error } = await q;
  if (error) return c.json({ error: { code: 'query_failed', message: error.message } }, 500);

  const byRider = new Map<string, { earning: number; commission: number; other: number; trips: number }>();
  for (const t of tx ?? []) {
    if (!t.rider_id) continue;
    const b = byRider.get(t.rider_id) ?? { earning: 0, commission: 0, other: 0, trips: 0 };
    const amt = Number(t.amount);
    if (t.type === 'trip_earning') { b.earning += amt; b.trips += 1; }
    else if (t.type === 'commission') b.commission += amt;
    else b.other += amt;
    byRider.set(t.rider_id, b);
  }

  // Enrich with names
  const riderIds = [...byRider.keys()];
  const { data: profiles } = riderIds.length > 0
    ? await db.from('profiles').select('id, full_name, email').in('id', riderIds)
    : { data: [] as Array<{ id: string; full_name: string; email: string | null }> };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, { name: p.full_name, email: p.email ?? '' }]));

  const rows = [...byRider.entries()]
    .map(([id, b]) => ({
      rider_id: id,
      name: nameById.get(id)?.name ?? '',
      email: nameById.get(id)?.email ?? '',
      trips: b.trips,
      earning: b.earning.toFixed(2),
      commission_paid: (-b.commission).toFixed(2),      // stored negative
      adjustments: b.other.toFixed(2),
      net_payout: (b.earning + b.other + b.commission).toFixed(2),
    }))
    .sort((a, b) => Number(b.net_payout) - Number(a.net_payout));
  return csvResponse(
    csv(rows, ['rider_id', 'name', 'email', 'trips', 'earning', 'commission_paid', 'adjustments', 'net_payout']),
    `goride-rider-earnings-${new Date().toISOString().slice(0, 10)}.csv`,
  );
});

// ---- Force re-dispatch a stuck order ----
adminRoute.post('/orders/:id/redispatch', async (c) => {
  const orderId = c.req.param('id');
  const db = admin(c.env);
  const { data: order } = await db
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);
  if (['completed', 'delivered', 'cancelled_customer', 'cancelled_rider'].includes(order.status)) {
    return c.json({ error: { code: 'already_final' } }, 409);
  }
  // Reset to searching if it was stuck at no_rider_found or similar
  if (order.status !== 'accepted' && order.status !== 'arrived' && order.status !== 'picked_up' && order.status !== 'in_transit') {
    await db.from('orders').update({ status: 'searching' }).eq('id', orderId);
  }
  const n = await dispatch(c.env, orderId, { radiusKm: 15, maxRiders: 10, offerTtlSec: 25 });
  return c.json({ ok: true, offers_sent: n });
});

// ---- Explain why an order didn't get matched ----
adminRoute.get('/orders/:id/dispatch-report', async (c) => {
  const orderId = c.req.param('id');
  const db = admin(c.env);
  const { data: order } = await db
    .from('orders')
    .select('id, service, city, status, pickup_lat, pickup_lng, created_at')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);

  const { data: allRiders } = await db
    .from('riders')
    .select('id, status, vehicle_type, city, kyc, last_lat, last_lng, last_seen, profiles!inner(full_name)');
  const fiveMinAgo = Date.now() - 5 * 60_000;

  const rows = (allRiders ?? []).map((r) => {
    const reasons: string[] = [];
    if (r.status !== 'online') reasons.push(`status=${r.status}`);
    if (r.kyc !== 'approved') reasons.push(`kyc=${r.kyc}`);
    if (r.city?.toLowerCase() !== order.city?.toLowerCase()) reasons.push(`city="${r.city}"≠"${order.city}"`);
    if (!r.last_seen || new Date(r.last_seen).getTime() < fiveMinAgo) reasons.push('gps_stale');
    if (!r.last_lat || !r.last_lng) reasons.push('no_location');
    const distanceKm = r.last_lat != null && r.last_lng != null
      ? haversineKm(order.pickup_lat, order.pickup_lng, r.last_lat, r.last_lng)
      : null;
    // Vehicle match — bike/scooter/parcel_bike are fungible on the customer side,
    // but rider's vehicle_type must be in the candidate set for the ORDER's service.
    const candidates = ['bike', 'scooter'].includes(order.service)
      ? ['bike', 'scooter']
      : ['parcel_bike', 'parcel_scooter'].includes(order.service)
        ? ['parcel_bike', 'parcel_scooter']
        : [order.service];
    if (!candidates.includes(r.vehicle_type)) reasons.push(`vehicle=${r.vehicle_type}`);

    return {
      rider_id: r.id,
      name: (r as any).profiles?.full_name,
      status: r.status,
      vehicle_type: r.vehicle_type,
      city: r.city,
      kyc: r.kyc,
      last_seen: r.last_seen,
      distance_km: distanceKm ? Number(distanceKm.toFixed(2)) : null,
      eligible: reasons.length === 0,
      reasons,
    };
  });

  const eligible = rows.filter((r) => r.eligible);
  return c.json({
    order: {
      id: order.id,
      service: order.service,
      city: order.city,
      status: order.status,
      pickup: [order.pickup_lat, order.pickup_lng],
      age_seconds: Math.round((Date.now() - new Date(order.created_at).getTime()) / 1000),
    },
    total_riders: rows.length,
    eligible_count: eligible.length,
    within_5km: eligible.filter((r) => (r.distance_km ?? Infinity) <= 5).length,
    within_10km: eligible.filter((r) => (r.distance_km ?? Infinity) <= 10).length,
    riders: rows.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)),
  });
});

// ---- Refund / adjustment on completed order ----
adminRoute.post('/orders/:id/refund', async (c) => {
  const body = await parse(c, refundBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('id, rider_id, status, fare_final').eq('id', c.req.param('id')).maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);
  await db.from('transactions').insert({
    order_id: order.id,
    rider_id: order.rider_id,
    type: body.type,
    amount: body.type === 'refund' ? -Math.abs(body.amount) : body.amount,
    note: body.note,
    created_by: uid,
  });
  if (body.type === 'refund') {
    await db.from('orders').update({ payment_status: 'refunded' }).eq('id', order.id);
  }
  return c.json({ ok: true });
});

// ---- Partners ----
adminRoute.get('/partners', async (c) => {
  const { data } = await admin(c.env).from('partners').select('id, business_name, contact_email, api_key_prefix, webhook_url, active, rate_limit_per_min, created_at');
  return c.json({ partners: data ?? [] });
});

adminRoute.post('/partners', async (c) => {
  const body = await c.req.json();
  const rawKey = 'pk_live_' + crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder().encode(rawKey);
  const hashBuf = await crypto.subtle.digest('SHA-256', enc);
  const hash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const secret = crypto.randomUUID().replace(/-/g, '');
  const { data, error } = await admin(c.env)
    .from('partners')
    .insert({
      business_name: body.business_name,
      contact_email: body.contact_email,
      webhook_url: body.webhook_url,
      webhook_secret: secret,
      api_key_hash: hash,
      api_key_prefix: rawKey.slice(0, 12),
    })
    .select()
    .single();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  // Return plaintext key ONCE — never again.
  return c.json({ partner: data, api_key: rawKey, webhook_secret: secret });
});

// ---- Live riders (for live map panel) ----
adminRoute.get('/live-riders', async (c) => {
  const { data } = await admin(c.env)
    .from('riders')
    .select('id, city, last_lat, last_lng, status, vehicle_type, profiles!inner(full_name)')
    .in('status', ['online', 'on_trip'])
    .not('last_lat', 'is', null)
    .limit(500);
  return c.json({ riders: data ?? [] });
});

// -----------------------------------------------------------------
// Dev — seed / purge demo data. Fills the dashboard with realistic
// activity for screenshots and demos.
// -----------------------------------------------------------------
const DEMO_EMAIL_SUFFIX = '@goride.demo';

const DEMO_CAPTAINS = [
  { name: 'Amit Patel',    vehicle: 'bike',  plate: 'TS 09 AB 1001', lat_off:  0.010, lng_off:  0.012 },
  { name: 'Priya Sharma',  vehicle: 'bike',  plate: 'TS 09 CD 1002', lat_off: -0.018, lng_off:  0.005 },
  { name: 'Rahul Reddy',   vehicle: 'auto',  plate: 'TS 09 EF 1003', lat_off:  0.005, lng_off: -0.020 },
  { name: 'Sneha Kumar',   vehicle: 'cab_4', plate: 'TS 09 GH 1004', lat_off:  0.022, lng_off: -0.008 },
  { name: 'Vikram Rao',    vehicle: 'cab_7', plate: 'TS 09 IJ 1005', lat_off: -0.008, lng_off:  0.025 },
] as const;

const DEMO_CUSTOMERS = [
  { name: 'Meera Menon',    email: 'meera' },
  { name: 'Arjun Verma',    email: 'arjun' },
  { name: 'Kavya Nair',     email: 'kavya' },
] as const;

const HYD_CENTER = { lat: 17.3850, lng: 78.4867 };

// Pre-baked orders in Hyderabad — pickup/drop pairs of real neighborhoods.
const ORDER_ROUTES = [
  { pickup: [17.4483, 78.3915, 'Madhapur, Hitech City'], drop: [17.4065, 78.5691, 'Uppal Metro'] },
  { pickup: [17.4239, 78.4738, 'Banjara Hills Rd 12'],   drop: [17.4400, 78.3489, 'Gachibowli'] },
  { pickup: [17.3616, 78.4747, 'Charminar'],             drop: [17.3947, 78.4780, 'Secunderabad Stn'] },
  { pickup: [17.4400, 78.4483, 'Ameerpet Metro'],        drop: [17.4530, 78.3712, 'HITEC City MMTS'] },
  { pickup: [17.4048, 78.4630, 'Somajiguda'],            drop: [17.3410, 78.5486, 'LB Nagar'] },
  { pickup: [17.4300, 78.4400, 'Punjagutta'],            drop: [17.4478, 78.3915, 'Kondapur'] },
  { pickup: [17.3850, 78.4867, 'Nampally Stn'],          drop: [17.4568, 78.5646, 'Kompally'] },
];

function pick<T>(arr: readonly T[], i: number): T { return arr[i % arr.length]!; }

adminRoute.post('/dev/seed-demo', async (c) => {
  const db = admin(c.env);

  // 1. Create captain auth users + profiles + riders
  const captains: Array<{ id: string; vehicle: string }> = [];
  for (let i = 0; i < DEMO_CAPTAINS.length; i++) {
    const cap = DEMO_CAPTAINS[i]!;
    const email = `captain${i + 1}${DEMO_EMAIL_SUFFIX}`;
    let userId: string | null = null;

    // Try to find existing
    const { data: existing } = await db.from('profiles').select('id').eq('email', email).maybeSingle();
    if (existing) {
      userId = existing.id;
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email, password: 'demo-goride-captain-' + (i + 1),
        email_confirm: true,
        user_metadata: { full_name: cap.name },
      });
      if (error) return c.json({ error: { code: 'auth_create_failed', message: error.message } }, 500);
      userId = data.user.id;
    }
    if (!userId) continue;

    await db.from('profiles').update({ role: 'rider', full_name: cap.name }).eq('id', userId);
    await db.from('riders').upsert({
      id: userId,
      status: i === 0 ? 'online' : (i === 1 ? 'online' : 'offline'),   // 2 online, 3 offline
      vehicle_type: cap.vehicle,
      vehicle_number: cap.plate,
      vehicle_model: cap.vehicle === 'bike' ? 'Honda Activa' : cap.vehicle === 'auto' ? 'Bajaj Auto' : 'Maruti Suzuki',
      license_number: 'DL-TS-' + (10000 + i),
      city: 'Hyderabad',
      kyc: 'approved',
      last_lat: HYD_CENTER.lat + cap.lat_off,
      last_lng: HYD_CENTER.lng + cap.lng_off,
      last_seen: new Date().toISOString(),
      total_trips: Math.floor(Math.random() * 200) + 20,
    });
    captains.push({ id: userId, vehicle: cap.vehicle });
  }

  // 2. Create customer auth users + profiles
  const customers: string[] = [];
  for (let i = 0; i < DEMO_CUSTOMERS.length; i++) {
    const cust = DEMO_CUSTOMERS[i]!;
    const email = `${cust.email}${DEMO_EMAIL_SUFFIX}`;
    let userId: string | null = null;
    const { data: existing } = await db.from('profiles').select('id').eq('email', email).maybeSingle();
    if (existing) {
      userId = existing.id;
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email, password: 'demo-goride-customer-' + (i + 1),
        email_confirm: true,
        user_metadata: { full_name: cust.name },
      });
      if (error) return c.json({ error: { code: 'auth_create_failed', message: error.message } }, 500);
      userId = data.user.id;
    }
    if (userId) customers.push(userId);
  }

  // 3. Generate 15 orders across statuses + timeframes
  //    5 completed (yesterday), 3 delivered (today), 2 in_transit, 2 searching,
  //    1 cancelled_customer, 1 cancelled_rider, 1 no_rider_found
  const now = Date.now();
  type Plan = {
    status: string;
    service: string;
    ageMs: number;
    completed?: boolean;
    withRider?: boolean;
    cancelled?: 'customer' | 'rider';
  };
  const plans: Plan[] = [
    ...Array.from({ length: 5 }, () => ({ status: 'completed', service: 'bike',       ageMs: 24 * 3600_000 + Math.random() * 4 * 3600_000, completed: true, withRider: true })),
    ...Array.from({ length: 3 }, () => ({ status: 'delivered', service: 'parcel_bike', ageMs: 2 * 3600_000  + Math.random() * 3 * 3600_000, completed: true, withRider: true })),
    ...Array.from({ length: 2 }, () => ({ status: 'in_transit', service: 'auto',      ageMs: 15 * 60_000, withRider: true })),
    ...Array.from({ length: 2 }, () => ({ status: 'searching', service: 'cab_4',      ageMs: 30_000 })),
    { status: 'cancelled_customer', service: 'bike', ageMs: 6 * 3600_000, cancelled: 'customer' as const, withRider: true },
    { status: 'cancelled_rider',    service: 'auto', ageMs: 5 * 3600_000, cancelled: 'rider' as const,    withRider: true },
    { status: 'no_rider_found',     service: 'cab_7', ageMs: 3 * 3600_000 },
  ];

  const created: string[] = [];
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]!;
    const route = pick(ORDER_ROUTES, i);
    const distance_km = 4 + Math.random() * 12;
    const duration_min = Math.round(distance_km * 3 + Math.random() * 5);
    const baseFare = p.service === 'auto' ? 35 : p.service.startsWith('cab_') ? (p.service === 'cab_4' ? 60 : 90) : p.service.startsWith('parcel_') ? 30 : 25;
    const perKm = p.service === 'auto' ? 13 : p.service === 'cab_4' ? 17 : p.service === 'cab_7' ? 23 : p.service.startsWith('parcel_') ? 10 : 9;
    const fare = Math.round(baseFare + Math.max(0, distance_km - 2) * perKm);
    const commission = Math.round(fare * 0.15);
    const rider_earning = fare - commission;
    const created_at = new Date(now - p.ageMs).toISOString();
    const captain = p.withRider ? pick(captains, i) : null;

    const { data: nums } = await db.rpc('generate_order_no');
    const order_no = (nums as unknown as string) ?? `GR-DEMO-${1000 + i}`;

    const row: Record<string, unknown> = {
      order_no,
      customer_id: pick(customers, i),
      rider_id: captain?.id ?? null,
      service: p.service,
      status: p.status,
      city: 'Hyderabad',
      pickup_lat: route.pickup[0], pickup_lng: route.pickup[1], pickup_address: route.pickup[2],
      drop_lat: route.drop[0],     drop_lng: route.drop[1],     drop_address: route.drop[2],
      distance_km, duration_min,
      fare_estimate: fare,
      fare_final: p.completed ? fare : null,
      fare_breakup: { base: baseFare, distance: fare - baseFare, time: 0, surge_multiplier: 1, subtotal: fare, total: fare, min_fare: baseFare, km: distance_km, minutes: duration_min, commission, rider_earning },
      payment_method: 'cash',
      payment_status: p.completed ? 'paid' : 'pending',
      otp: String(Math.floor(1000 + Math.random() * 9000)),
      created_at,
      accepted_at:   captain ? new Date(new Date(created_at).getTime() + 60_000).toISOString() : null,
      picked_at:     p.status === 'in_transit' || p.completed ? new Date(new Date(created_at).getTime() + 5 * 60_000).toISOString() : null,
      completed_at:  p.completed ? new Date(new Date(created_at).getTime() + (duration_min + 5) * 60_000).toISOString() : null,
      cancelled_at:  p.cancelled ? new Date(new Date(created_at).getTime() + 3 * 60_000).toISOString() : null,
      cancelled_reason: p.cancelled === 'customer' ? 'Changed my mind' : p.cancelled === 'rider' ? 'Vehicle breakdown' : null,
    };
    const { data: inserted, error: insErr } = await db.from('orders').insert(row).select('id').single();
    if (insErr) continue;
    created.push(inserted.id);

    // Post transactions for completed trips
    if (p.completed && captain) {
      await db.from('transactions').insert([
        { order_id: inserted.id, rider_id: captain.id, type: 'trip_earning', amount: rider_earning, note: 'Trip completed' },
        { order_id: inserted.id, rider_id: captain.id, type: 'commission',   amount: -commission,   note: 'Platform commission' },
      ]);
    }
  }

  return c.json({
    ok: true,
    captains: captains.length,
    customers: customers.length,
    orders: created.length,
    note: 'Refresh Dashboard / Live map / Orders to see the seeded data.',
  });
});

// Purge everything created by seed-demo.
adminRoute.post('/dev/purge-demo', async (c) => {
  const db = admin(c.env);
  const { data: profiles } = await db.from('profiles').select('id').ilike('email', `%${DEMO_EMAIL_SUFFIX}`);
  const ids = (profiles ?? []).map((p) => p.id);
  if (ids.length === 0) return c.json({ ok: true, deleted: 0, note: 'Nothing to purge' });

  // Delete order + trans + rider chain
  const { data: orders } = await db.from('orders').select('id').in('customer_id', ids);
  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length > 0) {
    await db.from('transactions').delete().in('order_id', orderIds);
    await db.from('job_offers').delete().in('order_id', orderIds);
    await db.from('rider_locations').delete().in('order_id', orderIds);
    await db.from('orders').delete().in('id', orderIds);
  }
  await db.from('riders').delete().in('id', ids);
  await db.from('profiles').delete().in('id', ids);
  // Delete auth users (cascade would normally do this via profile FK, but be
  // explicit — profiles.id references auth.users)
  for (const id of ids) {
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
  return c.json({ ok: true, deleted: ids.length, orders: orderIds.length });
});

export default adminRoute;
