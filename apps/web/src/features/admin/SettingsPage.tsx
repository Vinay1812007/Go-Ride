// Admin — org settings, feature flags, branding, admin roster.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import Badge from '@/components/ui/Badge';
import Avatar from '@/components/ui/Avatar';

interface Settings {
  org?:      { name?: string; support_phone?: string; support_email?: string; default_city?: string; currency?: string };
  features?: { surge?: boolean; food?: boolean; parcel?: boolean; scheduled?: boolean; referrals?: boolean };
  branding?: { primary_color?: string; logo_url?: string };
  withdraw?: { min_paise?: number; max_per_day?: number; methods?: string[] };
}

interface Admin { id: string; full_name: string; phone: string | null; email: string | null; created_at: string; }

export default function AdminSettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>({});
  const [admins, setAdmins]   = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [promoteId, setPromoteId] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        api.get<{ settings: Settings }>('/admin/settings'),
        api.get<{ admins: Admin[] }>('/admin/admins'),
      ]);
      setSettings(s.settings ?? {});
      setAdmins(a.admins ?? []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const save = async (key: keyof Settings, value: unknown) => {
    setSaving(true);
    try {
      await api.patch('/admin/settings', { [key]: value });
      toast.success('Saved');
      setSettings({ ...settings, [key]: value } as Settings);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const promote = async () => {
    if (!promoteId.trim()) return;
    try {
      await api.post('/admin/admins/promote', { profile_id: promoteId.trim() });
      toast.success('Promoted');
      setPromoteId('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Promote failed');
    }
  };

  const demote = async (id: string) => {
    if (!confirm('Revoke admin role from this user?')) return;
    try {
      await api.post('/admin/admins/demote', { profile_id: id });
      toast.success('Revoked');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Demote failed');
    }
  };

  if (loading) return <div className="p-6 max-w-4xl mx-auto"><Skeleton className="h-32 w-full mb-3" /><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-xs text-slate-500">Org config, feature flags, admin roster.</p>
      </div>

      {/* Org details */}
      <SettingsCard title="Organisation">
        <FormRow label="Organisation name" value={settings.org?.name ?? ''}
          onSave={(v) => save('org', { ...settings.org, name: v })} disabled={saving} />
        <FormRow label="Support phone" value={settings.org?.support_phone ?? ''} placeholder="+91 …"
          onSave={(v) => save('org', { ...settings.org, support_phone: v })} disabled={saving} />
        <FormRow label="Support email" value={settings.org?.support_email ?? ''} placeholder="support@…"
          onSave={(v) => save('org', { ...settings.org, support_email: v })} disabled={saving} />
        <FormRow label="Default city" value={settings.org?.default_city ?? ''}
          onSave={(v) => save('org', { ...settings.org, default_city: v })} disabled={saving} />
        <FormRow label="Currency (ISO)" value={settings.org?.currency ?? 'INR'}
          onSave={(v) => save('org', { ...settings.org, currency: v.toUpperCase() })} disabled={saving} />
      </SettingsCard>

      {/* Feature flags */}
      <SettingsCard title="Feature flags">
        <p className="text-xs text-slate-500 mb-2 -mt-1">Turn features on or off for the whole platform. Clients read these on load.</p>
        {(['surge', 'food', 'parcel', 'scheduled', 'referrals'] as const).map((k) => (
          <div key={k} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-none">
            <div>
              <div className="font-medium capitalize">{k}</div>
              <div className="text-xs text-slate-500">{k === 'surge' ? 'Dynamic pricing per zone' : k === 'food' ? 'Food ordering flow' : k === 'parcel' ? 'Parcel delivery flow' : k === 'scheduled' ? 'Book rides in advance' : 'Referral bonuses'}</div>
            </div>
            <Toggle
              value={!!settings.features?.[k]}
              onChange={(v) => save('features', { ...settings.features, [k]: v })}
              disabled={saving}
            />
          </div>
        ))}
      </SettingsCard>

      {/* Branding */}
      <SettingsCard title="Branding">
        <FormRow label="Primary colour (hex)" value={settings.branding?.primary_color ?? '#F5B60A'}
          onSave={(v) => save('branding', { ...settings.branding, primary_color: v })}
          right={<div className="w-8 h-8 rounded-lg border" style={{ background: settings.branding?.primary_color ?? '#F5B60A' }} />}
          disabled={saving} />
        <FormRow label="Logo URL" value={settings.branding?.logo_url ?? ''} placeholder="https://…" onSave={(v) => save('branding', { ...settings.branding, logo_url: v })} disabled={saving} />
      </SettingsCard>

      {/* Withdraw config */}
      <SettingsCard title="Captain withdrawals">
        <FormRow label="Minimum amount (₹)" value={String((settings.withdraw?.min_paise ?? 10000) / 100)}
          onSave={(v) => save('withdraw', { ...settings.withdraw, min_paise: Math.round(parseFloat(v || '0') * 100) })}
          disabled={saving} type="number" />
        <FormRow label="Max per day" value={String(settings.withdraw?.max_per_day ?? 1)}
          onSave={(v) => save('withdraw', { ...settings.withdraw, max_per_day: parseInt(v || '1', 10) })}
          disabled={saving} type="number" />
      </SettingsCard>

      {/* Admin roster */}
      <SettingsCard title={`Admins (${admins.length})`}>
        <div className="space-y-2 mb-4">
          {admins.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50">
              <Avatar name={a.full_name} size="md" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{a.full_name}</div>
                <div className="text-xs text-slate-500 truncate">{a.email ?? a.phone ?? a.id}</div>
              </div>
              <Badge tone="danger">admin</Badge>
              <button onClick={() => demote(a.id)} className="text-xs text-red-600 hover:underline">Revoke</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-3 border-t border-slate-100">
          <input className="input flex-1"
            placeholder="Profile ID to promote (from /admin/riders or Supabase)"
            value={promoteId} onChange={(e) => setPromoteId(e.target.value)} />
          <button className="btn btn-primary" onClick={promote}>Promote</button>
        </div>
      </SettingsCard>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="text-lg font-bold mb-3">{title}</h2>
      {children}
    </section>
  );
}

function FormRow({ label, value, onSave, disabled, placeholder, right, type = 'text' }: {
  label: string; value: string; onSave: (v: string) => void;
  disabled?: boolean; placeholder?: string; right?: React.ReactNode; type?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const dirty = local !== value;
  return (
    <div className="flex items-end gap-2 py-2">
      <label className="block flex-1">
        <div className="text-xs font-semibold text-slate-600 mb-1">{label}</div>
        <div className="flex items-center gap-2">
          <input className="input flex-1" type={type} value={local} placeholder={placeholder}
            onChange={(e) => setLocal(e.target.value)} disabled={disabled} />
          {right}
        </div>
      </label>
      <button
        onClick={() => onSave(local)} disabled={disabled || !dirty}
        className={`btn ${dirty ? 'btn-primary' : 'btn-ghost'} text-sm`}
      >
        Save
      </button>
    </div>
  );
}

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!value)} disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition ${value ? 'bg-brand-500' : 'bg-slate-300'} ${disabled ? 'opacity-50' : ''}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
    </button>
  );
}
