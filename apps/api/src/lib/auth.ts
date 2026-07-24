import { jwtVerify, createRemoteJWKSet, errors as joseErrors } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from './env';
import { admin } from './supabase';

// JWKS cache — one per Worker instance, keyed by Supabase URL. jose handles
// its own in-memory caching (default 10 min TTL) once created.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(env: Env) {
  const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, jwks);
  }
  return jwks;
}

// Verify a Supabase JWT and populate ctx.userId + ctx.userRole.
// Supports both HS256 (legacy shared secret) and asymmetric (ES256/RS256)
// signing keys — Supabase migrated newer projects to signing keys.
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authz = c.req.header('Authorization');
  if (!authz?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'unauthenticated', message: 'Missing bearer token' } }, 401);
  }
  const token = authz.slice(7);
  const hs256Secret = new TextEncoder().encode(c.env.SUPABASE_JWT_SECRET);
  const jwks = getJwks(c.env);

  let payload: Record<string, unknown>;
  try {
    // jose accepts a key resolver function: (protectedHeader, token) => Key
    // HS256 tokens use the shared secret; asymmetric tokens use JWKS.
    ({ payload } = await jwtVerify(
      token,
      async (protectedHeader) => {
        if (protectedHeader.alg === 'HS256') return hs256Secret;
        return jwks(protectedHeader);
      },
      { algorithms: ['HS256', 'ES256', 'RS256'] },
    ));
  } catch (e) {
    const code = e instanceof joseErrors.JWTExpired ? 'token_expired'
               : e instanceof joseErrors.JOSEError ? `invalid_token:${e.code}`
               : 'invalid_token';
    return c.json({ error: { code, message: e instanceof Error ? e.message : 'JWT verify failed' } }, 401);
  }
  const userId = payload.sub as string | undefined;
  if (!userId) {
    return c.json({ error: { code: 'invalid_token', message: 'sub missing' } }, 401);
  }
  c.set('userId', userId);

  // Fetch role (cached in Supabase-side session claims later; for now, one lookup).
  const { data, error } = await admin(c.env)
    .from('profiles')
    .select('role, blocked')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) {
    return c.json({ error: { code: 'profile_missing', message: 'Profile not found' } }, 401);
  }
  if (data.blocked) {
    return c.json({ error: { code: 'blocked', message: 'Account is blocked' } }, 403);
  }
  c.set('userRole', data.role);
  await next();
};

// Guard a route by role.
export function requireRole(...roles: Array<'customer' | 'rider' | 'admin' | 'restaurant_partner'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const role = c.get('userRole');
    if (!role || !roles.includes(role)) {
      return c.json({ error: { code: 'forbidden', message: 'Insufficient role' } }, 403);
    }
    await next();
  };
}

// Constant-time-ish comparison for API key hash lookups (best available in Workers).
export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Partner API key middleware — reads X-API-Key, hashes, looks up.
export const requirePartner: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header('X-API-Key');
  if (!key) {
    return c.json({ error: { code: 'unauthenticated', message: 'Missing X-API-Key' } }, 401);
  }
  const hash = await sha256Hex(key);
  const { data, error } = await admin(c.env)
    .from('partners')
    .select('id, active, rate_limit_per_min')
    .eq('api_key_hash', hash)
    .maybeSingle();
  if (error || !data || !data.active) {
    return c.json({ error: { code: 'invalid_key', message: 'Unknown or disabled API key' } }, 401);
  }
  c.set('partnerId', data.id);

  // Rate limit — KV counter per minute, per key.
  const bucket = Math.floor(Date.now() / 60_000).toString();
  const kvKey = `rl:${data.id}:${bucket}`;
  const current = parseInt((await c.env.CACHE.get(kvKey)) ?? '0', 10);
  if (current >= data.rate_limit_per_min) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many requests' } }, 429);
  }
  // Best-effort increment (races OK for MVP; hard-cap comes at next bucket).
  c.executionCtx.waitUntil(c.env.CACHE.put(kvKey, String(current + 1), { expirationTtl: 120 }));

  await next();
};
