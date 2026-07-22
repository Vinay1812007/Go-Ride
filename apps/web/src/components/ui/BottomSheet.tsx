import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function BottomSheet({ open, onClose, title, children, className }: Props) {
  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40 animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div className={cn('sheet z-50', className)} role="dialog" aria-modal>
        <div className="sheet-handle" />
        {title && (
          <header className="px-5 pt-2 pb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            {onClose && (
              <button onClick={onClose} className="text-slate-500 text-2xl leading-none px-2" aria-label="Close">×</button>
            )}
          </header>
        )}
        <div className="px-5 pb-5">{children}</div>
      </div>
    </>
  );
}
