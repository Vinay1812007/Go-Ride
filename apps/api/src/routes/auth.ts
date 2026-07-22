import { Hono } from 'hono';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../lib/auth';
import { admin } from '../lib/supabase';

const auth = new Hono<AppEnv>();

// Whoami — used by the SPA on boot to route by role.
auth.get('/me', requireAuth, async (c) => {
  const uid = c.get('userId')!;
  const { data: profile } = await admin(c.env)
    .from('profiles')
    .select('id, full_name, phone, email, role, rating, avatar_url')
    .eq('id', uid)
    .maybeSingle();
  if (!profile) return c.json({ error: { code: 'not_found' } }, 404);
  let rider = null;
  if (profile.role === 'rider') {
    const { data } = await admin(c.env)
      .from('riders')
      .select('status, vehicle_type, vehicle_number, kyc, city, wallet_balance, total_trips')
      .eq('id', uid)
      .maybeSingle();
    rider = data;
  }
  return c.json({ profile, rider });
});

export default auth;
