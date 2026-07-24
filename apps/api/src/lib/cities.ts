// City / service-area helpers shared between admin and geo routes.
//
// Design: a service area is defined by center + radius (circle) OR an
// optional polygon that takes precedence. Point-in-polygon uses standard
// ray casting in plain JS — fine at pilot scale (small N cities × small
// number of vertices per city).
import type { Env } from './env';
import { admin } from './supabase';
import { haversineKm } from './geo';

export interface ServiceArea {
  id: number;
  city: string;
  display_name?: string | null;
  country: string;
  timezone: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  polygon?: Array<{ lat: number; lng: number }> | null;
  active: boolean;
}

// Standard ray-casting point-in-polygon. Vertices treated as an implicitly
// closed loop; caller can pass either an open or closed ring.
export function pointInPolygon(lat: number, lng: number, poly: Array<{ lat: number; lng: number }>): boolean {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect =
      (a.lng > lng) !== (b.lng > lng) &&
      lat < ((b.lat - a.lat) * (lng - a.lng)) / (b.lng - a.lng + 1e-12) + a.lat;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Given a point, return the best-matching active service area (polygon
// containment beats circle-distance; ties broken by smaller radius so
// nested cities work as expected — e.g. "Hyderabad Old City" wins over
// "Hyderabad" if both contain the point).
export async function detectCity(env: Env, lat: number, lng: number): Promise<ServiceArea | null> {
  const { data } = await admin(env)
    .from('service_areas')
    .select('id, city, display_name, country, timezone, center_lat, center_lng, radius_km, polygon, active')
    .eq('active', true);
  const areas = (data ?? []) as ServiceArea[];
  if (areas.length === 0) return null;

  // 1st pass — any polygon that contains the point
  const polyHits = areas.filter((a) => a.polygon && pointInPolygon(lat, lng, a.polygon));
  if (polyHits.length > 0) {
    // Prefer the tightest polygon (smallest bbox area) for nested cities.
    polyHits.sort((a, b) => polygonBboxArea(a.polygon!) - polygonBboxArea(b.polygon!));
    return polyHits[0]!;
  }

  // 2nd pass — circles by distance-to-centre within radius
  const circleHits = areas
    .map((a) => ({ a, d: haversineKm(lat, lng, a.center_lat, a.center_lng) }))
    .filter((x) => x.d <= Number(x.a.radius_km))
    .sort((x, y) => x.d - y.d);
  return circleHits[0]?.a ?? null;
}

function polygonBboxArea(poly: Array<{ lat: number; lng: number }>): number {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of poly) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return (maxLat - minLat) * (maxLng - minLng);
}
