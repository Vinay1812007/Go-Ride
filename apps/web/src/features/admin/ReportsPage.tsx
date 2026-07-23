// Admin — CSV exports (orders, daily revenue, per-rider earnings).
// Uses authenticated blob download; server sets the filename.
import { useState } from 'react';
import { downloadFile } from '@/lib/api';

type ReportKey = 'orders' | 'daily-revenue' | 'rider-earnings';

interface Report {
  key: ReportKey;
  label: string;
  description: string;
  endpoint: (from: string, to: string, status: string) => string;
  supportsStatus?: boolean;
}

const REPORTS: Report[] = [
  {
    key: 'orders',
    label: 'Orders',
    description: 'Every order in the range — flattened for Excel: fare, distance, addresses, timings, status, cancellation reasons.',
    supportsStatus: true,
    endpoint: (from, to, status) => {
      const q = new URLSearchParams();
      if (from)   q.set('from', from);
      if (to)     q.set('to', to);
      if (status) q.set('status', status);
      const qs = q.toString();
      return `/admin/exports/orders.csv${qs ? '?' + qs : ''}`;
    },
  },
  {
    key: 'daily-revenue',
    label: 'Daily revenue',
    description: 'Per-day aggregate of completed orders: orders count, gross revenue, platform commission, rider payouts.',
    endpoint: (from, to) => {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to)   q.set('to', to);
      const qs = q.toString();
      return `/admin/exports/daily-revenue.csv${qs ? '?' + qs : ''}`;
    },
  },
  {
    key: 'rider-earnings',
    label: 'Rider earnings',
    description: 'Per-rider totals for the range: trips, earning, commission paid, adjustments, net payout — ranked by payout.',
    endpoint: (from, to) => {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to)   q.set('to', to);
      const qs = q.toString();
      return `/admin/exports/rider-earnings.csv${qs ? '?' + qs : ''}`;
    },
  },
];

function isoDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  { label: 'Today',        from: isoDay(0),  to: '' },
  { label: 'Last 7 days',  from: isoDay(-7), to: '' },
  { label: 'Last 30 days', from: isoDay(-30), to: '' },
  { label: 'This month',   from: new Date().toISOString().slice(0, 7) + '-01', to: '' },
  { label: 'All time',     from: '',         to: '' },
];

export default function ReportsPage() {
  const [from, setFrom] = useState<string>(isoDay(-30));
  const [to, setTo] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState<ReportKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(r: Report) {
    setBusy(r.key); setError(null);
    try {
      await downloadFile(r.endpoint(from, to, status));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-xs text-slate-500 mt-1">
          Pick a date range and download a CSV. Files include filenames dated today so they don't overwrite in Downloads.
        </p>
      </div>

      {/* Date range */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">Date range</span>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => { setFrom(p.from); setTo(p.to); }}
                className="text-xs px-2 py-1 rounded-lg border border-surface-border hover:bg-surface-muted"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-500">From</span>
            <input
              type="date"
              className="input mt-1"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">To <span className="text-slate-400">(optional)</span></span>
            <input
              type="date"
              className="input mt-1"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-400 rounded-xl p-3">
          {error}
        </div>
      )}

      {/* Each report as a card */}
      <div className="space-y-3">
        {REPORTS.map((r) => (
          <div key={r.key} className="card flex items-start gap-4">
            <div className="flex-1">
              <div className="font-semibold">{r.label}</div>
              <p className="text-xs text-slate-500 mt-1">{r.description}</p>
              {r.supportsStatus && (
                <label className="block mt-2 text-xs">
                  <span className="text-slate-500">Filter by status (optional)</span>
                  <select
                    className="input mt-1 w-full max-w-xs py-2"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">All statuses</option>
                    <option value="searching">Searching</option>
                    <option value="accepted">Accepted</option>
                    <option value="completed">Completed</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled_customer">Cancelled by customer</option>
                    <option value="cancelled_rider">Cancelled by rider</option>
                    <option value="no_rider_found">No rider found</option>
                  </select>
                </label>
              )}
            </div>
            <button
              onClick={() => download(r)}
              disabled={busy === r.key}
              className="btn-primary whitespace-nowrap"
            >
              {busy === r.key ? 'Downloading…' : '↓ CSV'}
            </button>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500 mt-6">
        Files open cleanly in Excel, Google Sheets, and Numbers. Amounts are in ₹ (INR),
        timestamps are UTC ISO-8601.
      </p>
    </div>
  );
}
