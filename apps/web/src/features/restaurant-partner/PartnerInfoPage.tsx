// Restaurant info page — partner-editable subset (description, phone,
// image, avg_prep_min, open/closed toggle). Business-critical fields
// (city, lat, lng, min_order) require admin.
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';

interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
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
  description?: string | null;
}

export default function PartnerInfoPage({ restaurant, onChange }: { restaurant: Restaurant; onChange: () => void }) {
  const [form, setForm] = useState({
    description:  restaurant.description  ?? '',
    phone:        restaurant.phone        ?? '',
    image_url:    restaurant.image_url    ?? '',
    avg_prep_min: restaurant.avg_prep_min,
    active:       restaurant.active,
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    setSaving(true);
    try {
      await api.patch('/partner-restaurant/restaurant', {
        description:  form.description || null,
        phone:        form.phone       || null,
        image_url:    form.image_url   || null,
        avg_prep_min: form.avg_prep_min,
        active:       form.active,
      });
      toast.success('Saved');
      onChange();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-lg font-bold mb-3">Restaurant info</h1>

      {/* Read-only header showing what admin owns */}
      <div className="card mb-4 bg-surface-muted">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Managed by admin</div>
        <dl className="text-sm space-y-1">
          <div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd className="font-medium">{restaurant.name}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Cuisine</dt><dd>{restaurant.cuisine}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Address</dt><dd className="text-right truncate max-w-[60%]">{restaurant.address}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">City</dt><dd>{restaurant.city}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Min order</dt><dd>{inr(restaurant.min_order)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Rating</dt><dd>★ {(restaurant.rating ?? 0).toFixed(1)}</dd></div>
        </dl>
        <p className="text-[10px] text-slate-500 mt-2">
          Contact your admin to change any of the above.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Editable</div>

        <label className="block">
          <span className="text-sm font-medium">Description</span>
          <textarea rows={3} className="input mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Phone</span>
            <input className="input mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={20} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Avg prep min</span>
            <input type="number" min={1} max={180} className="input mt-1" value={form.avg_prep_min} onChange={(e) => setForm({ ...form, avg_prep_min: parseInt(e.target.value || '20', 10) })} />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium">Image URL</span>
          <input className="input mt-1" placeholder="https://…" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} maxLength={500} />
        </label>

        <label className="flex items-center gap-3 rounded-xl bg-surface-muted p-3 cursor-pointer">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-brand-500" />
          <div className="flex-1">
            <div className="text-sm font-medium">Open for orders</div>
            <div className="text-xs text-slate-500">
              Turn off to stop showing your restaurant in the customer browse. Existing in-flight orders keep resolving.
            </div>
          </div>
        </label>

        <button onClick={save} disabled={saving} className="btn-primary w-full">
          {saving ? '…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
