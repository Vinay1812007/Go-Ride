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

// GET /riders/leaderboard?metric=earnings|trips&period=week|month&city=
//
// Top 20 captains by the chosen metric in the chosen period. If the caller
// is a captain and outside the top 20, also returns their own rank.
// Privacy: display name is first name + last initial ("Vinay K.") — full
// names would be uncomfortable in a public-ish leaderboard.
riders.get('/leaderboard', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const metric  = (c.req.query('metric')  ?? 'earnings') as 'earnings' | 'trips';
  const period  = (c.req.query('period')  ?? 'week')     as 'week' | 'month';
  const cityQ   = c.req.query('city');
  const db = admin(c.env);

  // Time window
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const daysSinceMonday = (now.getDay() + 6) % 7;
  const startOfWeek = startOfToday - daysSinceMonday * 86400_000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const since = new Date(period === 'week' ? startOfWeek : startOfMonth).toISOString();

  // Pull rider-owned trip_earning transactions in the window.
  // NOTE: This scans all trip_earnings in the period — fine at MVP scale
  // (few hundred/day). At real volume we'd move to a materialised view.
  const { data: txns } = await db
    .from('transactions')
    .select('rider_id, amount, order_id, orders(city)')
    .eq('type', 'trip_earning')
    .gte('created_at', since)
    .not('rider_id', 'is', null)
    .limit(50_000);

  // Aggregate per rider, honouring the optional city filter.
  const aggr = new Map<string, { earnings: number; trips: number }>();
  for (const t of txns ?? []) {
    if (!t.rider_id) continue;
    if (cityQ) {
      const o = Array.isArray(t.orders) ? t.orders[0] : t.orders;
      if (o?.city?.toLowerCase() !== cityQ.toLowerCase()) continue;
    }
    const row = aggr.get(t.rider_id) ?? { earnings: 0, trips: 0 };
    row.earnings += Number(t.amount);
    row.trips += 1;
    aggr.set(t.rider_id, row);
  }

  const scored = Array.from(aggr, ([rider_id, v]) => ({
    rider_id,
    earnings: round2(v.earnings),
    trips: v.trips,
    score: metric === 'trips' ? v.trips : v.earnings,
  })).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return c.json({ metric, period, city: cityQ ?? null, top: [], me: null });
  }

  // Join name + vehicle for the top 20 + the caller (if outside top 20).
  const top = scored.slice(0, 20);
  const myScoreIdx = scored.findIndex((s) => s.rider_id === uid);
  const meScore = myScoreIdx >= 0 ? scored[myScoreIdx] : null;
  const includeMe = meScore && !top.some((t) => t.rider_id === uid);

  const idsToFetch = new Set<string>(top.map((t) => t.rider_id));
  if (includeMe && meScore) idsToFetch.add(meScore.rider_id);

  const { data: riderRows } = await db
    .from('riders')
    .select('id, vehicle_type, profiles!inner(full_name)')
    .in('id', Array.from(idsToFetch));

  const nameFor = (id: string): string => {
    const r = (riderRows ?? []).find((x) => x.id === id);
    // Supabase-js returns joined 'profiles' as either object or array
    const p = Array.isArray((r as any)?.profiles) ? (r as any).profiles[0] : (r as any)?.profiles;
    const full = p?.full_name as string | undefined;
    return anonymise(full);
  };
  const vehicleFor = (id: string): string | undefined =>
    (riderRows ?? []).find((x) => x.id === id)?.vehicle_type;

  const topOut = top.map((t, i) => ({
    rank: i + 1,
    rider_id: t.rider_id,
    display_name: nameFor(t.rider_id),
    vehicle_type: vehicleFor(t.rider_id),
    trips: t.trips,
    earnings: t.earnings,
    is_me: t.rider_id === uid,
  }));

  const me = meScore ? {
    rank: myScoreIdx + 1,
    rider_id: meScore.rider_id,
    display_name: nameFor(meScore.rider_id),
    vehicle_type: vehicleFor(meScore.rider_id),
    trips: meScore.trips,
    earnings: meScore.earnings,
    is_me: true,
    total_participants: scored.length,
  } : null;

  return c.json({ metric, period, city: cityQ ?? null, top: topOut, me });
});

// First name + last initial. Falls back to "Captain" if the name is missing.
function anonymise(fullName?: string): string {
  if (!fullName?.trim()) return 'Captain';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? 'Captain';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] + '.' : '';
  return last ? `${first} ${last}` : first;
}

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

// ─── PROFILE — captain personal info + vehicle change + photo ──────────────
riders.get('/profile', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const [{ data: prof }, { data: rider }] = await Promise.all([
    db.from('profiles').select('id, full_name, phone, email, avatar_url, rating, created_at').eq('id', uid).maybeSingle(),
    db.from('riders').select('id, status, vehicle_type, vehicle_number, vehicle_model, license_number, city, kyc, kyc_docs, wallet_balance, total_trips').eq('id', uid).maybeSingle(),
  ]);
  return c.json({ profile: prof, rider });
});

riders.patch('/profile', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const body = await c.req.json().catch(() => null) as null | {
    full_name?: string; phone?: string; avatar_url?: string;
    vehicle_type?: string; vehicle_number?: string; vehicle_model?: string; license_number?: string; city?: string;
    kyc_docs?: Record<string, string>;
  };
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const db = admin(c.env);

  // Split fields between profiles + riders
  const profileFields: Record<string, unknown> = {};
  const riderFields:   Record<string, unknown> = {};
  if (typeof body.full_name  === 'string' && body.full_name.trim())  profileFields.full_name  = body.full_name.trim();
  if (typeof body.phone      === 'string')                            profileFields.phone      = body.phone;
  if (typeof body.avatar_url === 'string')                            profileFields.avatar_url = body.avatar_url;
  if (typeof body.vehicle_type   === 'string')                        riderFields.vehicle_type   = body.vehicle_type;
  if (typeof body.vehicle_number === 'string')                        riderFields.vehicle_number = body.vehicle_number;
  if (typeof body.vehicle_model  === 'string')                        riderFields.vehicle_model  = body.vehicle_model;
  if (typeof body.license_number === 'string')                        riderFields.license_number = body.license_number;
  if (typeof body.city           === 'string')                        riderFields.city           = body.city;
  if (body.kyc_docs && typeof body.kyc_docs === 'object')             riderFields.kyc_docs       = body.kyc_docs;

  // Vehicle change resets KYC to pending (admin must re-approve).
  const vehicleChanged = riderFields.vehicle_type || riderFields.vehicle_number || riderFields.license_number;
  if (vehicleChanged) riderFields.kyc = 'pending';

  const ops: Promise<unknown>[] = [];
  if (Object.keys(profileFields).length) ops.push(Promise.resolve(db.from('profiles').update(profileFields).eq('id', uid).then(r => r)));
  if (Object.keys(riderFields).length)   ops.push(Promise.resolve(db.from('riders').update(riderFields).eq('id', uid).then(r => r)));
  await Promise.all(ops);
  return c.json({ ok: true, kyc_reset: !!vehicleChanged });
});

// ─── WITHDRAWALS — instant payout, 1×/day cap ──────────────────────────────
// Returns available balance + whether a withdraw was already made today.
riders.get('/withdraw/status', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const [{ data: rider }, { data: recent }, { data: allowedRow }] = await Promise.all([
    db.from('riders').select('wallet_balance').eq('id', uid).maybeSingle(),
    db.from('withdrawals')
      .select('id, amount, status, requested_at, paid_at, method, destination')
      .eq('rider_id', uid)
      .order('requested_at', { ascending: false })
      .limit(10),
    db.from('app_settings').select('value').eq('key', 'withdraw').maybeSingle(),
  ]);
  const cfg = (allowedRow?.value ?? { min_paise: 10000, max_per_day: 1, methods: ['upi', 'bank'] }) as {
    min_paise: number; max_per_day: number; methods: string[];
  };
  // Any non-failed withdrawal today counts against the daily cap.
  const startOfDayIST = new Date();
  startOfDayIST.setHours(0, 0, 0, 0);
  // Approximate IST (UTC+05:30) — Cloudflare Workers are UTC.
  const istOffsetMs = 5.5 * 3600_000;
  const cutoff = new Date(Math.floor((Date.now() + istOffsetMs) / 86400_000) * 86400_000 - istOffsetMs);
  const today = (recent ?? []).filter((w) => new Date(w.requested_at) >= cutoff && w.status !== 'failed');
  return c.json({
    balance:      Number(rider?.wallet_balance ?? 0),
    min_amount:   cfg.min_paise / 100,
    methods:      cfg.methods,
    used_today:   today.length,
    max_per_day:  cfg.max_per_day,
    can_withdraw: today.length < cfg.max_per_day,
    recent,
  });
});

riders.post('/withdraw', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const body = await c.req.json().catch(() => null) as null | {
    amount?: number; method?: string; destination?: string;
  };
  if (!body || typeof body.amount !== 'number' || body.amount <= 0) {
    return c.json({ error: { code: 'bad_request', message: 'amount is required' } }, 400);
  }
  if (!body.destination?.trim()) {
    return c.json({ error: { code: 'bad_request', message: 'destination is required' } }, 400);
  }
  const method = body.method === 'bank' ? 'bank' : 'upi';
  const db = admin(c.env);

  // Re-check cap + balance server-side (defence in depth).
  const [{ data: rider }, { data: allowedRow }] = await Promise.all([
    db.from('riders').select('wallet_balance').eq('id', uid).maybeSingle(),
    db.from('app_settings').select('value').eq('key', 'withdraw').maybeSingle(),
  ]);
  const cfg = (allowedRow?.value ?? { min_paise: 10000, max_per_day: 1 }) as {
    min_paise: number; max_per_day: number;
  };
  const balance = Number(rider?.wallet_balance ?? 0);
  if (body.amount * 100 < cfg.min_paise) {
    return c.json({ error: { code: 'below_min', message: `Minimum withdrawal is ₹${cfg.min_paise / 100}` } }, 400);
  }
  if (body.amount > balance) {
    return c.json({ error: { code: 'insufficient', message: 'Not enough balance' } }, 400);
  }

  const istOffsetMs = 5.5 * 3600_000;
  const cutoff = new Date(Math.floor((Date.now() + istOffsetMs) / 86400_000) * 86400_000 - istOffsetMs);
  const { data: todayList } = await db.from('withdrawals')
    .select('id')
    .eq('rider_id', uid)
    .gte('requested_at', cutoff.toISOString())
    .neq('status', 'failed');
  if ((todayList ?? []).length >= cfg.max_per_day) {
    return c.json({ error: { code: 'daily_limit', message: 'Daily withdrawal limit reached — try again tomorrow.' } }, 429);
  }

  // Record withdrawal + debit wallet in the same transaction-ish burst.
  // Cloudflare Workers + supabase-js don't support real transactions; we
  // insert, then debit — if the debit fails we mark the withdrawal failed.
  const { data: created, error: createErr } = await db.from('withdrawals').insert({
    rider_id: uid,
    amount: body.amount,
    method,
    destination: body.destination.trim(),
    status: 'pending',
  }).select('id').maybeSingle();
  if (createErr || !created) {
    return c.json({ error: { code: 'insert_failed', message: createErr?.message ?? 'insert failed' } }, 500);
  }
  const { error: debitErr } = await db.from('riders')
    .update({ wallet_balance: balance - body.amount })
    .eq('id', uid)
    .eq('wallet_balance', balance);   // optimistic concurrency
  if (debitErr) {
    await db.from('withdrawals').update({ status: 'failed', failure_reason: debitErr.message }).eq('id', created.id);
    return c.json({ error: { code: 'debit_failed', message: debitErr.message } }, 500);
  }
  return c.json({ ok: true, withdrawal_id: created.id, new_balance: balance - body.amount });
});

// ─── INCENTIVES — quest cards with live progress ───────────────────────────
riders.get('/incentives', requireAuth, requireRole('rider'), async (c) => {
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const nowIso = new Date().toISOString();
  const { data: rider } = await db.from('riders').select('vehicle_type, city').eq('id', uid).maybeSingle();
  const { data: incentives } = await db.from('incentives')
    .select('id, title, description, kind, target, reward_paise, window_hours, vehicle_type, city, ends_at')
    .eq('active', true)
    .lte('starts_at', nowIso)
    .or(`ends_at.is.null,ends_at.gte.${nowIso}`);
  // Filter by vehicle/city match (null = matches all).
  const eligible = (incentives ?? []).filter((i) =>
    (!i.vehicle_type || i.vehicle_type === rider?.vehicle_type) &&
    (!i.city         || i.city         === rider?.city));

  // Compute progress from transactions in each incentive's window
  const results: Array<Record<string, unknown>> = [];
  for (const inc of eligible) {
    const since = new Date(Date.now() - inc.window_hours * 3600_000).toISOString();
    const { data: txns } = await db.from('transactions')
      .select('amount, created_at, orders(pickup_at)')
      .eq('rider_id', uid)
      .eq('type', 'trip_earning')
      .gte('created_at', since);
    let progress = 0;
    if (inc.kind === 'trip_count') {
      progress = (txns ?? []).length;
    } else if (inc.kind === 'earnings_target') {
      progress = Math.floor((txns ?? []).reduce((s, t) => s + Number(t.amount), 0));
    } else if (inc.kind === 'peak_hours') {
      // Trips between 17:00–22:00 IST count
      progress = (txns ?? []).filter((t) => {
        const d = new Date(t.created_at);
        const istHour = (d.getUTCHours() + 5) % 24;   // approx
        return istHour >= 17 && istHour < 22;
      }).length;
    } else if (inc.kind === 'streak_days') {
      const days = new Set((txns ?? []).map((t) => new Date(t.created_at).toISOString().slice(0, 10)));
      progress = days.size;
    }
    const pct = Math.min(100, Math.round((progress / inc.target) * 100));
    results.push({
      id: inc.id,
      title: inc.title,
      description: inc.description,
      kind: inc.kind,
      target: inc.target,
      progress,
      pct,
      reward_rupees: inc.reward_paise / 100,
      window_hours: inc.window_hours,
      completed: progress >= inc.target,
      ends_at: inc.ends_at,
    });
  }
  return c.json({ incentives: results });
});

export default riders;
