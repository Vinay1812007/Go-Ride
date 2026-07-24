// SettingsRow — one row of a settings list. Icon + label + optional right slot
// + chevron. Click-through if `to`/`onClick` provided.
//
// Matches the Uber/Rapido settings-page pattern: dense list of 44-56px tall
// rows separated by hairlines, grouped into cards.
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  label: string;
  hint?: string;
  right?: ReactNode;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
  showChevron?: boolean;
}

export default function SettingsRow({
  icon, label, hint, right, to, onClick, danger, showChevron = true,
}: Props) {
  const content = (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 min-h-[52px]',
      (to || onClick) && 'active:bg-slate-100 hover:bg-slate-50 transition',
    )}>
      <span className={cn(
        'w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center',
        danger ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700',
      )}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className={cn('font-medium truncate', danger && 'text-red-600')}>
          {label}
        </div>
        {hint && <div className="text-xs text-slate-500 truncate">{hint}</div>}
      </div>
      {right}
      {showChevron && (to || onClick) && (
        <svg className="w-4 h-4 text-slate-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      )}
    </div>
  );
  if (to)      return <NavLink to={to} className="block">{content}</NavLink>;
  if (onClick) return <button onClick={onClick} className="block w-full text-left">{content}</button>;
  return content;
}

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      {title && <h3 className="px-4 py-2 text-[11px] uppercase tracking-wider font-bold text-slate-500">{title}</h3>}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100 shadow-sm">
        {children}
      </div>
    </section>
  );
}
