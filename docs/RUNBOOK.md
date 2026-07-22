# GoRide RUNBOOK

Deploy, secrets, and day-2 ops on 100% free tier.

## 0. What you need (before the first deploy)

- **GitHub repo** (this one)
- **Supabase project** (free — supabase.com)
- **Cloudflare account** (free — cloudflare.com) with a "Workers & Pages" project
- **Android keystore** for signing the APK (generate once, base64 into a GitHub secret)
- Optional: LocationIQ / Geoapify free API key (for better geocoding rate limits)

## 1. Supabase — one-time setup

1. Create a free project. Region: Singapore or Mumbai for India traffic.
2. **SQL editor → New query** and run in this order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_rls.sql`
   - `supabase/seed.sql`
3. **Database → Replication** → toggle Realtime on the `orders` table.
4. **Storage** → create buckets:
   - `kyc` — Private
   - `food` — Public (Phase 2)
5. **Auth → Providers → Email** → enable email + password.
6. **Project settings → API** → copy these for later:
   - `URL`
   - `anon` public key
   - `service_role` secret key
   - `JWT secret` (under "JWT Settings")

### First admin

Sign up once via the app (or from `Auth → Users → Add user`), then:

```sql
update profiles set role = 'admin' where email = 'you@yourdomain.com';
```

## 2. Cloudflare — Worker + Pages

### KV namespace (for cache)

```bash
cd apps/api
npx wrangler kv:namespace create CACHE
```

Copy the returned `id` into `apps/api/wrangler.toml` under `[[kv_namespaces]]`.

### Set Worker secrets

```bash
cd apps/api
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_JWT_SECRET
npx wrangler secret put SHARE_TOKEN_SECRET     # openssl rand -hex 32
# Optional
npx wrangler secret put ORS_KEY
npx wrangler secret put GEOCODER_KEY
```

Deploy the Worker:

```bash
npx wrangler deploy
```

Note the Worker URL (e.g. `https://goride-api.YOUR-SUBDOMAIN.workers.dev`).

### Pages project

Create in Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git → Vinay1812007/Go-Ride**.

- **Build command:** `npm ci && npm run build:web`
- **Build output directory:** `apps/web/dist`
- **Root directory:** (leave blank; the workflow builds from repo root)
- **Environment variables** (Preview & Production):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_API_URL` (paste your Worker URL)
  - `VITE_APP_TARGET=customer`
  - `VITE_DEFAULT_CITY=Hyderabad`
  - `VITE_DEFAULT_LAT=17.3850`
  - `VITE_DEFAULT_LNG=78.4867`

## 3. GitHub secrets (for CI)

Repo → Settings → Secrets and variables → Actions → New repository secret:

```
CLOUDFLARE_API_TOKEN      # scoped to Workers + Pages Edit
CLOUDFLARE_ACCOUNT_ID
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET
SHARE_TOKEN_SECRET
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_URL
ORS_KEY                   # optional
GEOCODER_KEY              # optional
# APK signing
ANDROID_KEYSTORE_B64
KEYSTORE_PASSWORD
KEY_ALIAS
KEY_PASSWORD
```

### Generate the Android keystore

```bash
keytool -genkeypair -v \
  -keystore release.keystore -alias goride -keyalg RSA -validity 10000
# base64 it into the ANDROID_KEYSTORE_B64 secret
base64 -w0 release.keystore | pbcopy       # macOS
```

## 4. Day-to-day

- **Deploy:** `git push` to `main` → GitHub Actions `deploy.yml` builds Pages + Worker.
- **Ship APKs:** `git tag v0.1.0 && git push --tags` → `buildapk.yml` produces both `goride-customer.apk` and `goride-rider.apk` on the Release.
- **Edit rate cards:** Admin panel → Rate cards. Changes apply instantly.
- **Rider onboarding:** rider signs up, calls `POST /riders/onboard`, admin approves KYC.
- **Live status:** Admin panel → Dashboard (auto-refresh 15s).

## 5. Cron

Wrangler cron is defined in `apps/api/wrangler.toml`:

- Every minute — sweep expired job offers, widen dispatch to 8 km at 60s, fail to `no_rider_found` at 120s.
- Nightly 03:00 UTC — prune `rider_locations` rows older than 24h to stay inside the Supabase 500 MB free tier.

Check runs in Cloudflare → Workers → your Worker → Triggers.

## 6. Known free-tier ceilings

| Limit | Value | Impact |
|---|---|---|
| Supabase Postgres | 500 MB | Fine for a pilot city; auto-prune keeps `rider_locations` in check |
| Supabase Realtime | 200 concurrent | ~100 active users comfortably |
| Cloudflare Workers | 100k req/day | Rate limit partner keys; enable caching |
| OSRM public demo | ~1 req/sec / no SLA | Move to self-hosted OSRM or Openrouteservice free tier (2000/day) for real traffic |
| Nominatim public | ~1 req/sec | Register LocationIQ (5k/day) or Geoapify (3k/day) for anything beyond demos |

Upgrade path is documented per service in the Supabase/Cloudflare dashboards — the schema and Worker code do not change.

## 7. Local dev

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars
# fill in credentials

npm run dev:api  # :8787
npm run dev:web  # :5173
```

## 8. Troubleshooting

- **Rider offers not arriving** — check that the rider has `kyc = 'approved'`, `status = 'online'`, and `last_seen` within 60s. The dispatch query filters on all three.
- **Fare wildly off** — the OSRM public demo can 502; the code falls back to haversine × 25km/h. Set `ROUTER=ors` + `ORS_KEY` for reliability.
- **Realtime not firing** — confirm the `orders` table has Replication enabled in Supabase; broadcast uses the same channel infra.
- **"setup_incomplete" from Partner API** — the shell customer profile for the partner isn't created yet. See PARTNER-API.md footnote (Phase 2 auto-provisions this).
