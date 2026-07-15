/** ULTRA complex-UI frontends (user-requested): multi-component interactive
 * apps must actually WORK in the sandbox — forms mutate state, derived values
 * recompute, filters filter. Interaction-level assertions, not render checks. */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, cleanupMarked, MARK } from './helpers';

async function create(page: import('@playwright/test').Page, prompt: string): Promise<void> {
  await page.goto('/');
  await page.getByText('New chat', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await composer(page).fill(`${MARK} ${prompt}`);
  await composer(page).press('Enter');
  await waitIdle(page, 240_000);
  await page.waitForTimeout(3000);
}

test.describe('ULTRA complex UI', () => {
  test.afterAll(cleanupMarked);
  test.setTimeout(420_000);

  test('expense tracker: form input → list grows → derived total updates', async ({ page }) => {
    await create(
      page,
      'Create an interactive React expense tracker: a text input with placeholder "Description", a number input with placeholder "Amount", an "Add expense" button, a list of added expenses, and a running total shown in an element with id "total". Start with an empty list and total 0.',
    );
    const frame = page.frameLocator('iframe').last();
    const desc = frame.locator('input[placeholder="Description"]');
    await expect(desc, 'form rendered').toBeVisible({ timeout: 60_000 });
    await desc.fill('Coffee');
    await frame.locator('input[placeholder="Amount"]').fill('4.50');
    await frame.getByRole('button', { name: /add expense/i }).click();
    await desc.fill('Train ticket');
    await frame.locator('input[placeholder="Amount"]').fill('12.25');
    await frame.getByRole('button', { name: /add expense/i }).click();
    // list has both entries; derived total = 16.75
    await expect(frame.locator('body')).toContainText('Coffee');
    await expect(frame.locator('body')).toContainText('Train ticket');
    await expect(frame.locator('#total')).toContainText(/16\.75/);
  });

  test('tabbed dashboard: tab switching swaps content', async ({ page }) => {
    await create(
      page,
      'Create an interactive React dashboard with two tabs labeled exactly "Overview" and "Details". The Overview tab shows the text "OVERVIEW-PANE-A"; the Details tab shows "DETAILS-PANE-B". Only the active tab\'s content is visible.',
    );
    const frame = page.frameLocator('iframe').last();
    await expect(frame.getByRole('button', { name: 'Overview' }).or(frame.getByText('Overview', { exact: true })).first()).toBeVisible({ timeout: 60_000 });
    await expect(frame.locator('body')).toContainText('OVERVIEW-PANE-A');
    await frame.getByText('Details', { exact: true }).first().click();
    await expect(frame.locator('body')).toContainText('DETAILS-PANE-B');
    await expect(frame.locator('body')).not.toContainText('OVERVIEW-PANE-A');
  });
});
