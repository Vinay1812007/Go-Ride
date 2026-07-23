// /push/register — store an FCM token for this user.
// /push/unregister — soft-delete tokens (sign-out, permission revoked).
//
// The client is responsible for token lifecycle. When Firebase rotates a
// token (rare, but happens), the client sees it via onTokenRefresh and
// hits /push/register again — we upsert on `token` so re-registration is
// idempotent.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../lib/auth';
import { admin } from '../lib/supabase';

const push = new Hono<AppEnv>();

const registerBody = z.object({
  token: z.string().min(20).max(500),
  platform: z.enum(['web', 'android', 'ios']),
  user_agent: z.string().max(300).optional(),
});

push.post('/register', requireAuth, async (c) => {
  let body: z.infer<typeof registerBody>;
  try { body = registerBody.parse(await c.req.json()); }
  catch { return c.json({ error: { code: 'bad_request' } }, 400); }

  const uid = c.get('userId')!;
  const db = admin(c.env);
  // Upsert on token — if this token was previously registered to a different
  // profile (device shared, or re-sign-in), we take the current user.
  const { error } = await db.from('push_tokens').upsert({
    profile_id: uid,
    token: body.token,
    platform: body.platform,
    user_agent: body.user_agent,
    revoked_at: null,
    last_used_at: new Date().toISOString(),
  }, { onConflict: 'token' });
  if (error) return c.json({ error: { code: 'save_failed', message: error.message } }, 500);
  return c.json({ ok: true });
});

const unregisterBody = z.object({ token: z.string() });
push.post('/unregister', requireAuth, async (c) => {
  let body: z.infer<typeof unregisterBody>;
  try { body = unregisterBody.parse(await c.req.json()); }
  catch { return c.json({ error: { code: 'bad_request' } }, 400); }
  const uid = c.get('userId')!;
  await admin(c.env)
    .from('push_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', body.token)
    .eq('profile_id', uid);
  return c.json({ ok: true });
});

export default push;
