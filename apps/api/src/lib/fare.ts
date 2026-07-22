// Fare engine per §5. Always run server-side.
export interface RateCard {
  base_fare: number;
  base_km: number;
  per_km: number;
  per_min: number;
  min_fare: number;
  surge_multiplier: number;
  commission_pct: number;
  parcel_weight_limit_kg: number | null;
}

export interface FareBreakup {
  base: number;
  distance: number; // per_km × (km − base_km)
  time: number;     // per_min × min
  surge_multiplier: number;
  subtotal: number; // (base + distance + time) × surge
  total: number;    // max(subtotal, min_fare)
  min_fare: number;
  km: number;
  minutes: number;
  commission: number;
  rider_earning: number;
}

export function computeFare(
  km: number,
  minutes: number,
  card: RateCard,
): FareBreakup {
  const extraKm = Math.max(0, km - card.base_km);
  const base = card.base_fare;
  const distance = round2(extraKm * card.per_km);
  const time = round2(minutes * card.per_min);
  const surge = card.surge_multiplier || 1;
  const raw = (base + distance + time) * surge;
  const subtotal = round2(raw);
  const total = Math.round(Math.max(subtotal, card.min_fare)); // round to nearest ₹1 per spec
  const commission = round2((total * card.commission_pct) / 100);
  const rider_earning = round2(total - commission);
  return {
    base,
    distance,
    time,
    surge_multiplier: surge,
    subtotal,
    total,
    min_fare: card.min_fare,
    km: round2(km),
    minutes: Math.round(minutes),
    commission,
    rider_earning,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
