-- ---------------------------------------------------------------------------
-- 0009: Weekly rider payouts
--
-- Adds:
--   • payouts table               — one row per rider per pay period
--   • payout_status enum          — pending | paid | failed | cancelled
--   • payout_transactions table   — junction linking a payout to the
--     transactions rows it settled (audit trail so we never double-pay)
--
-- Model:
--   The payouts table is the "cheque book". Every Monday, a cron computes
--   the previous week's (Mon 00:00 UTC → Sun 23:59 UTC) net earnings for
--   each rider from `transactions` and inserts a pending row. Admin marks
--   paid once the actual bank transfer has cleared, entering the bank
--   reference.
--
--   payout_transactions.rows are the specific trip_earning + commission
--   transactions that were folded into this payout — guarantees the same
--   transaction can't be paid twice by a re-run.
--
-- Fully idempotent — every CREATE / INSERT is guarded.
-- ---------------------------------------------------------------------------

do $$ begin
  create type payout_status as enum ('pending', 'paid', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists payouts (
  id            uuid primary key default gen_random_uuid(),
  rider_id      uuid not null references riders(id) on delete cascade,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  gross         numeric(10, 2) not null default 0,   -- sum of trip_earning
  commission    numeric(10, 2) not null default 0,   -- sum of |commission|
  net           numeric(10, 2) not null default 0,   -- gross - commission
  trips         int not null default 0,
  status        payout_status not null default 'pending',
  bank_ref      text,                                -- UTR / UPI ref filled by admin
  note          text,
  paid_at       timestamptz,
  paid_by       uuid references profiles(id),
  created_at    timestamptz not null default now(),
  -- One payout per rider per period. Prevents double-inserts if the cron
  -- fires twice due to a Cloudflare quirk.
  unique (rider_id, period_start, period_end)
);
create index if not exists payouts_rider_idx  on payouts(rider_id, period_start desc);
create index if not exists payouts_status_idx on payouts(status, period_start desc)
  where status = 'pending';

-- Junction: which transactions are already covered by this payout.
create table if not exists payout_transactions (
  payout_id      uuid not null references payouts(id) on delete cascade,
  transaction_id bigint not null references transactions(id) on delete cascade,
  primary key (payout_id, transaction_id)
);
-- Reverse lookup: has a transaction already been paid out?
create unique index if not exists payout_transactions_tx_uidx
  on payout_transactions(transaction_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table payouts              enable row level security;
alter table payout_transactions  enable row level security;

drop policy if exists "payout: rider read own"  on payouts;
drop policy if exists "payout: admin all"       on payouts;
drop policy if exists "payout_tx: admin all"    on payout_transactions;

create policy "payout: rider read own" on payouts
  for select using (rider_id = auth.uid());
create policy "payout: admin all" on payouts
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

create policy "payout_tx: admin all" on payout_transactions
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ── run_payouts SQL function ───────────────────────────────────────────────
-- Called by the cron. Batches the previous ISO week per rider (Monday-start),
-- skips transactions that already belong to a payout, and inserts one
-- payout row + N payout_transactions rows in a single transactional block.
-- Returns the count of payouts created for logging.
create or replace function run_payouts(p_from timestamptz default null, p_to timestamptz default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_from   timestamptz;
  v_to     timestamptz;
  v_count  int := 0;
  r        record;
  v_payout_id uuid;
begin
  -- Default window: previous Monday 00:00 UTC → Sunday 23:59:59.999 UTC.
  if p_from is null or p_to is null then
    v_to   := date_trunc('week', now() at time zone 'utc');       -- this Mon 00:00 UTC
    v_from := v_to - interval '7 days';
    v_to   := v_to - interval '1 microsecond';
  else
    v_from := p_from;
    v_to   := p_to;
  end if;

  for r in
    select
      t.rider_id,
      sum(case when t.type = 'trip_earning' then t.amount else 0 end)              as gross,
      sum(case when t.type = 'commission'   then abs(t.amount) else 0 end)         as commission,
      count(distinct case when t.type = 'trip_earning' then t.order_id end)        as trips,
      array_agg(t.id order by t.id)                                                 as tx_ids
    from transactions t
    left join payout_transactions px on px.transaction_id = t.id
    where t.type in ('trip_earning', 'commission')
      and t.created_at >= v_from
      and t.created_at <= v_to
      and t.rider_id is not null
      and px.transaction_id is null                     -- skip already-paid transactions
    group by t.rider_id
    having sum(case when t.type = 'trip_earning' then t.amount else 0 end) > 0
  loop
    -- Idempotent insert — if a re-run finds an existing row for the same
    -- window + rider, skip it entirely.
    insert into payouts (rider_id, period_start, period_end, gross, commission, net, trips)
    values (r.rider_id, v_from, v_to, r.gross, r.commission, r.gross - r.commission, r.trips)
    on conflict (rider_id, period_start, period_end) do nothing
    returning id into v_payout_id;

    if v_payout_id is not null then
      insert into payout_transactions (payout_id, transaction_id)
      select v_payout_id, tx_id from unnest(r.tx_ids) tx_id
      on conflict do nothing;
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;
