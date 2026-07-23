export type ServiceType =
  | 'bike'
  | 'scooter'
  | 'auto'
  | 'cab_4'
  | 'cab_7'
  | 'parcel_bike'
  | 'parcel_scooter'
  | 'parcel_auto'
  | 'parcel_truck'
  | 'food';

export type Role = 'customer' | 'rider' | 'admin';

export type OrderStatus =
  | 'scheduled'
  | 'searching'
  | 'accepted'
  | 'arrived'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'completed'
  | 'cancelled_customer'
  | 'cancelled_rider'
  | 'no_rider_found';

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  rating: number;
  avatar_url?: string | null;
}

export interface FareBreakup {
  base: number;
  distance: number;
  time: number;
  surge_multiplier: number;
  subtotal: number;
  total: number;
  min_fare: number;
  km: number;
  minutes: number;
  commission: number;
  rider_earning: number;
}

export interface QuoteResult {
  service: ServiceType;
  city: string;
  distance_km: number;
  duration_min: number;
  polyline: string;
  fare: number;
  fare_breakup: FareBreakup;
}

export interface OrderSummary {
  id: string;
  order_no: string;
  service: ServiceType;
  status: OrderStatus;
  pickup_address: string;
  drop_address: string;
  fare_final?: number | null;
  fare_estimate?: number | null;
  scheduled_at?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}
