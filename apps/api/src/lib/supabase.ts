import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';

// Service-role client — bypasses RLS. Never expose to the browser.
export function admin(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-goride-source': 'worker' } },
  });
}

// Broadcast a message on a Realtime channel via Supabase's REST endpoint.
// Cheaper than opening a WebSocket per request from the Worker.
export async function broadcast(
  env: Env,
  channel: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const url = `${env.SUPABASE_URL}/realtime/v1/api/broadcast`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ topic: channel, event, payload }],
    }),
  });
  if (!res.ok) {
    // Non-fatal — realtime is best-effort; the DB is source of truth.
    console.warn('broadcast failed', channel, event, res.status, await res.text());
  }
}
