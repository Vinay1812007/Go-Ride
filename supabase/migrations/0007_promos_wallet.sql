-- ---------------------------------------------------------------------------
-- 0007: Promo codes + wallet + referrals
--
-- Adds:
--   • promo_codes          — the campaign definition (WELCOME50 etc.)
--   • promo_redemptions    — one row per use, so we can enforce per-user caps
--   • wallet_ledger        — append-only credit/debit journal per profile
--   • orders.promo_id, orders.discount, orders.wallet_used
--   • profiles.referral_code (unique), profiles.referred_by (FK to profiles)
--   • wallet_balance(uuid) function
--   • Updated handle_new_user trigger to auto-generate a referral code
--   • Seed of a few sample codes so demos work out of the box
--
-- Fully idempotent — every CREATE / INSERT is guarded.
-- ---------------------------------------------------------------------------

-- ── Enum for wallet ledger reason ───────────────────────────────────────────
do $$ begin
  create type wallet_reason as enum (
    'signup_bonus',
    'referral_bonus_referrer',
    'referral_bonus_referee',
    'promo_credit',
    'refund',
    'trip_debit',
    'top_up',
    'adjustment'
  );
exception when duplicate_object then null; end $$;

-- ── PROMO_CODES ────────────────────────────────────────────────────────────
create table if not exists promo_codes (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique not null check (code = upper(code)),
  description           text,
  discount_type         text not null check (discount_type in ('percent', 'flat')),
  discount_value        numeric(8, 2) not null check (discount_value > 0),
  max_discount          numeric(8, 2),          -- caps a percent discount
  min_order             numeric(8, 2) not null default 0,
  applies_to            text not null default 'all' check (applies_to in ('all', 'ride', 'parcel', 'food')),
  valid_from            timestamptz not null default now(),
  valid_until           timestamptz,             -- null = no expiry
  usage_limit_per_user  int not null default 1,  -- 0 = unlimited
  total_usage_limit     int,                     -- null = unlimited
  times_used            int not null default 0,
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);
create index if not exists promo_codes_active_idx on promo_codes(active) where active = true;

-- ── PROMO_REDEMPTIONS ──────────────────────────────────────────────────────
create table if not exists promo_redemptions (
  id              uuid primary key default gen_random_uuid(),
  promo_id        uuid not null references promo_codes(id) on delete cascade,
  order_id        uuid not null references orders(id) on delete cascade,
  customer_id     uuid not null references profiles(id),
  discount_amount numeric(8, 2) not null,
  redeemed_at     timestamptz not null default now(),
  unique (order_id, promo_id)                    -- one redemption per order
);
create index if not exists promo_redemptions_user_idx  on promo_redemptions(customer_id, promo_id);
create index if not exists promo_redemptions_promo_idx on promo_redemptions(promo_id);

-- ── WALLET_LEDGER ──────────────────────────────────────────────────────────
create table if not exists wallet_ledger (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  delta       numeric(8, 2) not null check (delta <> 0),
  reason      wallet_reason not null,
  order_id    uuid references orders(id),
  promo_id    uuid references promo_codes(id),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists wallet_ledger_profile_idx on wallet_ledger(profile_id, created_at desc);

-- Compute a profile's balance = sum(delta). Marked stable so callers can
-- cache-in-query. Kept in SQL for speed; called by the API on demand.
create or replace function wallet_balance(p_profile_id uuid) returns numeric
language sql stable as $$
  select coalesce(sum(delta), 0)::numeric(8, 2)
  from wallet_ledger
  where profile_id = p_profile_id
$$;

-- ── ORDERS.PROMO / DISCOUNT / WALLET_USED ──────────────────────────────────
alter table orders add column if not exists promo_id     uuid references promo_codes(id);
alter table orders add column if not exists discount     numeric(8, 2) not null default 0;
alter table orders add column if not exists wallet_used  numeric(8, 2) not null default 0;

-- ── PROFILES.REFERRAL_CODE + REFERRED_BY ───────────────────────────────────
alter table profiles add column if not exists referral_code text unique;
alter table profiles add column if not exists referred_by   uuid references profiles(id);
create index if not exists profiles_referred_by_idx on profiles(referred_by) where referred_by is not null;

-- Generate a short human-typable referral code from a UUID.
create or replace function gen_referral_code(seed uuid) returns text
language sql immutable as $$
  select upper(substr(replace(seed::text, '-', ''), 1, 6));
$$;

-- Backfill any existing profiles.
update profiles
   set referral_code = gen_referral_code(id)
 where referral_code is null;

-- Extend the new-user handler so freshly-created auth users get a code.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'phone',
    gen_referral_code(new.id)
  )
  on conflict (id) do update set
    referral_code = coalesce(profiles.referral_code, excluded.referral_code);
  return new;
end $$;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table promo_codes         enable row level security;
alter table promo_redemptions   enable row level security;
alter table wallet_ledger       enable row level security;

drop policy if exists "promo: public read active"     on promo_codes;
drop policy if exists "promo: admin write"            on promo_codes;
drop policy if exists "redemption: self read"         on promo_redemptions;
drop policy if exists "redemption: admin all"         on promo_redemptions;
drop policy if exists "wallet: self read"             on wallet_ledger;
drop policy if exists "wallet: admin all"             on wallet_ledger;

-- Anyone (even unauthed) can attempt a code — validation happens in the API,
-- which uses the service-role client. But we still let authed users read
-- active codes if they want to browse a "Your offers" page later.
create policy "promo: public read active" on promo_codes
  for select using (active = true or auth_role() = 'admin');
create policy "promo: admin write" on promo_codes
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

create policy "redemption: self read" on promo_redemptions
  for select using (customer_id = auth.uid() or auth_role() = 'admin');
create policy "redemption: admin all" on promo_redemptions
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

create policy "wallet: self read" on wallet_ledger
  for select using (profile_id = auth.uid() or auth_role() = 'admin');
create policy "wallet: admin all" on wallet_ledger
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ── SEED: sample promo codes so demos work out of the box ──────────────────
insert into promo_codes (code, description, discount_type, discount_value, max_discount, min_order, applies_to, usage_limit_per_user, total_usage_limit) values
  ('WELCOME50',   'Flat ₹50 off on your first ride',           'flat',    50, null,   100, 'all',    1, null),
  ('GRSPICE100',  '₹100 off food orders over ₹300',            'flat',   100, null,   300, 'food',   3, 5000),
  ('RIDE20',      '20% off rides (up to ₹80)',                 'percent', 20,   80,   150, 'ride',   5, null),
  ('SEND40',      'Flat ₹40 off parcel deliveries',            'flat',    40, null,   120, 'parcel', 2, null),
  ('GORIDE10',    '10% off any order (up to ₹60)',             'percent', 10,   60,     0, 'all',    3, null)
on conflict (code) do update set
  description          = excluded.description,
  discount_type        = excluded.discount_type,
  discount_value       = excluded.discount_value,
  max_discount         = excluded.max_discount,
  min_order            = excluded.min_order,
  applies_to           = excluded.applies_to,
  usage_limit_per_user = excluded.usage_limit_per_user,
  total_usage_limit    = excluded.total_usage_limit;
