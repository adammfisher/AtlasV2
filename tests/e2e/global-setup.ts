/** Logs in as the primary account once and saves storageState (cookie +
 * localStorage token) — every spec reuses it, so the auth gate stays honest
 * without touching ~90 tests. */
import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = (config.projects[0]?.use.baseURL as string | undefined) ?? 'http://127.0.0.1:5173';
  const api = process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175';
  const res = await fetch(`${api}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'adammfisher', password: 'buster11' }),
  });
  if (!res.ok) throw new Error(`global-setup login failed: ${res.status} ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  process.env.ATLAS_TEST_TOKEN = token;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL });
  // set the token BEFORE any app script runs — the app's 401 handler clears
  // localStorage, so a post-load setItem races the boot requests and loses
  await ctx.addInitScript((t) => localStorage.setItem('atlas_token', t), token);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByText('New chat', { exact: true }).first().waitFor({ timeout: 15_000 });
  await ctx.addCookies([
    {
      name: 'atlas_token',
      value: token,
      url: baseURL,
    },
    {
      name: 'atlas_token',
      value: token,
      url: api,
    },
  ]);
  await ctx.storageState({ path: 'tests/e2e/.auth-state.json' });
  await browser.close();
}
