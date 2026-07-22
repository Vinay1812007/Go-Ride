# Supabase — apply order

1. Create a free Supabase project (https://supabase.com), pick a region near your pilot city (Singapore or Mumbai for India).
2. Open the SQL editor and run these files, in order:
   - `migrations/0001_init.sql` — schema, enums, helpers, triggers
   - `migrations/0002_rls.sql` — Row Level Security policies
   - `seed.sql` — Hyderabad rate cards + service area
3. Enable Realtime on the `orders` table:
   - Dashboard → Database → Replication → toggle `orders` on
4. Create storage buckets:
   - `kyc` — private (rider license, RC, insurance photos)
   - `food` — public (Phase 2)
5. Auth settings:
   - Enable Email/Password (MVP)
   - Disable email confirmation for demo, or leave on if you want the real flow
6. Copy credentials into the Worker (`apps/api/.dev.vars`) and web (`apps/web/.env.local`):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` — safe for the browser
   - `SUPABASE_SERVICE_ROLE_KEY` — Worker-side only, never ship to the client

## First admin

There's no seeded admin because the row must reference `auth.users`. After the first sign-up, run:

```sql
update profiles set role = 'admin' where email = 'you@yourdomain.com';
```

## Notes

- `handle_new_user()` trigger auto-creates a `profiles` row for every new auth user.
- RLS is on for every table; the Worker uses the `service_role` key and bypasses RLS. Direct client writes to `orders` / `job_offers` / `transactions` are blocked.
- `prune_rider_locations()` should be called daily by the scheduled Worker (see `.github/workflows/deploy.yml` and the API's cron handler).
