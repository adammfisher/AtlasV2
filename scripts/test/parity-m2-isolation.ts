/**
 * M2 project-isolation (parity audit): API-level guarantees that hold against
 * ANY deployment — the stage-2 gate (isolation.test.ts) asserts through SQLite
 * helpers that the DynamoDB migration retired, so it can no longer run.
 *
 * Creates two projects, plants a distinct memory fact + conversation in each,
 * then asserts: conversation scoping, artifact scoping, and — the leak that
 * actually matters — project B's fact must NOT recall inside project A.
 *
 * Usage: [AXIOM_BASE=https://…cloudfront.net] tsx scripts/test/parity-m2-isolation.ts
 */
const BASE = `${process.env.AXIOM_BASE ?? 'http://127.0.0.1:5175'}/api`;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Every /api/* route has required a bearer token since the login-gate landed
// (2026-07-15, the day after this script was first written) — it never
// carried one, so it 401'd on its very first request on any environment.
// Same login this script's PARITY_MATRIX row already assumed a human ran by
// hand; automating it here is what makes "GREEN" mean something re-runnable.
async function login(): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'adammfisher', password: 'buster11' }),
  });
  if (!res.ok) throw new Error(`login → ${res.status}: ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}
const TOKEN = await login();

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function chat(convId: string, text: string): Promise<string> {
  const res = await fetch(`${BASE}/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) throw new Error(`chat → ${res.status}`);
  const raw = await res.text();
  return [...raw.matchAll(/event: token\ndata: (.*)\n/g)]
    .map((m) => {
      try {
        return (JSON.parse(m[1]!) as { delta?: string }).delta ?? '';
      } catch {
        return '';
      }
    })
    .join('');
}

interface Project { id: string }
interface Conversation { id: string; projectId?: string; project_id?: string }

const pA = await j<Project>('/projects', { method: 'POST', body: JSON.stringify({ name: '[e2e] ISO-A' }) });
const pB = await j<Project>('/projects', { method: 'POST', body: JSON.stringify({ name: '[e2e] ISO-B' }) });
const prevActive = (await j<Record<string, string>>('/settings')).activeProjectId;

try {
  console.log('— setup: fact + conversation per project');
  await j('/settings', { method: 'PATCH', body: JSON.stringify({ activeProjectId: pA.id }) });
  const cA = await j<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ projectId: pA.id }) });
  await chat(cA.id, 'Remember for this project: the vault passphrase is AMETHYST-ANVIL. Acknowledge briefly.');
  await j('/settings', { method: 'PATCH', body: JSON.stringify({ activeProjectId: pB.id }) });
  const cB = await j<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ projectId: pB.id }) });
  await chat(cB.id, 'Remember for this project: the vault passphrase is BASALT-BANNER. Acknowledge briefly.');

  console.log('— conversation scoping');
  const convsA = await j<Conversation[]>(`/conversations?projectId=${pA.id}`);
  const idsA = convsA.map((c) => c.id);
  check('A lists its own conversation', idsA.includes(cA.id));
  check("A does not list B's conversation", !idsA.includes(cB.id));

  console.log('— artifact scoping (a REAL artifact, not an empty-array check)');
  // `artsA.every(...)` on an empty result passes vacuously — no artifact was
  // ever created in this script, so that check never actually exercised
  // anything. Create one for real and prove BOTH directions of isolation.
  interface ArtifactRow { id: string; projectId: string; kind: string; created_at: number }
  const artT0 = Date.now();
  const cArtA = await j<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ projectId: pA.id }) });
  await chat(cArtA.id, 'Create an SVG icon of a compass rose as a document/artifact.');
  const allArts = await j<ArtifactRow[]>('/artifacts');
  const art = allArts.filter((a) => a.kind === 'svg' && a.created_at > artT0).sort((a, b) => b.created_at - a.created_at)[0];
  check('artifact was actually created by the prompt', Boolean(art), 'no svg artifact appeared');
  if (art) {
    check("artifact carries project A's id", art.projectId === pA.id, `got ${art.projectId}`);
    const artsBAfter = await j<ArtifactRow[]>(`/artifacts?projectId=${pB.id}`);
    check("project B's filtered query must not see A's artifact", !artsBAfter.some((a) => a.id === art.id));
    const artsAAfter = await j<ArtifactRow[]>(`/artifacts?projectId=${pA.id}`);
    check("project A's own filtered query must see it", artsAAfter.some((a) => a.id === art.id));
  }

  console.log('— memory isolation (the leak that matters)');
  const prevA = await j<{ injected: string }>(`/projects/${pA.id}/memory/recall-preview?q=${encodeURIComponent('what is the vault passphrase?')}`);
  const prevB = await j<{ injected: string }>(`/projects/${pB.id}/memory/recall-preview?q=${encodeURIComponent('what is the vault passphrase?')}`);
  check('A recalls its own fact', /AMETHYST-ANVIL/.test(prevA.injected), prevA.injected.slice(0, 200));
  check("A does NOT recall B's fact", !/BASALT-BANNER/.test(prevA.injected), prevA.injected.slice(0, 200));
  check('B recalls its own fact', /BASALT-BANNER/.test(prevB.injected), prevB.injected.slice(0, 200));
  check("B does NOT recall A's fact", !/AMETHYST-ANVIL/.test(prevB.injected), prevB.injected.slice(0, 200));

  console.log('— cross-project chat probe');
  await j('/settings', { method: 'PATCH', body: JSON.stringify({ activeProjectId: pA.id }) });
  const cA2 = await j<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ projectId: pA.id }) });
  const answer = await chat(cA2.id, 'What is the vault passphrase? Answer with just the passphrase.');
  check('chat in A never surfaces B\'s passphrase', !/BASALT-BANNER/.test(answer), answer.slice(0, 200));
} finally {
  console.log('— teardown');
  await j('/settings', { method: 'PATCH', body: JSON.stringify({ activeProjectId: prevActive ?? 'p1' }) }).catch(() => undefined);
  for (const p of [pA, pB]) {
    await j(`/projects/${p.id}`, { method: 'DELETE' }).catch((err: Error) => console.error(`project cleanup ${p.id}: ${err.message}`));
  }
}

console.log(`\nM2 isolation: ${passed} passed, ${failed} failed → ${failed === 0 ? 'GREEN' : 'RED'}`);
process.exit(failed === 0 ? 0 : 1);
