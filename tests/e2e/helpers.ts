import { type Page, expect } from '@playwright/test';

// Local dev hits :5175 directly; cloud runs point both client + API at the
// CloudFront origin via ATLAS_BASE (e.g. https://xxxx.cloudfront.net).
const BASE_ORIGIN = process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175';
export const API = `${BASE_ORIGIN}/api`;
export const MARK = '[e2e]'; // title marker — teardown deletes marked conversations

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export function composer(page: Page) {
  return page.locator('textarea').first();
}

/** Open a fresh chat and send a marked message. */
export async function sendNew(page: Page, text: string): Promise<void> {
  await page.getByText('New chat', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await send(page, text);
}

export async function send(page: Page, text: string): Promise<void> {
  const c = composer(page);
  await c.fill(`${MARK} ${text}`);
  await c.press('Enter');
}

/** Wait until streaming finishes (send arrow returns). */
export async function waitIdle(page: Page, maxMs = 120_000): Promise<void> {
  const t0 = Date.now();
  await page.waitForTimeout(1500);
  for (;;) {
    const busy = await page.locator('button:has(svg.lucide-square)').isVisible().catch(() => false);
    if (!busy || Date.now() - t0 > maxMs) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(500);
}

export async function assistantText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

export async function expectReply(page: Page, pattern: RegExp): Promise<void> {
  await expect
    .poll(async () => (await assistantText(page)).replace(new RegExp(`\\${MARK}[^\\n]*`, 'g'), ''), {
      timeout: 60_000,
    })
    .toMatch(pattern);
}

/** Delete every conversation whose title carries the e2e marker. */
export async function cleanupMarked(): Promise<void> {
  const convs = await api<Array<{ id: string; title: string }>>('/conversations');
  const ids = convs.filter((c) => c.title.includes(MARK)).map((c) => c.id);
  if (ids.length) {
    await api('/conversations/delete', { method: 'POST', body: JSON.stringify({ ids }) });
  }
}
