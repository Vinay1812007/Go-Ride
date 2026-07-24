-- =============================================================================
-- 0016 — captain withdrawals, incentives, org settings
-- =============================================================================
-- Adds:
--   • withdrawals      — captain daily payouts (1×/day cap enforced)
--   • incentives       — org-defined active quests (e.g. "10 trips → +₹200")
--   • captain_incentives — per-captain progress on each quest
--   • app_settings     — global kv store for admin-editable config
--
-- Idempotent: safe to re-run.

-- -----------------------------------------------------------------------------
-- 1. withdrawals — captain instant payouts, one per day
-- -----------------------------------------------------------------------------
do $$ begin
  create type withdrawal_status as enum ('pending', 'processing', 'paid', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists withdrawals (
  id             uuid primary key default gen_random_uuid(),
  rider_id       uuid not null references riders(id) on delete cascade,
  amount         numeric(10, 2) not null check (amount > 0),
  status         withdrawal_status not null default 'pending',
  method         text not null default 'upi',       -- 'upi' | 'bank'
  destination    text not null,                     -- upi id or masked bank acct
  reference      text,                              -- payment-gateway ref
  failure_reason text,
  requested_at   timestamptz not null default now(),
  paid_at        timestamptz
);
create index if not exists withdrawals_rider_time_idx on withdrawals(rider_id, requested_at desc);

-- One WITHDRAWAL per rider per calendar day (Asia/Kolkata) — enforced in code
-- (partial unique on a generated col is fragile with tz); a strong index
-- makes the read side of the check fast.
create index if not exists withdrawals_rider_daily_idx
  on withdrawals(rider_id, ((requested_at at time zone 'Asia/Kolkata')::date))
  where status <> 'failed';

alter table withdrawals enable row level security;
drop policy if exists withdrawals_self_read on withdrawals;
create policy withdrawals_self_read on withdrawals
  for select using (rider_id = auth.uid());
drop policy if exists withdrawals_admin_all on withdrawals;
create policy withdrawals_admin_all on withdrawals
  for all using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- -----------------------------------------------------------------------------
-- 2. incentives — quests admin can define
-- -----------------------------------------------------------------------------
do $$ begin
  create type incentive_kind as enum ('trip_count', 'earnings_target', 'streak_days', 'peak_hours');
exception when duplicate_object then null; end $$;

create table if not exists incentives (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  kind         incentive_kind not null,
  target       int not null check (target > 0),         -- e.g. 10 trips, 500 rupees
  reward_paise int not null check (reward_paise > 0),   -- in paise
  window_hours int not null default 24,                 -- rolling window in hours
  vehicle_type service_type,                            -- null = all types
  city         text,                                    -- null = all cities
  active       boolean not null default true,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists incentives_active_idx on incentives(active, starts_at, ends_at);

alter table incentives enable row level security;
drop policy if exists incentives_read_all on incentives;
create policy incentives_read_all on incentives
  for select using (true);   -- riders + admins can read
drop policy if exists incentives_admin_write on incentives;
create policy incentives_admin_write on incentives
  for all using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- Seed a couple of sensible defaults so the incentives page isn't empty on day 1
insert into incentives (title, description, kind, target, reward_paise, window_hours)
values
  ('Daily 10 trips', 'Complete 10 trips today and earn a ₹200 bonus.', 'trip_count', 10, 20000, 24),
  ('Weekly hustle',  'Cross ₹5,000 in earnings this week to unlock ₹500.', 'earnings_target', 5000, 50000, 168),
  ('Peak-hour pro',  'Take 5 trips between 5-10 PM tonight for ₹150.',    'peak_hours',      5,   15000, 5)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. captain_incentives — join / progress table (denormalised on complete)
-- -----------------------------------------------------------------------------
create table if not exists captain_incentives (
  id            uuid primary key default gen_random_uuid(),
  rider_id      uuid not null references riders(id)     on delete cascade,
  incentive_id  uuid not null references incentives(id) on delete cascade,
  progress      int not null default 0,
  completed_at  timestamptz,
  paid_at       timestamptz,
  paid_paise    int,
  window_start  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (rider_id, incentive_id, window_start)
);
create index if not exists captain_incentives_rider_idx on captain_incentives(rider_id, completed_at);

alter table captain_incentives enable row level security;
drop policy if exists captain_incentives_self on captain_incentives;
create policy captain_incentives_self on captain_incentives
  for select using (rider_id = auth.uid());
drop policy if exists captain_incentives_admin on captain_incentives;
create policy captain_incentives_admin on captain_incentives
  for all using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- -----------------------------------------------------------------------------
-- 4. app_settings — admin-editable kv (org name, feature flags, branding)
-- -----------------------------------------------------------------------------
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;
drop policy if exists app_settings_read_all on app_settings;
create policy app_settings_read_all on app_settings
  for select using (true);   -- everyone can read (needed for branding/feature flags in the client)
drop policy if exists app_settings_admin_write on app_settings;
create policy app_settings_admin_write on app_settings
  for all using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- Seed sane defaults
insert into app_settings (key, value) values
  ('org',       '{"name":"GoRide","support_phone":"","support_email":"","default_city":"Hyderabad","currency":"INR"}'::jsonb),
  ('features',  '{"surge":true,"food":true,"parcel":true,"scheduled":true,"referrals":true}'::jsonb),
  ('branding',  '{"primary_color":"#F5B60A","logo_url":""}'::jsonb),
  ('withdraw',  '{"min_paise":10000,"max_per_day":1,"methods":["upi","bank"]}'::jsonb)
on conflict (key) do nothing;
