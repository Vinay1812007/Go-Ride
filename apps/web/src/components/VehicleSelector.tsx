import type { ServiceType } from '@/lib/types';
import { inr, minutes, km, serviceLabel } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface VehicleQuote {
  service: ServiceType;
  fare: number;
  eta_min: number;
  distance_km: number;
  loading?: boolean;
  unavailable?: boolean;
  icon?: string; // emoji fallback while spec's illustrations are Phase 2
}

interface Props {
  quotes: VehicleQuote[];
  selected?: ServiceType | null;
  onSelect: (s: ServiceType) => void;
}

const DEFAULT_ICONS: Partial<Record<ServiceType, string>> = {
  bike: '🏍️',
  scooter: '🛵',
  auto: '🛺',
  cab_4: '🚗',
  cab_7: '🚙',
  parcel_bike: '📦',
  parcel_scooter: '📦',
  parcel_auto: '📦',
  parcel_truck: '🚚',
  food: '🍱',
};

export default function VehicleSelector({ quotes, selected, onSelect }: Props) {
  return (
    <ul className="space-y-2">
      {quotes.map((q) => (
        <li key={q.service}>
          <button
            onClick={() => !q.unavailable && onSelect(q.service)}
            disabled={q.unavailable}
            className={cn(
              'w-full flex items-center gap-3 rounded-2xl border p-3 text-left',
              'transition',
              selected === q.service
                ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/30'
                : 'border-surface-border bg-white hover:border-slate-300',
              q.unavailable && 'opacity-50 cursor-not-allowed',
            )}
          >
            <span className="text-3xl w-12 text-center">{q.icon ?? DEFAULT_ICONS[q.service] ?? '🚕'}</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{serviceLabel(q.service)}</div>
              <div className="text-xs text-slate-500">
                {q.loading ? 'Calculating…' : `${minutes(q.eta_min)} · ${km(q.distance_km)}`}
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold text-lg">{q.loading ? '…' : inr(q.fare)}</div>
              {q.unavailable && <div className="text-[10px] text-slate-400">Not available</div>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
