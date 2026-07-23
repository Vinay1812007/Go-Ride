-- =============================================================================
-- Allow partner-created orders to have no customer_id
-- =============================================================================
-- The D2C partner API (§8) shouldn't need to invent a synthetic customer
-- profile. Partner orders have customer_id=null and partner_id set instead.
-- Consumer-facing UI shows the partner's business_name in that slot.

alter table orders alter column customer_id drop not null;

-- One of customer_id or partner_id must be present.
do $$ begin
  alter table orders add constraint orders_customer_or_partner_chk
    check (customer_id is not null or partner_id is not null);
exception when duplicate_object then null; end $$;

-- Update the RLS policy that let partners' orders leak into a customer's
-- "read own" scope. Nobody with a NULL customer_id matches auth.uid() anyway,
-- but drop-and-recreate for clarity.
drop policy if exists "order: customer read own" on orders;
create policy "order: customer read own" on orders
  for select using (customer_id is not null and customer_id = auth.uid());
