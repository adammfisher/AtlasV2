/** Login screen: an unauthenticated browser sees the gate (not the app),
 * signs in, and lands in its own workspace. */
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } }); // no auth

test('unauthenticated → login screen → sign in as demo → workspace loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Sign in to your workspace')).toBeVisible({ timeout: 10_000 });
  // the app shell must NOT render behind the gate
  expect(await page.getByText('New chat', { exact: true }).count()).toBe(0);

  await page.locator('input').first().fill('demo');
  await page.locator('input[type="password"]').fill('llama');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('New chat', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});
