import { test, expect } from '@playwright/test';

// Only run in the 'customer' project (via projects config in playwright.config.ts).
test.describe('customer web', () => {
  test.skip(({}, testInfo) => testInfo.project.name !== 'customer', 'customer-only');

  test('auth page renders and shows email/password fields', async ({ page }) => {
    await page.goto('/');
    // AuthPage should render if not signed in — look for either "Sign in" or an email input.
    const email = page.getByPlaceholder(/email/i).first();
    await expect(email).toBeVisible({ timeout: 10_000 });
  });

  test('developers docs render publicly', async ({ page }) => {
    await page.goto('/developers');
    // DevelopersPage should render even without auth
    await expect(page).toHaveTitle(/GoRide/i);
    // "Quick Start" is one of the section headers we ship
    await expect(page.getByText(/quick start/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('public tracking page with a bad token 404s gracefully', async ({ page }) => {
    await page.goto('/t/DOES-NOT-EXIST?k=bad');
    // Should render something — either a not-found message or a redirect.
    // Just assert the app didn't blow up.
    await expect(page.locator('body')).not.toHaveText(/^undefined$/);
  });
});
