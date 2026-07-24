// Saved-places hook — one fetch, one refresh method.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface SavedPlace {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  place_type: 'home' | 'work' | 'other';
  created_at: string;
  updated_at: string;
}

export function useSavedPlaces() {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ places: SavedPlace[] }>('/places');
      setPlaces(res.places);
    } catch { /* leave as-is */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { places, loading, refresh };
}
