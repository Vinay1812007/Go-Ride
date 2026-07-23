// Admin — promo code editor. Full CRUD via /admin/promos.
// Soft-delete flips active=false so historical redemptions still resolve.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

interface Promo {
  id?: string;
  code: string;
  description?: string | null;
  discount_type: 'percent' | 'flat';
  discount_value: number;
  max_discount?: number | null;
  min_order: number;
  applies_to: 'all' | 'ride' | 'parcel' | 'food';
  valid_from?: string;
  valid_until?: string | null;
  usage_limit_per_user: number;
  total_usage_limit?: number | null;
  times_used?: number;
  active: boolean;
}

const DEFAULT_PROMO: Promo = {
  code: '',
  description: '',
  discount_type: 'flat',
  discount_value: 50,
  max_discount: null,
  min_order: 100,
  applies_to: 'all',
  usage_limit_per_user: 1,
  total_usage_limit: null,
  active: true,
};

export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Promo | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ promos: Promo[] }>('/admin/promos');
      setPromos(res.promos);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load promos');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      await api.post('/admin/promos', editing);
      toast.success(editing.id ? 'Promo updated' : 'Promo created');
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Promo) {
    if (!p.id) return;
    try {
      await api.post('/admin/promos', { ...p, active: !p.active });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Toggle failed');
    }
  }

  async function softDelete(id: string) {
    if (!confirm('Soft-delete this promo? Existing redemptions stay intact; new customers can no longer apply the code.')) return;
    try {
      await api.del(`/admin/promos/${id}`);
      toast.success('Promo deactivated');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Promo codes</h1>
          <p className="text-xs text-slate-500">
            Percent or flat discounts, optionally scoped to a service and per-user limits.
          </p>
        </div>
        <button onClick={() => setEditing({ ...DEFAULT_PROMO })} className="btn-primary">
          + New promo
        </button>
      </div>

      {loading && (
        <div className="card p-0 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3 border-b border-surface-border last:border-none">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64 mt-1" />
            </div>
          ))}
        </div>
      )}

      {!loading && promos.length === 0 && (
        <EmptyState
          icon="🎁"
          title="No promos yet"
          description="Create WELCOME50 to give first-time customers ₹50 off, for example."
          cta={{ label: '+ New promo', onClick: () => setEditing({ ...DEFAULT_PROMO }) }}
        />
      )}

      {!loading && promos.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">Code</th>
                <th className="p-3 text-left">Discount</th>
                <th className="p-3 text-left">Applies to</th>
                <th className="p-3 text-left">Min order</th>
                <th className="p-3 text-left">Used</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id} className="border-t border-surface-border">
                  <td className="p-3 font-mono font-semibold">{p.code}</td>
                  <td className="p-3">
                    {p.discount_type === 'flat'
                      ? inr(p.discount_value)
                      : `${p.discount_value}%${p.max_discount ? ` (max ${inr(p.max_discount)})` : ''}`}
                  </td>
                  <td className="p-3 capitalize">{p.applies_to}</td>
                  <td className="p-3">{inr(p.min_order)}</td>
                  <td className="p-3">
                    {p.times_used ?? 0}
                    {p.total_usage_limit ? ` / ${p.total_usage_limit}` : ''}
                  </td>
                  <td className="p-3 text-right space-x-1">
                    <button
                      onClick={() => toggleActive(p)}
                      className={`chip ${p.active ? 'bg-emerald-50 text-emerald-800 border border-emerald-400' : 'bg-slate-100 text-slate-600 border border-slate-300'}`}
                    >
                      {p.active ? 'Active' : 'Inactive'}
                    </button>
                    <button onClick={() => setEditing(p)} className="chip">Edit</button>
                    {p.id && (
                      <button onClick={() => softDelete(p.id!)} className="chip text-red-600">Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="card bg-white max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">{editing.id ? 'Edit promo' : 'New promo'}</h2>
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium">Code</span>
                <input
                  className="input mt-1 font-mono uppercase"
                  maxLength={30}
                  value={editing.code}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Description</span>
                <input
                  className="input mt-1"
                  maxLength={200}
                  value={editing.description ?? ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium">Type</span>
                  <select
                    className="input mt-1"
                    value={editing.discount_type}
                    onChange={(e) => setEditing({ ...editing, discount_type: e.target.value as 'percent' | 'flat' })}
                  >
                    <option value="flat">Flat ₹</option>
                    <option value="percent">Percent</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Value</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="input mt-1"
                    value={editing.discount_value}
                    onChange={(e) => setEditing({ ...editing, discount_value: parseFloat(e.target.value || '0') })}
                  />
                </label>
              </div>
              {editing.discount_type === 'percent' && (
                <label className="block">
                  <span className="text-sm font-medium">Max discount (optional)</span>
                  <input
                    type="number"
                    className="input mt-1"
                    value={editing.max_discount ?? ''}
                    onChange={(e) => setEditing({ ...editing, max_discount: e.target.value ? parseFloat(e.target.value) : null })}
                  />
                </label>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium">Min order (₹)</span>
                  <input
                    type="number"
                    min={0}
                    className="input mt-1"
                    value={editing.min_order}
                    onChange={(e) => setEditing({ ...editing, min_order: parseFloat(e.target.value || '0') })}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Applies to</span>
                  <select
                    className="input mt-1"
                    value={editing.applies_to}
                    onChange={(e) => setEditing({ ...editing, applies_to: e.target.value as Promo['applies_to'] })}
                  >
                    <option value="all">All</option>
                    <option value="ride">Rides</option>
                    <option value="parcel">Parcels</option>
                    <option value="food">Food</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium">Per-user limit</span>
                  <input
                    type="number"
                    min={0}
                    className="input mt-1"
                    value={editing.usage_limit_per_user}
                    onChange={(e) => setEditing({ ...editing, usage_limit_per_user: parseInt(e.target.value || '0', 10) })}
                  />
                  <span className="text-[10px] text-slate-500">0 = unlimited</span>
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Total cap</span>
                  <input
                    type="number"
                    className="input mt-1"
                    value={editing.total_usage_limit ?? ''}
                    onChange={(e) => setEditing({ ...editing, total_usage_limit: e.target.value ? parseInt(e.target.value, 10) : null })}
                  />
                  <span className="text-[10px] text-slate-500">Blank = no cap</span>
                </label>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                  className="h-4 w-4 accent-brand-500"
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving || editing.code.length < 2} className="btn-primary">
                {saving ? '…' : editing.id ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
