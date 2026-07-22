// HMAC-SHA256 helpers for partner webhook signing + public share-tracking tokens.

async function hmac(key: string, msg: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg));
  return new Uint8Array(sig);
}

export async function hmacHex(key: string, msg: string): Promise<string> {
  const bytes = await hmac(key, msg);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Deterministic public tracking token: base64url(HMAC(secret, order_no)).
// URL: /t/{order_no}?k={token} — no login, no PII beyond driver name/vehicle.
export async function shareToken(secret: string, orderNo: string): Promise<string> {
  return toBase64Url(await hmac(secret, orderNo));
}

export async function verifyShareToken(
  secret: string,
  orderNo: string,
  token: string,
): Promise<boolean> {
  const expected = await shareToken(secret, orderNo);
  // Constant-time-ish compare
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
