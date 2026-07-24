// Admin — restaurant + menu CRUD for the food vertical. List view with
// counts, modal for restaurant editing, expandable per-row menu editor.
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

interface Restaurant {
  id?: string;
  name: string;
  cuisine: string;
  description?: string | null;
  address: string;
  city: string;
  lat: number;
  lng: number;
  phone?: string | null;
  image_url?: string | null;
  avg_prep_min: number;
  min_order: number;
  rating?: number | null;
  active: boolean;
  menu_item_count?: number;
  menu_item_available?: number;
}

interface MenuItem {
  id?: string;
  restaurant_id: string;
  name: string;
  description?: string | null;
  price: number;
  category: string;
  image_url?: string | null;
  is_veg: boolean;
  available: boolean;
  sort_order: number;
}

const DEFAULT_RESTAURANT: Restaurant = {
  name: '',
  cuisine: 'North Indian',
  description: '',
  address: '',
  city: 'Hyderabad',
  lat: 17.3850,
  lng: 78.4867,
  phone: '',
  image_url: '',
  avg_prep_min: 25,
  min_order: 150,
  rating: 4.2,
  active: true,
};

const DEFAULT_MENU_ITEM: Omit<MenuItem, 'restaurant_id'> = {
  name: '',
  description: '',
  price: 100,
  category: 'Mains',
  image_url: '',
  is_veg: true,
  available: true,
  sort_order: 0,
};

const CATEGORIES = ['Starters', 'Mains', 'Rice', 'Breads', 'Sides', 'Drinks', 'Desserts'];

export default function RestaurantsPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Restaurant | null>(null);
  const [menuOpen, setMenuOpen] = useState<Restaurant | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [partnerModal, setPartnerModal] = useState<Restaurant | null>(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ restaurants: Restaurant[] }>('/admin/restaurants');
      setRestaurants(res.restaurants);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load restaurants');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const shown = useMemo(
    () => filter === 'active' ? restaurants.filter((r) => r.active) : restaurants,
    [restaurants, filter],
  );

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      // Clean up empty strings so they hit the DB as nulls.
      const payload = {
        ...editing,
        description: editing.description || null,
        phone: editing.phone || null,
        image_url: editing.image_url || null,
      };
      await api.post('/admin/restaurants', payload);
      toast.success(editing.id ? 'Restaurant updated' : 'Restaurant created');
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(r: Restaurant) {
    if (!r.id) return;
    try {
      await api.post('/admin/restaurants', { ...r, active: !r.active });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Toggle failed');
    }
  }

  async function softDelete(id: string, name: string) {
    if (!confirm(`Deactivate "${name}"? Customers stop seeing it, but historical food orders still resolve.`)) return;
    try {
      await api.del(`/admin/restaurants/${id}`);
      toast.success('Restaurant deactivated');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Restaurants</h1>
          <p className="text-xs text-slate-500">
            Add and manage restaurants + their menus for the food vertical.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-white rounded-full p-1 border border-surface-border">
            <button
              onClick={() => setFilter('active')}
              className={`px-3 py-1 rounded-full text-sm font-medium ${filter === 'active' ? 'bg-surface-strong text-white' : 'text-slate-600'}`}
            >
              Active
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-full text-sm font-medium ${filter === 'all' ? 'bg-surface-strong text-white' : 'text-slate-600'}`}
            >
              All
            </button>
          </div>
          <button onClick={() => setEditing({ ...DEFAULT_RESTAURANT })} className="btn-primary">
            + New restaurant
          </button>
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-52" />
            </div>
          ))}
        </div>
      )}

      {!loading && shown.length === 0 && (
        <EmptyState
          icon="🍽️"
          title="No restaurants"
          description={filter === 'active' ? 'Nothing active. Toggle All to see deactivated ones.' : 'Create your first restaurant to start the food vertical.'}
          cta={{ label: '+ New restaurant', onClick: () => setEditing({ ...DEFAULT_RESTAURANT }) }}
        />
      )}

      {!loading && shown.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {shown.map((r) => (
            <div key={r.id} className={`card ${!r.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="h-14 w-14 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0">
                  {r.image_url ? (
                    <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="h-full w-full grid place-items-center text-xl">🍽️</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-semibold truncate">{r.name}</div>
                    <div className="text-xs text-slate-500 flex-shrink-0">★ {(r.rating ?? 0).toFixed(1)}</div>
                  </div>
                  <div className="text-xs text-slate-500 truncate">{r.cuisine} · {r.city}</div>
                  <div className="text-xs text-slate-500 truncate">{r.address}</div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
                    <span>⏱ {r.avg_prep_min}m</span>
                    <span>Min {inr(r.min_order)}</span>
                    <span>
                      {r.menu_item_available ?? 0} / {r.menu_item_count ?? 0} items
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button onClick={() => setMenuOpen(r)} className="chip">Menu →</button>
                <button onClick={() => setPartnerModal(r)} className="chip">Partner →</button>
                <button onClick={() => setEditing(r)} className="chip">Edit</button>
                <button
                  onClick={() => toggleActive(r)}
                  className={`chip ${r.active ? 'bg-emerald-50 text-emerald-800 border border-emerald-400' : 'bg-slate-100 text-slate-600 border border-slate-300'}`}
                >
                  {r.active ? 'Active' : 'Inactive'}
                </button>
                {r.id && r.active && (
                  <button onClick={() => softDelete(r.id!, r.name)} className="chip text-red-600">Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Restaurant editor */}
      {editing && (
        <RestaurantEditor
          value={editing}
          saving={saving}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}

      {/* Menu editor */}
      {menuOpen?.id && (
        <MenuEditor
          restaurant={menuOpen}
          onClose={() => { setMenuOpen(null); void load(); /* refresh counts */ }}
        />
      )}

      {/* Partner assignment */}
      {partnerModal?.id && (
        <PartnerModal restaurant={partnerModal} onClose={() => setPartnerModal(null)} />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// Partner assignment modal
// -------------------------------------------------------------------------
interface ProfileMatch { id: string; full_name: string; email?: string | null; phone?: string | null; role: string; balance?: number }
interface PartnerInfo { id: string; full_name: string; email?: string | null; phone?: string | null; created_at: string }

function PartnerModal({ restaurant, onClose }: { restaurant: Restaurant; onClose: () => void }) {
  const [current, setCurrent] = useState<PartnerInfo | null | undefined>(undefined);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProfileMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function loadCurrent() {
    try {
      const res = await api.get<{ partner: PartnerInfo | null }>(`/admin/restaurants/${restaurant.id}/partner`);
      setCurrent(res.partner);
    } catch {
      setCurrent(null);
    }
  }
  useEffect(() => { void loadCurrent(); /* eslint-disable-next-line */ }, [restaurant.id]);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let cancel = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<{ profiles: ProfileMatch[] }>(`/admin/profiles/search?q=${encodeURIComponent(q.trim())}`);
        if (!cancel) setResults(res.profiles);
      } finally { if (!cancel) setSearching(false); }
    }, 300);
    return () => { cancel = true; clearTimeout(t); };
  }, [q]);

  async function assign(p: ProfileMatch) {
    if (!confirm(`Promote ${p.full_name} to restaurant partner for ${restaurant.name}?\n\nThey'll be routed to the partner portal on their next sign-in.`)) return;
    setBusy(true);
    try {
      await api.post(`/admin/restaurants/${restaurant.id}/partner`, { profile_id: p.id });
      toast.success('Assigned');
      await loadCurrent();
      setQ(''); setResults([]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Assign failed');
    } finally {
      setBusy(false);
    }
  }

  async function unassign() {
    if (!confirm(`Remove ${current?.full_name} as partner? They'll be demoted back to customer.`)) return;
    setBusy(true);
    try {
      await api.post(`/admin/restaurants/${restaurant.id}/partner`, { unassign: true });
      toast.success('Removed');
      await loadCurrent();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Unassign failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card bg-white max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">Restaurant partner</h2>
        <p className="text-xs text-slate-500 mb-3">{restaurant.name}</p>

        {current === undefined && <div className="text-sm text-slate-500">Loading…</div>}

        {current === null && (
          <div className="rounded-xl bg-surface-muted p-3 text-sm mb-3">
            No partner assigned. Search for a customer profile below to promote them.
          </div>
        )}

        {current && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-300 p-3 mb-3">
            <div className="text-xs uppercase text-emerald-800 mb-1">Currently linked</div>
            <div className="font-semibold">{current.full_name}</div>
            <div className="text-xs text-slate-600">{current.email ?? '—'} · {current.phone ?? '—'}</div>
            <button onClick={unassign} disabled={busy} className="chip text-red-600 mt-2">Remove partner</button>
          </div>
        )}

        <label className="block">
          <span className="text-sm font-medium">Search customers by email / phone / name</span>
          <input
            className="input mt-1"
            placeholder="Min 2 chars"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus={current === null}
          />
        </label>

        {searching && <div className="text-xs text-slate-500 mt-2">Searching…</div>}

        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-surface-border max-h-60 overflow-y-auto">
            {results.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.full_name}</div>
                  <div className="text-xs text-slate-500 truncate">{p.email ?? '—'} · {p.phone ?? '—'} · {p.role}</div>
                </div>
                <button
                  onClick={() => assign(p)}
                  disabled={busy || p.role === 'admin' || p.role === 'restaurant_partner'}
                  className="chip"
                  title={p.role === 'admin' ? 'Admins cannot be restaurant partners' : p.role === 'restaurant_partner' ? 'Already a partner' : ''}
                >
                  Promote
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Restaurant editor modal
// -------------------------------------------------------------------------
function RestaurantEditor({ value, saving, onChange, onCancel, onSave }: {
  value: Restaurant;
  saving: boolean;
  onChange: (v: Restaurant) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="card bg-white max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-3">{value.id ? 'Edit restaurant' : 'New restaurant'}</h2>
        <div className="space-y-3">
          <Field label="Name">
            <input className="input mt-1" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cuisine">
              <input className="input mt-1" placeholder="North Indian, Biryani, Chinese…" value={value.cuisine} onChange={(e) => onChange({ ...value, cuisine: e.target.value })} />
            </Field>
            <Field label="City">
              <input className="input mt-1" value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} />
            </Field>
          </div>
          <Field label="Address">
            <input className="input mt-1" value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lat">
              <input type="number" step="0.0001" className="input mt-1" value={value.lat} onChange={(e) => onChange({ ...value, lat: parseFloat(e.target.value || '0') })} />
            </Field>
            <Field label="Lng">
              <input type="number" step="0.0001" className="input mt-1" value={value.lng} onChange={(e) => onChange({ ...value, lng: parseFloat(e.target.value || '0') })} />
            </Field>
          </div>
          <Field label="Description">
            <textarea rows={2} className="input mt-1" value={value.description ?? ''} onChange={(e) => onChange({ ...value, description: e.target.value })} />
          </Field>
          <Field label="Image URL (optional)">
            <input className="input mt-1" placeholder="https://…" value={value.image_url ?? ''} onChange={(e) => onChange({ ...value, image_url: e.target.value })} />
          </Field>
          <Field label="Phone (optional)">
            <input className="input mt-1" value={value.phone ?? ''} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Avg prep min">
              <input type="number" min={1} className="input mt-1" value={value.avg_prep_min} onChange={(e) => onChange({ ...value, avg_prep_min: parseInt(e.target.value || '0', 10) })} />
            </Field>
            <Field label="Min order ₹">
              <input type="number" min={0} className="input mt-1" value={value.min_order} onChange={(e) => onChange({ ...value, min_order: parseFloat(e.target.value || '0') })} />
            </Field>
            <Field label="Rating (0–5)">
              <input type="number" min={0} max={5} step="0.1" className="input mt-1" value={value.rating ?? ''} onChange={(e) => onChange({ ...value, rating: e.target.value ? parseFloat(e.target.value) : null })} />
            </Field>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.active} onChange={(e) => onChange({ ...value, active: e.target.checked })} className="h-4 w-4 accent-brand-500" />
            <span className="text-sm">Active</span>
          </label>
        </div>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving || value.name.length < 2 || value.address.length < 3}
            className="btn-primary"
          >
            {saving ? '…' : value.id ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Menu editor modal
// -------------------------------------------------------------------------
function MenuEditor({ restaurant, onClose }: { restaurant: Restaurant; onClose: () => void }) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    if (!restaurant.id) return;
    setLoading(true);
    try {
      const res = await api.get<{ items: MenuItem[] }>(`/admin/restaurants/${restaurant.id}/menu`);
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [restaurant.id]);

  async function saveItem() {
    if (!editing || !restaurant.id) return;
    setSaving(true);
    try {
      const payload = {
        ...editing,
        restaurant_id: restaurant.id,
        description: editing.description || null,
        image_url: editing.image_url || null,
      };
      await api.post(`/admin/restaurants/${restaurant.id}/menu`, payload);
      toast.success(editing.id ? 'Item updated' : 'Item added');
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAvailable(item: MenuItem) {
    if (!item.id || !restaurant.id) return;
    try {
      await api.post(`/admin/restaurants/${restaurant.id}/menu`, {
        ...item,
        restaurant_id: restaurant.id,
        available: !item.available,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Toggle failed');
    }
  }

  async function removeItem(item: MenuItem) {
    if (!item.id || !restaurant.id) return;
    if (!confirm(`Delete "${item.name}"? This is permanent (menu items don't have historical FKs).`)) return;
    try {
      await api.del(`/admin/restaurants/${restaurant.id}/menu/${item.id}`);
      toast.success('Item removed');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Delete failed');
    }
  }

  const grouped = useMemo(() => {
    const buckets = new Map<string, MenuItem[]>();
    for (const it of items) {
      const arr = buckets.get(it.category) ?? [];
      arr.push(it);
      buckets.set(it.category, arr);
    }
    return Array.from(buckets.entries());
  }, [items]);

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card bg-white max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold">{restaurant.name} · Menu</h2>
            <p className="text-xs text-slate-500">{items.length} item(s), {items.filter((i) => i.available).length} available</p>
          </div>
          <button
            onClick={() => setEditing({ ...DEFAULT_MENU_ITEM, restaurant_id: restaurant.id!, sort_order: items.length + 1 } as MenuItem)}
            className="btn-primary py-2"
          >
            + Add item
          </button>
        </div>

        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="py-2 border-b border-surface-border">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 mt-1" />
          </div>
        ))}

        {!loading && items.length === 0 && (
          <EmptyState icon="📋" title="No menu items yet" description="Add the first item to make this restaurant orderable." />
        )}

        {!loading && grouped.map(([category, list]) => (
          <section key={category} className="mb-4">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 mt-2">{category}</h3>
            <div className="space-y-1">
              {list.map((it) => (
                <div key={it.id} className={`flex items-center gap-3 py-2 border-b border-surface-border ${!it.available ? 'opacity-50' : ''}`}>
                  <span
                    className={`inline-block h-3 w-3 border ${it.is_veg ? 'border-emerald-600' : 'border-red-600'} flex-shrink-0`}
                    aria-label={it.is_veg ? 'Veg' : 'Non-veg'}
                  >
                    <span className={`block h-1.5 w-1.5 m-[1px] rounded-full ${it.is_veg ? 'bg-emerald-600' : 'bg-red-600'}`} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{it.name}</div>
                    {it.description && <div className="text-xs text-slate-500 truncate">{it.description}</div>}
                  </div>
                  <div className="text-sm font-bold w-14 text-right">{inr(it.price)}</div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => toggleAvailable(it)} className="chip text-xs">
                      {it.available ? 'Available' : 'Hidden'}
                    </button>
                    <button onClick={() => setEditing(it)} className="chip text-xs">Edit</button>
                    <button onClick={() => removeItem(it)} className="chip text-xs text-red-600">×</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="card bg-white max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3">{editing.id ? 'Edit item' : 'Add item'}</h3>
            <div className="space-y-3">
              <Field label="Name">
                <input className="input mt-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Description">
                <textarea rows={2} className="input mt-1" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price ₹">
                  <input type="number" min={0} step="1" className="input mt-1" value={editing.price} onChange={(e) => setEditing({ ...editing, price: parseFloat(e.target.value || '0') })} />
                </Field>
                <Field label="Category">
                  <input
                    list="category-suggestions"
                    className="input mt-1"
                    value={editing.category}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                  />
                  <datalist id="category-suggestions">
                    {CATEGORIES.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sort order">
                  <input type="number" min={0} className="input mt-1" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value || '0', 10) })} />
                </Field>
                <div className="flex items-end gap-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={editing.is_veg} onChange={(e) => setEditing({ ...editing, is_veg: e.target.checked })} className="h-4 w-4 accent-brand-500" />
                    <span className="text-sm">Veg</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={editing.available} onChange={(e) => setEditing({ ...editing, available: e.target.checked })} className="h-4 w-4 accent-brand-500" />
                    <span className="text-sm">Available</span>
                  </label>
                </div>
              </div>
              <Field label="Image URL (optional)">
                <input className="input mt-1" placeholder="https://…" value={editing.image_url ?? ''} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} />
              </Field>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
              <button onClick={saveItem} disabled={saving || editing.name.length < 1} className="btn-primary">
                {saving ? '…' : editing.id ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
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
