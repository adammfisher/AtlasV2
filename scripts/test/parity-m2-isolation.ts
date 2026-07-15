/**
 * M2 project-isolation (parity audit): API-level guarantees that hold against
 * ANY deployment — the stage-2 gate (isolation.test.ts) asserts through SQLite
 * helpers that the DynamoDB migration retired, so it can no longer run.
 *
 * Creates two projects, plants a distinct memory fact + conversation in each,
 * then asserts: conversation scoping, artifact scoping, and — the leak that
 * actually matters — project B's fact must NOT recall inside project A.
 *
 * Usage: [ATLAS_BASE=https://…cloudfront.net] tsx scripts/test/parity-m2-isolation.ts
 */
const BASE = `${process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175'}/api`;

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

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function chat(convId: string, text: string): Promise<string> {
  const res = await fetch(`${BASE}/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  console.log('— artifact scoping');
  const artsA = await j<Array<{ projectId: string }>>(`/artifacts?projectId=${pA.id}`);
  check('artifacts?projectId=A returns only A rows', artsA.every((a) => a.projectId === pA.id));

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
