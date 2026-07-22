-- =============================================================================
-- Row Level Security — hardening before production per §4
-- =============================================================================
-- Golden rule: all writes to `orders`, `job_offers`, `transactions`, `rate_cards`,
-- and `partners` go through the Worker (service_role key). RLS just makes sure
-- an anon/authenticated client with a stolen anon key can't tamper.

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

-- Helper: current user's role
create or replace function auth_role() returns user_role
language sql stable as $$
  select role from profiles where id = auth.uid()
$$;

-- -----------------------------------------------------------------------------
-- profiles: user sees/updates own row; admin sees all
-- -----------------------------------------------------------------------------
create policy "profile: self select" on profiles
  for select using (id = auth.uid() or auth_role() = 'admin');

create policy "profile: self update" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));

create policy "profile: admin update any" on profiles
  for update using (auth_role() = 'admin');

-- -----------------------------------------------------------------------------
-- riders: rider sees own row; admin sees all; admin updates KYC
-- -----------------------------------------------------------------------------
create policy "rider: self select" on riders
  for select using (id = auth.uid() or auth_role() = 'admin');

create policy "rider: self update online-toggle" on riders
  for update using (id = auth.uid())
  with check (id = auth.uid());

create policy "rider: admin update any" on riders
  for update using (auth_role() = 'admin');

create policy "rider: self insert during onboarding" on riders
  for insert with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- rate_cards: public read of active; admin write
-- -----------------------------------------------------------------------------
create policy "rate_card: public read active" on rate_cards
  for select using (active = true);

create policy "rate_card: admin all" on rate_cards
  for all using (auth_role() = 'admin')
  with check (auth_role() = 'admin');

-- -----------------------------------------------------------------------------
-- service_areas: public read; admin write
-- -----------------------------------------------------------------------------
create policy "service_area: public read active" on service_areas
  for select using (active = true);

create policy "service_area: admin all" on service_areas
  for all using (auth_role() = 'admin')
  with check (auth_role() = 'admin');

-- -----------------------------------------------------------------------------
-- partners: admin only; Worker uses service_role
-- -----------------------------------------------------------------------------
create policy "partner: admin all" on partners
  for all using (auth_role() = 'admin')
  with check (auth_role() = 'admin');

-- -----------------------------------------------------------------------------
-- orders: customer sees own; rider sees assigned or offered; admin sees all.
--         Direct writes blocked — Worker uses service_role.
-- -----------------------------------------------------------------------------
create policy "order: customer read own" on orders
  for select using (customer_id = auth.uid());

create policy "order: rider read assigned or offered" on orders
  for select using (
    rider_id = auth.uid()
    or exists (select 1 from job_offers
               where order_id = orders.id and rider_id = auth.uid())
  );

create policy "order: admin read all" on orders
  for select using (auth_role() = 'admin');

-- No INSERT/UPDATE/DELETE policies — service_role bypasses RLS.

-- -----------------------------------------------------------------------------
-- rider_locations: rider inserts own; customer of active linked order sees theirs
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- job_offers: rider sees own; admin sees all
-- -----------------------------------------------------------------------------
create policy "offer: rider read own" on job_offers
  for select using (rider_id = auth.uid());

create policy "offer: admin read all" on job_offers
  for select using (auth_role() = 'admin');

-- -----------------------------------------------------------------------------
-- ratings: participants read; participants insert their side
-- -----------------------------------------------------------------------------
create policy "rating: participants read" on ratings
  for select using (
    exists (select 1 from orders o
            where o.id = ratings.order_id
              and (o.customer_id = auth.uid() or o.rider_id = auth.uid()))
    or auth_role() = 'admin'
  );

-- -----------------------------------------------------------------------------
-- transactions: rider sees own earnings; admin sees all
-- -----------------------------------------------------------------------------
create policy "tx: rider read own" on transactions
  for select using (rider_id = auth.uid());

create policy "tx: admin all" on transactions
  for all using (auth_role() = 'admin')
  with check (auth_role() = 'admin');

-- -----------------------------------------------------------------------------
-- webhook_deliveries: admin only
-- -----------------------------------------------------------------------------
create policy "hook: admin read" on webhook_deliveries
  for select using (auth_role() = 'admin');
