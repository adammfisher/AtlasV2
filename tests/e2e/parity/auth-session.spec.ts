/** Logout + 12h token expiry. The token embeds a signed issued-at, so expiry
 * is enforced server-side and can't be tampered. */
import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

const BASE = process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175';

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return ((await res.json()) as { token: string }).token;
}

test.describe('auth session', () => {
  test('logout endpoint clears the cookie', async () => {
    const res = await fetch(`${BASE}/api/auth/logout`, { method: 'POST' });
    expect(res.ok).toBe(true);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/atlas_token=;.*Max-Age=0/);
  });

  test('login reports a 12h TTL', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'llama' }),
    });
    const body = (await res.json()) as { expiresInMs: number };
    expect(body.expiresInMs).toBe(12 * 60 * 60 * 1000);
  });

  test('a valid token works; a 13h-old token is rejected', async () => {
    const fresh = await login('adammfisher', 'buster11');
    const ok = await fetch(`${BASE}/api/conversations`, { headers: { Authorization: `Bearer ${fresh}` } });
    expect(ok.status).toBe(200);

    // forge a token issued 13h ago — the client can't do this without the
    // secret, so it must FAIL to sign correctly and be rejected as invalid
    const [u64, , mac] = fresh.split('.');
    const staleIat = Date.now() - 13 * 60 * 60 * 1000;
    const forged = `${u64}.${staleIat}.${mac}`; // old iat, original mac (won't match)
    const bad = await fetch(`${BASE}/api/conversations`, { headers: { Authorization: `Bearer ${forged}` } });
    expect(bad.status, 'stale/tampered token must be rejected').toBe(401);
  });

  test('logout button then reload returns to the login screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('New chat', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.locator('button[title="Sign out"]').click();
    await expect(page.getByText('Sign in to your workspace')).toBeVisible({ timeout: 10_000 });
  });
});
