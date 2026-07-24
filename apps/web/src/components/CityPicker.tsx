// Compact city picker chip.
//
// Renders as a pill button with the active city's display_name. Tapping
// opens a bottom sheet with the list of active cities. Picking one writes
// to the useCity store (localStorage-backed) and closes the sheet.
//
// Fails silently if the /geo/cities API errors — the chip still shows the
// active city name; the sheet just says "couldn't load cities".
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import BottomSheet from '@/components/ui/BottomSheet';
import { useCity } from '@/hooks/useCity';

interface City {
  city: string;
  display_name?: string | null;
  center_lat: number;
  center_lng: number;
}

export default function CityPicker() {
  const { city, setCity } = useCity();
  const [open, setOpen] = useState(false);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || cities.length > 0) return;
    setLoading(true);
    api.get<{ cities: City[] }>('/geo/cities')
      .then((r) => setCities(r.cities))
      .catch(() => setCities([]))
      .finally(() => setLoading(false));
  }, [open, cities.length]);

  const active = cities.find((c) => c.city === city);
  const label = active?.display_name ?? city;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl bg-white shadow-card px-3 py-2 text-sm font-medium flex items-center gap-1"
        aria-label={`Change city (currently ${label})`}
      >
        <span aria-hidden>📍</span>
        <span className="truncate max-w-[8rem]">{label}</span>
        <span className="text-slate-400 text-xs">▾</span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Choose your city">
        {loading && <p className="text-sm text-slate-500 py-4 text-center">Loading…</p>}
        {!loading && cities.length === 0 && (
          <p className="text-sm text-slate-500 py-4 text-center">No other cities available yet.</p>
        )}
        <ul className="divide-y divide-surface-border">
          {cities.map((c) => (
            <li key={c.city}>
              <button
                onClick={() => { setCity(c.city); setOpen(false); }}
                className={`w-full flex items-center justify-between py-3 text-left ${
                  c.city === city ? 'font-semibold text-brand-800' : ''
                }`}
              >
                <span>
                  <span className="mr-2" aria-hidden>{c.city === city ? '✓' : '  '}</span>
                  {c.display_name ?? c.city}
                </span>
                <span className="text-xs text-slate-400 font-mono">{c.city}</span>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
