import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth, requireRole } from '../lib/auth';
import { admin, broadcast } from '../lib/supabase';
import { createOrderBody, cancelBody, rateBody, rescheduleBody, sendMessageBody } from '../lib/schemas';
import { quoteInternal } from './fare';
import { dispatch } from '../lib/dispatch';

// Booking a ride "for later" needs some sanity: at least 30 minutes out (so
// the cron's LEAD_MINUTES window isn't already past), at most 7 days out.
const SCHEDULE_MIN_MS = 30 * 60_000;
const SCHEDULE_MAX_MS = 7 * 24 * 60 * 60_000;

function validateScheduleWindow(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'invalid scheduled_at';
  const delta = t - Date.now();
  if (delta < SCHEDULE_MIN_MS) return 'must be at least 30 minutes from now';
  if (delta > SCHEDULE_MAX_MS) return 'cannot be more than 7 days from now';
  return null;
}
import { shareToken } from '../lib/hmac';
import {
  countUserRedemptions,
  evaluatePromo,
  fetchPromo,
  promoErrorMessage,
  walletBalance,
} from '../lib/promos';
import type { z } from 'zod';

const orders = new Hono<AppEnv>();

function otp4(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function parse<T extends z.ZodTypeAny>(c: any, s: T) {
  try {
    return s.parse(await c.req.json());
  } catch {
    return null;
  }
}

// -------- POST / — create order --------
orders.post('/', requireAuth, requireRole('customer'), async (c) => {
  const body = await parse(c, createOrderBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);

  // Parcel-service payload sanity
  if (body.service.startsWith('parcel_') && !body.parcel) {
    return c.json({ error: { code: 'missing_parcel' } }, 400);
  }

  // Food-service payload sanity
  if (body.service === 'food' && (!body.food || !body.restaurant_id)) {
    return c.json({ error: { code: 'missing_food' } }, 400);
  }

  // For food, re-verify the cart total server-side using authoritative prices.
  // This prevents a malicious client from paying ₹10 for a ₹300 biryani.
  let foodSubtotal = 0;
  if (body.service === 'food' && body.food && body.restaurant_id) {
    const db0 = admin(c.env);
    const { data: r } = await db0.from('restaurants').select('id, min_order, active').eq('id', body.restaurant_id).maybeSingle();
    if (!r || !r.active) return c.json({ error: { code: 'restaurant_unavailable' } }, 404);
    const ids = body.food.items.map((i: { menu_item_id: string }) => i.menu_item_id);
    const { data: items } = await db0.from('menu_items').select('id, name, price, available').in('id', ids);
    const priceById = new Map((items ?? []).map((it) => [it.id, it]));
    for (const line of body.food.items) {
      const it = priceById.get(line.menu_item_id);
      if (!it || !it.available) return c.json({ error: { code: 'item_unavailable', message: `${line.name} is not available` } }, 400);
      foodSubtotal += Number(it.price) * line.qty;
    }
    if (foodSubtotal < Number(r.min_order)) {
      return c.json({ error: { code: 'min_order', message: `Minimum order is ₹${r.min_order}` } }, 400);
    }
  }

  const { breakup, route, card } = await quoteInternal(c.env, {
    pickup: body.pickup,
    drop: body.drop,
    service: body.service,
    city: body.city,
  });

  // Parcel weight guard
  if (body.parcel && card.parcel_weight_limit_kg && body.parcel.weight_kg > card.parcel_weight_limit_kg) {
    return c.json(
      { error: { code: 'overweight', message: `Max weight ${card.parcel_weight_limit_kg} kg for this service` } },
      400,
    );
  }

  // Generate order_no + otp + share_token via SQL RPC helpers.
  const db = admin(c.env);
  const { data: nums } = await db.rpc('generate_order_no');
  const orderNo = (nums as unknown as string) ?? `GR-${Date.now()}`;
  const token = await shareToken(c.env.SHARE_TOKEN_SECRET, orderNo);

  // Branch: schedule for later vs dispatch now.
  const isScheduled = !!body.scheduled_at;
  if (isScheduled) {
    const err = validateScheduleWindow(body.scheduled_at!);
    if (err) return c.json({ error: { code: 'bad_schedule', message: err } }, 400);
  }

  // For food orders, fare_estimate = delivery fee + food subtotal, and the
  // breakup gets an extra `food_subtotal` field so the customer sees the
  // split at checkout.
  const baseFareEstimate = body.service === 'food'
    ? Number(breakup.total) + foodSubtotal
    : Number(breakup.total);

  // ── Promo code ─────────────────────────────────────────────────────────
  // If code is provided, revalidate here (client dry-run may be stale) and
  // record the redemption right after the insert.
  const uid = c.get('userId')!;
  let promoRow: Awaited<ReturnType<typeof fetchPromo>> = null;
  let discount = 0;
  if (body.promo_code) {
    promoRow = await fetchPromo(c.env, body.promo_code);
    const eligible = body.service === 'food' ? foodSubtotal : Number(breakup.total);
    const used = promoRow ? await countUserRedemptions(c.env, promoRow.id, uid) : 0;
    const verdict = evaluatePromo(promoRow, { service: body.service, eligible_amount: eligible }, used);
    if (!verdict.ok) {
      return c.json({ error: { code: verdict.code, message: promoErrorMessage(verdict.code) } }, 400);
    }
    discount = verdict.discount;
  }

  // ── Wallet apply ───────────────────────────────────────────────────────
  // Consume up to the post-discount total. Any remainder rides on the
  // customer's chosen payment_method.
  let walletUsed = 0;
  if (body.wallet_apply) {
    const bal = await walletBalance(c.env, uid);
    const payable = Math.max(0, baseFareEstimate - discount);
    walletUsed = Math.min(Math.max(0, bal), payable);
    walletUsed = Math.round(walletUsed * 100) / 100;
  }

  const finalFareEstimate = Math.max(0, baseFareEstimate - discount - walletUsed);
  const finalBreakup: Record<string, unknown> = body.service === 'food'
    ? { ...breakup, food_subtotal: foodSubtotal, delivery_fee: breakup.total }
    : { ...breakup };
  if (discount)   finalBreakup.discount    = discount;
  if (walletUsed) finalBreakup.wallet_used = walletUsed;
  finalBreakup.total = finalFareEstimate;

  const { data: inserted, error } = await db
    .from('orders')
    .insert({
      order_no: orderNo,
      customer_id: c.get('userId'),
      service: body.service,
      status: isScheduled ? 'scheduled' : 'searching',
      scheduled_at: isScheduled ? body.scheduled_at : null,
      city: body.city,
      pickup_lat: body.pickup.lat,
      pickup_lng: body.pickup.lng,
      pickup_address: body.pickup.address,
      drop_lat: body.drop.lat,
      drop_lng: body.drop.lng,
      drop_address: body.drop.address,
      distance_km: breakup.km,
      duration_min: breakup.minutes,
      route_polyline: route.polyline,
      fare_estimate: finalFareEstimate,
      fare_breakup: finalBreakup,
      payment_method: body.payment_method,
      otp: otp4(),
      parcel_details: body.parcel ?? null,
      restaurant_id: body.restaurant_id ?? null,
      food_details: body.food
        ? { items: body.food.items, instructions: body.food.instructions ?? null, subtotal: foodSubtotal }
        : null,
      share_token: token,
      promo_id: promoRow?.id ?? null,
      discount,
      wallet_used: walletUsed,
    })
    .select('id, order_no, otp, share_token, scheduled_at, status')
    .single();
  if (error || !inserted) return c.json({ error: { code: 'insert_failed', message: error?.message } }, 500);

  // ── Post-insert side effects: record redemption + debit wallet ─────────
  // These are fire-and-forget so a slow write doesn't stall the response.
  // If any of them fails we've already got the order — a nightly job could
  // reconcile, but at MVP scale the failure rate here is effectively zero.
  const sideEffects: Promise<unknown>[] = [];
  if (promoRow && discount > 0) {
    sideEffects.push(
      Promise.resolve(db.from('promo_redemptions').insert({
        promo_id: promoRow.id,
        order_id: inserted.id,
        customer_id: uid,
        discount_amount: discount,
      })),
      Promise.resolve(db.from('promo_codes').update({ times_used: promoRow.times_used + 1 }).eq('id', promoRow.id)),
    );
  }
  if (walletUsed > 0) {
    sideEffects.push(
      Promise.resolve(db.from('wallet_ledger').insert({
        profile_id: uid,
        delta: -walletUsed,
        reason: 'trip_debit',
        order_id: inserted.id,
        note: `Applied to ${inserted.order_no}`,
      })),
    );
  }
  if (sideEffects.length > 0) {
    c.executionCtx.waitUntil(Promise.allSettled(sideEffects).then(() => {}));
  }

  // Only kick off dispatch immediately for now-orders. Scheduled orders wait
  // for the minutely cron to promote them.
  if (!isScheduled) {
    c.executionCtx.waitUntil(dispatch(c.env, inserted.id).catch((e) => console.warn('dispatch', e)));
  }

  return c.json({
    id: inserted.id,
    order_no: inserted.order_no,
    otp: inserted.otp,
    status: inserted.status,
    scheduled_at: inserted.scheduled_at,
    tracking_url: `/t/${inserted.order_no}?k=${inserted.share_token}`,
    fare: finalFareEstimate,
    fare_breakup: finalBreakup,
    distance_km: breakup.km,
    duration_min: breakup.minutes,
  });
});

// -------- PATCH /:id/schedule — reschedule a scheduled order --------
orders.patch('/:id/schedule', requireAuth, requireRole('customer'), async (c) => {
  const body = await parse(c, rescheduleBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const err = validateScheduleWindow(body.scheduled_at);
  if (err) return c.json({ error: { code: 'bad_schedule', message: err } }, 400);

  const db = admin(c.env);
  const uid = c.get('userId')!;
  const { data, error } = await db
    .from('orders')
    .update({ scheduled_at: body.scheduled_at })
    .eq('id', c.req.param('id'))
    .eq('customer_id', uid)
    .eq('status', 'scheduled')       // guard: can't reschedule a live order
    .select('id, scheduled_at')
    .maybeSingle();
  if (error) return c.json({ error: { code: 'update_failed', message: error.message } }, 500);
  if (!data) return c.json({ error: { code: 'not_found_or_started' } }, 404);
  return c.json({ id: data.id, scheduled_at: data.scheduled_at });
});

// -------- POST /:id/start-now — customer chooses to dispatch a scheduled order early --------
orders.post('/:id/start-now', requireAuth, requireRole('customer'), async (c) => {
  const db = admin(c.env);
  const uid = c.get('userId')!;
  const { data, error } = await db
    .from('orders')
    .update({ status: 'searching', dispatch_started_at: new Date().toISOString() })
    .eq('id', c.req.param('id'))
    .eq('customer_id', uid)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: { code: 'update_failed', message: error.message } }, 500);
  if (!data) return c.json({ error: { code: 'not_found_or_started' } }, 404);
  c.executionCtx.waitUntil(dispatch(c.env, data.id).catch((e) => console.warn('start-now dispatch', e)));
  return c.json({ id: data.id, status: 'searching' });
});

// -------- GET / — list customer's orders --------
// ?upcoming=1 filters to scheduled orders (sorted by pickup time ascending).
// Everything else returns the flat history sorted by created_at desc.
orders.get('/', requireAuth, requireRole('customer'), async (c) => {
  const uid = c.get('userId')!;
  const upcoming = c.req.query('upcoming') === '1';
  const q = admin(c.env)
    .from('orders')
    .select('id, order_no, service, status, pickup_address, drop_address, fare_final, fare_estimate, scheduled_at, created_at, completed_at')
    .eq('customer_id', uid);
  if (upcoming) {
    q.eq('status', 'scheduled').order('scheduled_at', { ascending: true });
  } else {
    q.order('created_at', { ascending: false });
  }
  const { data } = await q.limit(50);
  return c.json({ orders: data ?? [] });
});

// -------- GET /:id — order detail --------
orders.get('/:id', requireAuth, async (c) => {
  const uid = c.get('userId')!;
  const role = c.get('userRole');
  const q = admin(c.env).from('orders').select('*').eq('id', c.req.param('id')).maybeSingle();
  const { data } = await q;
  if (!data) return c.json({ error: { code: 'not_found' } }, 404);
  if (role !== 'admin' && data.customer_id !== uid && data.rider_id !== uid) {
    return c.json({ error: { code: 'forbidden' } }, 403);
  }
  // Hide OTP from rider until arrival.
  if (role === 'rider' && data.status !== 'arrived') data.otp = null;
  return c.json({ order: data });
});

// -------- POST /:id/cancel --------
orders.post('/:id/cancel', requireAuth, async (c) => {
  const body = await parse(c, cancelBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const role = c.get('userRole');
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('*').eq('id', c.req.param('id')).maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);

  const isCustomer = order.customer_id === uid;
  const isRider = order.rider_id === uid;
  if (!isCustomer && !isRider && role !== 'admin') return c.json({ error: { code: 'forbidden' } }, 403);
  if (['completed', 'cancelled_customer', 'cancelled_rider', 'delivered'].includes(order.status)) {
    return c.json({ error: { code: 'already_final', message: 'Cannot cancel a finished order' } }, 409);
  }
  const nextStatus = isCustomer ? 'cancelled_customer' : 'cancelled_rider';
  await db
    .from('orders')
    .update({ status: nextStatus, cancelled_reason: body.reason, cancelled_at: new Date().toISOString() })
    .eq('id', order.id);
  await broadcast(c.env, `order:${order.id}`, 'status', { status: nextStatus });

  // Free the rider — status was 'on_trip' during the ride, put them back
  // to 'online' so they can accept new offers and the captain UI unfreezes.
  // Also expire any still-pending job_offers for this order.
  if (order.rider_id) {
    await db.from('riders').update({ status: 'online', last_seen: new Date().toISOString() }).eq('id', order.rider_id);
    await db.from('job_offers')
      .update({ response: 'expired', responded_at: new Date().toISOString() })
      .eq('order_id', order.id)
      .is('response', null);
    // Broadcast to the rider so their captain shell refreshes immediately
    await broadcast(c.env, `rider:${order.rider_id}`, 'trip_ended', {
      order_id: order.id,
      reason: nextStatus,
    });
  }
  return c.json({ ok: true, status: nextStatus });
});

// -------- POST /:id/rate — customer rates rider --------
orders.post('/:id/rate', requireAuth, requireRole('customer'), async (c) => {
  const body = await parse(c, rateBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const { data: order } = await db.from('orders').select('id, customer_id, rider_id, status').eq('id', c.req.param('id')).maybeSingle();
  if (!order || order.customer_id !== uid) return c.json({ error: { code: 'forbidden' } }, 403);
  if (order.status !== 'completed' && order.status !== 'delivered') {
    return c.json({ error: { code: 'not_completed' } }, 409);
  }
  await db.from('ratings').upsert(
    { order_id: order.id, by_customer: body.rating, comment: body.comment },
    { onConflict: 'order_id' },
  );
  // Recompute rider average (cheap enough at MVP scale).
  if (order.rider_id) {
    const { data: agg } = await db
      .from('ratings')
      .select('by_customer.avg()')
      .not('by_customer', 'is', null)
      .in('order_id', (
        await db.from('orders').select('id').eq('rider_id', order.rider_id)
      ).data?.map((r) => r.id) ?? []);
    const avg = (agg?.[0] as { avg?: number } | undefined)?.avg;
    if (avg) await db.from('profiles').update({ rating: Math.round(avg * 10) / 10 }).eq('id', order.rider_id);
  }
  return c.json({ ok: true });
});

// ============================================================================
// Chat messages
// ----------------------------------------------------------------------------
// Two-party chat between the customer and the assigned captain. Rows are
// immutable except for read_at, which flips null → now() when the recipient
// opens the drawer.
// ============================================================================

// GET /:id/messages — list messages, mark received as read
orders.get('/:id/messages', requireAuth, async (c) => {
  const uid = c.get('userId')!;
  const role = c.get('userRole');
  const orderId = c.req.param('id');
  const db = admin(c.env);

  // Membership check — do this ourselves rather than relying on RLS because
  // this handler uses the service-role client for the read.
  const { data: order } = await db
    .from('orders')
    .select('id, customer_id, rider_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);
  const isCustomer = order.customer_id === uid;
  const isRider = order.rider_id === uid;
  if (!isCustomer && !isRider && role !== 'admin') {
    return c.json({ error: { code: 'forbidden' } }, 403);
  }

  const { data: messages } = await db
    .from('messages')
    .select('id, sender_role, sender_id, body, created_at, read_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .limit(500);

  // Mark unread-by-me messages as read (best-effort, don't fail the read).
  const myRole: 'customer' | 'rider' | null =
    isCustomer ? 'customer' : isRider ? 'rider' : null;
  if (myRole) {
    const otherRole = myRole === 'customer' ? 'rider' : 'customer';
    await db
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('order_id', orderId)
      .eq('sender_role', otherRole)
      .is('read_at', null);
  }

  return c.json({ messages: messages ?? [] });
});

// POST /:id/messages — send a message
orders.post('/:id/messages', requireAuth, async (c) => {
  const body = await parse(c, sendMessageBody);
  if (!body) return c.json({ error: { code: 'bad_request' } }, 400);
  const uid = c.get('userId')!;
  const role = c.get('userRole');
  const orderId = c.req.param('id');
  const db = admin(c.env);

  const { data: order } = await db
    .from('orders')
    .select('id, customer_id, rider_id, status')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return c.json({ error: { code: 'not_found' } }, 404);

  const isCustomer = order.customer_id === uid;
  const isRider = order.rider_id === uid;
  if (!isCustomer && !isRider) return c.json({ error: { code: 'forbidden' } }, 403);

  // Only allow chatting while the trip is live. Once completed/cancelled,
  // the drawer is read-only.
  const openStatuses = ['accepted', 'arrived', 'picked_up', 'in_transit'];
  if (!openStatuses.includes(order.status)) {
    return c.json({ error: { code: 'chat_closed', message: 'Chat is only available during an active trip' } }, 409);
  }

  const senderRole: 'customer' | 'rider' = isCustomer ? 'customer' : 'rider';

  const { data: inserted, error } = await db
    .from('messages')
    .insert({
      order_id: orderId,
      sender_role: senderRole,
      sender_id: uid,
      body: body.body.trim(),
    })
    .select('id, sender_role, sender_id, body, created_at, read_at')
    .single();
  if (error || !inserted) return c.json({ error: { code: 'insert_failed', message: error?.message } }, 500);

  // Realtime push so the other side updates without a poll. Best-effort —
  // if it drops, the next GET /messages still returns everything.
  c.executionCtx.waitUntil(
    broadcast(c.env, `order:${orderId}`, 'message', inserted).catch(() => {}),
  );
  // Also notify the other party's rider/customer channel so their unread
  // badge lights up even without the trip screen open.
  const otherId = isCustomer ? order.rider_id : order.customer_id;
  if (otherId) {
    const otherChannel = isCustomer ? `rider:${otherId}` : `customer:${otherId}`;
    c.executionCtx.waitUntil(
      broadcast(c.env, otherChannel, 'message', { order_id: orderId, preview: inserted.body.slice(0, 80) }).catch(() => {}),
    );
  }

  return c.json({ message: inserted });
});

export default orders;
