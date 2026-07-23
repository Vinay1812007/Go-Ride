-- ---------------------------------------------------------------------------
-- 0008: Push notification tokens
--
-- Adds:
--   • push_tokens table — one row per (profile, device) FCM/APNs token
--   • Unique on token so a user re-registering the same device is idempotent
--
-- Fully idempotent — every CREATE / INSERT is guarded.
-- ---------------------------------------------------------------------------

do $$ begin
  create type push_platform as enum ('web', 'android', 'ios');
exception when duplicate_object then null; end $$;

create table if not exists push_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  token        text unique not null,
  platform     push_platform not null,
  user_agent   text,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists push_tokens_profile_idx on push_tokens(profile_id)
  where revoked_at is null;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Users manage their own tokens. Worker uses service-role for sends.
alter table push_tokens enable row level security;

drop policy if exists "push: self select" on push_tokens;
drop policy if exists "push: self insert" on push_tokens;
drop policy if exists "push: self update" on push_tokens;
drop policy if exists "push: admin all"   on push_tokens;

create policy "push: self select" on push_tokens
  for select using (profile_id = auth.uid());
create policy "push: self insert" on push_tokens
  for insert with check (profile_id = auth.uid());
create policy "push: self update" on push_tokens
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "push: admin all" on push_tokens
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');
