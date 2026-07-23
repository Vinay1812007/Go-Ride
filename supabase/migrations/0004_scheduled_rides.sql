-- ---------------------------------------------------------------------------
-- 0004: Scheduled rides
--
-- Adds:
--   • order_status.scheduled          (booked for later, not yet dispatching)
--   • orders.scheduled_at             (when to auto-promote to 'searching')
--   • orders.dispatch_started_at      (audit: when the cron kicked dispatch)
--   • orders_scheduled_due_idx        (partial index for the promote query)
--
-- Fully idempotent. Every enum add, column add, and index add uses IF NOT
-- EXISTS / DO-EXCEPTION guards so this migration is safe to re-run.
-- ---------------------------------------------------------------------------

-- Extend the order_status enum with 'scheduled'.
do $$ begin
  alter type order_status add value if not exists 'scheduled' before 'searching';
exception when others then null; end $$;

-- Columns
alter table orders add column if not exists scheduled_at        timestamptz;
alter table orders add column if not exists dispatch_started_at timestamptz;

-- Partial index for the minutely "promote due scheduled orders" cron query.
-- Only rows with status='scheduled' AND a set scheduled_at are indexed, which
-- keeps the index tiny even as the orders table grows.
create index if not exists orders_scheduled_due_idx
  on orders(scheduled_at)
  where status = 'scheduled' and scheduled_at is not null;

-- Customer-facing "upcoming" query index (list scheduled rides per customer).
create index if not exists orders_customer_scheduled_idx
  on orders(customer_id, scheduled_at)
  where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- RLS: customer can insert/update/delete their own scheduled orders. The
-- existing orders RLS in 0002_rls.sql already scopes by customer_id, so no
-- new policy is needed — this is a note for the reader.
-- ---------------------------------------------------------------------------
