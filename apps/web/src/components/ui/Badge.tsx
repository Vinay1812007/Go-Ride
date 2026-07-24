// Badge — small colored pill for status labels (e.g. "Online", "KYC pending").
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE: Record<Tone, string> = {
  brand:   'bg-brand-50 text-brand-800 border-brand-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  danger:  'bg-red-50 text-red-800 border-red-200',
  info:    'bg-blue-50 text-blue-800 border-blue-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
};

export default function Badge({
  children, tone = 'neutral', className, dot,
}: { children: ReactNode; tone?: Tone; className?: string; dot?: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border',
      TONE[tone], className,
    )}>
      {dot && <span className={cn(
        'w-1.5 h-1.5 rounded-full',
        tone === 'success' ? 'bg-emerald-500 animate-pulse' :
        tone === 'danger'  ? 'bg-red-500' :
        tone === 'warning' ? 'bg-amber-500' :
        tone === 'info'    ? 'bg-blue-500' :
        tone === 'brand'   ? 'bg-brand-500' : 'bg-slate-500',
      )} />}
      {children}
    </span>
  );
}
