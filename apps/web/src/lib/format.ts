import type { ServiceType, OrderStatus } from './types';

export function inr(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function km(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)} km`;
}

export function minutes(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${Math.round(n)} min`;
}

export function serviceLabel(s: ServiceType): string {
  switch (s) {
    case 'bike':           return 'Bike';
    case 'scooter':        return 'Scooter';
    case 'auto':           return 'Auto';
    case 'cab_4':          return 'Cab (4-seater)';
    case 'cab_7':          return 'Cab (7-seater)';
    case 'parcel_bike':    return 'Parcel · Bike';
    case 'parcel_scooter': return 'Parcel · Scooter';
    case 'parcel_auto':    return 'Parcel · Auto';
    case 'parcel_truck':   return 'Parcel · Mini Truck';
    case 'food':           return 'Food Delivery';
  }
}

export function statusLabel(s: OrderStatus): string {
  switch (s) {
    case 'scheduled':          return 'Scheduled';
    case 'searching':          return 'Finding your captain';
    case 'accepted':           return 'Captain on the way';
    case 'arrived':            return 'Captain arrived';
    case 'picked_up':          return 'Picked up';
    case 'in_transit':         return 'On the way';
    case 'delivered':          return 'Delivered';
    case 'completed':          return 'Completed';
    case 'cancelled_customer': return 'Cancelled by you';
    case 'cancelled_rider':    return 'Cancelled by captain';
    case 'no_rider_found':     return 'No captain available';
  }
}

export function isFinalStatus(s: OrderStatus): boolean {
  return ['completed', 'delivered', 'cancelled_customer', 'cancelled_rider', 'no_rider_found'].includes(s);
}

// Human-friendly pickup time — "Today at 6:30 PM", "Tomorrow at 9:00 AM",
// "Sat, 26 Jul at 11:15 AM". Falls back to a full toLocaleString for far dates.
export function scheduleLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target  = new Date(d.getFullYear(),   d.getMonth(),   d.getDate());
  const dayDiff = Math.round((target.getTime() - midnight.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (dayDiff === 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Tomorrow at ${time}`;
  if (dayDiff > 1 && dayDiff < 7) {
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })}, ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${time}`;
  }
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// Countdown to a scheduled pickup — "in 2h 15m", "in 45m", "5m ago" (rare —
// means the cron promotion is running late).
export function scheduleCountdown(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const deltaMin = Math.round((t - Date.now()) / 60_000);
  if (deltaMin < 0) return `${-deltaMin}m ago`;
  if (deltaMin < 60) return `in ${deltaMin}m`;
  const h = Math.floor(deltaMin / 60);
  const m = deltaMin % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}
