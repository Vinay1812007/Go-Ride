// Admin — rate card editor. Full CRUD via POST /admin/rate-cards (upsert on
// city + service). Groups by city, per-row inline toggle for active/surge,
// modal editor for the full form.
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr, serviceLabel } from '@/lib/format';
import type { ServiceType } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

interface RateCard {
  id?: number;
  city: string;
  service: ServiceType;
  base_fare: number;
  base_km: number;
  per_km: number;
  per_min: number;
  min_fare: number;
  surge_multiplier: number;
  commission_pct: number;
  parcel_weight_limit_kg?: number | null;
  active: boolean;
}

const ALL_SERVICES: ServiceType[] = [
  'bike', 'scooter', 'auto', 'cab_4', 'cab_7',
  'parcel_bike', 'parcel_scooter', 'parcel_auto', 'parcel_truck', 'food',
];

// Default values for a fresh rate card — sensible starting point.
const DEFAULT_CARD: RateCard = {
  city: '',
  service: 'bike',
  base_fare: 25,
  base_km: 2,
  per_km: 9,
  per_min: 0.75,
  min_fare: 30,
  surge_multiplier: 1,
  commission_pct: 15,
  parcel_weight_limit_kg: null,
  active: true,
};

export default function RateCardsPage() {
  const [cards, setCards] = useState<RateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [editing, setEditing] = useState<RateCard | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const cities = useMemo(
    () => Array.from(new Set(cards.map((c) => c.city))).sort(),
    [cards],
  );
  const shownCards = useMemo(
    () => cityFilter === 'all' ? cards : cards.filter((c) => c.city === cityFilter),
    [cards, cityFilter],
  );
  const cardsByCity = useMemo(() => {
    const map = new Map<string, RateCard[]>();
    for (const c of shownCards) {
      const arr = map.get(c.city) ?? [];
      arr.push(c);
      map.set(c.city, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [shownCards]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ rate_cards: RateCard[] }>('/admin/rate-cards');
      setCards(res.rate_cards);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function save(card: RateCard) {
    try {
      await api.post('/admin/rate-cards', card);
      setEditing(null);
      toast.success(`Saved ${serviceLabel(card.service)} for ${card.city}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    }
  }

  async function toggleActive(card: RateCard) {
    const key = `${card.city}:${card.service}`;
    setBusyId(key);
    try {
      await api.post('/admin/rate-cards', { ...card, active: !card.active });
      toast.success(`${card.active ? 'Disabled' : 'Enabled'} ${serviceLabel(card.service)} in ${card.city}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Toggle failed');
    } finally {
      setBusyId(null);
    }
  }

  async function bumpSurge(card: RateCard, delta: number) {
    const next = Math.max(0.5, Math.min(5, Math.round((card.surge_multiplier + delta) * 100) / 100));
    if (next === card.surge_multiplier) return;
    const key = `${card.city}:${card.service}:surge`;
    setBusyId(key);
    try {
      await api.post('/admin/rate-cards', { ...card, surge_multiplier: next });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Surge update failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Rate cards</h1>
          <p className="text-xs text-slate-500 mt-1">
            Changes apply to new orders immediately. Existing orders keep their booked fare.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {cities.length > 0 && (
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="input w-auto py-2"
            >
              <option value="all">All cities</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button
            onClick={() => setEditing({ ...DEFAULT_CARD, city: cities[0] ?? '' })}
            className="btn-primary py-2"
          >
            + New rate card
          </button>
        </div>
      </div>

      {loading && cards.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" rounded="xl" />)}
        </div>
      )}
      {!loading && cards.length === 0 && (
        <EmptyState
          icon="💳"
          title="No rate cards yet"
          description="Add a rate card to start accepting orders for a city + service combination."
          cta={{ label: '+ New rate card', onClick: () => setEditing({ ...DEFAULT_CARD }) }}
        />
      )}

      {cardsByCity.map(([city, list]) => (
        <div key={city} className="mb-6">
          <div className="flex items-center justify-between mb-2 sticky top-0 bg-surface-muted -mx-4 px-4 py-2 z-10">
            <h2 className="font-bold text-lg">{city}</h2>
            <span className="text-xs text-slate-500">{list.length} services</span>
          </div>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-slate-500 uppercase">
                <tr>
                  <th className="text-left p-3">Service</th>
                  <th className="text-right p-3">Base (incl. km)</th>
                  <th className="text-right p-3">Per km</th>
                  <th className="text-right p-3">Per min</th>
                  <th className="text-right p-3">Min</th>
                  <th className="text-right p-3">Weight max</th>
                  <th className="text-center p-3">Surge</th>
                  <th className="text-right p-3">Comm</th>
                  <th className="text-center p-3">Active</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const busyKey = `${c.city}:${c.service}`;
                  return (
                    <tr key={c.id ?? busyKey} className={`border-t border-surface-border ${!c.active ? 'opacity-50' : ''}`}>
                      <td className="p-3 font-medium">{serviceLabel(c.service)}</td>
                      <td className="p-3 text-right">{inr(c.base_fare)} <span className="text-xs text-slate-400">({c.base_km} km)</span></td>
                      <td className="p-3 text-right">{inr(c.per_km)}</td>
                      <td className="p-3 text-right">{c.per_min ? inr(c.per_min) : <span className="text-slate-400">—</span>}</td>
                      <td className="p-3 text-right">{inr(c.min_fare)}</td>
                      <td className="p-3 text-right">{c.parcel_weight_limit_kg ? `${c.parcel_weight_limit_kg} kg` : <span className="text-slate-400">—</span>}</td>
                      <td className="p-3 text-center">
                        <div className="inline-flex items-center gap-1 bg-surface-muted rounded-full">
                          <button
                            onClick={() => bumpSurge(c, -0.1)}
                            disabled={busyId === `${busyKey}:surge` || c.surge_multiplier <= 0.5}
                            className="h-7 w-7 rounded-full hover:bg-slate-200 disabled:opacity-30"
                            aria-label="Decrease surge"
                          >−</button>
                          <span className={`px-2 font-mono font-semibold min-w-[3ch] text-center ${c.surge_multiplier > 1 ? 'text-red-600' : ''}`}>
                            {c.surge_multiplier.toFixed(1)}×
                          </span>
                          <button
                            onClick={() => bumpSurge(c, 0.1)}
                            disabled={busyId === `${busyKey}:surge` || c.surge_multiplier >= 5}
                            className="h-7 w-7 rounded-full hover:bg-slate-200 disabled:opacity-30"
                            aria-label="Increase surge"
                          >+</button>
                        </div>
                      </td>
                      <td className="p-3 text-right">{c.commission_pct}%</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => toggleActive(c)}
                          disabled={busyId === busyKey}
                          className={`h-6 w-11 rounded-full relative transition ${c.active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                          aria-label={c.active ? 'Disable' : 'Enable'}
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${c.active ? 'left-5' : 'left-0.5'}`}
                          />
                        </button>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setEditing({ ...c })}
                          className="btn-ghost text-xs px-3 py-1 border border-surface-border"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {editing && (
        <EditModal
          card={editing}
          isNew={!editing.id}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

// -------------------------- Edit / Create modal --------------------------

function EditModal({
  card, isNew, onClose, onSave,
}: {
  card: RateCard;
  isNew: boolean;
  onClose: () => void;
  onSave: (c: RateCard) => Promise<void>;
}) {
  const [form, setForm] = useState<RateCard>(card);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof RateCard>(key: K, value: RateCard[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Sanitize numeric fields
      const clean: RateCard = {
        ...form,
        base_fare: Number(form.base_fare),
        base_km: Number(form.base_km),
        per_km: Number(form.per_km),
        per_min: Number(form.per_min),
        min_fare: Number(form.min_fare),
        surge_multiplier: Number(form.surge_multiplier),
        commission_pct: Number(form.commission_pct),
        parcel_weight_limit_kg: form.parcel_weight_limit_kg ? Number(form.parcel_weight_limit_kg) : null,
      };
      await onSave(clean);
    } finally {
      setSaving(false);
    }
  }

  // Live fare preview at a few sample distances
  const preview = [3, 5, 10, 15].map((km) => {
    const extraKm = Math.max(0, km - form.base_km);
    const dist = extraKm * form.per_km;
    const time = km * 3 * form.per_min; // ~3 min/km rough
    const subtotal = (Number(form.base_fare) + dist + time) * Number(form.surge_multiplier);
    const total = Math.max(subtotal, Number(form.min_fare));
    return { km, fare: Math.round(total) };
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <header className="p-5 border-b border-surface-border flex items-center justify-between sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold">{isNew ? 'New rate card' : `Edit ${serviceLabel(card.service)} · ${card.city}`}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Unique per (city, service).</p>
          </div>
          <button type="button" onClick={onClose} className="text-2xl text-slate-500" aria-label="Close">×</button>
        </header>

        <div className="p-5 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">City</span>
            <input
              className="input mt-1"
              value={form.city}
              onChange={(e) => update('city', e.target.value)}
              required
              placeholder="Hyderabad"
              disabled={!isNew}
            />
            {!isNew && <span className="text-[10px] text-slate-500">City locked on edit. Create new card to change.</span>}
          </label>

          <label className="block">
            <span className="text-sm font-medium">Service</span>
            <select
              className="input mt-1"
              value={form.service}
              onChange={(e) => update('service', e.target.value as ServiceType)}
              disabled={!isNew}
            >
              {ALL_SERVICES.map((s) => <option key={s} value={s}>{serviceLabel(s)}</option>)}
            </select>
            {!isNew && <span className="text-[10px] text-slate-500">Service locked on edit.</span>}
          </label>

          <label className="block">
            <span className="text-sm font-medium">Base fare (₹)</span>
            <input type="number" min={0} step={1} className="input mt-1" value={form.base_fare}
                   onChange={(e) => update('base_fare', Number(e.target.value))} required />
            <span className="text-[10px] text-slate-500">Includes the first N km below.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Base km (included)</span>
            <input type="number" min={0} step={0.5} className="input mt-1" value={form.base_km}
                   onChange={(e) => update('base_km', Number(e.target.value))} required />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Per km (₹)</span>
            <input type="number" min={0} step={0.5} className="input mt-1" value={form.per_km}
                   onChange={(e) => update('per_km', Number(e.target.value))} required />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Per min (₹)</span>
            <input type="number" min={0} step={0.25} className="input mt-1" value={form.per_min}
                   onChange={(e) => update('per_min', Number(e.target.value))} />
            <span className="text-[10px] text-slate-500">0 = no time component.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Minimum fare (₹)</span>
            <input type="number" min={0} step={1} className="input mt-1" value={form.min_fare}
                   onChange={(e) => update('min_fare', Number(e.target.value))} required />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Surge multiplier</span>
            <input type="number" min={0.5} max={5} step={0.1} className="input mt-1" value={form.surge_multiplier}
                   onChange={(e) => update('surge_multiplier', Number(e.target.value))} required />
            <span className="text-[10px] text-slate-500">1.0 = normal · &gt;1 raises all fares in this city/service.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Commission %</span>
            <input type="number" min={0} max={50} step={0.5} className="input mt-1" value={form.commission_pct}
                   onChange={(e) => update('commission_pct', Number(e.target.value))} required />
            <span className="text-[10px] text-slate-500">Platform's cut of the fare.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Weight limit (kg) <span className="text-slate-400">— parcel only</span></span>
            <input type="number" min={0} step={1} className="input mt-1"
                   value={form.parcel_weight_limit_kg ?? ''}
                   onChange={(e) => update('parcel_weight_limit_kg', e.target.value ? Number(e.target.value) : null)}
                   placeholder="e.g. 8" />
          </label>

          <label className="flex items-center gap-2 md:col-span-2 pt-2">
            <input type="checkbox" checked={form.active}
                   onChange={(e) => update('active', e.target.checked)}
                   className="h-4 w-4" />
            <span className="text-sm">Active — accept orders using this card</span>
          </label>
        </div>

        {/* Live fare preview */}
        <div className="mx-5 mb-5 rounded-xl bg-surface-muted p-3">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Fare preview</div>
          <div className="grid grid-cols-4 gap-2">
            {preview.map((p) => (
              <div key={p.km} className="text-center">
                <div className="text-xs text-slate-500">{p.km} km</div>
                <div className="text-lg font-bold">{inr(p.fare)}</div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-slate-400 mt-2">Rough estimate assuming ~3 min per km. Real trips use OSRM-derived duration.</div>
        </div>

        <footer className="p-5 border-t border-surface-border flex gap-2 justify-end sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving || !form.city} className="btn-primary">
            {saving ? 'Saving…' : isNew ? 'Create rate card' : 'Save changes'}
          </button>
        </footer>
      </form>
    </div>
  );
}
