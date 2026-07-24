import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MapView from '@/components/MapView';
import BottomSheet from '@/components/ui/BottomSheet';
import { useSession } from '@/lib/session';
import { getCurrentPosition, reverseGeocode, searchPlaces, DEFAULT_CENTER } from '@/lib/geo';
import type { LatLng, ServiceType } from '@/lib/types';
import { cn } from '@/lib/cn';
import CityPicker from '@/components/CityPicker';
import { detectCityFor, useCity } from '@/hooks/useCity';
import { useSavedPlaces, type SavedPlace } from '@/hooks/useSavedPlaces';
import { api } from '@/lib/api';

type Category = 'ride' | 'parcel';
type CategoryOption = { id: Category; label: string; services: ServiceType[]; icon: string };

function iconFor(kind: SavedPlace['place_type']): string {
  return kind === 'home' ? '🏠' : kind === 'work' ? '💼' : '📍';
}

const CATEGORIES: CategoryOption[] = [
  { id: 'ride',   label: 'Ride',   services: ['bike', 'auto', 'cab_4', 'cab_7'],       icon: '🚗' },
  { id: 'parcel', label: 'Parcel', services: ['parcel_bike', 'parcel_auto', 'parcel_truck'], icon: '📦' },
];

export default function HomePage() {
  const nav = useNavigate();
  const { profile, signOut } = useSession();
  const { city } = useCity();
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [pickupLabel, setPickupLabel] = useState('Fetching your location…');
  const [dropSearchOpen, setDropSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ label: string; lat: number; lng: number }>>([]);
  const [category, setCategory] = useState<Category>('ride');
  const [locError, setLocError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Array<{ lat: number; lng: number; vehicle_type?: string }>>([]);
  const { places } = useSavedPlaces();

  // Poll nearby captains for the "cars in your area" map decoration.
  useEffect(() => {
    if (!pickup) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.get<{ captains: typeof nearby }>(
          `/captains/nearby?lat=${pickup.lat}&lng=${pickup.lng}&radius=5`,
        );
        if (!cancelled) setNearby(r.captains ?? []);
      } catch { /* silent — decorative */ }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [pickup]);

  // Get GPS on mount, then reverse geocode + auto-detect city.
  useEffect(() => {
    let cancelled = false;
    getCurrentPosition().then(async (p) => {
      if (cancelled) return;
      setPickup(p);
      // Fire-and-forget city detect (respects an explicit user pick).
      void detectCityFor(p.lat, p.lng);
      try {
        const rev = await reverseGeocode(p.lat, p.lng);
        if (!cancelled) setPickupLabel(rev.label);
      } catch {
        if (!cancelled) setPickupLabel(`${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`);
      }
    }).catch(() => {
      if (cancelled) return;
      setLocError('Could not read your location. Search for a pickup instead.');
      setPickup(DEFAULT_CENTER);
      setPickupLabel(`${city} (default)`);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 3) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await searchPlaces(query);
        setSuggestions(res.results);
      } catch {
        setSuggestions([]);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  function chooseDrop(s: { label: string; lat: number; lng: number }) {
    if (!pickup) return;
    setDropSearchOpen(false);
    // Navigate to /order with state so we don't need to store globally.
    nav('/order/new', {
      state: {
        pickup: { ...pickup, address: pickupLabel },
        drop: { lat: s.lat, lng: s.lng, address: s.label },
        category,
      },
    });
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="absolute top-0 inset-x-0 z-20 p-3 flex items-center justify-between gap-2">
        <Link to="/settings" className="flex-shrink-0 rounded-full bg-white shadow-card w-11 h-11 flex items-center justify-center font-bold text-surface-strong hover:brightness-95 transition" aria-label="Settings">
          {(profile?.full_name ?? '?').charAt(0).toUpperCase()}
        </Link>
        <div className="flex-1 flex justify-center">
          <CityPicker />
        </div>
        <div className="flex gap-2">
          <Link to="/wallet" className="rounded-full bg-white shadow-card w-11 h-11 flex items-center justify-center" aria-label="Wallet">
            💳
          </Link>
          <Link to="/history" className="rounded-full bg-white shadow-card w-11 h-11 flex items-center justify-center" aria-label="History">
            🕐
          </Link>
        </div>
      </header>

      {/* Map fills the viewport */}
      <div className="absolute inset-0">
        <MapView pickup={pickup} nearby={nearby} />
      </div>
      {nearby.length > 0 && (
        <div className="absolute top-16 left-3 z-10 rounded-full bg-white shadow-card px-3 py-1 text-xs font-semibold text-emerald-700">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
          {nearby.length} captain{nearby.length === 1 ? '' : 's'} nearby
        </div>
      )}

      {/* Category tabs floating above sheet */}
      <div className="absolute z-10 left-0 right-0 bottom-[45%] flex justify-center pointer-events-none">
        <div className="pointer-events-auto flex gap-2 bg-white rounded-full shadow-card p-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium',
                category === c.id ? 'bg-brand-500 text-surface-strong' : 'text-slate-600',
              )}
            >
              <span className="mr-1">{c.icon}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom booking sheet */}
      <div className="sheet z-10 !max-h-none" style={{ bottom: 0 }}>
        <div className="sheet-handle" />
        <div className="px-5 pb-5 pt-1">
          <h2 className="text-xl font-bold mb-3">
            {category === 'ride' ? 'Where to?' : 'Send a parcel'}
          </h2>

          {locError && <p className="text-xs text-amber-700 mb-2">{locError}</p>}

          <div className="space-y-2">
            <div className="flex items-center gap-3 rounded-xl bg-surface-muted px-4 py-3">
              <span className="h-2 w-2 rounded-full bg-surface-strong" />
              <span className="text-sm truncate">{pickupLabel}</span>
              <span className="ml-auto text-xs text-slate-500">Pickup</span>
            </div>

            <button
              onClick={() => setDropSearchOpen(true)}
              disabled={!pickup}
              className="w-full flex items-center gap-3 rounded-xl border border-surface-border px-4 py-3 text-left"
            >
              <span className="h-2 w-2 rounded-full bg-brand-500" />
              <span className="text-sm text-slate-500 flex-1">
                {category === 'ride' ? 'Enter destination' : 'Enter drop location'}
              </span>
              <span className="text-slate-400">→</span>
            </button>
          </div>

          {/* Food shortcut — separate flow from ride/parcel */}
          <Link
            to="/food"
            className="mt-4 flex items-center gap-3 rounded-xl bg-brand-50 border border-brand-200 p-3 hover:bg-brand-100 transition"
          >
            <div className="h-10 w-10 rounded-xl bg-brand-500 grid place-items-center text-xl">🍽️</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-brand-800">Order food</div>
              <div className="text-xs text-brand-800/70 truncate">Biryani, South Indian, and more from local kitchens</div>
            </div>
            <span className="text-brand-800 font-bold">→</span>
          </Link>

          <div className="mt-4 flex items-center justify-between text-xs">
            <Link to="/captain" className="text-slate-500 hover:text-surface-strong font-medium">
              Drive with GoRide →
            </Link>
            <Link to="/developers" className="text-slate-400 hover:text-slate-600">Developers →</Link>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 text-center">
            © OpenStreetMap contributors
          </div>
        </div>
      </div>

      {/* Destination search sheet */}
      <BottomSheet
        open={dropSearchOpen}
        onClose={() => setDropSearchOpen(false)}
        title={category === 'ride' ? 'Where are you going?' : 'Drop location'}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a place, area, address…"
          className="input"
        />

        {/* Saved places — quick chips when the search box is empty */}
        {query.trim().length < 3 && places.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Saved</div>
            <div className="flex flex-wrap gap-2">
              {places.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  onClick={() => chooseDrop({ label: p.address, lat: p.lat, lng: p.lng })}
                  className="chip bg-brand-50 border border-brand-200 text-brand-800"
                  title={p.address}
                >
                  {iconFor(p.place_type)} {p.label}
                </button>
              ))}
              <Link to="/places" className="chip text-slate-500" onClick={() => setDropSearchOpen(false)}>Manage →</Link>
            </div>
          </div>
        )}
        {query.trim().length < 3 && places.length === 0 && (
          <p className="mt-3 text-xs text-slate-400">
            💡 <Link to="/places" className="underline" onClick={() => setDropSearchOpen(false)}>Save Home + Work</Link> for one-tap trip booking.
          </p>
        )}

        <ul className="mt-3 divide-y divide-surface-border">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                onClick={() => chooseDrop(s)}
                className="w-full flex items-start gap-3 py-3 text-left"
              >
                <span className="mt-1">📍</span>
                <span className="flex-1 text-sm">{s.label}</span>
              </button>
            </li>
          ))}
          {query.length >= 3 && suggestions.length === 0 && (
            <li className="py-6 text-center text-sm text-slate-400">No results</li>
          )}
        </ul>
      </BottomSheet>
    </div>
  );
}
