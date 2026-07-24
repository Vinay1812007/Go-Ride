-- ---------------------------------------------------------------------------
-- 0012: Dynamic surge pricing
--
-- The fare engine already respects `rate_cards.surge_multiplier`. This
-- migration adds the machinery to auto-compute that value from live
-- demand/supply ratio per (city, service) via a 2-minute cron.
--
-- Adds:
--   • rate_cards.auto_surge          — off by default; opt-in per card
--   • rate_cards.surge_multiplier_floor / _cap — clamps for auto mode
--   • surge_history table            — every recomputation, for audit + admin chart
--   • run_surge() Postgres function  — the compute-and-write step
--
-- Fully idempotent — every ALTER uses IF NOT EXISTS.
-- ---------------------------------------------------------------------------

alter table rate_cards add column if not exists auto_surge boolean not null default false;
alter table rate_cards add column if not exists surge_multiplier_floor numeric(3, 2) not null default 1.00;
alter table rate_cards add column if not exists surge_multiplier_cap   numeric(3, 2) not null default 2.50;

create table if not exists surge_history (
  id             bigint generated always as identity primary key,
  city           text not null,
  service        service_type not null,
  multiplier     numeric(3, 2) not null,
  active_riders  int not null,
  pending_orders int not null,
  computed_at    timestamptz not null default now()
);
create index if not exists surge_history_city_svc_time_idx
  on surge_history(city, service, computed_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table surge_history enable row level security;

drop policy if exists "surge: public read" on surge_history;
drop policy if exists "surge: admin write" on surge_history;
create policy "surge: public read" on surge_history
  for select using (true);   -- Read-only; contains no PII.
create policy "surge: admin write" on surge_history
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ── run_surge() ────────────────────────────────────────────────────────────
-- Per (city, service) row in rate_cards WHERE auto_surge:
--   demand   = orders in status ('searching','no_rider_found') in the last 5min in that city
--   supply   = riders online + vehicle_type matching + city matching, minus on-trip
--   ratio    = demand / (supply + 1)      (+1 to avoid /0 explosion)
--   raw      = 1 + ratio * 0.30           (empirical — one waiting rider bumps 30%)
--   multi    = clamp(raw, floor, cap)
--
-- Then writes rate_cards.surge_multiplier AND appends a surge_history row.
-- Returns count of cards recomputed for cron logging.
create or replace function run_surge() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_demand int;
  v_supply int;
  v_ratio  numeric;
  v_raw    numeric;
  v_multi  numeric;
  v_count  int := 0;
  v_since  timestamptz := now() - interval '5 minutes';
begin
  for r in
    select id, city, service, surge_multiplier, surge_multiplier_floor, surge_multiplier_cap
    from rate_cards
    where auto_surge = true and active = true
  loop
    -- Demand: unhappy customers with unfilled orders.
    select count(*) into v_demand
    from orders
    where lower(city) = lower(r.city)
      and service = r.service
      and status in ('searching', 'no_rider_found')
      and created_at >= v_since;

    -- Supply: online riders with a matching vehicle type in the same city.
    -- Bike & scooter customers can accept scooter & bike riders.
    -- Parcel_bike/scooter symmetric. Cabs and autos are strict.
    select count(*) into v_supply
    from riders rr
    where rr.status = 'online'
      and rr.kyc = 'approved'
      and lower(rr.city) = lower(r.city)
      and rr.vehicle_type = any(
        case r.service::text
          when 'bike'            then array['bike','scooter']::service_type[]
          when 'scooter'         then array['bike','scooter']::service_type[]
          when 'parcel_bike'     then array['parcel_bike','parcel_scooter']::service_type[]
          when 'parcel_scooter'  then array['parcel_bike','parcel_scooter']::service_type[]
          else array[r.service]::service_type[]
        end
      );

    v_ratio := v_demand::numeric / (v_supply + 1)::numeric;
    v_raw   := 1 + v_ratio * 0.30;
    v_multi := round(greatest(r.surge_multiplier_floor,
                              least(v_raw, r.surge_multiplier_cap))::numeric, 2);

    -- Only bother writing if the value moved meaningfully (avoids history noise
    -- when demand is flat).
    if abs(v_multi - r.surge_multiplier) >= 0.05 then
      update rate_cards
        set surge_multiplier = v_multi, updated_at = now()
        where id = r.id;
      v_count := v_count + 1;
    end if;

    -- Always append to history — the chart wants regular samples even if the
    -- value didn't change.
    insert into surge_history (city, service, multiplier, active_riders, pending_orders)
      values (r.city, r.service, v_multi, v_supply, v_demand);
  end loop;

  -- Trim history — keep 7 days per (city, service). Cheap because of the index.
  delete from surge_history where computed_at < now() - interval '7 days';

  return v_count;
end $$;
