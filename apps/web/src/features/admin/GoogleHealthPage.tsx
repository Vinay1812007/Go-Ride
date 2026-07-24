// Admin — Google Maps Platform health check.
// Runs live probes against each Google API we integrate and shows which
// are working. When something's red, that call is falling back to OSM.
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

interface Check {
  name: string;
  ok: boolean;
  ms: number;
  sample?: unknown;
  error?: string;
}

interface Health {
  configured: boolean;
  all_ok?: boolean;
  message: string;
  checks: Check[];
}

const CHECK_LABELS: Record<string, { title: string; desc: string }> = {
  places_autocomplete: {
    title: 'Places Autocomplete (New v1)',
    desc: 'Powers the "search for a destination" typeahead. Falls back to Nominatim / LocationIQ / Geoapify on error.',
  },
  reverse_geocoding: {
    title: 'Reverse Geocoding',
    desc: 'Turns GPS coords into a street label. Falls back to Nominatim reverse on error.',
  },
  routes_v2: {
    title: 'Routes v2 (traffic-aware)',
    desc: 'Point-A → point-B routing with traffic. Falls back to OSRM demo / ORS on error.',
  },
  route_matrix: {
    title: 'Route Matrix v2',
    desc: 'Many-to-many driving distances — used to re-rank captains in dispatch by real driving distance. Falls back to haversine.',
  },
};

export default function GoogleHealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function run() {
    setLoading(true);
    try {
      const res = await api.get<Health>('/admin/dev/google-health');
      setData(res);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Health check failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void run(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Google Maps health</h1>
          <p className="text-xs text-slate-500">
            Live probes against each Google API we integrate. Red = that call is currently falling back to the OSM stack.
          </p>
        </div>
        <button onClick={run} disabled={loading} className="btn-primary">
          {loading ? '…' : 'Re-run'}
        </button>
      </div>

      {/* Status banner */}
      {!data && loading && <Skeleton className="h-16 w-full mb-4" />}
      {data && (
        <div className={cn(
          'card mb-4',
          !data.configured && 'border-amber-300 bg-amber-50/60',
          data.configured &&  data.all_ok && 'border-emerald-300 bg-emerald-50/60',
          data.configured && !data.all_ok && 'border-red-300 bg-red-50/60',
        )}>
          <div className="flex items-start gap-3">
            <div className="text-3xl leading-none">
              {!data.configured ? '⚠️' : data.all_ok ? '✅' : '🔴'}
            </div>
            <div>
              <div className="font-bold">
                {!data.configured ? 'Not configured' : data.all_ok ? 'All systems go' : 'Degraded — some APIs falling back'}
              </div>
              <p className="text-sm text-slate-700 mt-1">{data.message}</p>
              {!data.configured && (
                <ol className="text-xs text-slate-600 mt-3 list-decimal ml-4 space-y-1">
                  <li>Google Cloud Console → project → enable <strong>Places API (New)</strong>, <strong>Geocoding API</strong>, <strong>Routes API</strong>.</li>
                  <li>Credentials → Create API key → restrict to those three APIs.</li>
                  <li>GH → Settings → Secrets → add <code className="font-mono">GOOGLE_MAPS_API_KEY</code>.</li>
                  <li>Actions → <strong>Deploy web + api</strong> → Run workflow.</li>
                  <li>Come back and click <strong>Re-run</strong>.</li>
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Per-check cards */}
      <div className="space-y-3">
        {data?.checks.map((c) => {
          const meta = CHECK_LABELS[c.name] ?? { title: c.name, desc: '' };
          return (
            <div key={c.name} className={cn(
              'card',
              c.ok  ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-red-500',
            )}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{meta.title}</span>
                    <code className="text-[10px] font-mono text-slate-500">{c.name}</code>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{meta.desc}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className={cn('chip', c.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-400' : 'bg-red-50 text-red-800 border border-red-400')}>
                    {c.ok ? '✓ OK' : '✕ Failed'}
                  </span>
                  <div className="text-[10px] text-slate-500 mt-1">{c.ms}ms</div>
                </div>
              </div>

              {c.error && (
                <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-2 text-xs font-mono text-red-800 break-all">
                  {c.error}
                </div>
              )}
              {c.ok && c.sample !== undefined && (
                <details className="mt-3">
                  <summary className="text-xs text-slate-500 cursor-pointer hover:text-surface-strong">Response sample</summary>
                  <pre className="mt-2 rounded-lg bg-surface-muted p-3 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(c.sample, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {data && (
        <p className="text-center text-xs text-slate-400 mt-6">
          Test coords: Charminar → HITEC City (~12 km). Autocomplete query: "Paradise Biryani Hyderabad".
          Uses your live Google API key + counts against free-tier credits (~4 requests per run).
        </p>
      )}
    </div>
  );
}
