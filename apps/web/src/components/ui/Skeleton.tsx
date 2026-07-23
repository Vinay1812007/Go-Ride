// Pulsing gray box for perceived-speed loading states.
import { cn } from '@/lib/cn';

interface Props {
  className?: string;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

export default function Skeleton({ className, rounded = 'md' }: Props) {
  const r = {
    sm:   'rounded',
    md:   'rounded-md',
    lg:   'rounded-lg',
    xl:   'rounded-xl',
    full: 'rounded-full',
  }[rounded];
  return (
    <div
      className={cn('animate-pulse bg-slate-200/70', r, className)}
      aria-hidden
    />
  );
}
