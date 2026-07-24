// ProgressBar — used for incentive quests + generic progress.
import { cn } from '@/lib/cn';

export default function ProgressBar({
  value, label, tone = 'brand', className,
}: {
  value: number;   // 0–100
  label?: string;
  tone?: 'brand' | 'success' | 'info' | 'danger';
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const bar =
    tone === 'success' ? 'bg-emerald-500' :
    tone === 'info'    ? 'bg-blue-500' :
    tone === 'danger'  ? 'bg-red-500' : 'bg-brand-500';
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <div className="flex justify-between text-xs">
          <span className="text-slate-600">{label}</span>
          <span className="font-semibold text-surface-strong">{pct}%</span>
        </div>
      )}
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
