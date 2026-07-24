import { test, expect } from '@playwright/test';

test.describe('admin web', () => {
  test.skip(({}, testInfo) => testInfo.project.name !== 'admin', 'admin-only');

  test('auth page renders on the admin project', async ({ page }) => {
    await page.goto('/');
    const email = page.getByPlaceholder(/email/i).first();
    await expect(email).toBeVisible({ timeout: 10_000 });
  });

  test('non-admin sign-in is blocked with the role-mismatch page', async ({ page }) => {
    // If a customer account is provided, sign in and check for the mismatch page.
    const email = process.env.GORIDE_E2E_CUSTOMER_EMAIL;
    const password = process.env.GORIDE_E2E_CUSTOMER_PASSWORD;
    test.skip(!email || !password, 'requires GORIDE_E2E_CUSTOMER_EMAIL + _PASSWORD env vars');

    await page.goto('/');
    await page.getByPlaceholder(/email/i).first().fill(email!);
    await page.getByPlaceholder(/password/i).first().fill(password!);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // The RoleMismatch page shows the target-specific message.
    await expect(page.getByText(/admin console/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
