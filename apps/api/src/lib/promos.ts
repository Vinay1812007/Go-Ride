// Promo code validation + wallet arithmetic. Shared between the
// /orders create handler and the /promo/validate preview endpoint so
// the client-visible price and the server-side write can't drift.
import type { Env } from './env';
import { admin } from './supabase';

// A trip's "eligible amount" for a promo — the piece the discount can eat.
// For rides/parcels: the delivery fare estimate. For food: the food subtotal
// (delivery fee is capped separately).
export interface PromoContext {
  service: string;         // 'bike' | 'auto' | ... | 'food' | 'parcel_bike' | ...
  eligible_amount: number; // what the discount is computed against
}

export interface PromoRow {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'percent' | 'flat';
  discount_value: number;
  max_discount: number | null;
  min_order: number;
  applies_to: 'all' | 'ride' | 'parcel' | 'food';
  valid_from: string;
  valid_until: string | null;
  usage_limit_per_user: number;
  total_usage_limit: number | null;
  times_used: number;
  active: boolean;
}

export type PromoError =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'wrong_service'
  | 'below_min'
  | 'limit_reached_user'
  | 'limit_reached_total';

// Category-map: which broad bucket does this order belong to?
export function categoryOf(service: string): 'ride' | 'parcel' | 'food' {
  if (service === 'food') return 'food';
  if (service.startsWith('parcel_')) return 'parcel';
  return 'ride';
}

// Look up a promo by code (case-insensitive).
export async function fetchPromo(env: Env, code: string): Promise<PromoRow | null> {
  const { data } = await admin(env)
    .from('promo_codes')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle();
  return (data as PromoRow | null) ?? null;
}

// Compute the discount for a promo against a context. Returns either a positive
// number of rupees to subtract, or an error code so the caller can format a
// friendly message. Does NOT check per-user redemption count — the caller
// passes that in as `userRedemptions` because we don't want two lookups here.
export function evaluatePromo(
  promo: PromoRow | null,
  ctx: PromoContext,
  userRedemptions: number,
): { ok: true; discount: number } | { ok: false; code: PromoError } {
  if (!promo)         return { ok: false, code: 'not_found' };
  if (!promo.active)  return { ok: false, code: 'inactive' };
  const now = Date.now();
  if (new Date(promo.valid_from).getTime() > now)                     return { ok: false, code: 'not_started' };
  if (promo.valid_until && new Date(promo.valid_until).getTime() < now) return { ok: false, code: 'expired' };
  const cat = categoryOf(ctx.service);
  if (promo.applies_to !== 'all' && promo.applies_to !== cat)          return { ok: false, code: 'wrong_service' };
  if (ctx.eligible_amount < Number(promo.min_order))                   return { ok: false, code: 'below_min' };
  if (promo.total_usage_limit != null && promo.times_used >= promo.total_usage_limit) {
    return { ok: false, code: 'limit_reached_total' };
  }
  if (promo.usage_limit_per_user > 0 && userRedemptions >= promo.usage_limit_per_user) {
    return { ok: false, code: 'limit_reached_user' };
  }
  const raw = promo.discount_type === 'flat'
    ? Number(promo.discount_value)
    : (Number(promo.discount_value) / 100) * ctx.eligible_amount;
  const capped = promo.max_discount != null ? Math.min(raw, Number(promo.max_discount)) : raw;
  // Never discount more than the eligible amount itself (can't go negative).
  const discount = Math.max(0, Math.min(capped, ctx.eligible_amount));
  // Round to 2 dp so ledger arithmetic stays clean.
  return { ok: true, discount: Math.round(discount * 100) / 100 };
}

// How many times has this user already redeemed this promo?
export async function countUserRedemptions(env: Env, promoId: string, userId: string): Promise<number> {
  const { count } = await admin(env)
    .from('promo_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('promo_id', promoId)
    .eq('customer_id', userId);
  return count ?? 0;
}

// Read a profile's wallet balance via the SQL function.
export async function walletBalance(env: Env, profileId: string): Promise<number> {
  const { data } = await admin(env).rpc('wallet_balance', { p_profile_id: profileId });
  return Number(data ?? 0);
}

// Human-readable error messages for the PromoError codes.
export function promoErrorMessage(code: PromoError): string {
  switch (code) {
    case 'not_found':           return 'Code not recognised';
    case 'inactive':            return 'This code is not active';
    case 'not_started':         return 'This code is not yet active';
    case 'expired':             return 'This code has expired';
    case 'wrong_service':       return "This code doesn't apply to this order";
    case 'below_min':           return 'Order total is below the minimum for this code';
    case 'limit_reached_user':  return "You've already used this code the maximum number of times";
    case 'limit_reached_total': return 'This code has been fully redeemed';
  }
}
