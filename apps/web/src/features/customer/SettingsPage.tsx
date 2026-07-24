// Customer — settings & profile management, Uber/Rapido style.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, supabase } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import SettingsRow, { SettingsGroup } from '@/components/ui/SettingsRow';

interface Profile {
  id: string; full_name: string; phone: string | null; email: string | null;
  avatar_url: string | null; rating: number; created_at: string;
}

export default function CustomerSettingsPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    try {
      const r = await api.get<{ profile: Profile }>('/customer/profile');
      setProfile(r.profile);
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

  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      {/* Header */}
      <div className="bg-surface-strong text-white p-4 pb-8">
        <button onClick={() => nav(-1)} className="text-white/80 text-sm mb-4">← Back</button>
        <div className="flex items-center gap-4">
          <Avatar src={profile?.avatar_url} name={profile?.full_name} size="xl" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{profile?.full_name ?? 'Rider'}</h1>
            <div className="text-white/70 text-sm mt-0.5">{profile?.phone ?? profile?.email ?? 'No contact info'}</div>
            <div className="mt-2">
              <Badge tone="brand">★ {profile?.rating?.toFixed(1) ?? '5.0'}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 -mt-4 max-w-2xl mx-auto">
        {editing && profile && (
          <ProfileEditor profile={profile}
            onDone={async () => { setEditing(false); await load(); }}
            onCancel={() => setEditing(false)} />
        )}

        <SettingsGroup title="Account">
          <SettingsRow icon={<span>👤</span>} label="Personal information"
            hint={profile?.email ?? 'Name, phone, photo'}
            onClick={() => setEditing(true)} />
          <SettingsRow icon={<span>📍</span>} label="Saved places" hint="Home, Work, favourites" to="/places" />
          <SettingsRow icon={<span>💳</span>} label="Wallet" to="/wallet" />
        </SettingsGroup>

        <SettingsGroup title="Trips">
          <SettingsRow icon={<span>🕐</span>} label="Ride history" to="/history" />
          <SettingsRow icon={<span>🛟</span>} label="Support" to="/support" />
        </SettingsGroup>

        <SettingsGroup title="Safety">
          <SettingsRow icon={<span>🚨</span>} label="Emergency contacts"
            hint="Set up trusted contacts" onClick={() => toast.error('Coming soon')} />
          <SettingsRow icon={<span>🛡️</span>} label="Safety centre"
            hint="Share trip, SOS button, insurance" onClick={() => toast.error('Read-only for now')} />
        </SettingsGroup>

        <SettingsGroup title="Preferences">
          <SettingsRow icon={<span>🌐</span>} label="Language" hint="English" onClick={() => toast.error('Coming soon')} />
          <SettingsRow icon={<span>🔔</span>} label="Notifications" hint="Push, SMS, email" onClick={() => toast.error('Coming soon')} />
          <SettingsRow icon={<span>♿</span>} label="Accessibility" onClick={() => toast.error('Coming soon')} />
        </SettingsGroup>

        <SettingsGroup title="More">
          <SettingsRow icon={<span>🚗</span>} label="Drive with GoRide" to="/captain" />
          <SettingsRow icon={<span>ℹ️</span>} label="About GoRide" hint="Terms, privacy, licences" onClick={() => toast.error('Coming soon')} />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow icon={<span>🚪</span>} label="Sign out" danger showChevron={false} onClick={signOut} />
        </SettingsGroup>

        <p className="text-center text-xs text-slate-400 mt-6">GoRide · v0.1</p>
      </div>
    </div>
  );
}

function ProfileEditor({ profile, onDone, onCancel }: { profile: Profile; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone]       = useState(profile.phone ?? '');
  const [email, setEmail]       = useState(profile.email ?? '');
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
      await api.patch('/customer/profile', { full_name: fullName, phone, email, avatar_url: avatarUrl });
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-4 mb-4 space-y-3">
      <h2 className="font-bold text-lg">Edit profile</h2>
      <div className="flex items-center gap-4">
        <Avatar src={avatarUrl} name={fullName} size="xl" />
        <button className="btn btn-secondary text-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          Change photo
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); }} />
      </div>
      <label className="block">
        <div className="text-xs font-semibold text-slate-600 mb-1">Full name</div>
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} />
      </label>
      <label className="block">
        <div className="text-xs font-semibold text-slate-600 mb-1">Phone</div>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
      </label>
      <label className="block">
        <div className="text-xs font-semibold text-slate-600 mb-1">Email</div>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      </label>
      <div className="flex gap-2 pt-2">
        <button className="btn btn-ghost flex-1" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
