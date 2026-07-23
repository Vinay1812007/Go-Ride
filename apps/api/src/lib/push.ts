// Firebase Cloud Messaging — HTTP v1 API sender.
//
// FCM v1 requires an OAuth2 access token minted by signing a JWT with the
// service-account private key. We do that here using the Web Crypto API
// (Cloudflare Workers doesn't have Node's crypto) and cache the resulting
// token in KV so we only sign once per hour.
//
// If FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_JSON are absent this
// module treats every call as a no-op — the app still works over
// Supabase Realtime, push is just an optional accelerator.
import { SignJWT, importPKCS8 } from 'jose';
import type { Env } from './env';
import { admin } from './supabase';

interface ServiceAccount {
  client_email: string;
  private_key: string;    // PEM-encoded RSA private key
  private_key_id?: string;
}

const TOKEN_KV_KEY = 'push:fcm:access_token';
const TOKEN_TTL_S = 55 * 60;   // FCM tokens last 1h; refresh at 55m for safety.

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const j = JSON.parse(raw);
    if (!j.client_email || !j.private_key) return null;
    return { client_email: j.client_email, private_key: j.private_key, private_key_id: j.private_key_id };
  } catch { return null; }
}

// Mint (or reuse) an OAuth2 access token for the FCM scope.
async function getAccessToken(env: Env): Promise<string | null> {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  const cached = await env.CACHE.get(TOKEN_KV_KEY);
  if (cached) return cached;

  const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!sa) { console.warn('FCM: invalid service account JSON'); return null; }

  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256', kid: sa.private_key_id })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    console.warn('FCM token exchange failed', res.status, await res.text());
    return null;
  }
  const body = await res.json<{ access_token?: string; expires_in?: number }>();
  const token = body.access_token;
  if (!token) return null;
  await env.CACHE.put(TOKEN_KV_KEY, token, { expirationTtl: TOKEN_TTL_S });
  return token;
}

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;   // Only string values — FCM v1 rejects non-string data.
  // Deep-link path to open when tapped. E.g. `/track/<id>`
  clickAction?: string;
}

// Send to every non-revoked token for a profile.
export async function sendToProfile(env: Env, profileId: string, notif: PushNotification): Promise<void> {
  if (!env.FIREBASE_PROJECT_ID) return;
  const { data: tokens } = await admin(env)
    .from('push_tokens')
    .select('id, token, platform')
    .eq('profile_id', profileId)
    .is('revoked_at', null);
  if (!tokens || tokens.length === 0) return;

  const accessToken = await getAccessToken(env);
  if (!accessToken) return;

  await Promise.all(tokens.map((t) => sendOne(env, accessToken, t.token, t.id, notif)));
}

async function sendOne(
  env: Env,
  accessToken: string,
  fcmToken: string,
  rowId: string,
  notif: PushNotification,
): Promise<void> {
  // FCM v1 requires ALL data values to be strings.
  const dataStrings: Record<string, string> = {};
  for (const [k, v] of Object.entries(notif.data ?? {})) dataStrings[k] = String(v);
  if (notif.clickAction) dataStrings.click_action = notif.clickAction;

  const message = {
    token: fcmToken,
    notification: { title: notif.title, body: notif.body },
    data: dataStrings,
    // Web push override — attaches an fcm_options link so click routes work
    // for the service worker on the PWA.
    webpush: notif.clickAction ? {
      fcm_options: { link: notif.clickAction },
      notification: { icon: '/icon-192.png', badge: '/icon-192.png' },
    } : undefined,
    android: { priority: 'HIGH' as const, notification: { channel_id: 'goride_high' } },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    },
  );

  if (res.ok) {
    // Best-effort last_used bump — one round-trip per notif is fine at MVP scale.
    await admin(env).from('push_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', rowId);
    return;
  }
  const status = res.status;
  const text = await res.text().catch(() => '');
  // 404 / 400 with "UNREGISTERED" or "INVALID_ARGUMENT" means the token is dead — revoke it.
  if (status === 404 || /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(text)) {
    await admin(env)
      .from('push_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', rowId);
    return;
  }
  console.warn('FCM send failed', status, text);
}
