// Admin — cities & service areas.
//
// Each row is a service area (circle centre + radius, or optional polygon).
// The right side of the page has a small live MapLibre preview of the
// selected city so the admin can eyeball whether the coverage looks
// right before saving.
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibre, { Map as MLMap } from 'maplibre-gl';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/cn';

interface City {
  id?: number;
  city: string;
  display_name?: string | null;
  country: string;
  timezone: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  polygon?: Array<{ lat: number; lng: number }> | null;
  active: boolean;
  created_at?: string;
  rate_card_count?: number;
  rate_card_active?: number;
}

const DEFAULT_CITY: City = {
  city: '',
  display_name: '',
  country: 'IN',
  timezone: 'Asia/Kolkata',
  center_lat: 17.3850,
  center_lng: 78.4867,
  radius_km: 25,
  polygon: null,
  active: true,
};

const TILES = import.meta.env.VITE_MAP_TILES_URL as string | undefined;

export default function CitiesPage() {
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<City | null>(null);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<City | null>(null);
  const [cloneSource, setCloneSource] = useState<string>('');
  const [cloneOverwrite, setCloneOverwrite] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ cities: City[] }>('/admin/cities');
      setCities(res.cities);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load cities');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = {
        ...editing,
        display_name: editing.display_name || editing.city,
        polygon: (editing.polygon && editing.polygon.length >= 3) ? editing.polygon : null,
      };
      await api.post('/admin/cities', payload);
      toast.success(editing.id ? 'City updated' : 'City created');
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: City) {
    if (!c.id) return;
    try {
      await api.post('/admin/cities', { ...c, active: !c.active });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Toggle failed');
    }
  }

  async function softDelete(c: City) {
    if (!c.id) return;
    if (!confirm(`Deactivate "${c.city}"?\n\nExisting rate cards + orders keep resolving, but customers stop seeing it as a service area.`)) return;
    try {
      await api.del(`/admin/cities/${c.id}`);
      toast.success('City deactivated');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Delete failed');
    }
  }

  async function cloneRateCards() {
    if (!cloneTarget || !cloneSource) return;
    setCloning(true);
    try {
      const res = await api.post<{ created: number; from: string; to: string }>(
        '/admin/cities/clone-rate-cards',
        { from_city: cloneSource, to_city: cloneTarget.city, overwrite: cloneOverwrite },
      );
      toast.success(`Cloned ${res.created} rate card${res.created === 1 ? '' : 's'} from ${res.from} to ${res.to}`);
      setCloneTarget(null); setCloneSource(''); setCloneOverwrite(false);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Clone failed');
    } finally {
      setCloning(false);
    }
  }

  const cloneCandidates = useMemo(
    () => cloneTarget ? cities.filter((c) => c.rate_card_count && c.rate_card_count > 0 && c.city !== cloneTarget.city).map((c) => c.city) : [],
    [cities, cloneTarget],
  );

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Cities & service areas</h1>
          <p className="text-xs text-slate-500">
            Each city is a coverage zone. Bootstrap a new city by adding it here, then <em>clone rate cards</em> from Hyderabad.
          </p>
        </div>
        <button onClick={() => setEditing({ ...DEFAULT_CITY })} className="btn-primary">
          + New city
        </button>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          ))}
        </div>
      )}

      {!loading && cities.length === 0 && (
        <EmptyState
          icon="🌆"
          title="No service areas"
          description="Add your first city to enable rides + food orders in that region."
          cta={{ label: '+ New city', onClick: () => setEditing({ ...DEFAULT_CITY }) }}
        />
      )}

      {!loading && cities.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cities.map((c) => (
            <div key={c.id} className={cn('card', !c.active && 'opacity-60')}>
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="font-semibold">{c.display_name || c.city}</div>
                  <div className="text-xs text-slate-500">
                    {c.city} · {c.country} · {c.timezone}
                  </div>
                </div>
                {c.polygon ? (
                  <span className="chip bg-blue-50 text-blue-800 border border-blue-400">Polygon · {c.polygon.length}pt</span>
                ) : (
                  <span className="chip">Circle · {c.radius_km}km</span>
                )}
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {c.center_lat.toFixed(4)}, {c.center_lng.toFixed(4)} · <span className="font-semibold">{c.rate_card_active ?? 0}</span> / {c.rate_card_count ?? 0} rate cards
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button onClick={() => setEditing(c)} className="chip">Edit</button>
                <button onClick={() => { setCloneTarget(c); setCloneSource(''); }} className="chip">Clone rate cards →</button>
                <button
                  onClick={() => toggleActive(c)}
                  className={cn('chip', c.active ? 'bg-emerald-50 text-emerald-800 border border-emerald-400' : 'bg-slate-100 text-slate-600 border border-slate-300')}
                >
                  {c.active ? 'Active' : 'Inactive'}
                </button>
                {c.active && (
                  <button onClick={() => softDelete(c)} className="chip text-red-600">Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CityEditor value={editing} saving={saving} onChange={setEditing} onCancel={() => setEditing(null)} onSave={save} />
      )}

      {cloneTarget && (
        <CloneRateCardsModal
          target={cloneTarget}
          candidates={cloneCandidates}
          source={cloneSource}
          overwrite={cloneOverwrite}
          onSource={setCloneSource}
          onOverwrite={setCloneOverwrite}
          onCancel={() => setCloneTarget(null)}
          onConfirm={cloneRateCards}
          busy={cloning}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// City editor with live map preview
// -------------------------------------------------------------------------
function CityEditor({ value, saving, onChange, onCancel, onSave }: {
  value: City;
  saving: boolean;
  onChange: (v: City) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [polygonRaw, setPolygonRaw] = useState<string>(
    value.polygon ? JSON.stringify(value.polygon, null, 2) : ''
  );
  const [polyErr, setPolyErr] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<MLMap | null>(null);

  // Parse polygon on change
  useEffect(() => {
    if (!polygonRaw.trim()) {
      setPolyErr(null);
      if (value.polygon) onChange({ ...value, polygon: null });
      return;
    }
    try {
      const parsed = JSON.parse(polygonRaw);
      if (!Array.isArray(parsed) || parsed.length < 3) {
        setPolyErr('Polygon needs at least 3 vertices');
        return;
      }
      for (const v of parsed) {
        if (typeof v?.lat !== 'number' || typeof v?.lng !== 'number') {
          setPolyErr('Each vertex needs {lat, lng} numbers');
          return;
        }
      }
      setPolyErr(null);
      onChange({ ...value, polygon: parsed });
    } catch {
      setPolyErr('Invalid JSON');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygonRaw]);

  // Live map preview — recreate on lat/lng/radius/polygon change (cheap)
  useEffect(() => {
    if (!mapRef.current || !TILES) return;
    mapInstance.current?.remove();
    const map = new maplibre.Map({
      container: mapRef.current,
      style: TILES,
      center: [value.center_lng, value.center_lat],
      zoom: 10,
      attributionControl: false,
    });
    mapInstance.current = map;
    map.on('load', () => {
      // Centre marker
      new maplibre.Marker({ color: '#F5B60A' }).setLngLat([value.center_lng, value.center_lat]).addTo(map);

      // Polygon layer takes priority over circle
      if (value.polygon && value.polygon.length >= 3) {
        const coords = value.polygon.map((v) => [v.lng, v.lat]);
        coords.push(coords[0]!); // close the ring
        map.addSource('poly', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} } });
        map.addLayer({ id: 'poly-fill',   type: 'fill',   source: 'poly', paint: { 'fill-color': '#F5B60A', 'fill-opacity': 0.15 } });
        map.addLayer({ id: 'poly-stroke', type: 'line',   source: 'poly', paint: { 'line-color': '#F5B60A', 'line-width': 2 } });
      } else {
        // Circle: 32-point approximation
        const points: number[][] = [];
        const km = value.radius_km;
        for (let i = 0; i <= 64; i++) {
          const angle = (i / 64) * 2 * Math.PI;
          const dLat = (km / 111) * Math.sin(angle);
          const dLng = (km / (111 * Math.cos(value.center_lat * Math.PI / 180))) * Math.cos(angle);
          points.push([value.center_lng + dLng, value.center_lat + dLat]);
        }
        map.addSource('circ', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [points] }, properties: {} } });
        map.addLayer({ id: 'circ-fill',   type: 'fill',   source: 'circ', paint: { 'fill-color': '#F5B60A', 'fill-opacity': 0.15 } });
        map.addLayer({ id: 'circ-stroke', type: 'line',   source: 'circ', paint: { 'line-color': '#F5B60A', 'line-width': 2 } });
      }
    });
    return () => { map.remove(); mapInstance.current = null; };
  }, [value.center_lat, value.center_lng, value.radius_km, value.polygon]);

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="card bg-white max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-3">{value.id ? 'Edit city' : 'New city'}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Field label="City slug (used in rate_cards.city — pick something stable)">
              <input className="input mt-1 font-mono" value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} maxLength={60} />
            </Field>
            <Field label="Display name">
              <input className="input mt-1" placeholder="Hyderabad, TS" value={value.display_name ?? ''} onChange={(e) => onChange({ ...value, display_name: e.target.value })} maxLength={100} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country (ISO2)"><input className="input mt-1 font-mono uppercase" value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} /></Field>
              <Field label="Timezone"><input className="input mt-1" value={value.timezone} onChange={(e) => onChange({ ...value, timezone: e.target.value })} maxLength={60} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Centre lat"><input type="number" step="0.0001" className="input mt-1" value={value.center_lat} onChange={(e) => onChange({ ...value, center_lat: parseFloat(e.target.value || '0') })} /></Field>
              <Field label="Centre lng"><input type="number" step="0.0001" className="input mt-1" value={value.center_lng} onChange={(e) => onChange({ ...value, center_lng: parseFloat(e.target.value || '0') })} /></Field>
              <Field label="Radius km"><input type="number" step="1" min="1" max="200" className="input mt-1" value={value.radius_km} onChange={(e) => onChange({ ...value, radius_km: parseFloat(e.target.value || '25') })} /></Field>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={value.active} onChange={(e) => onChange({ ...value, active: e.target.checked })} className="h-4 w-4 accent-brand-500" />
              <span className="text-sm">Active</span>
            </label>
            <Field label="Polygon (optional) — JSON array of {lat, lng} vertices; overrides the circle above.">
              <textarea
                rows={5}
                className="input mt-1 font-mono text-xs"
                placeholder='[{"lat":17.5,"lng":78.4},{"lat":17.5,"lng":78.6},{"lat":17.3,"lng":78.6},{"lat":17.3,"lng":78.4}]'
                value={polygonRaw}
                onChange={(e) => setPolygonRaw(e.target.value)}
              />
              {polyErr && <p className="text-xs text-red-600 mt-1">{polyErr}</p>}
              {!polyErr && value.polygon && (
                <p className="text-xs text-emerald-700 mt-1">✓ {value.polygon.length} vertices — polygon overrides circle</p>
              )}
            </Field>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Preview</div>
            <div ref={mapRef} className="rounded-xl overflow-hidden h-72 md:h-full border border-surface-border bg-slate-100">
              {!TILES && <div className="h-full grid place-items-center text-xs text-slate-500 p-3 text-center">Map preview needs VITE_MAP_TILES_URL</div>}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button onClick={onSave} disabled={saving || value.city.length < 2 || !!polyErr} className="btn-primary">
            {saving ? '…' : value.id ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Clone rate cards modal
// -------------------------------------------------------------------------
function CloneRateCardsModal({ target, candidates, source, overwrite, onSource, onOverwrite, onCancel, onConfirm, busy }: {
  target: City;
  candidates: string[];
  source: string;
  overwrite: boolean;
  onSource: (v: string) => void;
  onOverwrite: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="card bg-white max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">Clone rate cards</h2>
        <p className="text-xs text-slate-500 mb-3">
          Copy every rate card from a source city into <strong>{target.city}</strong>. You can tweak the individual card fields (base fare, per-km, surge) afterwards.
        </p>
        <div className="space-y-3">
          <Field label="Source city">
            <select className="input mt-1" value={source} onChange={(e) => onSource(e.target.value)}>
              <option value="">Choose one…</option>
              {candidates.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {candidates.length === 0 && (
              <p className="text-xs text-amber-700 mt-1">No other city has rate cards yet.</p>
            )}
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={overwrite} onChange={(e) => onOverwrite(e.target.checked)} className="mt-1 h-4 w-4 accent-brand-500" />
            <span>
              Overwrite existing rate cards in <strong>{target.city}</strong> if any conflict on (city, service).
              <span className="block text-xs text-slate-500">Leave off to only insert cards for services not yet defined.</span>
            </span>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button onClick={onConfirm} disabled={busy || !source} className="btn-primary">
            {busy ? '…' : 'Clone rate cards'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
