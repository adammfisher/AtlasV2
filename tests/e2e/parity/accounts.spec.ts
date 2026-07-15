/** Accounts (users.config.json, no Cognito): three fully separate workspaces
 * with per-account model limits. API-level assertions per account token. */
import { test, expect } from '@playwright/test';

const BASE = process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175';

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(res.ok, `login ${username} → ${res.status}`).toBe(true);
  return ((await res.json()) as { token: string }).token;
}

async function as<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

test.describe('accounts', () => {
  test('auth gate: no token → 401; wrong password → 401', async () => {
    const bare = await fetch(`${BASE}/api/conversations`);
    expect(bare.status).toBe(401);
    const bad = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'susan', password: 'wrong' }),
    });
    expect(bad.status).toBe(401);
  });

  test('complete separation: susan’s data is invisible to demo and vice versa', async () => {
    const susan = await login('susan', 'ally');
    const demo = await login('demo', 'llama');
    const conv = await as<{ id: string }>(susan, '/conversations', { method: 'POST', body: '{}' });

    const susanList = await as<Array<{ id: string }>>(susan, '/conversations');
    expect(susanList.some((c) => c.id === conv.id), 'susan sees her chat').toBe(true);

    const demoList = await as<Array<{ id: string }>>(demo, '/conversations');
    expect(demoList.some((c) => c.id === conv.id), 'demo must NOT see susan’s chat').toBe(false);

    // cross-account direct access is a miss, not a leak
    await expect(as(demo, `/conversations/${conv.id}`)).rejects.toThrow(/404/);

    // projects separate too: a project created by susan never appears for demo
    const proj = await as<{ id: string }>(susan, '/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'SUSAN-ONLY-WORKSPACE' }),
    });
    const demoProjects = await as<Array<{ id: string; name: string }>>(demo, '/projects');
    expect(demoProjects.some((p) => p.id === proj.id || p.name === 'SUSAN-ONLY-WORKSPACE'), 'demo must not see susan’s project').toBe(false);
    await as(susan, `/projects/${proj.id}`, { method: 'DELETE' });

    await as(susan, '/conversations/delete', { method: 'POST', body: JSON.stringify({ ids: [conv.id] }) });
  });

  test('model limits: adam sees all, susan mid, demo nova-only; select outside → 403', async () => {
    const adam = await login('adammfisher', 'buster11');
    const susan = await login('susan', 'ally');
    const demo = await login('demo', 'llama');

    const keys = async (t: string): Promise<string[]> =>
      (await as<{ bedrockModels: Array<{ id: string }> }>(t, '/models')).bedrockModels.map((m) => m.id);
    // /models maps keys→entries; compare COUNTS per allowlist
    expect((await keys(adam)).length).toBe(3);
    expect((await keys(susan)).length).toBe(2);
    expect((await keys(demo)).length).toBe(1);

    const forbidden = await fetch(`${BASE}/api/models/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${demo}` },
      body: JSON.stringify({ id: 'haiku' }),
    });
    expect(forbidden.status, 'demo selecting haiku must be refused').toBe(403);
  });
});
