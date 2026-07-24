-- ---------------------------------------------------------------------------
-- 0011: Restaurant partner portal
--
-- Adds:
--   • user_role.restaurant_partner   — new profile role
--   • profiles.restaurant_id         — nullable FK; only set when role =
--     'restaurant_partner'. Enforced by a CHECK constraint below.
--
-- A restaurant_partner is a profile linked one-to-one to a restaurants row.
-- They sign in via the customer web, and the target-router in App.tsx
-- sends them to /partner. Backend endpoints under /partner-restaurant/*
-- read/write only their own restaurant + its menu + its orders.
--
-- Fully idempotent — every ALTER uses IF NOT EXISTS / DO-block guards.
-- ---------------------------------------------------------------------------

-- Extend enum. Postgres requires ALTER TYPE outside a transaction, but each
-- SQL file we ship is applied non-transactionally by the migration workflow.
do $$ begin
  alter type user_role add value if not exists 'restaurant_partner';
exception when others then null; end $$;

alter table profiles add column if not exists restaurant_id uuid references restaurants(id);
create index if not exists profiles_restaurant_idx on profiles(restaurant_id) where restaurant_id is not null;

-- CHECK constraint: restaurant_id set  ⇔  role = 'restaurant_partner'.
-- Wrapped in a DO block so re-running is safe.
do $$ begin
  alter table profiles
    add constraint profiles_restaurant_role_ck check (
      (role = 'restaurant_partner' and restaurant_id is not null) or
      (role <> 'restaurant_partner' and restaurant_id is null)
    );
exception when duplicate_object then null; end $$;

-- ── RLS additions ─────────────────────────────────────────────────────────
-- Restaurant partners get read+write on their own restaurant + menu items.
-- We add these policies alongside the existing admin-only ones.

drop policy if exists "restaurant: partner read own"    on restaurants;
drop policy if exists "restaurant: partner update own"  on restaurants;
create policy "restaurant: partner read own" on restaurants
  for select using (
    id = (select p.restaurant_id from profiles p where p.id = auth.uid())
  );
create policy "restaurant: partner update own" on restaurants
  for update using (
    id = (select p.restaurant_id from profiles p where p.id = auth.uid())
  ) with check (
    id = (select p.restaurant_id from profiles p where p.id = auth.uid())
  );

drop policy if exists "menu_item: partner read own"   on menu_items;
drop policy if exists "menu_item: partner write own"  on menu_items;
create policy "menu_item: partner read own" on menu_items
  for select using (
    restaurant_id = (select p.restaurant_id from profiles p where p.id = auth.uid())
  );
create policy "menu_item: partner write own" on menu_items
  for all using (
    restaurant_id = (select p.restaurant_id from profiles p where p.id = auth.uid())
  ) with check (
    restaurant_id = (select p.restaurant_id from profiles p where p.id = auth.uid())
  );

-- Orders: partner sees only food orders assigned to their restaurant.
drop policy if exists "order: partner read own restaurant" on orders;
create policy "order: partner read own restaurant" on orders
  for select using (
    service = 'food'
    and restaurant_id is not null
    and restaurant_id = (select p.restaurant_id from profiles p where p.id = auth.uid())
  );
