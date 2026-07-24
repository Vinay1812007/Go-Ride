// Captain — settings & profile management.
// Sections: profile (photo + name), vehicle change, documents, KYC status,
// language / notifications, help, logout.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, supabase } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import SettingsRow, { SettingsGroup } from '@/components/ui/SettingsRow';

interface Data {
  profile: {
    id: string; full_name: string; phone: string | null; email: string | null;
    avatar_url: string | null; rating: number; created_at: string;
  } | null;
  rider: {
    vehicle_type: string; vehicle_number: string; vehicle_model: string | null;
    license_number: string | null; city: string; kyc: 'pending'|'approved'|'rejected';
    kyc_docs: Record<string, string>; wallet_balance: number; total_trips: number;
  } | null;
}

const VEHICLE_TYPES = ['bike', 'scooter', 'auto', 'cab_4', 'cab_7'];

export default function CaptainSettingsPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<'profile' | 'vehicle' | 'documents' | null>(null);

  const load = async () => {
    try {
      const r = await api.get<Data>('/riders/profile');
      setData(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const signOut = async () => {
    if (!confirm('Sign out?')) return;
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  if (loading) {
    return <div className="p-4 max-w-2xl mx-auto"><Skeleton className="h-32 w-full mb-3" /><Skeleton className="h-64 w-full" /></div>;
  }

  const kycTone = data?.rider?.kyc === 'approved' ? 'success'
                : data?.rider?.kyc === 'rejected' ? 'danger' : 'warning';

  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      {/* Header with avatar */}
      <div className="bg-surface-strong text-white p-4 pb-8">
        <button onClick={() => nav(-1)} className="text-white/80 text-sm mb-4">← Back</button>
        <div className="flex items-center gap-4">
          <Avatar src={data?.profile?.avatar_url} name={data?.profile?.full_name} size="xl" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{data?.profile?.full_name ?? 'Captain'}</h1>
            <div className="text-white/70 text-sm mt-0.5">{data?.profile?.phone ?? 'No phone'}</div>
            <div className="mt-2 flex gap-2 flex-wrap">
              <Badge tone="brand" dot>★ {data?.profile?.rating?.toFixed(1) ?? '5.0'}</Badge>
              <Badge tone={kycTone as any} dot>KYC {data?.rider?.kyc}</Badge>
              <Badge tone="info">{data?.rider?.total_trips ?? 0} trips</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 -mt-4">
        {/* Modal for editing sections */}
        {editing === 'profile' && data?.profile && (
          <ProfileEditor
            profile={data.profile}
            onDone={async () => { setEditing(null); await load(); }}
            onCancel={() => setEditing(null)}
          />
        )}
        {editing === 'vehicle' && data?.rider && (
          <VehicleEditor
            rider={data.rider}
            onDone={async () => { setEditing(null); await load(); toast.success('Vehicle updated. KYC will be re-verified.'); }}
            onCancel={() => setEditing(null)}
          />
        )}
        {editing === 'documents' && data?.rider && (
          <DocumentsEditor
            rider={data.rider}
            onDone={async () => { setEditing(null); await load(); }}
            onCancel={() => setEditing(null)}
          />
        )}

        <SettingsGroup title="Account">
          <SettingsRow
            icon={<span>👤</span>} label="Personal information"
            hint={data?.profile?.email ?? 'Name, phone, photo'}
            onClick={() => setEditing('profile')}
          />
          <SettingsRow
            icon={<span>🚗</span>} label="Vehicle"
            hint={`${data?.rider?.vehicle_type} · ${data?.rider?.vehicle_number}`}
            onClick={() => setEditing('vehicle')}
          />
          <SettingsRow
            icon={<span>📄</span>} label="Documents"
            hint={`${Object.keys(data?.rider?.kyc_docs ?? {}).length} uploaded`}
            right={<Badge tone={kycTone as any}>{data?.rider?.kyc}</Badge>}
            onClick={() => setEditing('documents')}
          />
        </SettingsGroup>

        <SettingsGroup title="Earnings & payments">
          <SettingsRow icon={<span>💰</span>} label="Withdraw balance"
            hint={`₹${data?.rider?.wallet_balance ?? 0} available`} to="/captain/withdraw" />
          <SettingsRow icon={<span>🎯</span>} label="Incentives" to="/captain/incentives" />
          <SettingsRow icon={<span>📊</span>} label="Earnings summary" to="/captain/earnings" />
          <SettingsRow icon={<span>🏆</span>} label="Leaderboard" to="/captain/leaderboard" />
        </SettingsGroup>

        <SettingsGroup title="App">
          <SettingsRow icon={<span>🌐</span>} label="Language" hint="English" onClick={() => toast.error('Coming soon')} />
          <SettingsRow icon={<span>🔔</span>} label="Notifications" hint="Push, SMS" onClick={() => toast.error('Coming soon')} />
          <SettingsRow icon={<span>🛟</span>} label="Help & support" to="/support" showChevron={false} onClick={() => toast.error('Contact ops team')} />
          <SettingsRow icon={<span>📄</span>} label="Terms & privacy" onClick={() => toast.error('Coming soon')} />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow icon={<span>🚪</span>} label="Sign out" danger showChevron={false} onClick={signOut} />
        </SettingsGroup>

        <p className="text-center text-xs text-slate-400 mt-6">GoRide Captain · v0.1</p>
      </div>
    </div>
  );
}

// ─── Editors (modal sheets) ───────────────────────────────────────────────

function ProfileEditor({ profile, onDone, onCancel }: { profile: NonNullable<Data['profile']>; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const uploadAvatar = async (file: File) => {
    setBusy(true);
    try {
      const path = `${profile.id}/${Date.now()}-${file.name}`;
      const { data: up, error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(up.path);
      setAvatarUrl(pub.publicUrl);
    } catch (e) {
      toast.error((e as Error).message ?? 'Upload failed. Bucket may not exist.');
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/riders/profile', { full_name: fullName, phone, avatar_url: avatarUrl });
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-4 mb-4 space-y-3">
      <h2 className="font-bold text-lg">Personal information</h2>
      <div className="flex items-center gap-4">
        <Avatar src={avatarUrl} name={fullName} size="xl" />
        <div>
          <button className="btn btn-secondary text-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            Change photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); }} />
        </div>
      </div>
      <label className="block">
        <div className="text-xs font-semibold text-slate-600 mb-1">Full name</div>
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} />
      </label>
      <label className="block">
        <div className="text-xs font-semibold text-slate-600 mb-1">Phone</div>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
      </label>
      <div className="flex gap-2 pt-2">
        <button className="btn btn-ghost flex-1" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function VehicleEditor({ rider, onDone, onCancel }: { rider: NonNullable<Data['rider']>; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [vehicleType, setVehicleType]     = useState(rider.vehicle_type);
  const [vehicleNumber, setVehicleNumber] = useState(rider.vehicle_number);
  const [vehicleModel, setVehicleModel]   = useState(rider.vehicle_model ?? '');
  const [licenseNumber, setLicenseNumber] = useState(rider.license_number ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/riders/profile', {
        vehicle_type: vehicleType,
        vehicle_number: vehicleNumber,
        vehicle_model: vehicleModel,
        license_number: licenseNumber,
      });
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-4 mb-4 space-y-3">
      <h2 className="font-bold text-lg">Vehicle</h2>
      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
        ⚠️ Changing vehicle details resets your KYC to <strong>pending</strong>. Admin will re-verify.
      </p>
      <label className="block">
        <div className="text-xs font-semibold text-slate-600 mb-1">Vehicle type</div>
        <select className="input" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} disabled={busy}>
          {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      <label className="block">
        <div className="text-xs font-semibold text-slate-600 mb-1">Vehicle number</div>
        <input className="input" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())} disabled={busy} />
      </label>
      <label className="block">
        <div className="text-xs font-semibold text-slate-600 mb-1">Vehicle model</div>
        <input className="input" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} disabled={busy} />
      </label>
      <label className="block">
        <div className="text-xs font-semibold text-slate-600 mb-1">Licence number</div>
        <input className="input" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} disabled={busy} />
      </label>
      <div className="flex gap-2 pt-2">
        <button className="btn btn-ghost flex-1" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function DocumentsEditor({ rider, onDone, onCancel }: { rider: NonNullable<Data['rider']>; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [docs, setDocs] = useState<Record<string, string>>(rider.kyc_docs ?? {});
  const [busy, setBusy] = useState(false);

  const upload = async (key: string, file: File) => {
    setBusy(true);
    try {
      const path = `docs/${Date.now()}-${key}-${file.name}`;
      const { data: up, error } = await supabase.storage.from('rider-docs').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: pub } = supabase.storage.from('rider-docs').getPublicUrl(up.path);
      setDocs({ ...docs, [key]: pub.publicUrl });
    } catch (e) {
      toast.error((e as Error).message ?? 'Upload failed. Ask admin to create the "rider-docs" bucket.');
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/riders/profile', { kyc_docs: docs });
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  };

  const REQUIRED: Array<[string, string, string]> = [
    ['photo',     'Selfie / profile photo', '📷'],
    ['license',   'Driving licence',        '🪪'],
    ['rc',        'Vehicle RC',             '📋'],
    ['insurance', 'Insurance certificate',  '🛡️'],
  ];

  return (
    <div className="card p-4 mb-4 space-y-3">
      <h2 className="font-bold text-lg">Documents</h2>
      <p className="text-xs text-slate-600">Upload clear photos. JPG or PNG, under 5 MB.</p>
      {REQUIRED.map(([key, label, emoji]) => (
        <div key={key} className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl">
          <div className="text-2xl">{emoji}</div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{label}</div>
            {docs[key] ? (
              <a href={docs[key]} target="_blank" rel="noreferrer" className="text-xs text-brand-800 underline">View</a>
            ) : (
              <div className="text-xs text-slate-500">Not uploaded</div>
            )}
          </div>
          <label className="btn btn-ghost text-xs">
            {docs[key] ? 'Replace' : 'Upload'}
            <input type="file" accept="image/*" className="hidden" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(key, f); }} />
          </label>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button className="btn btn-ghost flex-1" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
