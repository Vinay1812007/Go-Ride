import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap, type Marker } from 'maplibre-gl';
import { createMap, decodePolyline, DEFAULT_CENTER } from '@/lib/geo';
import type { LatLng } from '@/lib/types';

interface Props {
  pickup?: LatLng | null;
  drop?: LatLng | null;
  rider?: (LatLng & { heading?: number }) | null;
  routePolyline?: string;
  center?: LatLng;
  onMapClick?: (p: LatLng) => void;
  className?: string;
  /** Ghost captain markers to render around pickup (Uber "cars in your area"). */
  nearby?: Array<{ lat: number; lng: number; vehicle_type?: string }>;
}

// Emoji per vehicle type for the ghost markers.
const VEHICLE_EMOJI: Record<string, string> = {
  bike: '🛵', scooter: '🛵', auto: '🛺',
  cab_4: '🚗', cab_7: '🚙',
  parcel_bike: '🛵', parcel_auto: '🛺', parcel_truck: '🚚',
};

export default function MapView({ pickup, drop, rider, routePolyline, center, onMapClick, className, nearby }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<{ pickup?: Marker; drop?: Marker; rider?: Marker; nearby?: Marker[] }>({});

  // Init once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const m = createMap(containerRef.current, center ?? DEFAULT_CENTER);
    mapRef.current = m;
    if (onMapClick) {
      m.on('click', (e) => onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    }
    return () => {
      m.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pickup marker
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (pickup) {
      if (!markersRef.current.pickup) {
        markersRef.current.pickup = new maplibregl.Marker({ color: '#0F172A' })
          .setLngLat([pickup.lng, pickup.lat])
          .addTo(m);
      } else {
        markersRef.current.pickup.setLngLat([pickup.lng, pickup.lat]);
      }
    } else {
      markersRef.current.pickup?.remove();
      markersRef.current.pickup = undefined;
    }
  }, [pickup]);

  // Drop marker
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (drop) {
      if (!markersRef.current.drop) {
        markersRef.current.drop = new maplibregl.Marker({ color: '#F5B60A' })
          .setLngLat([drop.lng, drop.lat])
          .addTo(m);
      } else {
        markersRef.current.drop.setLngLat([drop.lng, drop.lat]);
      }
    } else {
      markersRef.current.drop?.remove();
      markersRef.current.drop = undefined;
    }
  }, [drop]);

  // Rider marker (rotated by heading)
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !rider) return;
    if (!markersRef.current.rider) {
      const el = document.createElement('div');
      el.className = 'h-8 w-8 rounded-full bg-brand-500 border-2 border-white shadow-card grid place-items-center';
      el.innerHTML = '<span style="font-size:14px">🛵</span>';
      markersRef.current.rider = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
        .setLngLat([rider.lng, rider.lat])
        .addTo(m);
    } else {
      markersRef.current.rider.setLngLat([rider.lng, rider.lat]);
    }
    if (typeof rider.heading === 'number') {
      markersRef.current.rider.setRotation(rider.heading);
    }
  }, [rider]);

  // Ghost captain markers (small vehicle emojis around the pickup).
  // Efficient rebuild — captain positions change every 15s and we keep the
  // count low (~30), so removing+re-adding is fine.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    // Clear existing
    (markersRef.current.nearby ?? []).forEach((mk) => mk.remove());
    markersRef.current.nearby = [];
    if (!nearby || nearby.length === 0) return;
    for (const c of nearby) {
      const el = document.createElement('div');
      el.className = 'h-7 w-7 rounded-full bg-white border border-slate-200 shadow grid place-items-center';
      el.style.opacity = '0.85';
      el.innerHTML = `<span style="font-size:14px">${VEHICLE_EMOJI[c.vehicle_type ?? ''] ?? '🚗'}</span>`;
      const mk = new maplibregl.Marker({ element: el })
        .setLngLat([c.lng, c.lat])
        .addTo(m);
      markersRef.current.nearby.push(mk);
    }
  }, [nearby]);

  // Fit bounds to include pickup+drop (and route)
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (routePolyline) {
      const coords = decodePolyline(routePolyline);
      if (coords.length) {
        // Add or update the route source/layer
        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords.map(([lat, lng]) => [lng, lat]) },
          }],
        };
        const src = m.getSource('route') as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(geojson);
        } else if (m.isStyleLoaded()) {
          m.addSource('route', { type: 'geojson', data: geojson });
          m.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#0F172A', 'line-width': 4, 'line-opacity': 0.9 },
          });
        } else {
          m.once('style.load', () => {
            if (!m.getSource('route')) {
              m.addSource('route', { type: 'geojson', data: geojson });
              m.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': '#0F172A', 'line-width': 4, 'line-opacity': 0.9 },
              });
            }
          });
        }
        // Fit
        const b = new maplibregl.LngLatBounds();
        coords.forEach(([lat, lng]) => b.extend([lng, lat]));
        m.fitBounds(b, { padding: 80, maxZoom: 15, duration: 400 });
      }
    } else if (pickup && drop) {
      const b = new maplibregl.LngLatBounds()
        .extend([pickup.lng, pickup.lat])
        .extend([drop.lng, drop.lat]);
      m.fitBounds(b, { padding: 80, maxZoom: 15, duration: 400 });
    } else if (pickup) {
      m.easeTo({ center: [pickup.lng, pickup.lat], zoom: 14 });
    }
  }, [pickup, drop, routePolyline]);

  return <div ref={containerRef} className={className ?? 'h-full w-full'} />;
}
