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

## 21. Phase 2 (not built yet)

- Code-splitting for the web bundle (~540 kB main chunk → could halve).

Nothing else on the roadmap I've been tracking. Say what you want to
tackle next.
