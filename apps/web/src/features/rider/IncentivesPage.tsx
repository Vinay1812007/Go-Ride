// Captain — active incentive quests with progress bars.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import ProgressBar from '@/components/ui/ProgressBar';

interface Incentive {
  id: string;
  title: string;
  description?: string;
  kind: 'trip_count' | 'earnings_target' | 'streak_days' | 'peak_hours';
  target: number;
  progress: number;
  pct: number;
  reward_rupees: number;
  window_hours: number;
  completed: boolean;
  ends_at?: string;
}

const KIND_EMOJI: Record<string, string> = {
  trip_count: '🚗',
  earnings_target: '💰',
  streak_days: '🔥',
  peak_hours: '⏰',
};

const KIND_UNIT: Record<string, string> = {
  trip_count: 'trips',
  earnings_target: '₹',
  streak_days: 'days',
  peak_hours: 'trips (5-10 PM)',
};

export default function IncentivesPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<Incentive[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ incentives: Incentive[] }>('/riders/incentives');
        setItems(r.incentives ?? []);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to load');
      } finally { setLoading(false); }
    })();
  }, []);

  const totalPotential = items.reduce((s, i) => s + i.reward_rupees, 0);
  const earned = items.filter((i) => i.completed).reduce((s, i) => s + i.reward_rupees, 0);

  return (
    <div className="min-h-screen bg-surface-muted">
      <div className="bg-gradient-to-br from-brand-500 to-brand-600 text-white p-4 pb-8">
        <button onClick={() => nav(-1)} className="text-white/80 text-sm mb-4">← Back</button>
        <h1 className="text-2xl font-bold">Incentives</h1>
        <p className="text-sm text-white/80 mt-1">Complete challenges to earn bonus rewards.</p>
        {!loading && items.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="bg-white/10 backdrop-blur rounded-xl p-3">
              <div className="text-xs text-white/70">Earned today</div>
              <div className="text-xl font-bold">₹{earned}</div>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-3">
              <div className="text-xs text-white/70">Available</div>
              <div className="text-xl font-bold">₹{totalPotential - earned}</div>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 -mt-4 space-y-3">
        {loading ? (
          <><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></>
        ) : items.length === 0 ? (
          <EmptyState
            icon="🎯"
            title="No active incentives"
            description="Check back tomorrow — new challenges drop daily."
          />
        ) : items.map((inc) => (
          <div key={inc.id} className={`card p-4 ${inc.completed ? 'ring-2 ring-emerald-400' : ''}`}>
            <div className="flex items-start gap-3">
              <div className="text-3xl">{KIND_EMOJI[inc.kind] ?? '⭐'}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold">{inc.title}</h3>
                  {inc.completed && <Badge tone="success" dot>Completed</Badge>}
                </div>
                {inc.description && <p className="text-xs text-slate-600 mt-0.5">{inc.description}</p>}
                <div className="mt-3">
                  <ProgressBar
                    value={inc.pct}
                    label={`${inc.progress} / ${inc.target} ${KIND_UNIT[inc.kind]}`}
                    tone={inc.completed ? 'success' : 'brand'}
                  />
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div className="text-xs text-slate-500">
                    Window: last {inc.window_hours}h
                  </div>
                  <div className="text-lg font-bold text-brand-800">₹{inc.reward_rupees}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
