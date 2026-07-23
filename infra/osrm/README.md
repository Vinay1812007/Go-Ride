# Self-hosted OSRM for GoRide

The public OSRM demo at `router.project-osrm.org` has no SLA and 502s under
load — that's fine for demos, not fine for live dispatch. This directory
holds a ready-to-deploy OSRM container preloaded with a Telangana OSM
extract, plus the Fly.io config to run it in Mumbai (`bom`) region.

## Prerequisites

- Fly.io account (free to create; payment method required for a paid VM —
  see the cost note in `fly.toml`).
- `flyctl` installed locally: `curl -L https://fly.io/install.sh | sh`.
- Docker running locally (Fly builds the image on their side, but flyctl
  needs Docker to lint the Dockerfile).

## Deploy in 5 commands

```bash
cd infra/osrm
fly auth login
fly launch --no-deploy --name goride-osrm --region bom --copy-config
# ↑ this uses the existing fly.toml. Say NO when it offers to set up
#   a Postgres db, Redis, or scan for existing configs.
fly deploy
# ↑ ~15 minutes on the first deploy — downloads a ~200 MB Telangana PBF
#   inside the builder stage and runs osrm-extract / osrm-partition /
#   osrm-customize. Watch progress with `fly logs`.
fly status
# ↑ shows the live URL, e.g. https://goride-osrm.fly.dev
```

## Wire it into the Worker

Two ways:

**Option A — Via GH secret (recommended, no committed URL):**
1. GH → Settings → Secrets and variables → Actions → New repository secret:
   - `OSRM_URL_OVERRIDE` = `https://goride-osrm.fly.dev`
2. Run **Actions → Deploy web + api → Run workflow**. The deploy workflow
   patches `wrangler.toml` in-flight so nothing about the URL is committed
   to git.

**Option B — Edit committed config:**
1. Edit `apps/api/wrangler.toml`:
   ```toml
   [vars]
   OSRM_URL = "https://goride-osrm.fly.dev"
   ROUTER   = "osrm"
   ```
2. Push. GH Actions redeploys the Worker automatically.

Either way, route requests will now hit your instance instead of the
public demo.

## Verify

```bash
# Simple end-to-end route (Hyderabad city centre → Airport)
curl "https://goride-osrm.fly.dev/route/v1/driving/78.4867,17.3850;78.4291,17.2403?overview=false" | jq .
```

Expect `"code": "Ok"` with a `routes` array. If you get an error, check
`fly logs` — the most common cause is an OOM during preprocessing (bump
the builder machine size).

## Switching to a different region

Change the `REGION_URL` build arg. Common ones:

| Region | URL | Approx build RAM | Runtime RAM |
|---|---|---|---|
| Telangana (default) | https://download.geofabrik.de/asia/india/telangana-latest.osm.pbf | ~1.2 GB | ~250 MB |
| Karnataka | https://download.geofabrik.de/asia/india/karnataka-latest.osm.pbf | ~1.5 GB | ~350 MB |
| Maharashtra | https://download.geofabrik.de/asia/india/maharashtra-latest.osm.pbf | ~2 GB | ~450 MB |
| All India | https://download.geofabrik.de/asia/india-latest.osm.pbf | ~16 GB | ~5 GB |

For all-India you need a beefier builder — either preprocess locally and
copy the `.osrm*` files into the runtime image, or use Fly's dedicated
build VMs.

```bash
# Rebuild with a different region:
fly deploy --build-arg REGION_URL=https://download.geofabrik.de/asia/india/karnataka-latest.osm.pbf
```

## No-Fly alternative — OpenRouteService

If you don't want to self-host, OpenRouteService offers 2000 free requests
per day with no infra. On the Worker side:

```toml
# apps/api/wrangler.toml
[vars]
ROUTER = "ors"
```

Then set `ORS_KEY` as a Worker secret (already wired through the deploy
workflow when the `ORS_KEY` GH secret is present). Get the key at
https://openrouteservice.org/dev/#/signup.

## Cold starts

`fly.toml` sets `auto_stop_machines = "stop"` and `min_machines_running = 0`
so the machine stops when idle. Cold start is ~2 s once traffic returns —
tolerable for occasional demos, bad for real customer load. For
production, edit `fly.toml`:

```toml
min_machines_running = 1
```

That keeps one warm instance always running (~$3-4/mo).

## Refreshing the map data

OSM extracts change daily. To pick up updates, redeploy — the builder
stage always downloads the latest PBF:

```bash
fly deploy --no-cache
```

For automated refreshes, the repo ships `.github/workflows/osrm-refresh.yml`
which runs on the 1st of each month (and can be triggered manually).
It's gated on a `FLY_API_TOKEN` GH secret from `fly tokens create deploy` —
skips gracefully if the secret is empty.
