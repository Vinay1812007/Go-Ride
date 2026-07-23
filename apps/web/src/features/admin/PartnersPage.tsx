// Admin — D2C partners. Create, list, activate/deactivate. Plaintext API
// key + webhook secret are shown ONCE at creation time; only SHA-256 hash
// lives in the DB after that.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { inr } from '@/lib/format';

interface Partner {
  id: string;
  business_name: string;
  contact_email: string;
  api_key_prefix: string;
  webhook_url?: string | null;
  active: boolean;
  rate_limit_per_min: number;
  created_at: string;
}

interface CreatedPartner {
  partner: Partner;
  api_key: string;
  webhook_secret: string;
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedPartner | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await api.get<{ partners: Partner[] }>('/admin/partners');
      setPartners(res.partners);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load partners');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  return (
    <div className="p-4 max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">D2C Partners</h1>
          <p className="text-xs text-slate-500 mt-1">
            Businesses that create parcel / delivery orders via the API.
            Each partner has an API key (hashed) and an optional webhook URL for status callbacks.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary py-2">
          + New partner
        </button>
      </div>

      {error && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-400 rounded-xl p-3">
          {error}
        </div>
      )}

      {loading && partners.length === 0 && (
        <div className="card text-center py-10 text-slate-500">Loading…</div>
      )}
      {!loading && partners.length === 0 && (
        <div className="card text-center py-10 text-slate-500">
          No partners yet. Click "New partner" to onboard one.
        </div>
      )}

      {partners.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left p-3">Business</th>
                <th className="text-left p-3">Contact</th>
                <th className="text-left p-3">API key</th>
                <th className="text-left p-3">Webhook</th>
                <th className="text-right p-3">Rate/min</th>
                <th className="text-center p-3">Active</th>
                <th className="text-left p-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} className={`border-t border-surface-border ${!p.active ? 'opacity-50' : ''}`}>
                  <td className="p-3 font-medium">{p.business_name}</td>
                  <td className="p-3 text-slate-600">{p.contact_email}</td>
                  <td className="p-3 font-mono text-xs">{p.api_key_prefix}…</td>
                  <td className="p-3 text-xs text-slate-500 truncate max-w-[220px]">
                    {p.webhook_url ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="p-3 text-right">{inr(p.rate_limit_per_min).replace('₹', '')}</td>
                  <td className="p-3 text-center">
                    <span className={`chip text-[10px] ${
                      p.active
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-400'
                        : 'bg-slate-100 text-slate-600 border border-slate-300'
                    }`}>
                      {p.active ? 'active' : 'disabled'}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-slate-500">{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && !justCreated && (
        <CreatePartnerModal
          onClose={() => setCreating(false)}
          onCreated={(p) => { setJustCreated(p); void load(); }}
        />
      )}

      {justCreated && (
        <SecretsRevealModal
          data={justCreated}
          onClose={() => { setJustCreated(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

// ---------------------------- Create form ----------------------------

function CreatePartnerModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (p: CreatedPartner) => void;
}) {
  const [business_name, setName] = useState('');
  const [contact_email, setEmail] = useState('');
  const [webhook_url, setWebhook] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api.post<CreatedPartner>('/admin/partners', {
        business_name,
        contact_email,
        webhook_url: webhook_url.trim() || undefined,
      });
      onCreated(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
      >
        <header className="p-5 border-b border-surface-border flex items-center justify-between">
          <h2 className="text-lg font-bold">New D2C partner</h2>
          <button type="button" onClick={onClose} className="text-2xl text-slate-500" aria-label="Close">×</button>
        </header>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Business name</span>
            <input
              className="input mt-1"
              value={business_name}
              onChange={(e) => setName(e.target.value)}
              required minLength={2} maxLength={80}
              placeholder="Ravi's Cloud Kitchen"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Contact email</span>
            <input
              type="email"
              className="input mt-1"
              value={contact_email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="ravi@example.com"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Webhook URL <span className="text-slate-400">(optional)</span></span>
            <input
              type="url"
              className="input mt-1"
              value={webhook_url}
              onChange={(e) => setWebhook(e.target.value)}
              placeholder="https://ravi-kitchen.com/goride-webhook"
            />
            <span className="text-[10px] text-slate-500">
              We'll POST status updates here (arrived, picked_up, delivered) with an HMAC signature.
            </span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <footer className="p-5 border-t border-surface-border flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Creating…' : 'Create partner'}
          </button>
        </footer>
      </form>
    </div>
  );
}

// ---------------------------- Secrets reveal ----------------------------

function SecretsRevealModal({ data, onClose }: { data: CreatedPartner; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* noop */ }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
        <header className="p-5 border-b border-surface-border">
          <h2 className="text-lg font-bold">Partner created</h2>
          <p className="text-xs text-slate-500 mt-1">
            Copy these two values now and send them to <span className="font-medium">{data.partner.contact_email}</span>.
            {' '}Neither will be shown again — only SHA-256 hashes are stored.
          </p>
        </header>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">API key</div>
            <div className="flex gap-2">
              <code className="flex-1 rounded-lg bg-surface-muted px-3 py-2 text-xs font-mono break-all">
                {data.api_key}
              </code>
              <button
                onClick={() => copy(data.api_key)}
                className="btn-ghost text-xs border border-surface-border"
              >
                Copy
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Used in every request: <code>X-API-Key: {data.api_key.slice(0, 16)}…</code>
            </p>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Webhook signing secret</div>
            <div className="flex gap-2">
              <code className="flex-1 rounded-lg bg-surface-muted px-3 py-2 text-xs font-mono break-all">
                {data.webhook_secret}
              </code>
              <button
                onClick={() => copy(data.webhook_secret)}
                className="btn-ghost text-xs border border-surface-border"
              >
                Copy
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Used to verify HMAC-SHA256 signature on incoming webhooks. Header: <code>X-GoRide-Signature: v1=&lt;sig&gt;</code>
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm pt-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="h-4 w-4"
            />
            <span>I've saved both values somewhere safe</span>
          </label>
        </div>
        <footer className="p-5 border-t border-surface-border flex justify-end">
          <button onClick={onClose} disabled={!confirmed} className="btn-primary">
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
