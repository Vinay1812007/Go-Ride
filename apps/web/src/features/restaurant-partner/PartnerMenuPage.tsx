// Menu editor for restaurant partners — mirrors the admin MenuEditor but
// scoped to their own restaurant via /partner-restaurant/menu.
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';

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

const CATEGORIES = ['Starters', 'Mains', 'Rice', 'Breads', 'Sides', 'Drinks', 'Desserts'];

const DEFAULT_ITEM: Omit<MenuItem, 'restaurant_id'> = {
  name: '',
  description: '',
  price: 100,
  category: 'Mains',
  image_url: '',
  is_veg: true,
  available: true,
  sort_order: 0,
};

export default function PartnerMenuPage({ restaurantId, onChange }: { restaurantId: string; onChange: () => void }) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ items: MenuItem[] }>('/partner-restaurant/menu');
      setItems(res.items);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load menu');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function saveItem() {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = {
        ...editing,
        restaurant_id: restaurantId,
        description: editing.description || null,
        image_url: editing.image_url || null,
      };
      await api.post('/partner-restaurant/menu', payload);
      toast.success(editing.id ? 'Item updated' : 'Item added');
      setEditing(null);
      await load();
      onChange();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAvailable(it: MenuItem) {
    if (!it.id) return;
    try {
      await api.post('/partner-restaurant/menu', { ...it, restaurant_id: restaurantId, available: !it.available });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Toggle failed');
    }
  }

  async function remove(it: MenuItem) {
    if (!it.id) return;
    if (!confirm(`Delete "${it.name}"?`)) return;
    try {
      await api.del(`/partner-restaurant/menu/${it.id}`);
      toast.success('Item removed');
      await load();
      onChange();
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
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-bold">Menu</h1>
          <p className="text-xs text-slate-500">
            {items.length} item{items.length === 1 ? '' : 's'}, {items.filter((i) => i.available).length} available
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...DEFAULT_ITEM, restaurant_id: restaurantId, sort_order: items.length + 1 })}
          className="btn-primary"
        >
          + Add item
        </button>
      </div>

      {loading && Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card mb-2 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      ))}

      {!loading && items.length === 0 && (
        <EmptyState
          icon="📋"
          title="No items yet"
          description="Add the first item to open for orders."
          cta={{ label: '+ Add item', onClick: () => setEditing({ ...DEFAULT_ITEM, restaurant_id: restaurantId }) }}
        />
      )}

      {!loading && grouped.map(([category, list]) => (
        <section key={category} className="mb-4">
          <h2 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 mt-2">{category}</h2>
          <div className="space-y-1">
            {list.map((it) => (
              <div key={it.id} className={`flex items-center gap-3 py-2 border-b border-surface-border ${!it.available ? 'opacity-50' : ''}`}>
                <span
                  className={`inline-block h-3 w-3 border ${it.is_veg ? 'border-emerald-600' : 'border-red-600'} flex-shrink-0`}
                >
                  <span className={`block h-1.5 w-1.5 m-[1px] rounded-full ${it.is_veg ? 'bg-emerald-600' : 'bg-red-600'}`} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{it.name}</div>
                  {it.description && <div className="text-xs text-slate-500 truncate">{it.description}</div>}
                </div>
                <div className="text-sm font-bold w-14 text-right">{inr(it.price)}</div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => toggleAvailable(it)} className="chip text-xs">{it.available ? 'Available' : 'Hidden'}</button>
                  <button onClick={() => setEditing(it)} className="chip text-xs">Edit</button>
                  <button onClick={() => remove(it)} className="chip text-xs text-red-600">×</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {editing && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="card bg-white max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3">{editing.id ? 'Edit item' : 'Add item'}</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium">Name</span>
                <input className="input mt-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={100} />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Description</span>
                <textarea rows={2} className="input mt-1" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={500} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium">Price ₹</span>
                  <input type="number" min={0} className="input mt-1" value={editing.price} onChange={(e) => setEditing({ ...editing, price: parseFloat(e.target.value || '0') })} />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Category</span>
                  <input
                    list="cats"
                    className="input mt-1"
                    value={editing.category}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                  />
                  <datalist id="cats">
                    {CATEGORIES.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium">Sort order</span>
                  <input type="number" min={0} className="input mt-1" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value || '0', 10) })} />
                </label>
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
              <label className="block">
                <span className="text-sm font-medium">Image URL (optional)</span>
                <input className="input mt-1" placeholder="https://…" value={editing.image_url ?? ''} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
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
