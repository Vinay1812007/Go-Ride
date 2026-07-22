import type { OrderStatus } from '@/lib/types';
import { cn } from '@/lib/cn';

const STEPS: Array<{ id: OrderStatus | 'pickup'; label: string; forParcel?: boolean }> = [
  { id: 'searching', label: 'Finding' },
  { id: 'accepted',  label: 'On the way' },
  { id: 'arrived',   label: 'Arrived' },
  { id: 'picked_up', label: 'Picked up', forParcel: true },
  { id: 'in_transit', label: 'In transit' },
  { id: 'completed', label: 'Complete' },
];

const ORDER: Record<OrderStatus, number> = {
  searching: 0, accepted: 1, arrived: 2, picked_up: 3, in_transit: 3,
  delivered: 4, completed: 4,
  cancelled_customer: -1, cancelled_rider: -1, no_rider_found: -1,
};

export default function StatusStepper({ status }: { status: OrderStatus }) {
  const idx = ORDER[status] ?? 0;
  if (idx < 0) {
    return (
      <div className="rounded-xl bg-red-50 text-red-700 px-4 py-3 text-sm font-medium">
        {status.replace('_', ' ')}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {STEPS.slice(0, 5).map((s, i) => (
        <div key={s.id} className="flex-1">
          <div className={cn(
            'h-1.5 rounded-full transition-all',
            i <= idx ? 'bg-brand-500' : 'bg-slate-200',
          )} />
          <div className={cn(
            'mt-2 text-[11px] font-medium',
            i <= idx ? 'text-surface-strong' : 'text-slate-400',
          )}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
