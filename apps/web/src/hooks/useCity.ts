// Single source of truth for the customer's active city.
//
// Precedence:
//   1. localStorage — user explicitly picked one from the city picker
//   2. GPS auto-detect via /geo/detect-city
//   3. VITE_DEFAULT_CITY build-time fallback
//   4. 'Hyderabad' hard fallback
//
// The picker component writes to localStorage; the HomePage GPS effect
// calls detect() on first mount. Other pages just read `city` and pass
// it into their API calls (fare quotes, order create, food browse, …).
//
// Deliberately a singleton via a module-level store instead of Context —
// keeps the API tiny (any component just imports and reads) and avoids
// re-render cascades from a Provider high in the tree.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const KEY = 'goride:city';
const DEFAULT: string =
  (import.meta.env.VITE_DEFAULT_CITY as string | undefined) ?? 'Hyderabad';

// In-memory store + subscribers so multiple useCity() hooks stay in sync.
let current: string = readInitial();
const listeners = new Set<(v: string) => void>();

function readInitial(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && v.trim()) return v.trim();
  } catch { /* private mode */ }
  return DEFAULT;
}

export function getCity(): string { return current; }

export function setCity(next: string) {
  if (!next || next === current) return;
  current = next;
  try { localStorage.setItem(KEY, next); } catch { /* noop */ }
  listeners.forEach((fn) => fn(next));
}

// Fire and forget — asks the API which city contains this lat/lng and
// updates the active city UNLESS the user has explicitly picked one.
export async function detectCityFor(lat: number, lng: number): Promise<void> {
  try {
    const explicit = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    if (explicit) return; // user's choice always wins
    const res = await api.get<{ city: string | null; display_name?: string }>(`/geo/detect-city?lat=${lat}&lng=${lng}`);
    if (res?.city) {
      // Auto-detected — don't write to localStorage (leave that for explicit picks)
      // but broadcast to subscribers.
      current = res.city;
      listeners.forEach((fn) => fn(res.city!));
    }
  } catch { /* noop — keep the fallback */ }
}

export function useCity(): { city: string; setCity: (v: string) => void } {
  const [v, setV] = useState<string>(current);
  useEffect(() => {
    const fn = (next: string) => setV(next);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return { city: v, setCity };
}
