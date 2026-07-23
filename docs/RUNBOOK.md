# GoRide RUNBOOK

Everything you need to deploy, operate, debug, and hand off GoRide — running
on 100% free tier (Cloudflare + Supabase + GitHub + OpenStreetMap).

If you're wondering "why did we do X that way?", each section says so.

---

## 0. What's live

| Surface | URL | Notes |
|---|---|---|
| Customer web/PWA | https://goride-web.pages.dev | `VITE_APP_TARGET=customer` |
| Captain web/PWA | https://goride-captain.pages.dev | `VITE_APP_TARGET=rider` |
| Admin console | https://goride-admin.pages.dev | `VITE_APP_TARGET=admin` |
| API (Worker) | https://goride-api.\<subdomain\>.workers.dev | Hono on Cloudflare Workers |
| Developer docs | https://goride-web.pages.dev/developers | Also served at same path on each Pages project |
| Public tracking | https://goride-web.pages.dev/t/\<orderNo\> | Unauthenticated; HMAC-signed token |

**Why three Pages projects instead of one?** `pages.dev` doesn't do
per-subdomain apps under a single project, so each role is a separate Pages
project pinned at build time by `VITE_APP_TARGET`. This lets us tell riders
"go to `goride-captain.pages.dev`" without the customer bundle being
downloadable there.

---

## 1. Architecture at a glance

```
                       ┌────────────────────────────────┐
   Riders ─────────►   │   Cloudflare Pages ×3 (React)  │
   Customers ──────►   │   customer / captain / admin   │
   Admins ─────────►   │   PWA installable; same code   │
                       └───────────────┬────────────────┘
                                       │  HTTPS + Bearer <supabase JWT>
                                       ▼
                       ┌────────────────────────────────┐
                       │  Cloudflare Worker (Hono)      │
                       │  goride-api.workers.dev        │
                       │  • JWT verify (HS256 + JWKS)   │
                       │  • Dispatch engine             │
                       │  • Fare / rate cards / cron    │
                       │  • Partner API (HMAC)          │
                       └──────┬─────────────────────┬───┘
                              │                     │
                    Postgres  │                     │  Realtime
                              ▼                     ▼
                       ┌──────────────────────────────────┐
                       │  Supabase                        │
                       │  • Postgres + RLS                │
                       │  • Auth (email/password)         │
                       │  • Realtime broadcast channels   │
                       │  • Storage (KYC bucket)          │
                       └──────────────────────────────────┘
```

Maps come from **MapLibre GL JS** rendering **OpenFreeMap** tiles;
geocoding via **Nominatim** / LocationIQ; routing via **OSRM** public demo
(with an OpenRouteService fallback).

---

## 2. First-time deploy (start here)

### 2.1 Supabase — one-time setup

1. Create a free project. Region: **ap-south-1 (Mumbai)** for India traffic.
2. Copy from **Project Settings → API**:
   - Project URL
   - `anon` public key
   - `service_role` secret key
   - JWT secret (**JWT Settings** panel)
3. Copy from **Project Settings → Database → Connection string → URI**:
   the **Session pooler** connection string (uses port `5432`, IPv4-safe —
   GitHub Actions runners can't reach the direct connection because it's
   IPv6-only, and the transaction pooler on `:6543` breaks psql's
   `SET LOCAL` behaviour). This is what goes in `SUPABASE_DB_URL`.
4. **Database → Replication** → toggle Realtime on the `orders` table.
5. **Storage → New bucket**:
   - `kyc` — Private
   - `food` — Public (Phase 2, safe to skip)
6. **Auth → Providers → Email** → enable email + password. Disable email
   confirmation while you're testing so you don't fight your own inbox.

Do **not** run migrations by hand in the SQL editor. Use the workflow
(§3) — the SQL files are idempotent and re-runnable, which the workflow
takes advantage of.

### 2.2 GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Every workflow reads from here; there is no `.env` in the repo.

**Supabase**

| Secret | Where from |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key |
| `SUPABASE_JWT_SECRET` | JWT settings → JWT Secret |
| `SUPABASE_DB_URL` | Session pooler URI (see §2.1) |

**Cloudflare**

| Secret | Where from |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard → right sidebar |
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens → Create → template "Edit Cloudflare Workers" (needs Workers + Pages Edit + KV Edit) |

**App-level**

| Secret | Where from |
|---|---|
| `SHARE_TOKEN_SECRET` | `openssl rand -hex 32` (for share-link HMAC) |
| `ORS_KEY` | Optional — openrouteservice.org free tier for reliable routing |
| `GEOCODER_KEY` | Optional — LocationIQ or Geoapify free key |

**APK signing (only needed when you tag a release)**

| Secret | How to make |
|---|---|
| `ANDROID_KEYSTORE_B64` | `base64 -w0 release.keystore` (see §7) |
| `KEYSTORE_PASSWORD` | picked at `keytool -genkeypair` time |
| `KEY_ALIAS` | picked at `keytool -genkeypair` time |
| `KEY_PASSWORD` | picked at `keytool -genkeypair` time |

> **Gotcha:** GitHub's Secret UI silently strips trailing newlines. If the
> keystore base64 is over ~3000 chars, paste it from a file (Add secret →
> "Import from file") rather than the textarea, or the APK build will fail
> with "keystore doesn't exist" — the decoded blob will be truncated. This
> bit us in Day 3.

### 2.3 First deploy

Push to `main`. The **Deploy web + api** workflow will:

1. Provision the KV namespace and patch `wrangler.toml` if needed.
2. Push Worker secrets to Cloudflare (idempotent).
3. Deploy the Worker.
4. Resolve the workers.dev URL and pass it into the web build as
   `VITE_API_URL`.
5. Build the web app three times (once per `VITE_APP_TARGET`).
6. Ensure each Pages project exists, then deploy each build to its Pages
   project.

The workflow is fully idempotent — every step will re-run cleanly.

### 2.4 First admin

Sign up via the customer app or **Supabase → Auth → Users → Add user**,
then flip your role:

```sql
update profiles set role = 'admin' where email = 'you@yourdomain.com';
```

Log in at `https://goride-admin.pages.dev`.

---

## 3. Migrations

Never edit SQL in the Supabase dashboard by hand — you'll drift from
git. Instead:

1. Add a new migration file under `supabase/migrations/`.
2. Push it to `main`.
3. **Actions → Apply Supabase migrations → Run workflow → target: all**.

The workflow uses `psql` over the session pooler URI. Every migration is
guarded with `IF NOT EXISTS` (tables/columns), `CREATE OR REPLACE`
(functions), and `DO $$ ... EXCEPTION WHEN duplicate_object THEN null; END $$`
(enums). RLS policies use `DROP POLICY IF EXISTS` before every `CREATE
POLICY`. Re-running a migration is a no-op.

If you added a new SQL file, add it to the `case` block in
`.github/workflows/migrate.yml`.

**Rollback:** there isn't one. Migrations are additive by convention; if
you must revert, write a compensating migration and re-run.

---

## 4. Day-to-day operations

### 4.1 Deploy

```
git push origin main
```

Push kicks off both the Worker deploy and all three Pages deploys.
Watch **Actions → Deploy web + api**. Total time: ~90s.

### 4.2 Redeploy without a code change

Actions → **Deploy web + api** → **Run workflow**. Useful after rotating a
secret in Cloudflare or Supabase.

### 4.3 Seed / purge demo data

Admin console → Dashboard → **Load demo data** creates 5 captains around
Hyderabad, 3 customers, and 15 sample orders in various states (completed,
in-transit, cancelled, searching, no-rider-found). Idempotent — safe to
re-run. **Purge demo** removes every user with an `@goride.demo` email and
their orders in one shot.

Use this for screenshots and pilots; use it before demoing to a partner
so the map isn't empty.

### 4.4 Rotate a secret

Any Supabase or Cloudflare secret: update it in **Repo → Settings →
Secrets and variables**, then trigger **Deploy web + api → Run workflow**.
Worker secrets are pushed on every deploy, so the new value goes live in
about 60 seconds.

Rotating the Supabase JWT signing key (asymmetric, ES256): nothing to do
on our side — `apps/api/src/lib/auth.ts` fetches the JWKS from
`${SUPABASE_URL}/auth/v1/.well-known/jwks.json` and caches it. Old
tokens keep verifying until they expire.

### 4.5 Promote/demote a user

```sql
-- Promote
update profiles set role = 'admin' where email = 'them@yourdomain.com';
-- Demote a captain back to customer
update profiles set role = 'customer' where email = 'them@yourdomain.com';
```

Roles: `customer`, `rider`, `admin`. The three Pages projects gate access
by role at load time — a customer landing on `goride-admin.pages.dev` sees
a friendly diagnostic page with their email, detected role, and a link to
the correct URL.

### 4.6 Re-dispatch a stuck order

Admin → Orders → the row → **Re-dispatch**. This calls the same dispatch
engine again with a widened radius, and shows a debug modal with the exact
riders considered and why each was excluded (stale GPS, wrong city, wrong
vehicle, blocked, etc). This is what you use when an order is stuck on
"searching".

---

## 5. Dispatch engine (how it works)

`apps/api/src/lib/dispatch.ts`.

- On a new order, we grab every rider where
  `status='online'`, `kyc='approved'`, `last_seen` within **5 minutes**,
  city matches (case-insensitive), and the rider's vehicle serves the
  requested service. We rank by distance, offer to the top N, wait
  25 seconds per offer.
- A minutely cron sweeps expired offers, widens the radius to 8 km at 60s
  in the order lifetime, and fails to `no_rider_found` at 120s.
- A nightly 03:00 UTC cron prunes `rider_locations` rows older than 24h
  so we stay under Supabase's 500 MB free tier.
- Cron config: `[triggers] crons = ["* * * * *", "0 3 * * *"]` in
  `apps/api/wrangler.toml`.

**Why 5 minutes for stale?** Mobile browsers throttle GPS aggressively
when the tab is backgrounded. 60s (our first version) meant almost every
captain fell out of the pool as soon as they weren't actively looking at
the app. 5 minutes is generous enough to keep them dispatchable while
their app is warm in the background but still tight enough that a captain
who closed the browser doesn't get pinged 20 minutes later.

**Why we broadcast `trip_ended` on cancel:** if the customer cancels a
searching order, the captain's screen was previously stuck on "on trip"
because we only reset `rider.status` on trip completion. The cancel handler
now resets `rider.status → 'online'` and broadcasts `trip_ended` on the
`rider:{uid}` channel so the captain's UI clears immediately.

---

## 6. Cron

Defined in `apps/api/wrangler.toml`:

| Schedule | What |
|---|---|
| `* * * * *` | Every minute — expire offers, widen radius, transition to `no_rider_found` at 120s |
| `0 3 * * *` | 03:00 UTC daily — prune `rider_locations` older than 24h |

Runs visible in Cloudflare → Workers & Pages → `goride-api` → **Triggers**.

---

## 7. Android APKs

### 7.1 Generate the keystore (one time)

```bash
keytool -genkeypair -v \
  -keystore release.keystore \
  -alias goride \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
# → picks KEYSTORE_PASSWORD (store), KEY_PASSWORD (key)

# Encode for GH Actions
base64 -w0 release.keystore > release.keystore.b64
cat release.keystore.b64 | wc -c   # should be ~3500-3700 chars
```

Upload `release.keystore.b64` **as a file** into the `ANDROID_KEYSTORE_B64`
secret (not paste — see §2.2 gotcha).

### 7.2 Build

```
git tag v0.1.0
git push --tags
```

**buildapk.yml** runs a matrix (customer + rider) and produces two APKs on
the release. The APK IDs are `in.goride.app` (customer) and
`in.goride.captain` (rider).

Env requirements the workflow satisfies:

- **Java 21** (Capacitor 6 requires it — Java 17 hits a Gradle plugin
  version mismatch).
- **Android SDK 34** installed via `android-actions/setup-android@v3`.
- Keystore path resolved as `$GITHUB_WORKSPACE/apps/web/android/app/release.keystore`.
  A relative `app/release.keystore` in `signingConfig` resolves *from the
  app module directory*, producing the classic `app/app/release.keystore
  doesn't exist` error.
- The workflow self-verifies the keystore decode (`file release.keystore`
  must say "Java KeyStore"), so a truncated secret fails fast with a clear
  error rather than an opaque Gradle stacktrace.

If signing secrets are missing, the workflow falls back to an unsigned
debug APK so you never leave a release empty-handed.

---

## 8. Partner API (D2C)

Every business surface lives under `/api/partner/*` and is authenticated
by an HMAC signature over the request body + timestamp using the partner's
secret. Secrets are shown **once** at creation time in Admin → Partners.

Public docs: https://goride-web.pages.dev/developers

Create a partner:

Admin → Partners → **New partner** → save the returned secret somewhere
safe. There is no "show secret" endpoint — if a partner loses it, rotate.

Rate-limit at the KV level (100k reads/day free); the Worker signs
webhooks to the partner's `webhook_url` on state transitions.

---

## 9. PWA install

Every push produces installable PWAs on all three Pages projects.

- **Android/Chrome/Edge:** the `beforeinstallprompt` event is captured in
  `apps/web/src/components/InstallPrompt.tsx` and surfaced as a subtle
  bottom banner. Dismissal is remembered for 30 days.
- **iOS Safari:** no `beforeinstallprompt` — we show a "Share → Add to
  Home Screen" hint after 3s instead.
- Icons live in `apps/web/public/`: `icon-192.png`, `icon-512.png`,
  `icon-512-maskable.png`, `apple-touch-icon.png` (180). All rendered from
  `favicon.svg` — to update the brand, edit the SVG and re-run
  `rsvg-convert`.

---

## 10. Free-tier ceilings

| Service | Free limit | What breaks first |
|---|---|---|
| Supabase Postgres | 500 MB | `rider_locations` — nightly prune keeps it bounded |
| Supabase Realtime | 200 concurrent connections | ~100 active users comfortably |
| Supabase Auth | 50k monthly active users | Almost impossible to hit in a pilot |
| Cloudflare Workers | 100k req/day | Rate-limit partner keys; enable KV cache |
| Cloudflare Pages | Unlimited builds | Nothing at pilot scale |
| Cloudflare KV | 100k reads/day, 1000 writes/day | Cache misses hit Postgres |
| OSRM public demo | ~1 req/sec, no SLA | Move to self-hosted OSRM or OpenRouteService (2k/day) |
| Nominatim public | ~1 req/sec | LocationIQ (5k/day) or Geoapify (3k/day) |
| GitHub Actions | 2000 min/mo | Well under budget — each deploy ~2min, APK build ~5min |

Upgrade paths are documented in each vendor's dashboard. Nothing in our
code needs to change to move up a tier.

---

## 11. Local dev

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Fill in the same values as your GH secrets

npm run dev:api    # Worker on :8787
npm run dev:web    # Vite on :5173

# Typecheck the whole tree
npm run typecheck

# Apply migrations against a local Supabase (if you're running one)
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql
```

Local dev talks to your live Supabase project. If you want isolated
data, spin up a second Supabase project and swap the env vars — cheaper
than running Supabase locally.

---

## 12. Troubleshooting

All of these are real problems we hit during the build. Each has a fix.

**"Invalid token" on `/auth/me` even though the user is signed in.**
Supabase rolled the project onto asymmetric signing keys (ES256/RS256).
`apps/api/src/lib/auth.ts` supports both HS256 (legacy) and ES256/RS256
via JWKS. Confirm `SUPABASE_URL` is set correctly on the Worker; the
JWKS is fetched from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
If it's still failing, re-deploy the Worker so it picks up any secret
changes.

**Migration fails with `type "user_role" already exists`.**
You applied migrations in the Supabase SQL editor at some point. The
workflow's SQL is idempotent, but if you shipped a non-idempotent
`CREATE TYPE` yourself, guard it:
```sql
DO $$ BEGIN CREATE TYPE user_role AS ENUM (...); EXCEPTION WHEN duplicate_object THEN null; END $$;
```

**Migration fails with `ENOTFOUND ...pooler.supabase.com`.**
You used the transaction pooler (port 6543) instead of the session
pooler (port 5432). The transaction pooler doesn't support psql session
state and IPv4-only GH Actions runners can't reach the direct-connect
URL either. Use the session pooler URI.

**Captain isn't getting offers even though they're online.**
Order of checks:
1. Admin → Riders → is `kyc` = `approved`?
2. Admin → Orders → click the order → **Dispatch report** — shows every
   rider considered and the exact exclusion reason for each.
3. On the captain phone, does GPS have a fix? The `/riders/online`
   endpoint now accepts an initial lat/lng and immediately calls
   `wakePendingForRider`, so going online should page any searching
   orders in the area within a second.

**Captain stuck on "ON TRIP" after the customer cancels.**
Fixed in commit history — the cancel handler now resets
`rider.status → 'online'` and broadcasts `trip_ended` on the
`rider:{uid}` channel. If a captain is somehow still stuck, they can hit
**Go offline** in the Captain UI (escape hatch) or you can force the
state in SQL:
```sql
update riders set status = 'online' where profile_id = '<uid>';
```

**APK build fails with "keystore doesn't exist".**
Two possible causes:
1. `ANDROID_KEYSTORE_B64` was pasted into the GitHub UI and got
   truncated (see §2.2 gotcha) — re-upload as a file.
2. `signingConfig` in `apps/web/android/app/build.gradle` uses a relative
   path — force absolute:
   `storeFile = file("$System.env.GITHUB_WORKSPACE/apps/web/android/app/release.keystore")`.

**Pages deploy succeeds but the site shows an old version.**
Cloudflare Pages caches aggressively. Force a hard reload
(`Cmd/Ctrl+Shift+R`) or bump the `sw` if a service worker is registered.
If a Pages project's env vars changed, you need to trigger a redeploy —
env vars only apply at build time. Actions → **Deploy web + api → Run
workflow**.

**Realtime channel is silent.**
Confirm the `orders` table has Replication enabled in Supabase → Database
→ Replication. Broadcast on the `rider:{uid}` channel is independent of
table replication but relies on the same infra being healthy.

**Partner API returns `setup_incomplete`.**
Pre-Day-3 the partner API required a "shell customer" profile per
partner. That requirement is gone — `orders.customer_id` is nullable via
migration `0003_partner_orders.sql`. If you're still seeing this,
re-apply migrations (target: all) — the workflow is idempotent.

**Cloudflare API token expired mid-session.**
Cloudflare API tokens are opaque; if a workflow starts failing with
`Authentication error`, rotate `CLOUDFLARE_API_TOKEN` in GH secrets and
re-run the deploy.

---

## 13. Runbook checklist for a new environment (e.g. Bengaluru clone)

1. New Supabase project (region ap-south-1).
2. Run **Apply Supabase migrations → all** against it.
3. Duplicate GH secrets under a new environment (`bengaluru-prod`) or
   fork the repo.
4. Update `supabase/seed.sql` with the new city's rate cards and service
   area polygon.
5. Deploy — three new Pages projects will be created automatically by
   the workflow's "Ensure Pages project exists" step.
6. Promote your first admin (§2.4).
7. Seed demo data from the admin Dashboard for screenshots.

---

## 14. Scheduled rides

Customers can book rides 30 minutes to 7 days ahead.

- **Customer flow:** Order screen → **Schedule** toggle → pick a pickup
  time in a bottom-sheet datetime picker → confirm. Scheduled orders land
  in **History → Upcoming**, with **Start now** (immediate dispatch) and
  **Cancel** buttons per row.
- **Backend flow:** creation stores `orders.status = 'scheduled'` and
  `orders.scheduled_at`. The minutely `promoteScheduled` cron
  (`apps/api/src/lib/dispatch.ts`) flips any row where
  `scheduled_at <= now + 5min` into `searching` and kicks
  `dispatch(orderId)`. The 5-minute lead is `LEAD_MINUTES` — increase it
  if riders keep arriving late.
- **Guards:** the API rejects `scheduled_at` less than 30min or more than
  7 days out. Reschedule and start-now are guarded on
  `status='scheduled'`, so if the cron has already promoted the order the
  operation returns 404 (customer sees "already dispatched").
- **Admin visibility:** Orders → **Scheduled** filter lists all upcoming
  bookings; each row uses a yellow "scheduled" chip.

Schema is in `supabase/migrations/0004_scheduled_rides.sql` — apply via
**Actions → Apply Supabase migrations → target: all** (or
`scheduled-rides` for just this file).

---

## 15. In-app chat

Two-party chat between the customer and their assigned captain.

- **Customer flow:** Tracking page → **💬 Chat** button next to Call / Share.
  Unread count shows as a red badge; opening the drawer marks incoming
  messages as read server-side.
- **Captain flow:** Trip page → **💬 Chat** button in the top-right header.
  Same badge behaviour.
- **Chat window:** open only during an active trip (`accepted`, `arrived`,
  `picked_up`, `in_transit`). Before accept and after complete/cancel, the
  drawer is read-only. The API returns `409 chat_closed` on any send
  attempt outside the window.
- **Realtime:** Worker broadcasts `event='message'` on the `order:{id}`
  channel after every insert, plus a preview to `rider:{uid}` /
  `customer:{uid}` so the receiving party's badge lights up even if
  they're not on the trip screen.
- **Quick replies:** four canned lines each ("On my way", "Reached",
  "Stuck in traffic", "Please share exact location" for riders;
  "I'm coming down", "Please wait 2 min", "I'm at the gate", "Cancel
  please" for customers). Tap to send.
- **Schema:** `messages(id, order_id, sender_role, sender_id, body,
  created_at, read_at)`. RLS lets only the two parties on the order
  select/insert; admins can read for support. Two partial indexes:
  `(order_id, created_at)` for the timeline and
  `(order_id, sender_role) WHERE read_at IS NULL` for unread counts.

Schema is in `supabase/migrations/0005_chat.sql` — apply via
**Actions → Apply Supabase migrations → target: chat** (or `all`; every
migration is idempotent).

---

## 16. Phase 2 (not built yet)

- Food delivery UI (schema and rate cards already support it).
- Promo codes / referral bonuses.
- Self-hosted OSRM on Fly.io free tier.
- Push notifications (Capacitor + FCM).

None of these require schema migration beyond adding a column or two.
