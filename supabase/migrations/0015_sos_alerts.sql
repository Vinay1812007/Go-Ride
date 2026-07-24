-- ---------------------------------------------------------------------------
-- 0015: SOS emergency alerts
--
-- Customer or captain hits the panic button during an active trip.
-- Alert lands in an admin-visible queue with real-time push to on-call
-- admins.
-- ---------------------------------------------------------------------------

do $$ begin
  create type sos_status as enum ('open', 'acknowledged', 'resolved', 'false_alarm');
exception when duplicate_object then null; end $$;

create table if not exists sos_alerts (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references profiles(id) on delete cascade,
  role              user_role not null,       -- 'customer' | 'rider'
  order_id          uuid references orders(id),
  lat               double precision not null,
  lng               double precision not null,
  note              text,                     -- optional freeform "car following me" etc
  status            sos_status not null default 'open',
  acknowledged_by   uuid references profiles(id),
  acknowledged_at   timestamptz,
  resolved_by       uuid references profiles(id),
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz not null default now()
);
create index if not exists sos_alerts_status_idx  on sos_alerts(status, created_at desc) where status <> 'resolved' and status <> 'false_alarm';
create index if not exists sos_alerts_profile_idx on sos_alerts(profile_id, created_at desc);
create index if not exists sos_alerts_order_idx   on sos_alerts(order_id) where order_id is not null;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table sos_alerts enable row level security;

drop policy if exists "sos: self insert" on sos_alerts;
drop policy if exists "sos: self read"   on sos_alerts;
drop policy if exists "sos: admin all"   on sos_alerts;

create policy "sos: self insert" on sos_alerts
  for insert with check (profile_id = auth.uid());
create policy "sos: self read" on sos_alerts
  for select using (profile_id = auth.uid() or auth_role() = 'admin');
create policy "sos: admin all" on sos_alerts
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');
