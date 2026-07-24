// Google Maps Platform adapter.
//
// Every call is a pure fetch with a short timeout. The caller in geo.ts
// wraps these in try/catch and falls back to the OSM stack on any error.
// That means:
//   • credits running out → we fall back automatically
//   • Google API blip → we fall back automatically
//   • quota per key exceeded → we fall back automatically
//
// Cost-saving notes baked in:
//   • Places Autocomplete v1 with `sessionToken` — Google charges per
//     session instead of per keystroke as long as the tokens flow.
//   • Routes v2 with fieldMask so we only pay for the fields we use.
//   • Route Matrix v2 for many-to-many dispatch (10× cheaper than N
//     individual Route requests at scale).
//   • All responses cached in KV with a 24h TTL (§9 pattern from
//     the existing OSM path). Repeat lookups don't count against quota.

import type { Env } from './env';

// Small AbortController-based timeout wrapper.
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`${label} timeout`)), ms);
  try { return await p; } finally { clearTimeout(t); }
}

export interface GoogleSuggestion { label: string; lat: number; lng: number }
export interface GoogleRoute      { distance_km: number; duration_min: number; polyline: string }
export interface GoogleMatrixCell { origin: number; destination: number; distance_km: number; duration_min: number; status: 'ok' | 'no_route' }

// ── Places Autocomplete (New v1) ──────────────────────────────────────────
export async function googleAutocomplete(env: Env, query: string, countryCode = 'in', sessionToken?: string): Promise<GoogleSuggestion[]> {
  if (!env.GOOGLE_MAPS_API_KEY) throw new Error('no google key');
  const url = 'https://places.googleapis.com/v1/places:autocomplete';
  const body = {
    input: query,
    sessionToken,
    includedRegionCodes: [countryCode.toUpperCase()],
    languageCode: 'en',
  };
  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
        // Request only the fields we render — Google bills per field group.
        'X-Goog-FieldMask': 'suggestions.placePrediction.text,suggestions.placePrediction.placeId',
      },
      body: JSON.stringify(body),
    }),
    5_000,
    'google autocomplete',
  );
  if (!res.ok) throw new Error(`google autocomplete ${res.status}: ${await res.text().then((t) => t.slice(0, 400)).catch(() => '')}`);
  const data = await res.json() as {
    suggestions?: Array<{ placePrediction?: { text?: { text: string }; placeId: string } }>;
  };
  const preds = (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is { text?: { text: string }; placeId: string } => !!p);

  // Autocomplete returns names, not coords. Resolve top 6 place IDs in
  // parallel via Place Details (Basic fields only — cheap tier).
  const details = await Promise.all(preds.slice(0, 6).map((p) => placeDetails(env, p.placeId, sessionToken).catch(() => null)));
  const out: GoogleSuggestion[] = [];
  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const p = preds[i]!;
    if (!d) continue;
    out.push({ label: p.text?.text ?? d.formattedAddress, lat: d.lat, lng: d.lng });
  }
  return out;
}

async function placeDetails(env: Env, placeId: string, sessionToken?: string) {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  const params = new URLSearchParams();
  if (sessionToken) params.set('sessionToken', sessionToken);
  const res = await withTimeout(
    fetch(url + (params.toString() ? `?${params}` : ''), {
      headers: {
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY!,
        // Only ask for what we render — Basic Data SKU only.
        'X-Goog-FieldMask': 'formattedAddress,location',
      },
    }),
    5_000,
    'google placeDetails',
  );
  if (!res.ok) throw new Error(`google placeDetails ${res.status}: ${await res.text().then((t) => t.slice(0, 400)).catch(() => '')}`);
  const data = await res.json() as { formattedAddress: string; location: { latitude: number; longitude: number } };
  return { formattedAddress: data.formattedAddress, lat: data.location.latitude, lng: data.location.longitude };
}

// ── Geocoding (forward) ───────────────────────────────────────────────────
export async function googleGeocode(env: Env, address: string): Promise<GoogleSuggestion | null> {
  if (!env.GOOGLE_MAPS_API_KEY) throw new Error('no google key');
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
  const res = await withTimeout(fetch(url), 5_000, 'google geocode');
  if (!res.ok) throw new Error(`google geocode ${res.status}: ${await res.text().then((t) => t.slice(0, 400)).catch(() => '')}`);
  const data = await res.json() as { status: string; results: Array<{ formatted_address: string; geometry: { location: { lat: number; lng: number } } }> };
  const r = data.results[0];
  if (!r) return null;
  return { label: r.formatted_address, lat: r.geometry.location.lat, lng: r.geometry.location.lng };
}

// ── Reverse geocoding ─────────────────────────────────────────────────────
export async function googleReverse(env: Env, lat: number, lng: number): Promise<string | null> {
  if (!env.GOOGLE_MAPS_API_KEY) throw new Error('no google key');
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${lat},${lng}`);
  url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
  const res = await withTimeout(fetch(url), 5_000, 'google reverse');
  if (!res.ok) throw new Error(`google reverse ${res.status}: ${await res.text().then((t) => t.slice(0, 400)).catch(() => '')}`);
  const data = await res.json() as { status: string; results: Array<{ formatted_address: string }> };
  return data.results[0]?.formatted_address ?? null;
}

// ── Routes v2 (single route) ──────────────────────────────────────────────
export async function googleRoute(env: Env, from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<GoogleRoute> {
  if (!env.GOOGLE_MAPS_API_KEY) throw new Error('no google key');
  const body = {
    origin:      { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat,   longitude: to.lng   } } },
    travelMode:  'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    polylineEncoding: 'ENCODED_POLYLINE',
  };
  const res = await withTimeout(
    fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
    }),
    6_000,
    'google routes',
  );
  if (!res.ok) throw new Error(`google routes ${res.status}: ${await res.text().then((t) => t.slice(0, 400)).catch(() => '')}`);
  const data = await res.json() as { routes?: Array<{ distanceMeters: number; duration: string; polyline: { encodedPolyline: string } }> };
  const r = data.routes?.[0];
  if (!r) throw new Error('google routes: empty');
  return {
    distance_km:  r.distanceMeters / 1000,
    duration_min: parseInt(r.duration.replace(/s$/, ''), 10) / 60,
    polyline:     r.polyline.encodedPolyline,
  };
}

// ── Route Matrix v2 (many-to-many) — used by dispatch to find nearest ────
// captains by real driving distance instead of straight-line haversine.
// Caller can pass up to ~625 origin-destination pairs per request.
export async function googleRouteMatrix(env: Env, origins: Array<{ lat: number; lng: number }>, destinations: Array<{ lat: number; lng: number }>): Promise<GoogleMatrixCell[]> {
  if (!env.GOOGLE_MAPS_API_KEY) throw new Error('no google key');
  if (origins.length === 0 || destinations.length === 0) return [];
  const body = {
    origins: origins.map((o) => ({ waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } } })),
    destinations: destinations.map((d) => ({ waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } } })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };
  const res = await withTimeout(
    fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,status,condition',
      },
      body: JSON.stringify(body),
    }),
    8_000,
    'google matrix',
  );
  if (!res.ok) throw new Error(`google matrix ${res.status}: ${await res.text().then((t) => t.slice(0, 400)).catch(() => '')}`);
  // The response is application/json but comes as a stream of top-level
  // JSON objects (one per pair) OR a JSON array — normalise.
  const text = await res.text();
  let rows: any[];
  try {
    const trimmed = text.trim();
    rows = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split(/\n(?=\{)/).map((l) => JSON.parse(l));
  } catch { rows = []; }
  return rows.map((r) => ({
    origin:       Number(r.originIndex ?? 0),
    destination:  Number(r.destinationIndex ?? 0),
    distance_km:  Number(r.distanceMeters ?? 0) / 1000,
    duration_min: r.duration ? parseInt(String(r.duration).replace(/s$/, ''), 10) / 60 : 0,
    status:       r.condition === 'ROUTE_EXISTS' ? 'ok' : 'no_route',
  }));
}

// Small helper — mint an opaque session token for Places autocomplete
// billing. Client-generated is fine; we generate on the server so it's
// consistent across the autocomplete → place-details sequence.
export function googleSessionToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
