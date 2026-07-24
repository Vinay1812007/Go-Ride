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

## 16. Food delivery

Fifth vertical. Customer browses restaurants → picks items → checks out →
same captain-driven dispatch and tracking flow as every other vertical.

- **Customer flow:** Home → **Order food** shortcut → `/food` browse (search
  + cuisine chips) → tap a restaurant → menu with per-item steppers →
  sticky cart bar (green) → checkout screen shows items / delivery address
  / instructions / payment / bill split → **Place order** → normal
  Tracking page with the item list added.
- **Fare split:** `orders.fare_estimate` = food subtotal + delivery fee.
  The delivery fee uses the `food` rate card in `rate_cards`
  (base 30 + per_km 8 + min 40). The fare_breakup JSON adds
  `food_subtotal` and `delivery_fee` fields so admin reports can split them.
- **Server-side verification:** the API refetches each menu item by ID
  and recomputes the subtotal from authoritative prices before writing
  the order. A tampered client can't buy a ₹300 biryani for ₹10. Also
  enforces `min_order` and `item.available`.
- **Cart persistence:** localStorage-backed at `goride:food-cart`. Switching
  restaurants prompts "Clear cart?" — one restaurant per order (matches
  Swiggy/Zomato).
- **Captain UX:** during a food trip, the top of the TripPage shows the
  item list ("2 × Chicken Biryani", "1 × Butter Naan") plus any
  customer instructions so they know what to collect at the counter.
- **Schema:** `restaurants(id, name, cuisine, address, lat, lng, phone,
  image_url, avg_prep_min, min_order, active, rating)` +
  `menu_items(restaurant_id, name, description, price, category, is_veg,
  available, sort_order)` + `orders.restaurant_id` FK. Public read RLS
  on active rows so browse works without auth; admin-only writes.
- **Seed:** five real Hyderabad restaurants (Paradise, Bawarchi, Ohri's,
  Chutneys, Pista House) with 4–5 menu items each — enough for a demo
  or screenshots without needing to add anything by hand.

Schema is in `supabase/migrations/0006_food.sql` — apply via
**Actions → Apply Supabase migrations → target: food** (or `all`).

### Adding a restaurant

Admin → **Restaurants** → **+ New restaurant**. Fill in name, cuisine,
address, lat/lng (Hyderabad default 17.3850, 78.4867 as starting point),
optional image URL and phone, min-order and avg-prep-min. Save.

Then tap **Menu →** on the card to open the menu editor and add items —
per-item veg/non-veg, category (with autocomplete from the standard list),
sort order, availability toggle, and hard-delete. Menu items don't have
downstream FKs (order `food_details` is a JSON snapshot captured at order
time), so a hard delete is safe.

If you still want to seed via SQL, the shape is:

```sql
insert into restaurants (name, cuisine, address, city, lat, lng, phone, avg_prep_min, min_order, rating)
values ('Beijing Bites', 'Chinese', 'Jubilee Hills Road No. 36', 'Hyderabad', 17.4315, 78.4090, '+911140000006', 20, 150, 4.3);
```

---

## 17. Promo codes + wallet + referrals

Three things landed together — they share the same ledger table:

### Promo codes
- **Customer:** at any checkout screen (rides/parcels/food), a code input
  appears. Applied codes show a green "Promo applied" pill with the
  discount and a Remove affordance.
- **Types:** `flat` (₹ off) or `percent` (with optional `max_discount` cap).
- **Guards:** `min_order`, `applies_to` scope (all/ride/parcel/food),
  `usage_limit_per_user`, `total_usage_limit`, `valid_from`/`valid_until`
  window, and active flag. The API revalidates at order-create time — the
  client's dry-run via `POST /promo/validate` is not trusted.
- **Admin:** `/admin/promos` — table with create/edit modal, toggle
  Active/Inactive, soft-delete (flips `active=false` so historical
  redemptions still resolve).
- **Seed:** WELCOME50, GRSPICE100, RIDE20, SEND40, GORIDE10 — enough for
  demos out of the box.

### Wallet
- **Customer:** new `/wallet` page shows balance + 30-entry history +
  refer-a-friend block with share button. Header nav has a 💳 Wallet link
  next to History.
- **Applying:** the "Use wallet balance" toggle shows at any checkout when
  balance > 0. The API caps `walletUsed` at the post-discount total, so
  wallet never leaves you with a negative order.
- **Schema:** `wallet_ledger(profile_id, delta, reason, order_id,
  promo_id, note, created_at)` — append-only. `wallet_balance(uuid)`
  Postgres function sums it. Reasons: `signup_bonus`,
  `referral_bonus_referrer/referee`, `promo_credit`, `refund`,
  `trip_debit`, `top_up`, `adjustment`.
- **Admin:** `GET /admin/wallet/:id` and `POST /admin/wallet/:id` for
  customer-support credits/debits (not yet a page — call via curl for now).

### Referrals
- Every new profile auto-gets a 6-char `referral_code` (`gen_referral_code`
  Postgres function). Backfilled for existing profiles via the migration.
- **Applying:** a new customer can enter a friend's code on the /wallet
  page before their first completed trip. Enforced server-side —
  `POST /wallet/apply-referral` returns `has_orders` (409) if they've
  already completed a trip.
- **Payout:** on the customer's first `completed`/`delivered` order,
  `maybeCreditReferralBonus` fires. Amounts (`REFERRER_BONUS=100`,
  `REFEREE_BONUS=50`) are constants at the top of `apps/api/src/routes/rides.ts`.
- **Guard:** ledger lookup on `reason='referral_bonus_referee'` prevents
  double-crediting if a customer somehow completes two "first trips".

Schema is in `supabase/migrations/0007_promos_wallet.sql` — apply via
**Actions → Apply Supabase migrations → target: promos-wallet** (or `all`).

---

## 18. Push notifications (Firebase Cloud Messaging)

Web-push delivery for backgrounded PWAs and Android APK (via Capacitor).
Realtime is still the primary channel — push is a "wake up" nudge for
apps that aren't in the foreground.

### What sends a push

| Trigger | Who gets it | Body |
|---|---|---|
| Dispatch fan-out (new offer) | Every candidate captain | "New ride request — Pickup X km away" |
| Captain accepts | Customer | "Captain on the way" |
| Captain marks arrived | Customer | "Captain has arrived — Share OTP XXXX" |
| Trip completed / delivered | Customer | "Trip completed — Fare ₹NNN" |
| Order cancelled by either party | The other party | "Trip cancelled — <reason>" |
| Chat message | Recipient | Message preview (200 chars) |

Each push carries `data.click_action` — the SW's `notificationclick`
handler focuses or opens the right route in the PWA (`/track/<id>` for
customers, `/captain/trip/<id>` for captains).

### One-time Firebase setup

1. **Firebase console → Add project.** Name it (e.g. `goride-prod`),
   accept defaults.
2. **Project settings → Cloud Messaging.** Nothing to configure here — it's
   auto-enabled.
3. **Project settings → Cloud Messaging → Web configuration → Generate
   key pair.** Copy the VAPID public key.
4. **Project settings → General → Your apps → Web (`</>` icon).** Register
   a web app named "GoRide web". Copy the `firebaseConfig` object shown
   after "SDK setup and configuration → Config" — paste it into GH secret
   `VITE_FIREBASE_CONFIG` as a single-line JSON string.
5. **Project settings → Service accounts → Generate new private key.**
   Downloads a JSON. Paste the whole file contents into GH secret
   `FIREBASE_SERVICE_ACCOUNT_JSON`.
6. **Copy the project ID** from the Firebase console (e.g. `goride-prod-1a2b3`)
   into GH secret `FIREBASE_PROJECT_ID`.

### GH secrets to add

| Secret | Where from | Which side |
|---|---|---|
| `VITE_FIREBASE_CONFIG` | Firebase → General → Web config (JSON) | Web build |
| `VITE_FIREBASE_VAPID_KEY` | Firebase → Cloud Messaging → Web push cert | Web build |
| `FIREBASE_PROJECT_ID` | Firebase console URL / General tab | Worker |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service accounts → JSON file contents | Worker |

Then trigger **Deploy web + api** — the workflow will push the Worker
secrets on that run and rebuild the web app with the Firebase config
baked in. All four secrets are optional: if any are missing, that side
no-ops (client never registers a token; Worker never sends). The feature
is fully additive to Realtime.

### How it works

- **Migration 0008** adds `push_tokens(profile_id, token, platform,
  user_agent, revoked_at)`.
- Client: `apps/web/src/lib/push.ts` inits after sign-in confirms via
  `/auth/me`. Requests notification permission (once, on first sign-in),
  registers `/firebase-messaging-sw.js`, calls `getToken({ vapidKey })`,
  POSTs to `/push/register`. Cached in `localStorage` so re-signing-in
  isn't a fresh registration.
- Server: `apps/api/src/lib/push.ts` mints an OAuth2 access token by
  signing a JWT with the service account private key (RS256 via `jose`),
  caches it in KV for 55 min, then hits the FCM HTTP v1
  `messages:send` endpoint per token. On 404 or `UNREGISTERED` it flips
  `revoked_at` so future sends skip that token.
- Vite plugin (`vite.config.ts`) emits `firebase-messaging-sw-config.js`
  at build time from `VITE_FIREBASE_CONFIG`, which the SW `importScripts`.
  Without the env var, the SW loads harmlessly and never fires.
- `revokePush()` runs on sign-out — user-scoped tokens shouldn't send to
  a browser whose owner has changed.

### Testing

1. Deploy with all four secrets set.
2. Sign in as customer on Chrome desktop or Android.
3. Grant notification permission when prompted.
4. Book a ride and use a demo captain (Admin → Load demo data) to accept
   it — the "Captain on the way" push should fire.
5. Watch Cloudflare → Workers → your Worker → Logs for `FCM send failed`
   entries if it's silent.

Schema is in `supabase/migrations/0008_push_tokens.sql` — apply via
**Actions → Apply Supabase migrations → target: push-tokens** (or `all`).

### iOS caveats

iOS Safari supports Web Push only from installed PWAs on iOS 16.4+. The
`InstallPrompt` component nudges users to install; once installed, push
works. Native APK on iOS requires an Apple Developer account and APNs
certificate — not built yet.

---

## 19. Admin wallet & credits

Support UI at **Admin → Wallet & credits** (`/admin/wallet`) for finding
a customer and adjusting their wallet.

- **Search:** type any of email / phone / name (min 2 chars). Debounced
  300 ms. Returns the top 20 matches with current balance inline. Backend
  endpoint: `GET /admin/profiles/search?q=…`.
- **Detail pane:** shows profile summary (name / email / phone / role /
  referral code / referred_by), current balance in the yellow hero, and
  the last 50 ledger entries with reason + note + timestamp.
- **Adjust form:** **+ Credit / − Debit** toggle, amount input, reason
  dropdown (adjustment / refund / top-up / promo credit), required audit
  note (min 3 chars). The note surfaces to the customer's own /wallet
  history — write it in the second person ("Sorry about your delayed
  ride on the 12th").
- **Guard:** the form warns "Will go negative" if a debit exceeds the
  balance, but doesn't block — a support agent occasionally needs to.
  Ledger arithmetic handles negative balances correctly (sum(delta)).

The endpoints `GET /admin/wallet/:id` and `POST /admin/wallet/:id`
already existed from §17 — this section adds the frontend.

---

## 20. Self-hosted OSRM (Fly.io)

The public OSRM demo at `router.project-osrm.org` has no SLA and 502s
under load. For production, run your own OSRM on Fly.io.

Everything you need is in `infra/osrm/`:

- **Dockerfile** — multi-stage. Builder downloads the Telangana OSM
  extract from Geofabrik and runs osrm-extract / osrm-partition /
  osrm-customize; runtime is just osrm-routed with the preprocessed
  files baked in.
- **fly.toml** — 1× shared-cpu-1x with 1 GB RAM in `bom` (Mumbai).
  Auto-stops when idle. Change `min_machines_running = 1` for a
  warm-always-on setup.
- **README** — deploy in 5 commands, verification curl, notes on
  region swap (Karnataka / Maharashtra / all-India) and cost.

### Deploy in 5 commands

```bash
cd infra/osrm
fly auth login
fly launch --no-deploy --name goride-osrm --region bom --copy-config
fly deploy   # ~15 min first time (downloads PBF + preprocesses)
fly status   # shows https://goride-osrm.fly.dev
```

### Wire it into the Worker

Edit `apps/api/wrangler.toml`:

```toml
[vars]
OSRM_URL = "https://goride-osrm.fly.dev"
ROUTER   = "osrm"
```

Push, GH Actions redeploys the Worker. Verify with:

```bash
curl "https://goride-osrm.fly.dev/route/v1/driving/78.4867,17.3850;78.4291,17.2403?overview=false" | jq .code
# → "Ok"
```

### Cost

Fly dropped the free-forever tier in Nov 2024. Expect **~$3-4/mo** for a
shared-cpu-1x + 1 GB RAM in a single region. If cost is an issue, use
OpenRouteService (below).

### Zero-infra alternative — OpenRouteService

OpenRouteService offers 2000 requests/day free with no infra to manage.
Sign up at https://openrouteservice.org/dev/#/signup → get the key →
add to GH secrets as `ORS_KEY` → set `ROUTER = "ors"` in
`apps/api/wrangler.toml` → push. The Worker already knows how to route
via ORS when it sees the key.

### Refreshing map data

OSM changes daily. Redeploy monthly:

```bash
fly deploy --no-cache
```

For automation, add a monthly GH Actions cron that runs
`flyctl deploy --no-cache` — needs a `FLY_API_TOKEN` GH secret from
`fly tokens create deploy`.

---

## 21. Code-splitting

Route-level lazy loading dramatically cuts first-paint bundle size:

- **Before:** main chunk ~544 kB (134 kB gz) — everything in one file.
- **After:** main chunk ~76 kB (25 kB gz). Every route is its own chunk
  (4–80 kB each) and only downloads when navigated to.

Chunks now emitted by the build:

| Chunk | Raw | gzip | Loads when |
|---|---|---|---|
| index (app shell + HomePage + AuthPage) | 76 kB | 25 kB | First paint |
| react vendor | 165 kB | 54 kB | First paint (cache-friendly) |
| supabase vendor | 216 kB | 56 kB | First paint (auth needs it) |
| firebase vendor | 98 kB | 18 kB | After sign-in only |
| maplibre vendor | 802 kB | 218 kB | First map render only |
| AdminShell (all admin pages) | 81 kB | 18 kB | Admin login only |
| CaptainShell | 23 kB | 7 kB | Captain login only |
| DevelopersPage | 19 kB | 6 kB | `/developers` visit only |
| OrderPage / TrackingPage / HistoryPage / FoodBrowsePage / RestaurantPage / FoodCheckoutPage / WalletPage / PublicTrackPage | 4–9 kB each | 2–3 kB each | Per-route navigation |

Implementation: `App.tsx` uses `React.lazy(() => import(...))` for
every non-first-paint route, wrapped in a `<Suspense>` boundary with
the existing `LoadingScreen` fallback. `vite.config.ts` `manualChunks`
groups `firebase`, `supabase`, `react-*`, and `maplibre-gl` into their
own vendor chunks so they cache independently of app code changes.

Firebase Cloud Messaging is dynamic-imported inside `initPush()` —
the firebase chunk only downloads once a signed-in user hits the push
registration path, keeping the anonymous first-paint bundle clean.

---

## 22. OSRM_URL override via secret

The deploy workflow reads two optional GH secrets that patch
`wrangler.toml` in-flight:

- `OSRM_URL_OVERRIDE` — e.g. `https://goride-osrm.fly.dev`
- `ROUTER_OVERRIDE` — `osrm` or `ors`

Set either in Repo → Settings → Secrets → Actions. When set, the deploy
step rewrites the corresponding line in `wrangler.toml` before
`wrangler deploy`. Nothing is committed to git. Leave empty to keep the
public demo defaults.

Same pattern is available for pointing at the self-hosted OSRM (§20)
without editing committed files.

---

## 23. OSRM monthly refresh

`.github/workflows/osrm-refresh.yml` runs on the 1st of each month at
03:15 UTC (and manually via workflow_dispatch). It calls
`flyctl deploy --no-cache --remote-only` inside `infra/osrm/`, which
pulls a fresh Geofabrik PBF and re-runs the OSRM pipeline.

Gated on `FLY_API_TOKEN` GH secret (get one via
`fly tokens create deploy`). If unset, the workflow no-ops with a
friendly log message — safe to have merged before OSRM is deployed.

---

## 24. Driver earnings dashboard

Full ledger view for captains at `/captain/earnings`. Tap either of the
Today / This-week cards on the captain home to open.

- **Three-bucket hero:** Today / This week (Mon-based) / This month, each
  showing earning + trip count.
- **14-day bar chart:** brand-yellow bars scaled to the highest earning
  day. Weekend / low-trip days show a muted grey stub so the chart never
  looks empty. Title-tooltip on each bar has date + earning + trip count.
- **Range toggle:** 7d / 30d / 90d — switches the trip list underneath
  and the CSV export scope.
- **Per-trip rows:** service label + order number, pickup → drop
  addresses (truncated), completed timestamp, distance, payment method,
  fare. Right side shows earning in green and commission below in
  greyed-out text so the split is legible without becoming a math
  puzzle.
- **CSV export:** `⤓ CSV` button downloads
  `goride-earnings-<days>d.csv` — date, order_no, service, pickup,
  drop, distance_km, fare, payment, earning, commission.

Backend endpoints on `apps/api/src/routes/riders.ts`:

| Endpoint | Returns |
|---|---|
| `GET /riders/earnings/summary` | Three buckets + 14-day timeline + 30d total |
| `GET /riders/earnings/trips?days=` | Folded per-order trip list (earning + commission per order) |
| `GET /riders/earnings.csv?days=` | CSV download, up to 365 days |
| `GET /riders/earnings` (legacy) | Kept for older clients — flat 30-day transaction list |

All read from the existing `transactions` table populated by the
`/rides/:orderId/complete` handler (transactions with `type =
'trip_earning'` and `type = 'commission'`). RLS from §0002 already
scopes rows to the calling rider.

---

## 25. Driver payout batching

Weekly settlement of rider earnings — every Monday 04:00 UTC a Worker
cron folds the previous Mon-Sun window of trip_earning + commission
transactions per rider into one `payouts` row. Admin then marks each
row paid with the bank reference once the transfer clears.

### Model

- **`payouts`** — one row per rider per pay period. Columns: rider_id,
  period_start, period_end, gross, commission, net, trips, status
  (`pending` | `paid` | `failed` | `cancelled`), bank_ref, note,
  paid_at, paid_by.
- **`payout_transactions`** — junction table linking a payout to the
  exact transaction rows it settled. The unique constraint on
  `transaction_id` guarantees the same trip earning can never be
  paid twice.
- **`run_payouts(from, to)`** — Postgres function that computes the
  window, aggregates per-rider from unpaid transactions, and inserts
  atomically per rider. Idempotent — an `on conflict do nothing`
  guard on `(rider_id, period_start, period_end)` means duplicate
  cron firings are safe.

### Endpoints

| Endpoint | Who | Notes |
|---|---|---|
| `GET /riders/payouts` | Captain (own) | Last 52 weeks |
| `GET /admin/payouts?status=pending\|paid\|all` | Admin | Riders joined for name lookup |
| `POST /admin/payouts/run` | Admin | On-demand batch. Optional `from` / `to` ISO window |
| `POST /admin/payouts/:id/mark-paid` | Admin | Requires `bank_ref` (min 3 chars) + optional `note` |
| `POST /admin/payouts/:id/cancel` | Admin | Soft-cancel; frees the covered transactions for the next run |
| `GET /admin/payouts/:id/transactions` | Admin | Trip-level breakdown for audit |

### Cron

`wrangler.toml` now has three schedules: `* * * * *` (minutely),
`0 3 * * *` (daily prune), and `0 4 * * 1` (Monday 04:00 UTC weekly
payout run). Handler in `apps/api/src/index.ts` calls `run_payouts`
with null args so it defaults to the previous full ISO week.

### Frontend

- **Captain earnings page:** a **Payouts** strip appears whenever
  there's at least one payout row. Shows period + net + status chip
  + gross/commission breakdown. Paid rows include the bank reference.
- **Admin `/admin/payouts`:** filter chip (pending / paid / all),
  summary strip (rows, trips, gross, net), full table with per-row
  Mark-paid modal (bank_ref + note) and Cancel button on pending
  rows. **Run now** button in the header triggers a manual batch —
  safe to click even if the Monday cron already ran.

### First-time setup

1. Apply migration 0009 (`Actions → Apply Supabase migrations → target:
   payouts` or `all`).
2. Redeploy the Worker so the Monday cron gets registered.
3. Click **Run now** on the admin Payouts page to backfill any
   already-completed transactions into a payout row.

---

## 26. Cities & service areas (multi-city support)

Every table with a `city` column (rate_cards, orders, riders, service_areas)
was already city-keyed since day one — this section adds the admin UI to
manage cities, a `/geo/detect-city` endpoint for the customer app, and a
one-click "clone rate cards" bootstrap for new cities.

### Model

- **`service_areas`** now has `display_name`, `country` (ISO2, default IN),
  `timezone` (default Asia/Kolkata), and an optional `polygon` column
  (`jsonb` — array of `{lat, lng}` vertices). If polygon is set, it
  overrides the existing center + radius circle for
  point-in-service-area checks.
- **Point-in-polygon** runs in JS on the Worker (`apps/api/src/lib/cities.ts`)
  via classic ray casting — no PostGIS required, fine at pilot scale.
- **Nested-city rule:** if a lat/lng hits multiple active polygons, the
  smallest bounding box wins. So "Hyderabad Old City" beats "Hyderabad"
  when both contain the point.
- **Fallback:** rows with no polygon fall back to
  `haversine(point, center) ≤ radius_km`, sorted by distance.

### Admin flow

New sidebar entry **Cities** (`/admin/cities`) above Rate cards.

- **Card grid** — one card per city with slug, display name, timezone,
  centre coords, coverage chip (Circle · Nkm / Polygon · Npt), and
  live rate-card count (active/total).
- **New city / Edit** — form with slug + display name + country + tz +
  centre lat/lng + radius, plus a JSON textarea for optional polygon
  vertices. **Live MapLibre preview on the right** renders the yellow
  circle or polygon overlay so admins eyeball the shape before saving.
- **Clone rate cards** — the third chip on every card. Opens a modal
  with a dropdown of source cities (only those with existing rate
  cards appear) + an "overwrite" toggle. Backend copies every rate
  card row from source → target; without overwrite it's an insert
  (skips duplicates on `(city, service)`), with it's an upsert.
  Ideal Hyderabad → Bengaluru bootstrap: 9 rate cards ported in one
  click, then tweak per-service pricing after.
- **Toggle Active / Delete** — soft-delete (flips `active=false`) so
  existing orders + rate cards keep resolving.

### Endpoints

| Endpoint | Notes |
|---|---|
| `GET /admin/cities` | All cities incl. inactive, with rate-card counts |
| `POST /admin/cities` | Upsert |
| `DELETE /admin/cities/:id` | Soft-delete |
| `POST /admin/cities/clone-rate-cards` | Body: `{from_city, to_city, overwrite}` |
| `GET /geo/detect-city?lat=&lng=` | Public, returns best-matching active area or `{city: null}` |

### Customer app integration (future)

The customer app still uses `VITE_DEFAULT_CITY` — swap that per Pages
project to pin each build to a city. For a single build that auto-picks
based on the user's GPS, call `GET /geo/detect-city` after
`getCurrentPosition()` and use the returned `city` string as
`VITE_DEFAULT_CITY`'s runtime replacement. Left as a follow-up.

Schema is in `supabase/migrations/0010_service_area_polygons.sql` —
apply via **Actions → Apply Supabase migrations → target: service-areas**
(or `all`).

---

## 27. Customer city auto-detect + picker

Runtime city selection in the customer app, closing the loop on §26.

- **Auto-detect:** HomePage calls `GET /geo/detect-city?lat=&lng=`
  after the GPS resolves and stores the best-matching active city.
- **Explicit override:** the top bar now has a 📍 city chip next to
  the greeting. Tapping opens a bottom sheet with all active cities
  (from `GET /geo/cities`) — picking one persists to localStorage and
  broadcasts to every subscriber immediately.
- **Precedence:** localStorage > GPS auto-detect > `VITE_DEFAULT_CITY`
  build-time fallback > `'Hyderabad'`. Explicit user picks always win —
  once someone taps "Bengaluru", GPS in Hyderabad won't override them.
- **Downstream:** every customer-side API call that took
  `VITE_DEFAULT_CITY` now reads from the `useCity()` hook (order create,
  fare quote, food browse, food checkout, promo validate). So switching
  cities immediately routes fare, food, and dispatch to the new city's
  rate cards + restaurants.

### Implementation

- `hooks/useCity.ts` — module-level singleton store with subscribers,
  no React Context (avoids re-render cascade from a Provider high in
  the tree). Also exposes `detectCityFor(lat, lng)` for the HomePage's
  GPS effect to fire-and-forget.
- `components/CityPicker.tsx` — compact chip button + bottom sheet.
  Lazily loads `/geo/cities` on first open, then caches.
- `GET /geo/cities` — public, `Cache-Control: max-age=600` since
  cities change rarely.

### Multi-city Pages projects

The three per-role Pages projects (customer/captain/admin) still bake
`VITE_DEFAULT_CITY` at build time — that's now purely the *initial*
fallback. A single customer bundle can serve any city at runtime.

To pin a Pages project to a specific city hard (e.g., a Bengaluru-only
brand deployment), leave `VITE_DEFAULT_CITY` as the city slug and don't
render `<CityPicker />` on the HomePage.

---

## 28. Restaurant partner portal

Restaurant owners get their own scoped admin so they don't need a
full-power admin account to manage their menu / see live orders / mark
themselves open-or-closed.

### Model

- **New `user_role` value: `restaurant_partner`.** Added via `ALTER
  TYPE user_role ADD VALUE` in migration 0011.
- **`profiles.restaurant_id`** (nullable FK) — set only when
  `role = 'restaurant_partner'`. Enforced by a CHECK constraint:
  `(role = 'restaurant_partner' AND restaurant_id IS NOT NULL) OR
   (role <> 'restaurant_partner' AND restaurant_id IS NULL)`. So
  moving a profile in or out of the partner role has to happen with
  both fields changing at once (statement-end constraint eval).
- **RLS additions** — partners can read/write their own restaurant +
  menu items, and read (only) orders where
  `restaurant_id = their_restaurant_id AND service = 'food'`.

### Admin flow

Admin → **Restaurants** card now has a **Partner →** chip alongside
Menu / Edit / Active. Opens a modal with:

- The currently-linked partner (if any), with **Remove partner** to
  demote back to customer.
- A search box (email / phone / name) using the same
  `/admin/profiles/search` endpoint the Wallet page uses. Only
  customers can be promoted — admins and existing partners are
  disabled with a tooltip.
- Confirm dialog before assigning, since the promoted user is routed
  to the partner portal on their next sign-in.

### Partner flow

Partner signs in on the customer app (`goride-web.pages.dev` or the
`goride-app` APK). The target-router in `App.tsx` recognises
`role === 'restaurant_partner'` and routes them to `/partner` instead
of the customer home.

**Three tabs:**

1. **Orders** — live queue with filter chips (Live / Today / All).
   Each order card shows: order number, order time, items with per-
   line qty × price, any instructions (in a yellow highlight box),
   drop address, total, and timestamps for accepted / picked / completed.
   Auto-refreshes every 15 seconds.
2. **Menu** — full CRUD (add / edit / hide / hard-delete) with the
   same veg-indicator + category autocomplete UI the admin uses.
3. **Info** — narrow editable subset: description, phone, image URL,
   avg prep min, **Open for orders** toggle. Read-only header block
   shows the admin-managed fields (name, cuisine, address, city,
   min order, rating) with a note to contact admin to change them.

### Endpoints

| Endpoint | Notes |
|---|---|
| `GET /partner-restaurant/me` | Profile + restaurant + today's orders/revenue + menu-item count |
| `GET /partner-restaurant/orders?status=` | Their food orders |
| `GET /partner-restaurant/menu` | Full menu incl. unavailable |
| `POST /partner-restaurant/menu` | Upsert (path-checked to their restaurant) |
| `DELETE /partner-restaurant/menu/:itemId` | Hard delete |
| `PATCH /partner-restaurant/restaurant` | Partner-editable subset only |
| `GET /admin/restaurants/:id/partner` | Currently-linked partner |
| `POST /admin/restaurants/:id/partner` | `{profile_id}` promote, `{unassign: true}` demote |

Schema is in `supabase/migrations/0011_restaurant_partners.sql` — apply
via **Actions → Apply Supabase migrations → target: restaurant-partners**
(or `all`).

### Testing checklist

1. Apply migration 0011.
2. Sign up a fresh customer (e.g. `chef@paradise.local`).
3. Admin → Restaurants → pick Paradise Biryani → **Partner →** → search
   for that email → **Promote**.
4. Sign in as that chef on the customer web → auto-routed to `/partner`.
5. Toggle **Open for orders** off on the Info tab → verify Paradise
   drops out of the customer /food browse.
6. Add / edit / hide a menu item → verify it appears / hides on the
   customer restaurant page immediately.
7. Book a food order from Paradise on the customer app → verify it
   appears in the partner's Orders tab within 15 seconds.

---

## 29. Restaurant partner analytics

New **Analytics** tab on the partner portal, between Menu and Info.

- **Three-bucket hero** — Today / This week (Mon-based) / This month,
  each with revenue + order count.
- **Daily revenue chart** — 7 / 30 / 90-day range toggle; yellow bars
  scaled to the highest-revenue day, low days grey stubs, title-tooltip
  per bar with `YYYY-MM-DD · ₹N · X orders`.
- **Top items** — up to 10 items ordered by units sold in the window,
  with a horizontal fill bar (qty vs max) + revenue on the right. Data
  comes from the `orders.food_details` JSON snapshot, so this is
  historical-accurate even if the item was later renamed / repriced.
- **Hour-of-day chart** — 24 mini bars showing peak order times over
  the window. Useful for staffing decisions.
- **Order status split** — chip row with counts per status
  (completed, cancelled_customer, in_transit, …).

All computed in memory on the Worker in a single query — restaurants are
small enough that even a 90-day scan is trivial.

Endpoint: `GET /partner-restaurant/analytics?days=30`.

---

## 30. Playwright end-to-end smoke tests

`tests/` — separate workspace (not in `apps/*` so Playwright's ~150 MB
chromium doesn't install on every root `npm i`). Deliberately narrow:
poke each Pages project's public surface (auth page, developer docs,
public tracking) and assert the app renders + expected copy is present.

### Run locally

```bash
cd tests
npm install
npx playwright install chromium --with-deps    # one-time
npm test
```

Three Playwright projects — customer / captain / admin — fan out across
the corresponding Pages URLs. Override with env vars for preview
branches:

```bash
GORIDE_URL_CUSTOMER=https://preview-abc.goride-web.pages.dev npm test
```

### Signed-in tests

The admin role-mismatch check needs a live customer account:

```bash
export GORIDE_E2E_CUSTOMER_EMAIL=…
export GORIDE_E2E_CUSTOMER_PASSWORD=…
```

Skipped automatically when unset.

### CI

`.github/workflows/e2e.yml` runs on **manual dispatch only**, never on
push. Rationale: silent smoke failures between merge and someone
noticing are worse than no CI. Trigger via Actions → **E2E smoke** →
Run workflow.

Overridable inputs on the dispatch dialog for preview URLs. Failed
runs upload the Playwright HTML report as an artifact for 7 days.

Add tests by dropping a `*.spec.ts` under `tests/e2e/`; gate on
`testInfo.project.name` to scope to one project.

---

## 31. Captain leaderboards

Gamification layer on top of the existing `transactions` ledger — no
schema change needed.

- **New page at `/captain/leaderboard`.** Podium (top 3) + rows 4–20 +
  a "You are #NN" callout if the caller is outside the top 20.
- **Toggle:** metric (earnings / trips) × period (week / month).
- **Privacy:** names shown as first name + last initial ("Vinay K.").
  Full names would be uncomfortable on a public-ish board.
- **Entry point:** yellow gradient card on the Captain home
  ("🏆 This week's leaderboard") next to the earnings widget.

Endpoint: `GET /riders/leaderboard?metric=earnings|trips&period=week|month&city=`.
Aggregates in memory from `transactions.type='trip_earning'` in the
window; joins to `orders.city` for the optional city filter. Returns
top 20 with rank/name/vehicle/trips/earnings + the caller's own row
if they're outside the top 20 (with total_participants for context).

At MVP scale this is a full scan of the period's trip_earning rows —
fine for a few hundred trips a day. At real volume we'd move to a
nightly materialised view refreshed by a cron.

---

## 32. Dynamic surge pricing

Auto-adjusts each rate card's `surge_multiplier` every 2 minutes based
on live demand/supply per (city, service). Opt-in per rate card so admin
keeps full control.

### Model

- **`rate_cards.auto_surge`** (bool, default false) — off means the
  card uses whatever multiplier admin set manually.
- **`rate_cards.surge_multiplier_floor` / `_cap`** (default 1.0 / 2.5) —
  clamp for auto mode. Protects customers from unbounded surge.
- **`surge_history`** table — one row per (city, service) per 2 min
  when auto-surge is on. 7-day retention, trimmed by the run function.
- **`run_surge()`** Postgres function does the compute:
  - demand = orders in `searching` / `no_rider_found` for that
    (city, service) in the last 5 min
  - supply = online + KYC-approved riders with matching vehicle type
    in the same city (bike ↔ scooter, parcel_bike ↔ parcel_scooter)
  - `raw = 1 + (demand / (supply+1)) × 0.30` — one waiting order
    bumps ~30% when supply is zero
  - `multiplier = clamp(raw, floor, cap)`, rounded to 2 dp
- Cron `*/2 * * * *` triggers `run_surge()`.

The fare engine already respected `surge_multiplier` — no changes
downstream.

### Admin flow

- **Rate cards page** — each card row shows the current multiplier
  chip; when auto-surge is on, the manual +/− stepper is disabled and
  the chip carries an "AUTO · 1.0–2.5×" caption underneath.
- **Rate card editor modal** — new section: **Dynamic surge** checkbox
  + floor + cap fields (only shown when the checkbox is on).
- **New Surge page** (`/admin/surge`, in the sidebar between Rate
  cards and Promos) — live dashboard grouped into "Auto-surge" (with
  per-card expandable 24-hour mini bar chart) and "Static" (compact
  grid). Auto-refreshes every 15s to show cron effect. **Run now**
  button triggers `run_surge()` on demand.
- **Colour code:** ≥1.5× red, >1.0× amber, ≤1.0× green.

### Endpoints

| Endpoint | Notes |
|---|---|
| `GET /admin/surge/current` | Rate cards + latest history sample per (city, service) |
| `GET /admin/surge/history?city=&service=&hours=24` | Timeline for the mini chart |
| `POST /admin/surge/run` | Manual recompute |

### First-time setup

1. Apply migration 0012 (`Actions → Apply Supabase migrations → target:
   dynamic-surge` or `all`).
2. Redeploy the Worker so the new every-2-min cron registers.
3. On the Rate cards page, edit a card and tick **Dynamic surge**.
   First sample lands with the next cron.

### Tuning

Two knobs in the SQL function:
- **Sensitivity** — `× 0.30` in `v_raw`. Higher = surge climbs faster.
- **Demand window** — `interval '5 minutes'`. Longer = smoother
  average, slower to react.

Edit the migration file, re-apply.

---

## 33. Support tickets

Customer ↔ admin support channel, distinct from the in-trip captain
chat (§15). A ticket outlives any single trip, has a lifecycle
(open → assigned → awaiting_customer → resolved), and threads
messages that both sides can add until it's resolved.

### Model

- **`support_tickets`** — id, customer_id, order_id (nullable
  context), subject, status, priority, assigned_to (admin FK),
  created_at, updated_at, closed_at.
- **`support_messages`** — id, ticket_id, sender_role, sender_id,
  body, read_by_customer_at, read_by_agent_at, created_at.
- **Trigger** `on_support_message` bumps `updated_at` after every
  insert and auto-reopens (`awaiting_customer` → `assigned`) when
  the customer replies to a ticket the admin had punted back.
- **RLS:** customer sees + manages own tickets/messages; admins full
  access. `support_messages` in the Supabase Realtime publication.

### Customer flow

- **Entry point:** Wallet page has a new **💬 Support** card
  ("Missing credit, wrong charge, trip issue — we'll get back to you").
- **`/support`** — inbox list of own tickets with status chip +
  updated_at. **+ New** opens a bottom-sheet form: subject +
  description + priority.
- **Ticket detail** — full thread with day dividers ("Today",
  "Yesterday", …), admin messages in grey bubbles with "Support"
  attribution, customer messages in yellow. "Read" receipt shows on
  customer bubbles once agent opens the ticket.
- **Resolved tickets** show a green banner and no reply box — customer
  can open a fresh ticket instead.

### Admin flow

- **New sidebar entry Support** between Restaurants and Wallet.
- **Two-pane layout:** filterable list (Open / Assigned / Awaiting
  cust. / Resolved / All + "Mine only" checkbox) on the left, full
  thread + reply box on the right.
- **Auto-refresh every 15s** so a live queue stays warm.
- **Header controls:** priority pills (Low / Normal / **High** red),
  Assign-to-me chip when Open, ✓ Resolve chip when not yet resolved.
- **First reply from an unassigned admin auto-assigns them** and
  flips status to `awaiting_customer` (customer's turn now).

### Realtime

Every message insert broadcasts on `ticket:{id}` for the thread and
on `customer:{customer_id}` / `admin:{assigned_to}` for lightweight
inbox pings. Both sides use the ticket channel; the per-user channel
is future room for a badge count when we get there.

### Endpoints

| Endpoint | Notes |
|---|---|
| Customer | |
| `GET /support/tickets` | My tickets, most recent first |
| `POST /support/tickets` | Open ticket + seed first message |
| `GET /support/tickets/:id` | Ticket + messages; marks admin msgs read |
| `POST /support/tickets/:id/messages` | Send reply. Guards on membership + not resolved |
| Admin | |
| `GET /admin/support/tickets?status=&mine=1` | Queue with joined customer profile |
| `GET /admin/support/tickets/:id` | Full thread; marks customer msgs read |
| `PATCH /admin/support/tickets/:id` | Status / priority / assignment. `status=resolved` stamps closed_at |
| `POST /admin/support/tickets/:id/messages` | Reply. Auto-assigns + flips to awaiting_customer |
| `GET /admin/support/counts` | Sidebar badge counts |

Schema is in `supabase/migrations/0013_support_tickets.sql` — apply
via **Actions → Apply Supabase migrations → target: support-tickets**
(or `all`).

---

## 34. Admin operations dashboard

Replaces the sparse 3-KPI admin home with a proper control-tower view.
One consolidated `GET /admin/ops-dashboard` fetch keeps the 15-second
auto-refresh cheap.

### Layout

- **6 KPI tiles** (top row) — Online captains (with on-trip sub-count),
  Active orders (with searching sub-count), Revenue today, Cancelled
  today (amber if >0), Failed today (red if >0), Hot surge cards
  (amber if >0).
- **2 queue cards** — Support (Open + Awaiting-customer counts, links
  to `/admin/support`) and Payouts (Pending count + total payable,
  links to `/admin/payouts`).
- **24-hour orders histogram** — 24 stacked bars per hour, brand-
  yellow (completed / in-progress), red (no-captain-found), grey
  (cancelled). Title-tooltip per bar with the breakdown.
- **Live orders list** (last 10 active) with status pill + fare + link
  to full orders page.
- **Live captains list** (last 10 online / on-trip) with green/blue
  status dot + link to the live map.
- **Hot surge chips** — every rate card currently above 1.0×, colour-
  coded (amber >1× / red ≥1.5×), tagged AUTO if that card uses
  dynamic surge.
- **Recent cancellations feed** — last 5 with reason + timeAgo.
- **Demo data controls** (kept) at the bottom.

### Endpoint

`GET /admin/ops-dashboard` — everything above in one payload:

- `kpi` — 12 counters
- `surge` — active `> 1.0×` rate cards
- `active_orders` — 10 most-recent live orders
- `live_captains` — 10 most-recently-seen online/on-trip riders
- `recent_cancels` — 5 most-recent cancellations
- `orders_24h` — 24 hourly buckets `{hour, total, failed, cancelled}`

Ran in parallel via `Promise.all` — one round trip to the DB. At
pilot scale (few hundred orders/day) this stays under 50ms.

---

## 35. Saved places

One-tap destination selection for common places — the Home / Work /
"Gym" shortcut every ride app has.

### Model

- **`saved_places`** — id, profile_id, label, address, lat, lng,
  place_type enum (`home` | `work` | `other`), timestamps.
- **Partial unique indexes** enforce at most one Home + one Work per
  profile. `other` can have many.
- **RLS:** owner-only (`profile_id = auth.uid()`).

### Customer flow

- **On the HomePage destination sheet** — when the search box is
  empty, saved places appear as yellow chips ("🏠 Home", "💼 Work",
  "📍 Gym") + a "Manage →" chip. Tap one to jump straight into
  `/order/new` with that as the drop, skipping the search.
- **Empty state** — if the customer has zero saved places, the
  sheet shows "💡 Save Home + Work for one-tap trip booking" with
  a link to the manage page.
- **`/places` management page** — Home + Work cards at the top with
  Set / Change / × Remove chips, followed by an Others list with
  add / edit / delete. Editor uses the same `searchPlaces()`
  autocomplete the destination sheet uses.

### Endpoints

| Endpoint | Notes |
|---|---|
| `GET /places` | Own places, home + work first |
| `POST /places` | Upsert. For home/work, replaces the existing row of that type in the same request — no unique-violation error surfaced |
| `DELETE /places/:id` | Owner-only |

Schema is in `supabase/migrations/0014_saved_places.sql` — apply via
**Actions → Apply Supabase migrations → target: saved-places**
(or `all`).

---

## 36. SOS emergency button

Safety feature every India ride-hailing app has (regulatory + user
expectation). Customer or captain hits a red panic button during an
active trip; alert lands in an admin-visible queue with live push to
all admins.

### Model

- **`sos_alerts`** — id, profile_id, role, order_id (optional), lat,
  lng, note, status enum (open / acknowledged / resolved / false_alarm),
  acknowledged_by + _at, resolved_by + _at + _note, created_at.
- **RLS:** self insert + read; admin full access.
- **No linked ticket auto-created** — support tickets are the follow-up
  channel; SOS is the *now* channel.

### Customer / captain flow

- **Red floating SOS button** appears on TrackingPage (customer) and
  TripPage (captain) when order status is
  `accepted` / `arrived` / `picked_up` / `in_transit`. Fixed to the
  bottom-right so it never disappears behind the sheet.
- **Two-step confirmation** — tap the button → bottom sheet with an
  optional note ("driver following me", "car making me uncomfortable")
  + a red banner reminding users to call **112** first if in immediate
  danger.
- **Client-side 30s cooldown** stored in localStorage — press-and-hold
  panic doesn't spam the queue.
- **Grabs live GPS on send**, falls back to the trip pickup if the
  browser refuses.

### Admin flow

- **New `🚨 SOS` sidebar entry** at the top (above Support).
- **Live-refreshed queue** — 10-second polling + realtime subscribe on
  `sos:global` channel. New alerts pop in without waiting for the
  poll.
- **Alert card:**
  - Open alerts get a **red left border + pulsing OPEN badge**
  - Acknowledged alerts get amber
  - Customer name + **tap-to-call phone link** front and centre
  - GPS coords + **Open in Maps →** link (opens Google Maps)
  - Two actions: **👋 Acknowledge — I'm on it** (open→acknowledged)
    and **✓ Resolve** (opens a note modal; false-alarm checkbox for
    accidental presses)
- **Filter chips** — Active (open+acknowledged) / Open / Acknowledged
  / Resolved / All. Active count in the chip label.

### Endpoints

| Endpoint | Notes |
|---|---|
| `POST /sos` | Customer/rider triggers. Broadcasts on `sos:global` + FCM push to all admin profiles |
| `GET /admin/sos?status=active\|open\|acknowledged\|resolved\|all` | Queue with joined profile |
| `POST /admin/sos/:id/acknowledge` | Guarded on `status='open'` (no double-take) |
| `POST /admin/sos/:id/resolve` | Body: `{note?, false_alarm?}` |
| `GET /admin/sos/counts` | Sidebar badge counts |

### Realtime + push chain

1. Customer/rider hits SOS → POST /sos writes the row + fires two
   fire-and-forget calls:
2. `broadcast(env, 'sos:global', 'alert', {...})` — any admin viewing
   the SOS page sees a new row insta-appear.
3. `pushToAllAdmins()` — fans out FCM push notifications
   (title `🚨 SOS from customer`) to every admin profile with a
   registered device.

### Testing checklist

1. Apply migration 0015.
2. Sign in as customer + start a demo ride (Admin → Load demo data,
   then book a real order to reach `accepted`+ status).
3. Red SOS button appears at bottom-right on `/track/:id`.
4. Tap it → confirm sheet → **Send SOS** → toast confirms.
5. In another tab, sign in as admin → `/admin/sos` → see the alert
   with a pulsing red border.
6. Click **Acknowledge**, then **Resolve** with a note.
7. Verify the sub-30s cooldown: try to send another SOS from the
   customer → toast tells you to wait.

Schema is in `supabase/migrations/0015_sos_alerts.sql` — apply via
**Actions → Apply Supabase migrations → target: sos** (or `all`).

---

## 37. Phase 3 (not built — deferred to post-MVP)

- **Automatic UPI/bank integration** — replace the manual mark-paid
  step with a Razorpay / Cashfree webhook loop. Real-money surface,
  needs a merchant account + audit. **Deferred to after MVP validation.**
- **Native iOS APK** — needs Apple Developer account + APNs cert.
- More e2e coverage (full customer → captain trip flow) — needs a
  test data seeder that resets between runs.
- **Support inbox badge on customer app** — light per-user ping
  channel already broadcasts; UI-only work.

Say what you want to tackle next.
