// Client-side geo helpers (map init, geocode/route via our Worker API).
import maplibregl, { type Map as MLMap, type LngLatLike } from 'maplibre-gl';
import polyline from '@mapbox/polyline';
import { api } from './api';
import type { LatLng } from './types';

export const DEFAULT_CENTER: LatLng = {
  lat: parseFloat(import.meta.env.VITE_DEFAULT_LAT || '17.3850'),
  lng: parseFloat(import.meta.env.VITE_DEFAULT_LNG || '78.4867'),
};

export const TILES_URL = import.meta.env.VITE_MAP_TILES_URL || 'https://tiles.openfreemap.org/styles/liberty';

export function createMap(container: HTMLDivElement, center: LatLng = DEFAULT_CENTER): MLMap {
  return new maplibregl.Map({
    container,
    style: TILES_URL,
    center: [center.lng, center.lat] as LngLatLike,
    zoom: 13,
    attributionControl: { compact: true },
  });
}

export async function watchCurrentPosition(
  onUpdate: (p: LatLng) => void,
  onError?: (e: GeolocationPositionError) => void,
): Promise<number> {
  return navigator.geolocation.watchPosition(
    (pos) => onUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    onError,
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
  );
}

export async function getCurrentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}

export function decodePolyline(encoded: string): Array<[number, number]> {
  if (!encoded) return [];
  return polyline.decode(encoded) as Array<[number, number]>;
}

export async function searchPlaces(q: string) {
  return api.get<{ results: Array<{ label: string; lat: number; lng: number }> }>(
    `/geo/autocomplete?q=${encodeURIComponent(q)}`,
  );
}

export async function reverseGeocode(lat: number, lng: number) {
  return api.get<{ label: string; lat: number; lng: number }>(
    `/geo/reverse?lat=${lat}&lng=${lng}`,
  );
}
