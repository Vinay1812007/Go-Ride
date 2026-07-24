-- ---------------------------------------------------------------------------
-- 0014: Saved places
--
-- Customer stores Home / Work / other named destinations for one-tap
-- pickup selection at booking time. Unique constraint keeps at most one
-- Home + one Work per profile; 'other' can have many.
-- ---------------------------------------------------------------------------

do $$ begin
  create type place_type as enum ('home', 'work', 'other');
exception when duplicate_object then null; end $$;

create table if not exists saved_places (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 60),
  address     text not null check (char_length(address) between 3 and 300),
  lat         double precision not null,
  lng         double precision not null,
  place_type  place_type not null default 'other',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists saved_places_profile_idx on saved_places(profile_id, place_type, created_at);

-- Enforce at most one home + one work per profile. 'other' can have many.
create unique index if not exists saved_places_profile_home_uidx
  on saved_places(profile_id) where place_type = 'home';
create unique index if not exists saved_places_profile_work_uidx
  on saved_places(profile_id) where place_type = 'work';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table saved_places enable row level security;

drop policy if exists "place: self all" on saved_places;
create policy "place: self all" on saved_places
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
