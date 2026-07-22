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
