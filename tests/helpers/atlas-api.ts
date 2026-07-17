/**
 * Server API client for the test harness. All harness traffic runs as the
 * dedicated `e2etest` account (own DynamoDB partition `A#e2etest|`), so tests
 * never touch the primary account's data. TESTPLAN.md §4.
 */

const BASE_ORIGIN = process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175';
export const API = `${BASE_ORIGIN}/api`;
export const MARK = '[e2e]'; // shared title marker — teardown deletes marked conversations

export const E2E_USER = 'e2etest';
export const E2E_PASS = 'e2e-harness-only';

let token: string | null = null;

export async function loginE2E(): Promise<string> {
  if (token) return token;
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: E2E_USER, password: E2E_PASS }),
  });
  if (!res.ok) throw new Error(`e2etest login failed: ${res.status} ${await res.text()}`);
  token = ((await res.json()) as { token: string }).token;
  return token;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const t = await loginE2E();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${t}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface Conv {
  id: string;
  projectId: string;
  title: string;
}

export async function createConv(projectId?: string): Promise<Conv> {
  return api<Conv>('/conversations', {
    method: 'POST',
    body: JSON.stringify(projectId ? { projectId } : {}),
  });
}

/** Delete every e2etest conversation carrying the marker, and marked artifacts. */
export async function cleanupE2E(): Promise<void> {
  const convs = await api<Array<{ id: string; title: string }>>('/conversations');
  const ids = convs.filter((c) => c.title.includes(MARK) || c.title === 'New chat').map((c) => c.id);
  if (ids.length) await api('/conversations/delete', { method: 'POST', body: JSON.stringify({ ids }) });
}

/** Raw SSE POST of a chat message; yields each network chunk with an ms offset. */
export async function* streamMessage(
  convId: string,
  text: string,
  opts?: { thinking?: boolean; signal?: AbortSignal },
): AsyncGenerator<{ t: number; chunk: string }> {
  const t0 = Date.now();
  const t = await loginE2E();
  const res = await fetch(`${API}/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ text, attachments: [], retry: false, thinking: opts?.thinking ?? false }),
    signal: opts?.signal ?? null,
  });
  if (!res.ok || !res.body) throw new Error(`stream POST → ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    yield { t: Date.now() - t0, chunk: dec.decode(value, { stream: true }) };
  }
}
