// Friendly empty state — icon/emoji + title + description + optional CTA.
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  icon?: string | ReactNode;
  title: string;
  description?: string;
  cta?: { label: string; onClick: () => void };
  secondaryCta?: { label: string; onClick: () => void };
  className?: string;
}

export default function EmptyState({ icon, title, description, cta, secondaryCta, className }: Props) {
  return (
    <div className={cn('card text-center py-12 px-6 flex flex-col items-center', className)}>
      {icon && (
        <div className="mb-4 h-16 w-16 rounded-2xl bg-brand-50 grid place-items-center text-3xl">
          {icon}
        </div>
      )}
      <h3 className="font-semibold text-slate-800">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>
      )}
      {(cta || secondaryCta) && (
        <div className="mt-5 flex gap-2">
          {cta && (
            <button onClick={cta.onClick} className="btn-primary">
              {cta.label}
            </button>
          )}
          {secondaryCta && (
            <button onClick={secondaryCta.onClick} className="btn-ghost border border-surface-border">
              {secondaryCta.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
