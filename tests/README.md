# GoRide end-to-end smoke tests

Minimal Playwright suite that pokes each live Pages project to make sure
it renders. Deliberately narrow — full user-flow coverage is deferred until
we have a reliable test data seeder.

## Run locally

```bash
cd tests
npm install
npx playwright install chromium --with-deps    # ~150 MB one-time
npm test
```

Tests fan out across three Playwright "projects" — customer, captain,
admin — pointed at the corresponding Pages URLs. Override per-project URLs
if you're testing a preview branch:

```bash
GORIDE_URL_CUSTOMER=https://preview-abc.goride-web.pages.dev npm test
```

## Signed-in tests

The role-mismatch test on the admin project needs a live customer account
so it can attempt an admin sign-in and expect the diagnostic. Set:

```bash
export GORIDE_E2E_CUSTOMER_EMAIL=…
export GORIDE_E2E_CUSTOMER_PASSWORD=…
```

Skipped automatically when these are unset — so `npm test` on a fresh
clone runs the anonymous smoke tests only.

## CI

`.github/workflows/e2e.yml` runs on **manual dispatch only** — not on
push. This is deliberate: broken deploys shouldn't be discovered because
a smoke test failed silently between the merge and someone noticing. Trigger
via Actions → **E2E smoke** → Run workflow.

## Adding a test

Drop a `*.spec.ts` under `tests/e2e/`. Gate it on
`testInfo.project.name` to run in only one project (customer / captain /
admin) — otherwise it runs in all three.
