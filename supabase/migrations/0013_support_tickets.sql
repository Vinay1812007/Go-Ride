-- ---------------------------------------------------------------------------
-- 0013: Support tickets + messages
--
-- Customer opens a ticket ("problem with order GR-XXX", "wallet credit
-- missing"…), an admin picks it up from the queue, they thread messages,
-- admin marks resolved. Realtime broadcast on ticket:{id} keeps both
-- sides live-updated.
--
-- Distinct from the in-trip chat (§15 messages table) — that's between
-- customer and captain during a live trip. This is customer ↔ support
-- and can outlive any specific trip.
-- ---------------------------------------------------------------------------

do $$ begin
  create type ticket_status as enum ('open', 'assigned', 'awaiting_customer', 'resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_priority as enum ('low', 'normal', 'high');
exception when duplicate_object then null; end $$;

create table if not exists support_tickets (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references profiles(id) on delete cascade,
  order_id      uuid references orders(id),           -- optional context
  subject       text not null check (char_length(subject) between 3 and 200),
  status        ticket_status not null default 'open',
  priority      ticket_priority not null default 'normal',
  assigned_to   uuid references profiles(id),         -- admin who picked it up
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists support_tickets_customer_idx on support_tickets(customer_id, created_at desc);
create index if not exists support_tickets_status_idx   on support_tickets(status, created_at desc) where status <> 'resolved';
create index if not exists support_tickets_assigned_idx on support_tickets(assigned_to, status)     where status <> 'resolved';

create table if not exists support_messages (
  id                  uuid primary key default gen_random_uuid(),
  ticket_id           uuid not null references support_tickets(id) on delete cascade,
  sender_role         user_role not null,      -- 'customer' | 'admin'
  sender_id           uuid not null references profiles(id),
  body                text not null check (char_length(body) between 1 and 4000),
  read_by_customer_at timestamptz,
  read_by_agent_at    timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx  on support_messages(ticket_id, created_at);

-- Add to Realtime publication so direct-subscribe clients get inserts too.
-- (Primary channel is still the Worker broadcast — this is belt-and-suspenders.)
do $$ begin
  alter publication supabase_realtime add table support_messages;
exception when duplicate_object then null;
         when others then null; end $$;

-- Bump the parent ticket's updated_at + reopen if the customer replies to
-- an awaiting_customer ticket. Runs after every message insert.
create or replace function bump_support_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update support_tickets
    set updated_at = now(),
        status = case
          when status = 'awaiting_customer' and new.sender_role = 'customer' then 'assigned'
          else status
        end
    where id = new.ticket_id;
  return new;
end $$;

drop trigger if exists on_support_message on support_messages;
create trigger on_support_message
  after insert on support_messages
  for each row execute function bump_support_ticket();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table support_tickets  enable row level security;
alter table support_messages enable row level security;

drop policy if exists "ticket: customer own"    on support_tickets;
drop policy if exists "ticket: admin all"       on support_tickets;
drop policy if exists "ticket_msg: customer own" on support_messages;
drop policy if exists "ticket_msg: customer send" on support_messages;
drop policy if exists "ticket_msg: admin all"    on support_messages;

create policy "ticket: customer own" on support_tickets
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy "ticket: admin all" on support_tickets
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

create policy "ticket_msg: customer own" on support_messages
  for select using (
    exists (
      select 1 from support_tickets t where t.id = support_messages.ticket_id and t.customer_id = auth.uid()
    )
  );
create policy "ticket_msg: customer send" on support_messages
  for insert with check (
    sender_id = auth.uid()
    and sender_role = 'customer'
    and exists (
      select 1 from support_tickets t where t.id = support_messages.ticket_id and t.customer_id = auth.uid()
    )
  );
create policy "ticket_msg: admin all" on support_messages
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');
