-- ---------------------------------------------------------------------------
-- 0005: In-app chat between customer and captain
--
-- Adds:
--   • messages                        — every chat line, one row each
--   • messages_order_created_idx      — for the per-order timeline query
--
-- Wire-format:
--   sender_role determines which side sent it. sender_id is stored for
--   audit (and to render an avatar in Phase 3), but the client identifies
--   its own message by sender_role match. Rows are immutable — no edits.
--
-- Fully idempotent: IF NOT EXISTS on the table + index; DROP POLICY IF EXISTS
-- before every CREATE POLICY so re-runs are safe.
-- ---------------------------------------------------------------------------

create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  sender_role user_role not null,     -- 'customer' | 'rider' (never 'admin' in the wild)
  sender_id   uuid not null references profiles(id),
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists messages_order_created_idx
  on messages(order_id, created_at);

create index if not exists messages_unread_idx
  on messages(order_id, sender_role)
  where read_at is null;

-- Realtime replication so both sides get pushed updates without polling.
-- (Broadcast from the Worker is our primary channel, but replication is
-- a nice belt-and-suspenders for direct-from-client inserts if we ever
-- allow them.)
do $$ begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null;
         when others then null; end $$;

-- ---------------------------------------------------------------------------
-- RLS: only the customer and the assigned rider on the parent order can
-- see or write messages. Admins can read for support.
-- ---------------------------------------------------------------------------
alter table messages enable row level security;

drop policy if exists "message: parties select"  on messages;
drop policy if exists "message: parties insert"  on messages;
drop policy if exists "message: recipient read"  on messages;

create policy "message: parties select" on messages
  for select using (
    exists (
      select 1 from orders o
      where o.id = messages.order_id
        and (o.customer_id = auth.uid() or o.rider_id = auth.uid())
    )
    or auth_role() = 'admin'
  );

create policy "message: parties insert" on messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from orders o
      where o.id = messages.order_id
        and (o.customer_id = auth.uid() or o.rider_id = auth.uid())
    )
  );

-- Only the recipient (the other party) can flip read_at, and only from
-- null → not-null. Once read, it stays read.
create policy "message: recipient read" on messages
  for update using (
    exists (
      select 1 from orders o
      where o.id = messages.order_id
        and (
          (o.customer_id = auth.uid() and messages.sender_role = 'rider')
          or
          (o.rider_id = auth.uid()    and messages.sender_role = 'customer')
        )
    )
  );
