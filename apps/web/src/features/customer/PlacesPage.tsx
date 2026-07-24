// Saved places CRUD for the customer.
// Layout: Home + Work cards at the top (either "Set" or "Change" state),
// followed by an Others list with add / edit / delete.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { searchPlaces } from '@/lib/geo';
import { useSavedPlaces, type SavedPlace } from '@/hooks/useSavedPlaces';
import BottomSheet from '@/components/ui/BottomSheet';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

type Kind = 'home' | 'work' | 'other';

interface EditorState {
  place_type: Kind;
  label: string;
  address: string;
  lat: number;
  lng: number;
  id?: string;
}

export default function PlacesPage() {
  const { places, loading, refresh } = useSavedPlaces();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const home  = places.find((p) => p.place_type === 'home');
  const work  = places.find((p) => p.place_type === 'work');
  const other = places.filter((p) => p.place_type === 'other');

  async function del(p: SavedPlace) {
    if (!confirm(`Remove "${p.label}"?`)) return;
    try {
      await api.del(`/places/${p.id}`);
      toast.success('Removed');
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Delete failed');
    }
  }

  function startNew(kind: Kind) {
    const existing = kind === 'home' ? home : kind === 'work' ? work : undefined;
    setEditor({
      place_type: kind,
      label: existing?.label ?? (kind === 'home' ? 'Home' : kind === 'work' ? 'Work' : ''),
      address: existing?.address ?? '',
      lat: existing?.lat ?? 0,
      lng: existing?.lng ?? 0,
      id: existing?.id,
    });
  }

  async function save() {
    if (!editor) return;
    if (editor.address.trim().length < 3 || !editor.lat || !editor.lng) {
      toast.error('Pick an address');
      return;
    }
    setSaving(true);
    try {
      await api.post('/places', {
        id: editor.id,
        label: editor.label.trim() || (editor.place_type === 'home' ? 'Home' : editor.place_type === 'work' ? 'Work' : 'Saved place'),
        address: editor.address,
        lat: editor.lat,
        lng: editor.lng,
        place_type: editor.place_type,
      });
      toast.success('Saved');
      setEditor(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full bg-surface-muted">
      <header className="bg-white border-b border-surface-border sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="text-slate-500 text-lg leading-none">←</Link>
          <div className="flex-1">
            <div className="font-bold">Saved places</div>
            <div className="text-xs text-slate-500">One-tap trip booking</div>
          </div>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4 space-y-3">
        {/* Home / Work cards */}
        {(['home', 'work'] as const).map((kind) => {
          const p = kind === 'home' ? home : work;
          return (
            <div key={kind} className="card">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-brand-50 grid place-items-center text-xl flex-shrink-0">
                  {kind === 'home' ? '🏠' : '💼'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold capitalize">{kind}</div>
                  {loading ? (
                    <Skeleton className="h-3 w-40 mt-1" />
                  ) : p ? (
                    <div className="text-xs text-slate-500 truncate">{p.address}</div>
                  ) : (
                    <div className="text-xs text-slate-400">Not set</div>
                  )}
                </div>
                <button onClick={() => startNew(kind)} className="chip">{p ? 'Change' : 'Set'}</button>
                {p && (
                  <button onClick={() => del(p)} className="chip text-red-600" aria-label="Remove">×</button>
                )}
              </div>
            </div>
          );
        })}

        {/* Other saved places */}
        <div className="card p-0 overflow-hidden">
          <div className="p-3 border-b border-surface-border flex items-baseline justify-between">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Others</div>
            <button onClick={() => startNew('other')} className="text-xs text-brand-800 font-semibold">+ Add place</button>
          </div>
          {loading && <div className="p-3"><Skeleton className="h-4 w-full" /></div>}
          {!loading && other.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-400">
              Add places you visit often — a friend's home, gym, favourite spot.
            </div>
          )}
          {other.map((p) => (
            <div key={p.id} className="p-3 border-b border-surface-border last:border-none flex items-center gap-3">
              <span className="text-lg">📍</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.label}</div>
                <div className="text-xs text-slate-500 truncate">{p.address}</div>
              </div>
              <button onClick={() => setEditor({ ...p })} className="chip">Edit</button>
              <button onClick={() => del(p)} className="chip text-red-600" aria-label="Remove">×</button>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-400 text-center pt-2">
          Saved places appear as quick chips on the destination search.
        </p>
      </div>

      {editor && (
        <PlaceEditor
          value={editor}
          saving={saving}
          onChange={setEditor}
          onCancel={() => setEditor(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

// ── Editor with autocomplete search ──────────────────────────────────────
function PlaceEditor({ value, saving, onChange, onCancel, onSave }: {
  value: EditorState;
  saving: boolean;
  onChange: (v: EditorState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [query, setQuery] = useState(value.address);
  const [results, setResults] = useState<Array<{ label: string; lat: number; lng: number }>>([]);
  const [searching, setSearching] = useState(false);

  async function doSearch(q: string) {
    if (q.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await searchPlaces(q);
      setResults(r.results);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }

  return (
    <BottomSheet
      open
      onClose={onCancel}
      title={value.place_type === 'other'
        ? (value.id ? 'Edit place' : 'Add place')
        : `${value.id ? 'Change' : 'Set'} ${value.place_type}`}
    >
      <div className="space-y-3">
        {value.place_type === 'other' && (
          <label className="block">
            <span className="text-sm font-medium">Label</span>
            <input
              className="input mt-1"
              placeholder="Gym, Mom's house, etc."
              value={value.label}
              maxLength={60}
              onChange={(e) => onChange({ ...value, label: e.target.value })}
            />
          </label>
        )}

        <label className="block">
          <span className="text-sm font-medium">Address</span>
          <input
            className="input mt-1"
            placeholder="Search for an address"
            value={query}
            onChange={(e) => { setQuery(e.target.value); void doSearch(e.target.value); }}
          />
          {value.lat !== 0 && value.address === query && (
            <p className="text-[10px] text-emerald-700 mt-1">✓ Selected — {value.lat.toFixed(4)}, {value.lng.toFixed(4)}</p>
          )}
        </label>

        {searching && <div className="text-xs text-slate-500">Searching…</div>}

        {results.length > 0 && (
          <ul className="divide-y divide-surface-border max-h-52 overflow-y-auto">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    onChange({ ...value, address: r.label, lat: r.lat, lng: r.lng });
                    setQuery(r.label);
                    setResults([]);
                  }}
                  className="w-full flex items-start gap-2 py-2 text-left"
                >
                  <span className="mt-0.5">📍</span>
                  <span className="flex-1 text-sm">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving || value.address.trim().length < 3 || value.lat === 0}
            className="btn-primary"
          >
            {saving ? '…' : 'Save'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
