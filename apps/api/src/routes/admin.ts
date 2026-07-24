import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin, broadcast } from '../lib/supabase';
import {
  rateCardBody,
  refundBody,
  promoUpsertBody,
  walletCreditBody,
  restaurantUpsertBody,
  menuItemUpsertBody,
  markPayoutPaidBody,
  runPayoutsBody,
  cityUpsertBody,
  cloneRateCardsBody,
  supportMessageBody,
  adminUpdateTicketBody,
} from '../lib/schemas';
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

// GET /admin/ops-dashboard — one consolidated payload for the control tower
// view. Everything the admin Dashboard needs in one fetch to keep the
// 15-second refresh cheap.
adminRoute.get('/ops-dashboard', async (c) => {
  const db = admin(c.env);
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const dayAgo = new Date(Date.now() - 24 * 3600_000);

  const [
    { count: onlineRiders },
    { count: onTripRiders },
    { count: activeOrders },
    { count: searchingOrders },
    { data: today },
    { count: failedToday },
    { count: cancelledToday },
    { count: openTickets },
    { count: awaitingTickets },
    { count: pendingPayouts },
    { data: pendingPayoutSum },
    { data: surgeCards },
    { data: recentActive },
    { data: liveCaptains },
    { data: recentCancels },
    { data: last24hOrders },
  ] = await Promise.all([
    db.from('riders').select('id', { count: 'exact', head: true }).eq('status', 'online'),
    db.from('riders').select('id', { count: 'exact', head: true }).eq('status', 'on_trip'),
    db.from('orders').select('id', { count: 'exact', head: true }).in('status', ['accepted', 'arrived', 'picked_up', 'in_transit']),
    db.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'searching'),
    db.from('orders').select('fare_final').in('status', ['completed', 'delivered']).gte('completed_at', startOfToday.toISOString()),
    db.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'no_rider_found').gte('created_at', startOfToday.toISOString()),
    db.from('orders').select('id', { count: 'exact', head: true }).in('status', ['cancelled_customer', 'cancelled_rider']).gte('created_at', startOfToday.toISOString()),
    db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'awaiting_customer'),
    db.from('payouts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('payouts').select('net').eq('status', 'pending'),
    db.from('rate_cards').select('city, service, surge_multiplier, auto_surge').eq('active', true).gt('surge_multiplier', 1.0),
    db.from('orders').select('id, order_no, service, status, city, pickup_address, drop_address, fare_estimate, created_at, accepted_at')
      .in('status', ['searching', 'accepted', 'arrived', 'picked_up', 'in_transit'])
      .order('created_at', { ascending: false }).limit(10),
    db.from('riders').select('id, city, vehicle_type, status, last_lat, last_lng, last_seen, profiles!inner(full_name)')
      .in('status', ['online', 'on_trip'])
      .order('last_seen', { ascending: false }).limit(10),
    db.from('orders').select('id, order_no, service, status, cancelled_reason, cancelled_at, fare_estimate')
      .in('status', ['cancelled_customer', 'cancelled_rider'])
      .order('cancelled_at', { ascending: false }).limit(5),
    db.from('orders').select('created_at, status')
      .gte('created_at', dayAgo.toISOString())
      .limit(5000),
  ]);

  const revenueToday   = (today ?? []).reduce((s, o) => s + Number(o.fare_final ?? 0), 0);
  const pendingPayable = (pendingPayoutSum ?? []).reduce((s, p) => s + Number(p.net ?? 0), 0);

  // 24-hour orders histogram, 24 buckets of 1h ending "now".
  const buckets = new Array<{ hour: string; total: number; failed: number; cancelled: number }>(24);
  const nowMs = Date.now();
  for (let i = 23; i >= 0; i--) {
    const endMs = nowMs - i * 3600_000;
    buckets[23 - i] = { hour: new Date(endMs).toISOString().slice(11, 13) + ':00', total: 0, failed: 0, cancelled: 0 };
  }
  for (const o of last24hOrders ?? []) {
    const hoursAgo = Math.floor((nowMs - new Date(o.created_at).getTime()) / 3600_000);
    if (hoursAgo < 0 || hoursAgo > 23) continue;
    const idx = 23 - hoursAgo;
    const b = buckets[idx]!;
    b.total++;
    if (o.status === 'no_rider_found') b.failed++;
    if (o.status === 'cancelled_customer' || o.status === 'cancelled_rider') b.cancelled++;
  }

  return c.json({
    kpi: {
      online_riders:      onlineRiders    ?? 0,
      on_trip_riders:     onTripRiders    ?? 0,
      active_orders:      activeOrders    ?? 0,
      searching_orders:   searchingOrders ?? 0,
      revenue_today:      Math.round(revenueToday),
      failed_today:       failedToday     ?? 0,
      cancelled_today:    cancelledToday  ?? 0,
      open_tickets:       openTickets     ?? 0,
      awaiting_tickets:   awaitingTickets ?? 0,
      pending_payouts:    pendingPayouts  ?? 0,
      pending_payable:    Math.round(pendingPayable),
      surge_hot_cards:    (surgeCards ?? []).length,
    },
    surge:             surgeCards      ?? [],
    active_orders:     recentActive    ?? [],
    live_captains:     liveCaptains    ?? [],
    recent_cancels:    recentCancels   ?? [],
    orders_24h:        buckets,
  });
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

// ---- Promo codes ----
adminRoute.get('/promos', async (c) => {
  const { data } = await admin(c.env)
    .from('promo_codes')
    .select('id, code, description, discount_type, discount_value, max_discount, min_order, applies_to, valid_from, valid_until, usage_limit_per_user, total_usage_limit, times_used, active, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  return c.json({ promos: data ?? [] });
});

adminRoute.post('/promos', async (c) => {
  const body = await parse(c, promoUpsertBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const payload = { ...body, code: body.code.trim().toUpperCase() };
  const db = admin(c.env);
  const { id, ...upsert } = payload;
  const query = id
    ? db.from('promo_codes').update(upsert).eq('id', id).select().single()
    : db.from('promo_codes').insert(upsert).select().single();
  const { data, error } = await query;
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ promo: data });
});

adminRoute.delete('/promos/:id', async (c) => {
  // Soft-delete: flip active=false so historical redemptions still resolve.
  const { error } = await admin(c.env)
    .from('promo_codes')
    .update({ active: false })
    .eq('id', c.req.param('id'));
  if (error) return c.json({ error: { code: 'delete_failed', message: error.message } }, 500);
  return c.json({ ok: true });
});

// ---- Wallet admin (customer-support: credit or debit) ----
// GET /admin/wallet/:profile_id → balance + last 50 entries + profile summary
adminRoute.get('/wallet/:id', async (c) => {
  const db = admin(c.env);
  const id = c.req.param('id');
  const [{ data: profile }, { data: entries }, { data: balanceRow }] = await Promise.all([
    db.from('profiles').select('id, full_name, email, phone, referral_code, referred_by').eq('id', id).maybeSingle(),
    db.from('wallet_ledger')
      .select('id, delta, reason, order_id, note, created_at')
      .eq('profile_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    db.rpc('wallet_balance', { p_profile_id: id }),
  ]);
  if (!profile) return c.json({ error: { code: 'not_found' } }, 404);
  return c.json({ profile, balance: Number(balanceRow ?? 0), entries: entries ?? [] });
});

// POST /admin/wallet/:profile_id → credit or debit (delta signed)
adminRoute.post('/wallet/:id', async (c) => {
  const body = await parse(c, walletCreditBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const { data, error } = await admin(c.env)
    .from('wallet_ledger')
    .insert({
      profile_id: c.req.param('id'),
      delta: body.delta,
      reason: body.reason,
      note: body.note,
    })
    .select()
    .single();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ entry: data });
});

// ---- Customer lookup for wallet admin (search by email / phone / name) ----
// Small tool for customer-support: type any of email / phone / name, get the
// top 20 matches with their current wallet balance.
adminRoute.get('/profiles/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json({ profiles: [] });
  const db = admin(c.env);
  // ilike on three columns via OR filter. Supabase's PostgREST or() takes
  // comma-separated conditions.
  const like = `%${q.replace(/[%,]/g, '')}%`;
  const { data: profiles } = await db
    .from('profiles')
    .select('id, full_name, email, phone, role, referral_code, referred_by, created_at, blocked')
    .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
    .limit(20);
  if (!profiles || profiles.length === 0) return c.json({ profiles: [] });

  // Batch-fetch balances via one RPC per row (cheap at 20 max).
  const withBalance = await Promise.all(profiles.map(async (p) => {
    const { data: bal } = await db.rpc('wallet_balance', { p_profile_id: p.id });
    return { ...p, balance: Number(bal ?? 0) };
  }));
  return c.json({ profiles: withBalance });
});

// ---- Restaurants + menu items (food vertical CRUD) ----

// GET /admin/restaurants → all restaurants (active or not) + menu item counts.
adminRoute.get('/restaurants', async (c) => {
  const db = admin(c.env);
  const [{ data: restaurants }, { data: counts }] = await Promise.all([
    db.from('restaurants')
      .select('id, name, cuisine, description, address, city, lat, lng, phone, image_url, avg_prep_min, min_order, rating, active, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    db.from('menu_items')
      .select('restaurant_id, id, available')
      .limit(10_000),
  ]);
  // Compute per-restaurant counts client-side (cheap in JS, saves a group by).
  const totalBy = new Map<string, number>();
  const availBy = new Map<string, number>();
  for (const it of counts ?? []) {
    totalBy.set(it.restaurant_id, (totalBy.get(it.restaurant_id) ?? 0) + 1);
    if (it.available) availBy.set(it.restaurant_id, (availBy.get(it.restaurant_id) ?? 0) + 1);
  }
  const withCounts = (restaurants ?? []).map((r) => ({
    ...r,
    menu_item_count: totalBy.get(r.id) ?? 0,
    menu_item_available: availBy.get(r.id) ?? 0,
  }));
  return c.json({ restaurants: withCounts });
});

adminRoute.post('/restaurants', async (c) => {
  const body = await parse(c, restaurantUpsertBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const db = admin(c.env);
  const { id, ...upsert } = body;
  const query = id
    ? db.from('restaurants').update(upsert).eq('id', id).select().single()
    : db.from('restaurants').insert(upsert).select().single();
  const { data, error } = await query;
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ restaurant: data });
});

adminRoute.delete('/restaurants/:id', async (c) => {
  // Soft-delete: flip active=false so existing food orders still resolve.
  const { error } = await admin(c.env)
    .from('restaurants')
    .update({ active: false })
    .eq('id', c.req.param('id'));
  if (error) return c.json({ error: { code: 'delete_failed', message: error.message } }, 500);
  return c.json({ ok: true });
});

// GET /admin/restaurants/:id/menu → all items (including unavailable) grouped
// by category. Distinct from the public GET /food/restaurants/:id which
// only returns available items.
adminRoute.get('/restaurants/:id/menu', async (c) => {
  const db = admin(c.env);
  const rid = c.req.param('id');
  const [{ data: restaurant }, { data: items }] = await Promise.all([
    db.from('restaurants').select('*').eq('id', rid).maybeSingle(),
    db.from('menu_items')
      .select('id, restaurant_id, name, description, price, category, image_url, is_veg, available, sort_order, created_at')
      .eq('restaurant_id', rid)
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true }),
  ]);
  if (!restaurant) return c.json({ error: { code: 'not_found' } }, 404);
  return c.json({ restaurant, items: items ?? [] });
});

// POST /admin/restaurants/:id/menu → upsert an item (id present = update).
adminRoute.post('/restaurants/:id/menu', async (c) => {
  const body = await parse(c, menuItemUpsertBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  if (body.restaurant_id !== c.req.param('id')) {
    return c.json({ error: { code: 'restaurant_mismatch' } }, 400);
  }
  const db = admin(c.env);
  const { id, ...upsert } = body;
  const query = id
    ? db.from('menu_items').update(upsert).eq('id', id).select().single()
    : db.from('menu_items').insert(upsert).select().single();
  const { data, error } = await query;
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ item: data });
});

// DELETE /admin/restaurants/:id/menu/:itemId → hard delete a menu item.
// Menu items don't have downstream FKs (order food_details is a JSON snapshot
// that captures name + price at order time), so a hard delete is safe.
adminRoute.delete('/restaurants/:id/menu/:itemId', async (c) => {
  const { error } = await admin(c.env)
    .from('menu_items')
    .delete()
    .eq('id', c.req.param('itemId'))
    .eq('restaurant_id', c.req.param('id'));
  if (error) return c.json({ error: { code: 'delete_failed', message: error.message } }, 500);
  return c.json({ ok: true });
});

// ---- Restaurant partner assignment ----
// POST /admin/restaurants/:id/partner
//   { profile_id }  → promote that profile to restaurant_partner + link them
//   { unassign: true } → demote the currently-linked partner back to customer
// Uses a small SQL trick: temporarily null the restaurant_id before flipping
// role (so the CHECK constraint doesn't fire), then set both to the new
// values in one round-trip.
adminRoute.post('/restaurants/:id/partner', async (c) => {
  const rid = c.req.param('id');
  const body = await c.req.json().catch(() => null) as { profile_id?: string; unassign?: boolean } | null;
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const db = admin(c.env);

  if (body.unassign) {
    // Find the current partner(s) for this restaurant and demote them.
    const { data: current } = await db.from('profiles').select('id').eq('restaurant_id', rid).eq('role', 'restaurant_partner');
    for (const p of current ?? []) {
      // Null the FK first so the CHECK constraint doesn't fail during role change.
      await db.from('profiles').update({ restaurant_id: null }).eq('id', p.id);
      await db.from('profiles').update({ role: 'customer' }).eq('id', p.id);
    }
    return c.json({ ok: true, demoted: current?.length ?? 0 });
  }

  if (!body.profile_id) return c.json({ error: { code: 'missing_profile_id' } }, 400);

  // Confirm the profile exists and isn't already an admin (safety guardrail).
  const { data: prof } = await db.from('profiles').select('id, role').eq('id', body.profile_id).maybeSingle();
  if (!prof) return c.json({ error: { code: 'profile_not_found' } }, 404);
  if (prof.role === 'admin') {
    return c.json({ error: { code: 'admin_cannot_be_partner', message: "Admins can't also be restaurant partners" } }, 400);
  }

  // Two-step: role first (must clear existing restaurant_id if any), then FK.
  // The CHECK requires them to move together. We use an UPDATE with both in
  // one statement — the constraint is evaluated at statement end, so
  // simultaneous assignment is legal.
  const { error } = await db
    .from('profiles')
    .update({ role: 'restaurant_partner', restaurant_id: rid })
    .eq('id', body.profile_id);
  if (error) return c.json({ error: { code: 'assign_failed', message: error.message } }, 500);
  return c.json({ ok: true });
});

// GET /admin/restaurants/:id/partner  → the currently-linked partner (or null)
adminRoute.get('/restaurants/:id/partner', async (c) => {
  const { data } = await admin(c.env)
    .from('profiles')
    .select('id, full_name, email, phone, created_at')
    .eq('restaurant_id', c.req.param('id'))
    .eq('role', 'restaurant_partner')
    .maybeSingle();
  return c.json({ partner: data ?? null });
});

// ---- Support ticket admin ----
// GET /admin/support/tickets?status=open|assigned|awaiting_customer|resolved|all
//                            &mine=1 (only mine when assigned_to = me)
adminRoute.get('/support/tickets', async (c) => {
  const status = c.req.query('status') ?? 'open';
  const mine   = c.req.query('mine') === '1';
  const uid    = c.get('userId')!;
  const db = admin(c.env);

  let q = db.from('support_tickets')
    .select('id, subject, status, priority, order_id, assigned_to, customer_id, created_at, updated_at, closed_at, profiles!support_tickets_customer_id_fkey(full_name, email, phone)')
    .order('updated_at', { ascending: false })
    .limit(500);
  if (status !== 'all')   q = q.eq('status', status);
  if (mine)               q = q.eq('assigned_to', uid);

  const { data } = await q;
  return c.json({ tickets: data ?? [] });
});

// GET /admin/support/tickets/:id — ticket + messages + customer profile.
// Also marks customer-sent messages as read by agent.
adminRoute.get('/support/tickets/:id', async (c) => {
  const db = admin(c.env);
  const tid = c.req.param('id');
  const [{ data: ticket }, { data: messages }] = await Promise.all([
    db.from('support_tickets')
      .select('id, subject, status, priority, order_id, assigned_to, customer_id, created_at, updated_at, closed_at, profiles!support_tickets_customer_id_fkey(full_name, email, phone)')
      .eq('id', tid)
      .maybeSingle(),
    db.from('support_messages')
      .select('id, sender_role, sender_id, body, read_by_customer_at, read_by_agent_at, created_at')
      .eq('ticket_id', tid)
      .order('created_at', { ascending: true })
      .limit(500),
  ]);
  if (!ticket) return c.json({ error: { code: 'not_found' } }, 404);

  // Mark customer messages read by agent (best-effort).
  await db.from('support_messages')
    .update({ read_by_agent_at: new Date().toISOString() })
    .eq('ticket_id', tid)
    .eq('sender_role', 'customer')
    .is('read_by_agent_at', null);

  return c.json({ ticket, messages: messages ?? [] });
});

// PATCH /admin/support/tickets/:id — set status / priority / assignment.
// Setting status=resolved stamps closed_at. Setting assigned_to='me' picks
// the caller up as the agent.
adminRoute.patch('/support/tickets/:id', async (c) => {
  const body = await parse(c, adminUpdateTicketBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;

  const patch: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() };
  if (body.status === 'resolved') patch.closed_at = new Date().toISOString();
  if (body.status && body.status !== 'resolved') patch.closed_at = null;
  // Auto-promote 'open' → 'assigned' when someone picks it up.
  if (body.assigned_to && !body.status) {
    patch.status = 'assigned';
  }

  const { data, error } = await admin(c.env)
    .from('support_tickets')
    .update(patch)
    .eq('id', c.req.param('id'))
    .select('id, status, assigned_to, customer_id')
    .maybeSingle();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  if (!data) return c.json({ error: { code: 'not_found' } }, 404);

  // Broadcast to the customer so their inbox sees the status change instantly.
  c.executionCtx.waitUntil(
    broadcast(c.env, `ticket:${data.id}`, 'status', { status: data.status }).catch(() => {}),
  );

  // Return the updated row with the effective agent name (if any).
  void uid; // silences unused warning when no assignment
  return c.json({ ticket: data });
});

// POST /admin/support/tickets/:id/messages — admin sends a reply.
// Auto-flips ticket status to 'awaiting_customer' unless it was resolved.
adminRoute.post('/support/tickets/:id/messages', async (c) => {
  const body = await parse(c, supportMessageBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const tid = c.req.param('id');

  const { data: ticket } = await db
    .from('support_tickets')
    .select('id, status, customer_id, assigned_to')
    .eq('id', tid)
    .maybeSingle();
  if (!ticket) return c.json({ error: { code: 'not_found' } }, 404);
  if (ticket.status === 'resolved') {
    return c.json({ error: { code: 'ticket_resolved' } }, 409);
  }

  const { data: msg, error } = await db
    .from('support_messages')
    .insert({
      ticket_id: tid,
      sender_role: 'admin',
      sender_id: uid,
      body: body.body.trim(),
    })
    .select('id, sender_role, sender_id, body, read_by_customer_at, read_by_agent_at, created_at')
    .single();
  if (error || !msg) return c.json({ error: { code: 'insert_failed', message: error?.message } }, 500);

  // If the ticket wasn't already assigned, self-assign on first reply.
  // Flip status to 'awaiting_customer' so the queue chip shows "we've replied".
  const updates: Record<string, unknown> = { status: 'awaiting_customer' };
  if (!ticket.assigned_to) updates.assigned_to = uid;
  await db.from('support_tickets').update(updates).eq('id', tid);

  // Broadcasts: to the live thread + a lightweight per-user ping for the
  // customer's inbox badge.
  c.executionCtx.waitUntil(broadcast(c.env, `ticket:${tid}`, 'message', msg).catch(() => {}));
  c.executionCtx.waitUntil(
    broadcast(c.env, `customer:${ticket.customer_id}`, 'ticket_message', { ticket_id: tid, preview: msg.body.slice(0, 80) }).catch(() => {}),
  );

  return c.json({ message: msg });
});

// GET /admin/support/counts — small badge counts for the sidebar.
adminRoute.get('/support/counts', async (c) => {
  const db = admin(c.env);
  const [{ count: open }, { count: assigned }, { count: awaiting }] = await Promise.all([
    db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'assigned'),
    db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'awaiting_customer'),
  ]);
  return c.json({ open: open ?? 0, assigned: assigned ?? 0, awaiting_customer: awaiting ?? 0 });
});

// ---- Google Maps Platform health check ----
// Runs one live probe against each Google API we integrate. Returns per-API
// status + latency + a short response sample so admin can verify the key
// works, credits are healthy, and the fallback isn't silently kicking in.
adminRoute.get('/dev/google-health', async (c) => {
  const env = c.env;
  const configured = !!env.GOOGLE_MAPS_API_KEY;
  if (!configured) {
    return c.json({
      configured: false,
      message: 'GOOGLE_MAPS_API_KEY is not set. Every call in geo.ts is falling back to the OSM stack.',
      checks: [],
    });
  }

  const { googleAutocomplete, googleReverse, googleRoute, googleRouteMatrix } = await import('../lib/google');

  // Hyderabad Charminar → HITEC City — a real 12km inter-city route.
  const origin = { lat: 17.3616, lng: 78.4747 };  // Charminar
  const dest   = { lat: 17.4487, lng: 78.3838 };  // HITEC City

  async function probe(name: string, fn: () => Promise<unknown>) {
    const started = Date.now();
    try {
      const result = await fn();
      return { name, ok: true, ms: Date.now() - started, sample: summarise(result) };
    } catch (e) {
      return { name, ok: false, ms: Date.now() - started, error: (e as Error).message };
    }
  }

  // Run all probes in parallel to keep the whole health check under ~2s.
  const [autocomplete, reverse, routeCheck, matrix] = await Promise.all([
    probe('places_autocomplete', () => googleAutocomplete(env, 'Paradise Biryani Hyderabad', 'in')),
    probe('reverse_geocoding',   () => googleReverse(env, origin.lat, origin.lng)),
    probe('routes_v2',           () => googleRoute(env, origin, dest)),
    probe('route_matrix',        () => googleRouteMatrix(env, [origin, dest], [dest])),
  ]);

  const checks = [autocomplete, reverse, routeCheck, matrix];
  const anyFailed = checks.some((c) => !c.ok);

  return c.json({
    configured: true,
    all_ok: !anyFailed,
    message: anyFailed
      ? 'One or more Google APIs failed. Check the Google Cloud Console → APIs & Services → Enabled APIs. Any check that failed is currently using the OSM fallback in production.'
      : 'All Google APIs healthy. Autocomplete + Geocoding + Routes + Matrix all responded.',
    checks,
  });
});

function summarise(v: unknown): unknown {
  if (Array.isArray(v)) return { count: v.length, first: v[0] };
  if (typeof v === 'object' && v !== null) {
    // Show at most 4 keys so the response stays small.
    const entries = Object.entries(v).slice(0, 4);
    return Object.fromEntries(entries);
  }
  return v;
}

// ---- SOS emergency queue ----
// GET /admin/sos?status=open|acknowledged|resolved|all — most recent first.
adminRoute.get('/sos', async (c) => {
  const status = c.req.query('status') ?? 'open';
  let q = admin(c.env)
    .from('sos_alerts')
    .select('id, profile_id, role, order_id, lat, lng, note, status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution_note, created_at, profiles!sos_alerts_profile_id_fkey(full_name, phone, email)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status === 'active') q = q.in('status', ['open', 'acknowledged']);
  else if (status !== 'all') q = q.eq('status', status);
  const { data } = await q;
  return c.json({ alerts: data ?? [] });
});

// POST /admin/sos/:id/acknowledge — first-responder marks they're on it.
adminRoute.post('/sos/:id/acknowledge', async (c) => {
  const uid = c.get('userId')!;
  const { data, error } = await admin(c.env)
    .from('sos_alerts')
    .update({ status: 'acknowledged', acknowledged_by: uid, acknowledged_at: new Date().toISOString() })
    .eq('id', c.req.param('id'))
    .eq('status', 'open')
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  if (!data) return c.json({ error: { code: 'not_found_or_taken' } }, 404);
  return c.json({ id: data.id, status: 'acknowledged' });
});

const resolveBody = { note: '' } as const;
// POST /admin/sos/:id/resolve  — { note?, false_alarm? }
adminRoute.post('/sos/:id/resolve', async (c) => {
  const body = await c.req.json().catch(() => null) as { note?: string; false_alarm?: boolean } | null;
  const uid = c.get('userId')!;
  const status = body?.false_alarm ? 'false_alarm' : 'resolved';
  const { data, error } = await admin(c.env)
    .from('sos_alerts')
    .update({
      status,
      resolved_by: uid,
      resolved_at: new Date().toISOString(),
      resolution_note: (body?.note ?? '').trim() || null,
    })
    .eq('id', c.req.param('id'))
    .in('status', ['open', 'acknowledged'])
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  if (!data) return c.json({ error: { code: 'not_found_or_resolved' } }, 404);
  void resolveBody;
  return c.json({ id: data.id, status });
});

// GET /admin/sos/counts — small badge for the sidebar.
adminRoute.get('/sos/counts', async (c) => {
  const db = admin(c.env);
  const [{ count: open }, { count: ack }] = await Promise.all([
    db.from('sos_alerts').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('sos_alerts').select('id', { count: 'exact', head: true }).eq('status', 'acknowledged'),
  ]);
  return c.json({ open: open ?? 0, acknowledged: ack ?? 0 });
});

// ---- Dynamic surge ----
// GET /admin/surge/current — latest snapshot per (city, service) from the
// history table + current rate_cards state so admin sees both.
adminRoute.get('/surge/current', async (c) => {
  const db = admin(c.env);
  const [{ data: cards }, { data: recent }] = await Promise.all([
    db.from('rate_cards')
      .select('id, city, service, surge_multiplier, auto_surge, surge_multiplier_floor, surge_multiplier_cap, active')
      .eq('active', true)
      .order('city').order('service'),
    // Most-recent-per-group is easiest via one recent-window fetch client-side.
    db.from('surge_history')
      .select('city, service, multiplier, active_riders, pending_orders, computed_at')
      .gte('computed_at', new Date(Date.now() - 60 * 60_000).toISOString())
      .order('computed_at', { ascending: false })
      .limit(2000),
  ]);
  const latest = new Map<string, { multiplier: number; active_riders: number; pending_orders: number; computed_at: string }>();
  for (const h of recent ?? []) {
    const key = `${h.city}::${h.service}`;
    if (!latest.has(key)) latest.set(key, h);
  }
  const enriched = (cards ?? []).map((rc) => ({
    ...rc,
    latest: latest.get(`${rc.city}::${rc.service}`) ?? null,
  }));
  return c.json({ cards: enriched });
});

// GET /admin/surge/history?city=&service=&hours=24 — timeline for the chart.
adminRoute.get('/surge/history', async (c) => {
  const city    = c.req.query('city');
  const service = c.req.query('service');
  const hours   = Math.min(168, Math.max(1, parseInt(c.req.query('hours') ?? '24', 10)));
  if (!city || !service) return c.json({ error: { code: 'bad_request' } }, 400);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data } = await admin(c.env)
    .from('surge_history')
    .select('multiplier, active_riders, pending_orders, computed_at')
    .eq('city', city)
    .eq('service', service)
    .gte('computed_at', since)
    .order('computed_at', { ascending: true })
    .limit(5_000);
  return c.json({ points: data ?? [] });
});

// POST /admin/surge/run — kick a recompute now instead of waiting for the cron.
adminRoute.post('/surge/run', async (c) => {
  const { data, error } = await admin(c.env).rpc('run_surge');
  if (error) return c.json({ error: { code: 'run_failed', message: error.message } }, 500);
  return c.json({ updated: Number(data ?? 0) });
});

// ---- Cities / service areas ----
// GET /admin/cities — all cities (active + inactive) with rate-card count
adminRoute.get('/cities', async (c) => {
  const db = admin(c.env);
  const [{ data: cities }, { data: cards }] = await Promise.all([
    db.from('service_areas')
      .select('id, city, display_name, country, timezone, center_lat, center_lng, radius_km, polygon, active, created_at')
      .order('city', { ascending: true }),
    db.from('rate_cards').select('city, active').limit(10_000),
  ]);
  const counts = new Map<string, { total: number; active: number }>();
  for (const rc of cards ?? []) {
    const c = counts.get(rc.city) ?? { total: 0, active: 0 };
    c.total++;
    if (rc.active) c.active++;
    counts.set(rc.city, c);
  }
  const enriched = (cities ?? []).map((r) => ({
    ...r,
    rate_card_count:  counts.get(r.city)?.total  ?? 0,
    rate_card_active: counts.get(r.city)?.active ?? 0,
  }));
  return c.json({ cities: enriched });
});

adminRoute.post('/cities', async (c) => {
  const body = await parse(c, cityUpsertBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const db = admin(c.env);
  const { id, ...upsert } = body;
  const query = id
    ? db.from('service_areas').update(upsert).eq('id', id).select().single()
    : db.from('service_areas').insert(upsert).select().single();
  const { data, error } = await query;
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ city: data });
});

adminRoute.delete('/cities/:id', async (c) => {
  // Soft-delete: flip active=false so existing orders + rate cards keep
  // resolving. If someone later wants a permanent hard delete, that's
  // an admin SQL job.
  const { error } = await admin(c.env).from('service_areas').update({ active: false }).eq('id', c.req.param('id'));
  if (error) return c.json({ error: { code: 'delete_failed', message: error.message } }, 500);
  return c.json({ ok: true });
});

// POST /admin/cities/clone-rate-cards — copies rate_cards from one city to another.
// Useful when bootstrapping a new city: clone Hyderabad's cards, tweak
// per-service pricing after. onConflict on (city, service) means re-running
// is a no-op unless `overwrite=true`.
adminRoute.post('/cities/clone-rate-cards', async (c) => {
  const body = await parse(c, cloneRateCardsBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  if (body.from_city === body.to_city) return c.json({ error: { code: 'same_city' } }, 400);

  const db = admin(c.env);
  const { data: cards } = await db
    .from('rate_cards')
    .select('service, base_fare, base_km, per_km, per_min, min_fare, surge_multiplier, commission_pct, parcel_weight_limit_kg, active')
    .eq('city', body.from_city);
  if (!cards || cards.length === 0) {
    return c.json({ error: { code: 'source_empty', message: `No rate cards found for ${body.from_city}` } }, 404);
  }
  const rows = cards.map((rc) => ({ ...rc, city: body.to_city }));
  const query = body.overwrite
    ? db.from('rate_cards').upsert(rows, { onConflict: 'city,service' })
    : db.from('rate_cards').insert(rows).select('id');
  // On non-overwrite mode a duplicate-key error is expected — swallow it and count what we got.
  const { error, count } = await query;
  if (error && !body.overwrite && !/duplicate|unique/i.test(error.message)) {
    return c.json({ error: { code: 'clone_failed', message: error.message } }, 500);
  }
  return c.json({ created: count ?? rows.length, from: body.from_city, to: body.to_city });
});

// ---- Payouts ----
// GET /admin/payouts?status=pending|paid|all — list of payouts with the
// rider's profile joined so the table can show a name. Defaults to pending
// because that's the queue that needs action.
adminRoute.get('/payouts', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  let q = admin(c.env)
    .from('payouts')
    .select('id, rider_id, period_start, period_end, gross, commission, net, trips, status, bank_ref, note, paid_at, created_at, riders(vehicle_number, vehicle_type, profiles!inner(full_name, email, phone))')
    .order('period_start', { ascending: false })
    .limit(500);
  if (status !== 'all') q = q.eq('status', status);
  const { data } = await q;
  return c.json({ payouts: data ?? [] });
});

// POST /admin/payouts/run — manually kick a run (defaults to the previous
// week window). Idempotent thanks to (rider_id, period_start, period_end)
// unique constraint and the payout_transactions.transaction_id unique idx.
adminRoute.post('/payouts/run', async (c) => {
  const body = await parse(c, runPayoutsBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const { data, error } = await admin(c.env).rpc('run_payouts', {
    p_from: body.from ?? null,
    p_to:   body.to   ?? null,
  });
  if (error) return c.json({ error: { code: 'run_failed', message: error.message } }, 500);
  return c.json({ created: Number(data ?? 0) });
});

// POST /admin/payouts/:id/mark-paid — record bank_ref + flip status to paid.
adminRoute.post('/payouts/:id/mark-paid', async (c) => {
  const body = await parse(c, markPayoutPaidBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const { data, error } = await admin(c.env)
    .from('payouts')
    .update({
      status: 'paid',
      bank_ref: body.bank_ref,
      note: body.note ?? null,
      paid_at: new Date().toISOString(),
      paid_by: uid,
    })
    .eq('id', c.req.param('id'))
    .eq('status', 'pending')   // guard: don't re-pay an already-paid one
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  if (!data) return c.json({ error: { code: 'not_found_or_already_paid' } }, 404);
  return c.json({ id: data.id, status: 'paid' });
});

// POST /admin/payouts/:id/cancel — soft-cancel a payout (rare — mistaken run).
// The linked payout_transactions rows are removed by the cascade, freeing
// those transactions for the next run.
adminRoute.post('/payouts/:id/cancel', async (c) => {
  const { data, error } = await admin(c.env)
    .from('payouts')
    .update({ status: 'cancelled' })
    .eq('id', c.req.param('id'))
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  if (!data) return c.json({ error: { code: 'not_found_or_already_paid' } }, 404);
  // Delete the junction so those transactions can be paid in a future run.
  await admin(c.env).from('payout_transactions').delete().eq('payout_id', data.id);
  return c.json({ id: data.id, status: 'cancelled' });
});

// GET /admin/payouts/:id/transactions — the trip-level breakdown of a payout.
adminRoute.get('/payouts/:id/transactions', async (c) => {
  const { data } = await admin(c.env)
    .from('payout_transactions')
    .select('transaction_id, transactions!inner(id, type, amount, created_at, order_id, orders(order_no, service, pickup_address, drop_address, distance_km, fare_final))')
    .eq('payout_id', c.req.param('id'));
  return c.json({ items: data ?? [] });
});

export default adminRoute;
