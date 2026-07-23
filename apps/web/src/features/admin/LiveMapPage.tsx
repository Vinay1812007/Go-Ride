// Admin — live map of every rider currently online. Full-viewport map,
// floating stats overlay, and per-rider markers with vehicle-typed icons.
// Polls /admin/live-riders every 5s (paused when tab is hidden), diff-updates
// markers so they slide instead of teleporting between refreshes.
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MLMap, type Marker } from 'maplibre-gl';
import { createMap, DEFAULT_CENTER } from '@/lib/geo';
import { api, ApiError } from '@/lib/api';
import { serviceLabel } from '@/lib/format';
import type { ServiceType } from '@/lib/types';

interface LiveRider {
  id: string;
  city: string;
  last_lat: number;
  last_lng: number;
  status: 'online' | 'on_trip';
  vehicle_type: ServiceType;
  profiles: { full_name: string };
}

const REFRESH_MS = 5_000;

const VEHICLE_EMOJI: Record<string, string> = {
  bike: '🏍️',
  scooter: '🛵',
  auto: '🛺',
  cab_4: '🚗',
  cab_7: '🚙',
  parcel_bike: '📦',
  parcel_scooter: '📦',
  parcel_auto: '🛺',
  parcel_truck: '🚚',
  food: '🍱',
};

export default function LiveMapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const [riders, setRiders] = useState<LiveRider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LiveRider | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const m = createMap(containerRef.current, DEFAULT_CENTER);
    mapRef.current = m;
    return () => {
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current.clear();
      m.remove();
      mapRef.current = null;
    };
  }, []);

  // Fetch loop
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (!alive) return;
      if (document.hidden || !autoRefresh) {
        timer = setTimeout(tick, REFRESH_MS);
        return;
      }
      try {
        const { riders: rs } = await api.get<{ riders: LiveRider[] }>('/admin/live-riders');
        if (!alive) return;
        setRiders(rs);
        setLastUpdated(new Date());
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : 'Refresh failed');
      } finally {
        if (alive) timer = setTimeout(tick, REFRESH_MS);
      }
    }
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [autoRefresh]);

  // Diff-sync markers when the rider list changes — reuse existing markers
  // so they animate smoothly rather than being removed + re-added.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seenIds = new Set<string>();
    for (const r of riders) {
      seenIds.add(r.id);
      const existing = markersRef.current.get(r.id);
      if (existing) {
        existing.setLngLat([r.last_lng, r.last_lat]);
      } else {
        const el = document.createElement('button');
        el.className = 'goride-live-marker';
        el.setAttribute('aria-label', r.profiles.full_name);
        el.innerHTML = `
          <span class="ring"></span>
          <span class="emoji">${VEHICLE_EMOJI[r.vehicle_type] ?? '🚕'}</span>
        `;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          setSelected(r);
        });
        // status class controls color
        el.classList.add(r.status === 'on_trip' ? 'on-trip' : 'online');
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([r.last_lng, r.last_lat])
          .addTo(map);
        markersRef.current.set(r.id, marker);
      }
      // Keep the status class current on each pass
      const el = markersRef.current.get(r.id)!.getElement();
      el.classList.toggle('on-trip', r.status === 'on_trip');
      el.classList.toggle('online',  r.status === 'online');
    }

    // Remove markers for riders no longer in the list
    for (const [id, marker] of markersRef.current) {
      if (!seenIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Fit bounds on the very first load only
    if (riders.length > 0 && !mapRef.current?.getStyle().sources?.['live-fit-marker']) {
      // A trivial way to only-once-fit: use a flag stored on the map object
      const key = '_gorideFitOnce';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(map as any)[key]) {
        const bounds = new maplibregl.LngLatBounds();
        riders.forEach((r) => bounds.extend([r.last_lng, r.last_lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 500 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (map as any)[key] = true;
      }
    }
  }, [riders]);

  const onlineCount = riders.filter((r) => r.status === 'online').length;
  const onTripCount = riders.filter((r) => r.status === 'on_trip').length;

  function focusOnRider(r: LiveRider) {
    setSelected(r);
    mapRef.current?.flyTo({ center: [r.last_lng, r.last_lat], zoom: 15, duration: 700 });
  }

  return (
    <div className="h-full relative overflow-hidden">
      <style>{`
        .goride-live-marker {
          position: relative;
          height: 44px;
          width: 44px;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
        }
        .goride-live-marker .ring {
          position: absolute;
          inset: 6px;
          border-radius: 999px;
          border: 3px solid white;
          box-shadow: 0 3px 8px rgba(15,23,42,0.25);
          display: block;
        }
        .goride-live-marker.online .ring { background: #10B981; }
        .goride-live-marker.on-trip .ring { background: #F5B60A; }
        .goride-live-marker .emoji {
          position: absolute;
          inset: 6px;
          display: grid;
          place-items: center;
          font-size: 16px;
          line-height: 1;
        }
        .goride-live-marker.online::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: rgba(16,185,129,0.35);
          animation: goride-pulse 2s ease-out infinite;
          pointer-events: none;
        }
        @keyframes goride-pulse {
          0%   { transform: scale(0.6); opacity: 0.9; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>

      <div ref={containerRef} className="absolute inset-0" />

      {/* Top-left: stats + city */}
      <div className="absolute top-4 left-4 z-10 space-y-2 max-w-xs">
        <div className="bg-white rounded-2xl shadow-card p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">Fleet · live</div>
          <div className="mt-1 flex items-baseline gap-4">
            <div>
              <div className="text-3xl font-bold text-emerald-600">{onlineCount}</div>
              <div className="text-xs text-slate-500">online</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-brand-600">{onTripCount}</div>
              <div className="text-xs text-slate-500">on trip</div>
            </div>
          </div>
        </div>
        <label className="bg-white rounded-xl shadow-card p-3 flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="h-4 w-4"
          />
          <span>Auto-refresh (5s)</span>
        </label>
        <div className="text-[10px] text-slate-500 pl-1">
          {lastUpdated ? `Updated ${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s ago` : 'Loading…'}
        </div>
      </div>

      {/* Top-right: legend */}
      <div className="absolute top-4 right-4 z-10 bg-white rounded-xl shadow-card p-3 text-xs space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-emerald-500 inline-block" />
          <span>Online (available)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-brand-500 inline-block" />
          <span>On trip</span>
        </div>
      </div>

      {error && (
        <div className="absolute bottom-4 left-4 z-10 bg-red-50 border border-red-400 text-red-700 rounded-xl p-3 text-sm">
          {error}
        </div>
      )}

      {/* Bottom: rider list drawer (collapsed by default on wide screens) */}
      {riders.length === 0 && !error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-white rounded-2xl shadow-card p-6 text-center text-sm text-slate-500 max-w-sm">
          No riders online right now. Once a captain goes online, they'll show up here in a few seconds.
        </div>
      )}

      {riders.length > 0 && (
        <div className="absolute bottom-4 right-4 z-10 bg-white rounded-2xl shadow-card max-h-[70vh] w-72 overflow-y-auto">
          <header className="p-3 border-b border-surface-border sticky top-0 bg-white">
            <div className="font-semibold text-sm">Fleet ({riders.length})</div>
            <div className="text-xs text-slate-500">Tap to focus on map</div>
          </header>
          <ul className="divide-y divide-surface-border">
            {riders.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => focusOnRider(r)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-surface-muted text-left"
                >
                  <span className="text-2xl">{VEHICLE_EMOJI[r.vehicle_type] ?? '🚕'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.profiles.full_name}</div>
                    <div className="text-xs text-slate-500">
                      {serviceLabel(r.vehicle_type)} · {r.city}
                    </div>
                  </div>
                  <span
                    className={`chip text-[10px] ${
                      r.status === 'on_trip'
                        ? 'bg-brand-50 text-brand-800 border border-brand-400'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-400'
                    }`}
                  >
                    {r.status === 'on_trip' ? 'trip' : 'live'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Selected rider popup card */}
      {selected && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-24 z-20 bg-white rounded-2xl shadow-2xl p-4 max-w-sm w-[calc(100%-2rem)]"
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Captain</div>
              <div className="font-bold">{selected.profiles.full_name}</div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-2xl text-slate-400 leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div className="text-slate-500">Vehicle</div>
            <div>{serviceLabel(selected.vehicle_type)}</div>
            <div className="text-slate-500">City</div>
            <div>{selected.city}</div>
            <div className="text-slate-500">Status</div>
            <div>{selected.status === 'on_trip' ? 'On trip' : 'Available'}</div>
            <div className="text-slate-500">Location</div>
            <div className="font-mono text-[10px]">
              {selected.last_lat.toFixed(5)}, {selected.last_lng.toFixed(5)}
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
