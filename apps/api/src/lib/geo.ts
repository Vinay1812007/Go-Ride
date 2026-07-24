// Provider-switchable geocoding + routing. §9 spec.
//
// Provider precedence for each call:
//   1. Google Maps Platform if GOOGLE_MAPS_API_KEY is set — tried first
//      because it has the best data quality (traffic-aware routing,
//      Indian place coverage, business names in autocomplete).
//   2. On ANY Google error (credits exhausted, quota, network blip,
//      timeout), we fall back to the configured OSM provider silently.
//      That means the app keeps working even after the free tier
//      credits run out — worst case customers just get slightly worse
//      suggestions and haversine-derived ETAs.
// The fallback is per-call, not per-session: a transient Google outage
// on autocomplete doesn't disable Google for the whole session.
import type { Env } from './env';
import polyline from '@mapbox/polyline';
import { googleAutocomplete, googleReverse, googleRoute } from './google';

export interface PlaceSuggestion {
  label: string;
  lat: number;
  lng: number;
}

export interface RouteResult {
  distance_km: number;
  duration_min: number;
  polyline: string; // encoded polyline5
}

const CACHE_TTL = 60 * 60 * 24; // 24h per §9

// ------------------- Geocoding autocomplete -------------------
export async function autocomplete(
  env: Env,
  query: string,
  countryCode = 'in',
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  // Provider-independent cache key: results are equivalent enough that
  // switching providers doesn't need a cache blast. Google's higher-
  // quality result just wins the first write.
  const cacheKey = `geo:auto:${countryCode}:${q.toLowerCase()}`;
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) return cached as PlaceSuggestion[];

  // Try Google first when configured. Fall through to the OSM branch on
  // any error — logged at warn level so admin can spot credit exhaustion.
  if (env.GOOGLE_MAPS_API_KEY) {
    try {
      const g = await googleAutocomplete(env, q, countryCode);
      if (g.length > 0) {
        await env.CACHE.put(cacheKey, JSON.stringify(g), { expirationTtl: CACHE_TTL });
        return g;
      }
    } catch (e) {
      console.warn('google autocomplete failed → OSM fallback:', (e as Error).message);
    }
  }

  let results: PlaceSuggestion[] = [];
  if (env.GEOCODER === 'nominatim') {
    const url = new URL(`${env.NOMINATIM_URL}/search`);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '6');
    url.searchParams.set('countrycodes', countryCode);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GoRide/0.1 (contact via /developers)' },
    });
    if (res.ok) {
      const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
      results = data.map((d) => ({
        label: d.display_name,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
      }));
    }
  } else if (env.GEOCODER === 'locationiq' && env.GEOCODER_KEY) {
    const url = new URL('https://api.locationiq.com/v1/autocomplete');
    url.searchParams.set('key', env.GEOCODER_KEY);
    url.searchParams.set('q', q);
    url.searchParams.set('countrycodes', countryCode);
    url.searchParams.set('limit', '6');
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
      results = data.map((d) => ({
        label: d.display_name,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
      }));
    }
  } else if (env.GEOCODER === 'geoapify' && env.GEOCODER_KEY) {
    const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
    url.searchParams.set('text', q);
    url.searchParams.set('filter', `countrycode:${countryCode}`);
    url.searchParams.set('limit', '6');
    url.searchParams.set('apiKey', env.GEOCODER_KEY);
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as {
        features: Array<{ properties: { formatted: string; lat: number; lon: number } }>;
      };
      results = data.features.map((f) => ({
        label: f.properties.formatted,
        lat: f.properties.lat,
        lng: f.properties.lon,
      }));
    }
  }

  await env.CACHE.put(cacheKey, JSON.stringify(results), { expirationTtl: CACHE_TTL });
  return results;
}

// ------------------- Reverse geocode (pin-drag) -------------------
export async function reverse(
  env: Env,
  lat: number,
  lng: number,
): Promise<string> {
  const cacheKey = `geo:rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return cached;

  // Google first if configured.
  if (env.GOOGLE_MAPS_API_KEY) {
    try {
      const g = await googleReverse(env, lat, lng);
      if (g) {
        await env.CACHE.put(cacheKey, g, { expirationTtl: CACHE_TTL });
        return g;
      }
    } catch (e) {
      console.warn('google reverse failed → OSM fallback:', (e as Error).message);
    }
  }

  let label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    if (env.GEOCODER === 'nominatim') {
      const url = new URL(`${env.NOMINATIM_URL}/reverse`);
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      url.searchParams.set('format', 'json');
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GoRide/0.1' },
      });
      if (res.ok) {
        const data = (await res.json()) as { display_name?: string };
        if (data.display_name) label = data.display_name;
      }
    }
    // LocationIQ / Geoapify branches omitted for brevity — same shape.
  } catch (e) {
    console.warn('reverse geocode failed', e);
  }
  await env.CACHE.put(cacheKey, label, { expirationTtl: CACHE_TTL });
  return label;
}

// ------------------- Routing -------------------
export async function route(
  env: Env,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<RouteResult> {
  // Provider-independent key so a Google route and OSRM route for the same
  // pair collapse into the same cache entry. Traffic-aware differences
  // between calls are within our 24h TTL noise floor.
  const key = `geo:route:${from.lat.toFixed(5)},${from.lng.toFixed(5)}:${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
  const cached = await env.CACHE.get(key, 'json');
  if (cached) return cached as RouteResult;

  // Google first — better traffic-aware ETAs.
  if (env.GOOGLE_MAPS_API_KEY) {
    try {
      const g = await googleRoute(env, from, to);
      if (g && isFinite(g.distance_km) && g.distance_km > 0) {
        await env.CACHE.put(key, JSON.stringify(g), { expirationTtl: CACHE_TTL });
        return g;
      }
    } catch (e) {
      console.warn('google route failed → OSM fallback:', (e as Error).message);
    }
  }

  let result: RouteResult;
  if (env.ROUTER === 'ors' && env.ORS_KEY) {
    const res = await fetch(
      'https://api.openrouteservice.org/v2/directions/driving-car',
      {
        method: 'POST',
        headers: {
          Authorization: env.ORS_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
        }),
      },
    );
    if (!res.ok) throw new Error(`ORS ${res.status}`);
    const data = (await res.json()) as {
      routes: Array<{
        summary: { distance: number; duration: number };
        geometry: string;
      }>;
    };
    const r = data.routes[0];
    if (!r) throw new Error('ORS returned no route');
    result = {
      distance_km: r.summary.distance / 1000,
      duration_min: r.summary.duration / 60,
      polyline: r.geometry,
    };
  } else {
    // OSRM (public demo — MVP)
    const url = `${env.OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=polyline`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = (await res.json()) as {
      routes: Array<{ distance: number; duration: number; geometry: string }>;
    };
    const r = data.routes[0];
    if (!r) throw new Error('OSRM returned no route');
    result = {
      distance_km: r.distance / 1000,
      duration_min: r.duration / 60,
      polyline: r.geometry,
    };
  }
  // Fall-back: if the router returns junk, estimate via haversine at 25 km/h city speed.
  if (!isFinite(result.distance_km) || result.distance_km <= 0) {
    const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
    result = { distance_km: km, duration_min: (km / 25) * 60, polyline: '' };
  }
  await env.CACHE.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL });
  return result;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Decode a polyline for the client (used by tracking API)
export function decodePolyline(encoded: string): Array<[number, number]> {
  if (!encoded) return [];
  return polyline.decode(encoded) as Array<[number, number]>;
}
