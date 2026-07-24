// StatCard — big number + label + optional trend + optional icon accent.
// Used on captain earnings + admin dashboards.
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: 'brand' | 'success' | 'info' | 'neutral';
  trend?: { direction: 'up' | 'down'; text: string };
  className?: string;
}

const TONE = {
  brand:   'bg-brand-50 text-brand-800',
  success: 'bg-emerald-50 text-emerald-800',
  info:    'bg-blue-50 text-blue-800',
  neutral: 'bg-slate-100 text-slate-700',
};

export default function StatCard({ label, value, hint, icon, tone = 'neutral', trend, className }: Props) {
  return (
    <div className={cn('card p-4 flex flex-col gap-1', className)}>
      <div className="flex items-start gap-2">
        {icon && <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', TONE[tone])}>{icon}</div>}
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mt-1">{label}</div>
      </div>
      <div className="text-2xl font-bold text-surface-strong">{value}</div>
      {(hint || trend) && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          {hint && <span className="truncate">{hint}</span>}
          {trend && (
            <span className={cn('flex items-center gap-0.5 font-semibold',
              trend.direction === 'up' ? 'text-emerald-700' : 'text-red-700')}>
              {trend.direction === 'up' ? '↑' : '↓'} {trend.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
