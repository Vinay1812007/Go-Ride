-- =============================================================================
-- Row Level Security — hardening per §4
-- =============================================================================
-- Fully idempotent: DROP POLICY IF EXISTS before each CREATE POLICY so re-runs
-- are safe.

alter table profiles           enable row level security;
alter table riders             enable row level security;
alter table rate_cards         enable row level security;
alter table service_areas      enable row level security;
alter table partners           enable row level security;
alter table orders             enable row level security;
alter table rider_locations    enable row level security;
alter table job_offers         enable row level security;
alter table ratings            enable row level security;
alter table transactions       enable row level security;
alter table webhook_deliveries enable row level security;

create or replace function auth_role() returns user_role
language sql stable as $$
  select role from profiles where id = auth.uid()
$$;

-- profiles
drop policy if exists "profile: self select"        on profiles;
drop policy if exists "profile: self update"        on profiles;
drop policy if exists "profile: admin update any"   on profiles;
create policy "profile: self select" on profiles
  for select using (id = auth.uid() or auth_role() = 'admin');
create policy "profile: self update" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));
create policy "profile: admin update any" on profiles
  for update using (auth_role() = 'admin');

-- riders
drop policy if exists "rider: self select"                on riders;
drop policy if exists "rider: self update online-toggle"  on riders;
drop policy if exists "rider: admin update any"           on riders;
drop policy if exists "rider: self insert during onboarding" on riders;
create policy "rider: self select" on riders
  for select using (id = auth.uid() or auth_role() = 'admin');
create policy "rider: self update online-toggle" on riders
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "rider: admin update any" on riders
  for update using (auth_role() = 'admin');
create policy "rider: self insert during onboarding" on riders
  for insert with check (id = auth.uid());

-- rate_cards
drop policy if exists "rate_card: public read active" on rate_cards;
drop policy if exists "rate_card: admin all"          on rate_cards;
create policy "rate_card: public read active" on rate_cards
  for select using (active = true);
create policy "rate_card: admin all" on rate_cards
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- service_areas
drop policy if exists "service_area: public read active" on service_areas;
drop policy if exists "service_area: admin all"          on service_areas;
create policy "service_area: public read active" on service_areas
  for select using (active = true);
create policy "service_area: admin all" on service_areas
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- partners
drop policy if exists "partner: admin all" on partners;
create policy "partner: admin all" on partners
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- orders
drop policy if exists "order: customer read own"           on orders;
drop policy if exists "order: rider read assigned or offered" on orders;
drop policy if exists "order: admin read all"              on orders;
create policy "order: customer read own" on orders
  for select using (customer_id = auth.uid());
create policy "order: rider read assigned or offered" on orders
  for select using (
    rider_id = auth.uid()
    or exists (select 1 from job_offers where order_id = orders.id and rider_id = auth.uid())
  );
create policy "order: admin read all" on orders
  for select using (auth_role() = 'admin');

-- rider_locations
drop policy if exists "loc: rider insert own"                   on rider_locations;
drop policy if exists "loc: rider read own recent"              on rider_locations;
drop policy if exists "loc: customer read for own active order" on rider_locations;
drop policy if exists "loc: admin all"                          on rider_locations;
create policy "loc: rider insert own" on rider_locations
  for insert with check (rider_id = auth.uid());
create policy "loc: rider read own recent" on rider_locations
  for select using (rider_id = auth.uid());
create policy "loc: customer read for own active order" on rider_locations
  for select using (
    order_id in (
      select id from orders
      where customer_id = auth.uid()
        and status in ('accepted', 'arrived', 'picked_up', 'in_transit')
    )
  );
create policy "loc: admin all" on rider_locations
  for select using (auth_role() = 'admin');

-- job_offers
drop policy if exists "offer: rider read own"    on job_offers;
drop policy if exists "offer: admin read all"    on job_offers;
create policy "offer: rider read own" on job_offers
  for select using (rider_id = auth.uid());
create policy "offer: admin read all" on job_offers
  for select using (auth_role() = 'admin');

-- ratings
drop policy if exists "rating: participants read" on ratings;
create policy "rating: participants read" on ratings
  for select using (
    exists (select 1 from orders o
            where o.id = ratings.order_id
              and (o.customer_id = auth.uid() or o.rider_id = auth.uid()))
    or auth_role() = 'admin'
  );

-- transactions
drop policy if exists "tx: rider read own" on transactions;
drop policy if exists "tx: admin all"      on transactions;
create policy "tx: rider read own" on transactions
  for select using (rider_id = auth.uid());
create policy "tx: admin all" on transactions
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- webhook_deliveries
drop policy if exists "hook: admin read" on webhook_deliveries;
create policy "hook: admin read" on webhook_deliveries
  for select using (auth_role() = 'admin');
