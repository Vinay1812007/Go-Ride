-- =============================================================================
-- Seed data — Hyderabad rate cards from §5 + service area
-- =============================================================================
-- Run AFTER 0001_init.sql and 0002_rls.sql.
-- Admin creation is a manual step in RUNBOOK.md (needs to hit auth.users first).

-- -----------------------------------------------------------------------------
-- SERVICE AREAS
-- -----------------------------------------------------------------------------
insert into service_areas (city, center_lat, center_lng, radius_km) values
  ('Hyderabad', 17.3850, 78.4867, 30)
on conflict (city) do nothing;

-- -----------------------------------------------------------------------------
-- RATE CARDS — Hyderabad (edit in admin panel post-launch)
-- Format: base_fare (includes base_km), per_km after, per_min, min_fare, weight limit
-- -----------------------------------------------------------------------------
insert into rate_cards
  (city, service, base_fare, base_km, per_km, per_min, min_fare, parcel_weight_limit_kg, commission_pct)
values
  -- Bike taxi
  ('Hyderabad', 'bike',           25.00, 2.0,  9.00, 0.75, 30.00, null, 15.00),
  ('Hyderabad', 'scooter',        25.00, 2.0,  9.00, 0.75, 30.00, null, 15.00),
  -- Auto
  ('Hyderabad', 'auto',           35.00, 2.0, 13.00, 1.00, 45.00, null, 12.00),
  -- Cab
  ('Hyderabad', 'cab_4',          60.00, 2.0, 17.00, 1.50, 90.00, null, 18.00),
  ('Hyderabad', 'cab_7',          90.00, 2.0, 23.00, 2.00,140.00, null, 18.00),
  -- Parcel
  ('Hyderabad', 'parcel_bike',    30.00, 2.0, 10.00, 0.00, 40.00,   8, 15.00),
  ('Hyderabad', 'parcel_scooter', 30.00, 2.0, 10.00, 0.00, 40.00,   8, 15.00),
  ('Hyderabad', 'parcel_auto',    60.00, 2.0, 15.00, 0.00, 80.00,  40, 15.00),
  ('Hyderabad', 'parcel_truck',  150.00, 3.0, 28.00, 0.00,250.00, 500, 12.00)
on conflict (city, service) do update set
  base_fare              = excluded.base_fare,
  base_km                = excluded.base_km,
  per_km                 = excluded.per_km,
  per_min                = excluded.per_min,
  min_fare               = excluded.min_fare,
  parcel_weight_limit_kg = excluded.parcel_weight_limit_kg,
  commission_pct         = excluded.commission_pct,
  updated_at             = now();

-- -----------------------------------------------------------------------------
-- ADMIN USER PROMOTION
-- -----------------------------------------------------------------------------
-- After the first admin signs up via the app (or you create them in the
-- Supabase Auth dashboard), promote them by running:
--
--   update profiles set role = 'admin' where email = 'you@yourdomain.com';
--
-- Do the same for demo riders and customers as needed.

-- -----------------------------------------------------------------------------
-- OPTIONAL: demo customer + rider stubs (uncomment after creating auth users)
-- -----------------------------------------------------------------------------
-- update profiles set role = 'rider'
--   where email = 'demo-rider@goride.local';
-- insert into riders (id, vehicle_type, vehicle_number, vehicle_model, license_number, city, kyc)
-- select id, 'bike', 'TS 09 AB 1234', 'Honda Activa', 'DL-XXXX', 'Hyderabad', 'approved'
-- from profiles where email = 'demo-rider@goride.local'
-- on conflict (id) do nothing;
