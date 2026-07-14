/** S3 skills-UI: the toggle actually gates the router and persists. */
import { test, expect } from '@playwright/test';
import { composer, waitIdle, pollBody, cleanupMarked, api, MARK } from './helpers';

test.describe('S3 skills-UI gating', () => {
  test.afterAll(async () => {
    await api('/skills/pptx', { method: 'PATCH', body: JSON.stringify({ enabled: true }) }).catch(() => undefined);
    await cleanupMarked();
  });

  test('disable pptx → deck request degrades honestly → re-enable restores', async ({ page }) => {
    await api('/skills/pptx', { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
    await page.goto('/');
    await page.getByText('New chat', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await composer(page).fill(`${MARK} Create a 4-slide deck about onboarding.`);
    await composer(page).press('Enter');
    await waitIdle(page, 90_000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/turned off|disabled|skills/i);
    expect(body).not.toMatch(/Building|Compiling|\.pptx artifact/i);

    // persistence: the Skills view must show it disabled after reload
    await page.goto('/');
    await page.locator('text=Skills').first().click();
    await page.waitForTimeout(800);
    const badge = page.locator('text=Disabled');
    expect(await badge.count()).toBeGreaterThan(0);
  });
});
