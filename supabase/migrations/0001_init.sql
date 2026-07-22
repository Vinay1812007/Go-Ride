-- =============================================================================
-- GoRide — initial schema (§4 of MVP spec)
-- =============================================================================
-- Fully idempotent: safe to re-run at any time. Data is preserved.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- ENUMS — wrapped so re-runs don't error
-- -----------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('customer', 'rider', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_type as enum (
    'bike', 'scooter', 'auto', 'cab_4', 'cab_7',
    'parcel_bike', 'parcel_scooter', 'parcel_auto', 'parcel_truck',
    'food'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum (
    'searching', 'accepted', 'arrived', 'picked_up', 'in_transit',
    'delivered', 'completed',
    'cancelled_customer', 'cancelled_rider', 'no_rider_found'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type rider_status as enum ('offline', 'online', 'on_trip');
exception when duplicate_object then null; end $$;

do $$ begin
  create type kyc_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('cash', 'upi', 'wallet');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'paid', 'refunded');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- PROFILES (extends auth.users)
-- -----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  role user_role not null default 'customer',
  full_name text not null,
  phone text unique,
  email text,
  avatar_url text,
  rating numeric(2, 1) default 5.0,
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists profiles_role_idx on profiles(role);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- -----------------------------------------------------------------------------
-- RIDERS
-- -----------------------------------------------------------------------------
create table if not exists riders (
  id uuid primary key references profiles(id) on delete cascade,
  status rider_status not null default 'offline',
  vehicle_type service_type not null,
  vehicle_number text not null,
  vehicle_model text,
  license_number text,
  kyc kyc_status not null default 'pending',
  kyc_docs jsonb not null default '{}'::jsonb,
  city text not null,
  wallet_balance numeric(10, 2) not null default 0,
  total_trips int not null default 0,
  last_lat double precision,
  last_lng double precision,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists riders_dispatch_idx on riders(status, vehicle_type, city);
create index if not exists riders_last_seen_idx on riders(last_seen desc) where status <> 'offline';

-- -----------------------------------------------------------------------------
-- RATE CARDS (admin-editable per city per service)
-- -----------------------------------------------------------------------------
create table if not exists rate_cards (
  id bigint generated always as identity primary key,
  city text not null,
  service service_type not null,
  base_fare numeric(8, 2) not null,
  base_km numeric(4, 1) not null,
  per_km numeric(6, 2) not null,
  per_min numeric(6, 2) not null default 0,
  min_fare numeric(8, 2) not null,
  surge_multiplier numeric(3, 2) not null default 1.00,
  waiting_per_min numeric(6, 2) not null default 0,
  parcel_weight_limit_kg int,
  commission_pct numeric(4, 2) not null default 15.00,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (city, service)
);
create index if not exists rate_cards_lookup_idx on rate_cards(city, service, active);

-- -----------------------------------------------------------------------------
-- SERVICE AREAS (simple city radius for MVP)
-- -----------------------------------------------------------------------------
create table if not exists service_areas (
  id bigint generated always as identity primary key,
  city text unique not null,
  center_lat double precision not null,
  center_lng double precision not null,
  radius_km numeric(5, 1) not null default 25,
  active boolean not null default true
);

-- -----------------------------------------------------------------------------
-- D2C PARTNERS
-- -----------------------------------------------------------------------------
create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_email text not null,
  api_key_hash text not null,
  api_key_prefix text not null,
  webhook_url text,
  webhook_secret text,
  active boolean not null default true,
  rate_limit_per_min int not null default 60,
  created_at timestamptz not null default now()
);
create index if not exists partners_api_key_hash_idx on partners(api_key_hash);

-- -----------------------------------------------------------------------------
-- ORDERS
-- -----------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  customer_id uuid references profiles(id) not null,
  rider_id uuid references riders(id),
  service service_type not null,
  status order_status not null default 'searching',
  city text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  pickup_address text not null,
  drop_lat double precision not null,
  drop_lng double precision not null,
  drop_address text not null,
  distance_km numeric(6, 2),
  duration_min int,
  route_polyline text,
  fare_estimate numeric(8, 2),
  fare_final numeric(8, 2),
  fare_breakup jsonb,
  payment_method payment_method not null default 'cash',
  payment_status payment_status not null default 'pending',
  otp char(4),
  cancelled_reason text,
  parcel_details jsonb,
  food_details jsonb,
  partner_id uuid references partners(id),
  partner_reference_id text,
  share_token text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  picked_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists orders_customer_idx on orders(customer_id, created_at desc);
create index if not exists orders_rider_idx on orders(rider_id, created_at desc);
create index if not exists orders_status_idx on orders(status)
  where status in ('searching', 'accepted', 'arrived', 'picked_up', 'in_transit');
create index if not exists orders_partner_ref_idx on orders(partner_id, partner_reference_id);

-- -----------------------------------------------------------------------------
-- LIVE LOCATION TRAIL
-- -----------------------------------------------------------------------------
create table if not exists rider_locations (
  id bigint generated always as identity primary key,
  rider_id uuid references riders(id) not null,
  order_id uuid references orders(id),
  lat double precision not null,
  lng double precision not null,
  heading numeric(5, 1),
  speed_kmh numeric(5, 1),
  recorded_at timestamptz not null default now()
);
create index if not exists rider_loc_order_idx on rider_locations(order_id, recorded_at desc);
create index if not exists rider_loc_recorded_idx on rider_locations(recorded_at);

-- -----------------------------------------------------------------------------
-- JOB OFFERS
-- -----------------------------------------------------------------------------
create table if not exists job_offers (
  id bigint generated always as identity primary key,
  order_id uuid references orders(id) on delete cascade not null,
  rider_id uuid references riders(id) not null,
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  response text check (response in ('accepted', 'rejected', 'expired')),
  responded_at timestamptz,
  unique (order_id, rider_id)
);
create index if not exists job_offers_order_idx on job_offers(order_id, offered_at desc);
create index if not exists job_offers_rider_pending_idx on job_offers(rider_id, expires_at) where response is null;

-- -----------------------------------------------------------------------------
-- RATINGS
-- -----------------------------------------------------------------------------
create table if not exists ratings (
  id bigint generated always as identity primary key,
  order_id uuid references orders(id) unique not null,
  by_customer int check (by_customer between 1 and 5),
  by_rider int check (by_rider between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- TRANSACTIONS
-- -----------------------------------------------------------------------------
create table if not exists transactions (
  id bigint generated always as identity primary key,
  order_id uuid references orders(id),
  rider_id uuid references riders(id),
  type text not null check (type in ('trip_earning', 'commission', 'payout', 'refund', 'adjustment')),
  amount numeric(10, 2) not null,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists transactions_order_idx on transactions(order_id);
create index if not exists transactions_rider_idx on transactions(rider_id, created_at desc);

-- -----------------------------------------------------------------------------
-- WEBHOOK DELIVERY LOG
-- -----------------------------------------------------------------------------
create table if not exists webhook_deliveries (
  id bigint generated always as identity primary key,
  partner_id uuid references partners(id) not null,
  order_id uuid references orders(id),
  event_type text not null,
  payload jsonb not null,
  status_code int,
  attempt int not null default 1,
  delivered_at timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_pending_idx on webhook_deliveries(next_retry_at) where delivered_at is null;

-- -----------------------------------------------------------------------------
-- PARTNER RATE-LIMIT COUNTERS
-- -----------------------------------------------------------------------------
create table if not exists partner_rate_counters (
  partner_id uuid references partners(id) not null,
  minute_bucket timestamptz not null,
  count int not null default 0,
  primary key (partner_id, minute_bucket)
);

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------
create or replace function haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision language plpgsql immutable as $$
declare
  r constant double precision := 6371;
  dlat double precision;
  dlng double precision;
  a double precision;
begin
  dlat := radians(lat2 - lat1);
  dlng := radians(lng2 - lng1);
  a := sin(dlat / 2) ^ 2
     + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ^ 2;
  return r * 2 * atan2(sqrt(a), sqrt(1 - a));
end $$;

create or replace function generate_order_no() returns text
language plpgsql as $$
declare
  suffix text;
begin
  suffix := upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 4));
  return 'GR-' || to_char(now(), 'YYMMDD') || '-' || suffix;
end $$;

create or replace function prune_rider_locations() returns int
language plpgsql as $$
declare
  n int;
begin
  delete from rider_locations
  where recorded_at < now() - interval '24 hours'
    and (order_id is null
         or order_id in (select id from orders
                         where status in ('completed', 'delivered',
                                          'cancelled_customer', 'cancelled_rider',
                                          'no_rider_found')));
  get diagnostics n = row_count;
  return n;
end $$;
