import { test, expect } from '@playwright/test';

test.describe('captain web', () => {
  test.skip(({}, testInfo) => testInfo.project.name !== 'captain', 'captain-only');

  test('auth page renders on the captain project', async ({ page }) => {
    await page.goto('/');
    const email = page.getByPlaceholder(/email/i).first();
    await expect(email).toBeVisible({ timeout: 10_000 });
  });
});
