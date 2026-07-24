import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin } from '../lib/supabase';
import { onboardRiderBody } from '../lib/schemas';
import { wakePendingForRider } from '../lib/dispatch';
import type { z } from 'zod';

const riders = new Hono<AppEnv>();

async function parse<T extends z.ZodTypeAny>(c: any, s: T) {
  try {
    return s.parse(await c.req.json());
  } catch {
    return null;
  }
}

// Called after signup — user provides vehicle details, becomes rider role, KYC pending.
riders.post('/onboard', requireAuth, async (c) => {
  const body = await parse(c, onboardRiderBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);
  await db.from('profiles').update({ role: 'rider' }).eq('id', uid);
  const { error } = await db.from('riders').insert({
    id: uid,
    vehicle_type: body.vehicle_type,
    vehicle_number: body.vehicle_number,
    vehicle_model: body.vehicle_model,
    license_number: body.license_number,
    city: body.city,
    kyc: 'pending',
  });
  if (error && !error.message.includes('duplicate')) {
    return c.json({ error: { code: 'insert_failed', message: error.message } }, 500);
  }
  return c.json({ ok: true });
});

riders.post('/online', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const body = await c.req.json().catch(() => ({} as { lat?: number; lng?: number }));
  const { data } = await admin(c.env).from('riders').select('kyc, city, vehicle_type').eq('id', uid).maybeSingle();
  if (data?.kyc !== 'approved') {
    return c.json({ error: { code: 'kyc_required', message: 'Awaiting KYC approval' } }, 403);
  }
  const patch: Record<string, unknown> = { status: 'online', last_seen: new Date().toISOString() };
  if (typeof body.lat === 'number' && typeof body.lng === 'number') {
    patch.last_lat = body.lat;
    patch.last_lng = body.lng;
  }
  await admin(c.env).from('riders').update(patch).eq('id', uid);

  // Instantly offer any recent pending orders in the rider's city. Fires
  // in the background so the response doesn't block; the client will pick
  // up the resulting offers via the realtime channel + poll fallback.
  if (data?.city && data?.vehicle_type) {
    c.executionCtx.waitUntil(
      wakePendingForRider(c.env, uid, data.city, data.vehicle_type).catch((e) =>
        console.warn('wakePendingForRider', e),
      ),
    );
  }
  return c.json({ ok: true });
});

riders.post('/offline', requireAuth, requireRole('rider'), async (c) => {
  await admin(c.env).from('riders').update({ status: 'offline' }).eq('id', c.get('userId')!);
  return c.json({ ok: true });
});

// Legacy earnings endpoint — kept for older client versions.
riders.get('/earnings', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data } = await admin(c.env)
    .from('transactions')
    .select('type, amount, created_at, order_id')
    .eq('rider_id', uid)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  return c.json({ transactions: data ?? [] });
});

// Earnings summary — today / this week / this month + last 30 day timeline.
// Uses a single transactions read since RLS + the rider_id filter is cheap.
riders.get('/earnings/summary', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const now = new Date();
  // 30-day window covers all three summary periods.
  const since = new Date(now.getTime() - 30 * 86400_000);
  const { data } = await admin(c.env)
    .from('transactions')
    .select('type, amount, created_at, order_id')
    .eq('rider_id', uid)
    .gte('created_at', since.toISOString());
  const rows = data ?? [];

  // Time bucket boundaries
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = now.getDay(); // Sun=0 … Sat=6 — pick Monday-based week
  const daysSinceMonday = (day + 6) % 7;
  const startOfWeek = startOfToday - daysSinceMonday * 86400_000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let earningToday = 0, earningWeek = 0, earningMonth = 0, earning30d = 0;
  let commissionToday = 0, commissionWeek = 0, commissionMonth = 0;
  let tripsToday = 0, tripsWeek = 0, tripsMonth = 0;
  const perDay = new Map<string, number>();
  const perDayTrips = new Map<string, number>();

  for (const r of rows) {
    const ts = new Date(r.created_at).getTime();
    const amount = Number(r.amount);
    if (r.type === 'trip_earning') {
      earning30d += amount;
      if (ts >= startOfMonth) earningMonth += amount;
      if (ts >= startOfWeek) earningWeek += amount;
      if (ts >= startOfToday) earningToday += amount;
      if (ts >= startOfMonth) tripsMonth++;
      if (ts >= startOfWeek) tripsWeek++;
      if (ts >= startOfToday) tripsToday++;
      const dayKey = new Date(r.created_at).toISOString().slice(0, 10);
      perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + amount);
      perDayTrips.set(dayKey, (perDayTrips.get(dayKey) ?? 0) + 1);
    } else if (r.type === 'commission') {
      // commissions are stored negative
      if (ts >= startOfMonth) commissionMonth += Math.abs(amount);
      if (ts >= startOfWeek) commissionWeek += Math.abs(amount);
      if (ts >= startOfToday) commissionToday += Math.abs(amount);
    }
  }

  // Emit last 14 days ordered ascending so the client can render a bar chart.
  const timeline: Array<{ date: string; earning: number; trips: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(startOfToday - i * 86400_000).toISOString().slice(0, 10);
    timeline.push({ date: d, earning: Math.round((perDay.get(d) ?? 0) * 100) / 100, trips: perDayTrips.get(d) ?? 0 });
  }

  return c.json({
    today:      { earning: round2(earningToday),  commission: round2(commissionToday),  trips: tripsToday  },
    this_week:  { earning: round2(earningWeek),   commission: round2(commissionWeek),   trips: tripsWeek   },
    this_month: { earning: round2(earningMonth),  commission: round2(commissionMonth),  trips: tripsMonth  },
    last_30d_earning: round2(earning30d),
    timeline,
  });
});

// Detailed trip list for the earnings ledger view.
riders.get('/earnings/trips', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') ?? '30', 10)));
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const db = admin(c.env);
  // Join transactions → orders to get pickup/drop addresses and total fare
  const { data: txns } = await db
    .from('transactions')
    .select('id, type, amount, created_at, order_id, orders(id, order_no, service, pickup_address, drop_address, fare_final, distance_km, completed_at, payment_method)')
    .eq('rider_id', uid)
    .in('type', ['trip_earning', 'commission'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);

  // Fold per-order: sum trip_earning and commission into one row each.
  interface TripRow {
    order_id: string;
    order_no?: string;
    service?: string;
    pickup?: string;
    drop?: string;
    fare?: number;
    distance_km?: number;
    payment_method?: string;
    earning: number;
    commission: number;
    completed_at?: string;
  }
  const byOrder = new Map<string, TripRow>();
  for (const t of txns ?? []) {
    const oid = t.order_id;
    if (!oid) continue;
    const row: TripRow = byOrder.get(oid) ?? { order_id: oid, earning: 0, commission: 0 };
    // Supabase-js returns joined single-row 'orders' as an array in some versions.
    const o = Array.isArray(t.orders) ? t.orders[0] : t.orders;
    if (o) {
      row.order_no       = o.order_no;
      row.service        = o.service;
      row.pickup         = o.pickup_address;
      row.drop           = o.drop_address;
      row.fare           = o.fare_final ?? undefined;
      row.distance_km    = o.distance_km ?? undefined;
      row.payment_method = o.payment_method;
      row.completed_at   = o.completed_at ?? row.completed_at;
    }
    if (t.type === 'trip_earning') row.earning    += Number(t.amount);
    if (t.type === 'commission')   row.commission += Math.abs(Number(t.amount));
    byOrder.set(oid, row);
  }
  const trips = Array.from(byOrder.values())
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  return c.json({ trips });
});

// CSV export for personal records / tax purposes.
riders.get('/earnings.csv', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const days = Math.min(365, Math.max(1, parseInt(c.req.query('days') ?? '90', 10)));
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data: txns } = await admin(c.env)
    .from('transactions')
    .select('type, amount, created_at, order_id, orders(order_no, service, pickup_address, drop_address, fare_final, distance_km, payment_method)')
    .eq('rider_id', uid)
    .in('type', ['trip_earning', 'commission'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10_000);

  const cols = ['date', 'order_no', 'service', 'pickup', 'drop', 'distance_km', 'fare', 'payment', 'earning', 'commission'];
  type CsvRow = Record<string, unknown> & { earning: number; commission: number };
  const byOrder = new Map<string, CsvRow>();
  for (const t of txns ?? []) {
    const oid = t.order_id;
    if (!oid) continue;
    const row: CsvRow = byOrder.get(oid) ?? { earning: 0, commission: 0 };
    const o = Array.isArray(t.orders) ? t.orders[0] : t.orders;
    if (o) {
      row.date        = new Date(t.created_at).toISOString().slice(0, 10);
      row.order_no    = o.order_no;
      row.service     = o.service;
      row.pickup      = o.pickup_address;
      row.drop        = o.drop_address;
      row.distance_km = o.distance_km;
      row.fare        = o.fare_final;
      row.payment     = o.payment_method;
    }
    if (t.type === 'trip_earning') row.earning    += Number(t.amount);
    if (t.type === 'commission')   row.commission += Math.abs(Number(t.amount));
    byOrder.set(oid, row);
  }
  const rows = Array.from(byOrder.values());
  const csvCell = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map(csvCell).join(',');
  const body = rows.map((r) => cols.map((k) => csvCell(r[k])).join(',')).join('\n');
  return new Response(header + '\n' + body + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="goride-earnings-${new Date().toISOString().slice(0,10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

function round2(n: number): number { return Math.round(n * 100) / 100; }

// Captain's own payout history — most recent first.
riders.get('/payouts', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const { data } = await admin(c.env)
    .from('payouts')
    .select('id, period_start, period_end, gross, commission, net, trips, status, bank_ref, note, paid_at, created_at')
    .eq('rider_id', uid)
    .order('period_start', { ascending: false })
    .limit(52);
  return c.json({ payouts: data ?? [] });
});

// Pending offers for me (fallback if realtime missed)
riders.get('/offers', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const now = new Date().toISOString();
  const { data } = await admin(c.env)
    .from('job_offers')
    .select('order_id, offered_at, expires_at, orders(*)')
    .eq('rider_id', uid)
    .is('response', null)
    .gte('expires_at', now)
    .order('offered_at', { ascending: false });
  return c.json({ offers: data ?? [] });
});

export default riders;
