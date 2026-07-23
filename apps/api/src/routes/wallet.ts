// Wallet + promo endpoints for the customer app.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../lib/auth';
import { admin } from '../lib/supabase';
import { quoteInternal } from './fare';
import {
  countUserRedemptions,
  evaluatePromo,
  fetchPromo,
  promoErrorMessage,
  walletBalance,
} from '../lib/promos';

const wallet = new Hono<AppEnv>();
export const promo = new Hono<AppEnv>();

const validateBody = z.object({
  code: z.string().min(2).max(30),
  service: z.string(),
  city: z.string().default('Hyderabad'),
  pickup: z.object({ lat: z.number(), lng: z.number() }),
  drop: z.object({ lat: z.number(), lng: z.number() }),
  food_subtotal: z.number().nonnegative().optional(),  // required if service='food'
});

// POST /promo/validate — dry-run apply, returns discount + new total so the
// checkout screen can render the breakup before the customer places the order.
promo.post('/validate', requireAuth, async (c) => {
  let body: z.infer<typeof validateBody>;
  try { body = validateBody.parse(await c.req.json()); }
  catch { return c.json({ error: { code: 'bad_request' } }, 400); }

  const promo = await fetchPromo(c.env, body.code);
  if (!promo) return c.json({ error: { code: 'not_found', message: promoErrorMessage('not_found') } }, 404);

  // Quote so we know the delivery/ride fare.
  const q = await quoteInternal(c.env, {
    pickup: body.pickup, drop: body.drop, service: body.service, city: body.city,
  });

  const eligible = body.service === 'food'
    ? Number(body.food_subtotal ?? 0)
    : Number(q.breakup.total);

  const uid = c.get('userId')!;
  const used = await countUserRedemptions(c.env, promo.id, uid);
  const verdict = evaluatePromo(promo, { service: body.service, eligible_amount: eligible }, used);
  if (!verdict.ok) {
    return c.json({ error: { code: verdict.code, message: promoErrorMessage(verdict.code) } }, 400);
  }
  return c.json({
    code: promo.code,
    description: promo.description,
    discount: verdict.discount,
    breakup: {
      subtotal: eligible,
      delivery_fee: body.service === 'food' ? Number(q.breakup.total) : 0,
      discount: verdict.discount,
    },
  });
});

// GET /wallet — balance + last 30 ledger entries + referral info
wallet.get('/', requireAuth, async (c) => {
  const uid = c.get('userId')!;
  const db = admin(c.env);
  const [balance, { data: entries }, { data: profile }] = await Promise.all([
    walletBalance(c.env, uid),
    db.from('wallet_ledger')
      .select('id, delta, reason, order_id, note, created_at')
      .eq('profile_id', uid)
      .order('created_at', { ascending: false })
      .limit(30),
    db.from('profiles').select('referral_code, referred_by').eq('id', uid).maybeSingle(),
  ]);
  return c.json({
    balance,
    entries: entries ?? [],
    referral_code: profile?.referral_code ?? null,
    referred_by: profile?.referred_by ?? null,
  });
});

// POST /wallet/apply-referral — customer submits a friend's referral code.
// Only valid before any completed order (to prevent farming).
const applyReferralBody = z.object({ code: z.string().min(3).max(20) });
wallet.post('/apply-referral', requireAuth, async (c) => {
  let body: z.infer<typeof applyReferralBody>;
  try { body = applyReferralBody.parse(await c.req.json()); }
  catch { return c.json({ error: { code: 'bad_request' } }, 400); }
  const uid = c.get('userId')!;
  const db = admin(c.env);

  const { data: me } = await db.from('profiles').select('referred_by, referral_code').eq('id', uid).maybeSingle();
  if (!me) return c.json({ error: { code: 'not_found' } }, 404);
  if (me.referred_by) return c.json({ error: { code: 'already_referred' } }, 409);

  const code = body.code.trim().toUpperCase();
  if (me.referral_code === code) return c.json({ error: { code: 'self_referral' } }, 400);

  const { data: referrer } = await db.from('profiles').select('id').eq('referral_code', code).maybeSingle();
  if (!referrer) return c.json({ error: { code: 'invalid_code', message: 'Referral code not recognised' } }, 404);

  // Bar users who've already ordered from applying a code retroactively.
  const { count } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', uid)
    .in('status', ['completed', 'delivered']);
  if ((count ?? 0) > 0) return c.json({ error: { code: 'has_orders', message: 'Referral must be applied before your first trip' } }, 409);

  await db.from('profiles').update({ referred_by: referrer.id }).eq('id', uid);
  return c.json({ ok: true });
});

export { wallet };
export default wallet;
