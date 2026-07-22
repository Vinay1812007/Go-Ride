# GoRide

Rapido / Uber / Ola / Porter-style multi-service platform in one app — **bike, cab, auto, and parcel** verticals, three role experiences (customer / rider / admin), and a D2C partner API. Built to run entirely on free tiers: Cloudflare (Pages + Workers), Supabase (Postgres + Auth + Realtime + Storage), GitHub Actions (APK build), and the OpenStreetMap ecosystem for maps.

> Food delivery is intentionally deferred to Phase 2 — the schema and rate-card system already support it, but the customer/restaurant UI is not built.

## Repo layout

```
apps/
  web/    React + Vite + TS + Tailwind — customer / rider / admin (role-routed)
  api/    Cloudflare Worker (Hono)     — REST API + fare engine + dispatch
supabase/
  migrations/0001_init.sql  — schema
  migrations/0002_rls.sql   — row-level security
  seed.sql                  — Hyderabad rate cards + service area + demo admin
docs/
  PARTNER-API.md            — D2C partner integration guide (rendered at /developers)
  RUNBOOK.md                — deploy + operate
.github/workflows/
  deploy.yml                — Pages + Worker on push to main
  buildapk.yml              — customer + rider APKs on tag push
```

## Quick start (local dev)

```bash
# 1. Install
npm install

# 2. Supabase — create free project, then apply migrations
#    (paste migrations/*.sql into SQL editor, then seed.sql)
#    Enable Realtime on the `orders` table.

# 3. Configure environment
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Fill in Supabase URL, keys, and your chosen geo provider

# 4. Run
npm run dev:api    # Worker on :8787
npm run dev:web    # Vite on :5173
```

## Tech stack (all free tier)

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript + Tailwind CSS |
| Mobile APK | Capacitor 6 (wraps the web app) |
| Backend API | Cloudflare Workers (Hono) |
| Database | Supabase Postgres |
| Auth | Supabase Auth (email/password for MVP) |
| Realtime tracking | Supabase Realtime channels |
| File storage | Supabase Storage |
| Maps | MapLibre GL JS + OpenFreeMap tiles |
| Geocoding | Nominatim / LocationIQ / Geoapify (env-switchable) |
| Routing | OSRM public demo / Openrouteservice (env-switchable) |
| CI/CD | GitHub Actions |

See [docs/RUNBOOK.md](./docs/RUNBOOK.md) for deploy and ops. See [docs/PARTNER-API.md](./docs/PARTNER-API.md) for the D2C partner API.

## License

MIT
