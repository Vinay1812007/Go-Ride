// Avatar — round image with initials fallback.
// Sizes tuned for our 44px+ touch-target rule.
import { cn } from '@/lib/cn';

interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
}

function initials(name?: string): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last  = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase() || '?';
}

const SIZES = {
  sm: 'w-8  h-8  text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

export default function Avatar({ src, name, size = 'md', className, onClick }: AvatarProps) {
  const Cmp = onClick ? 'button' : 'div';
  return (
    <Cmp
      onClick={onClick}
      className={cn(
        'rounded-full overflow-hidden bg-brand-100 text-brand-800 font-semibold flex items-center justify-center flex-shrink-0 ring-2 ring-white shadow-sm',
        SIZES[size],
        onClick && 'hover:brightness-95 active:scale-95 transition',
        className,
      )}
    >
      {src
        ? <img src={src} alt={name ?? ''} className="w-full h-full object-cover" />
        : <span>{initials(name)}</span>}
    </Cmp>
  );
}
