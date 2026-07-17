/**
 * Memory eval harness (MEMORY_DESIGN.md Phase 4): drives the RUNNING server
 * end-to-end and asserts the memory system's core guarantees deterministically
 * (store state + recall-preview), with the remember/forget tool flow exercised
 * through real chat. Uses project p3 (Internal Ops) as the sandbox; the user
 * scope is never wiped.
 *
 *   pnpm test:memory-eval        (server must be running on :5175)
 */
// AXIOM_BASE lets the same eval run against the deployed CloudFront origin
// (parity M1: memory guarantees must hold on the DEPLOYED DynamoDB/S3 Vectors)
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

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface SseResult {
  tools: string[];
  text: string;
  errored: boolean;
}

/** POST a chat message and collect the SSE stream. */
async function chat(convId: string, text: string): Promise<SseResult> {
  const res = await fetch(`${BASE}/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) throw new Error(`chat → ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const out: SseResult = { tools: [], text: '', errored: false };
  let event = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (event === 'tool' && typeof data.tool === 'string') out.tools.push(data.tool);
        if (event === 'token' && typeof data.delta === 'string') out.text += data.delta;
        if (event === 'error') out.errored = true;
      } catch {
        /* keep-alive */
      }
    }
  }
  return out;
}

interface Export {
  kv: Array<{ key: string; value: string }>;
  notes: Array<{ id: string; content: string }>;
  facts: Array<{ src: string; rel: string; dst: string }>;
  tombstones: Array<{ old_value: string; new_value: string }>;
  profile: { text: string } | null;
}

const P = 'p3';
const exportScope = (): Promise<Export> => j<Export>(`/projects/${P}/memory/export`);
const newConv = async (): Promise<string> =>
  (await j<{ id: string }>('/conversations', { method: 'POST', body: JSON.stringify({ projectId: P }) })).id;

// ── scenarios ────────────────────────────────────────────────────────────────

console.log('memory-eval: sandbox = project p3\n');

console.log('0. baseline wipe');
await j(`/projects/${P}/memory/wipe`, { method: 'POST' });
const empty = await exportScope();
check('scope empty after wipe', empty.kv.length === 0 && empty.notes.length === 0 && empty.facts.length === 0);

console.log('1. store + recall');
await j(`/projects/${P}/memory/kv`, {
  method: 'PUT',
  body: JSON.stringify({ key: 'project_context.deploy_target', value: 'Deploys run on AWS Fargate in us-east-2' }),
});
const preview1 = await j<{ injected: string }>(`/projects/${P}/memory/recall-preview?q=where do our deploys run`);
check('fact recalled for paraphrased query', preview1.injected.includes('Fargate'), preview1.injected.slice(0, 200));

console.log('2. paraphrase dedup (same fact, new key → merge, no duplicate)');
await j(`/projects/${P}/memory/kv`, {
  method: 'PUT',
  body: JSON.stringify({ key: 'project_context.deployment_platform', value: 'The service deploys to AWS Fargate (us-east-2)' }),
});
const afterDup = await exportScope();
const fargateKeys = afterDup.kv.filter((r) => /fargate/i.test(r.value));
check('exactly one Fargate fact remains', fargateKeys.length === 1, JSON.stringify(afterDup.kv.map((r) => r.key)));

console.log('3. contradiction → supersede + tombstone');
await j(`/projects/${P}/memory/kv`, {
  method: 'PUT',
  body: JSON.stringify({ key: 'project_context.deploy_platform_update', value: 'Deploys now run on EC2 instances, no longer Fargate' }),
});
const afterFlip = await exportScope();
const deployFacts = afterFlip.kv.filter((r) => /fargate|ec2/i.test(r.value));
check('still a single deploy fact', deployFacts.length === 1, JSON.stringify(afterFlip.kv.map((r) => r.key)));
check('value superseded to EC2', /ec2/i.test(deployFacts[0]?.value ?? ''), deployFacts[0]?.value);
check('tombstone written', afterFlip.tombstones.length >= 1);

console.log('4. remember tool (chat)');
const conv1 = await newConv();
const r1 = await chat(conv1, 'Remember for this project: the release cadence is every second Tuesday.');
check('remember tool fired', r1.tools.includes('remember'), `tools=${JSON.stringify(r1.tools)}`);
const afterRemember = await exportScope();
const hasCadence = [...afterRemember.notes.map((n) => n.content), ...afterRemember.kv.map((r) => r.value)].some((s) =>
  /second tuesday/i.test(s),
);
check('fact stored', hasCadence);

console.log('5. forget tool removes ALL matching layers');
const conv2 = await newConv();
const r2 = await chat(conv2, 'Forget everything about the release cadence for this project.');
check('forget tool fired', r2.tools.includes('forget'), `tools=${JSON.stringify(r2.tools)}`);
const afterForget = await exportScope();
const stillThere = [...afterForget.notes.map((n) => n.content), ...afterForget.kv.map((r) => r.value)].some((s) =>
  /second tuesday/i.test(s),
);
check('fact fully forgotten', !stillThere);

console.log('6. graph extraction + two-way recall');
const conv3 = await newConv();
await chat(conv3, 'Architecture note: the billing-service depends on the payments-gateway. Just acknowledge.');
await j(`/projects/${P}/memory/extract-now`, { method: 'POST', body: JSON.stringify({ convId: conv3 }) });
const afterGraph = await exportScope();
check('edge extracted', afterGraph.facts.length >= 1, JSON.stringify(afterGraph.facts));
const preview2 = await j<{ injected: string; entitiesMatched: string[] }>(
  `/projects/${P}/memory/recall-preview?q=${encodeURIComponent('what depends on the payments-gateway?')}`,
);
check(
  'reverse-direction entity recall',
  /depends/i.test(preview2.injected) && /billing/i.test(preview2.injected),
  preview2.injected.slice(0, 300),
);

console.log('7. durable queue: un-flushed fact surfaces cross-chat via JIT flush');
// The old check read the mem_pending SQLite row directly — that table moved to
// DynamoDB and direct introspection can't run against the deployed stack. The
// behavioral equivalent is stronger: a fact stated in conv4 and NEVER
// explicitly extracted must be recallable from a different conversation in the
// same project (flushProjectPending runs the queued extraction just-in-time).
// In Lambda this proves the queue survived across requests/instances — a
// process-timer queue would lose it.
const conv4 = await newConv();
await chat(conv4, 'Decision: the retention window for audit logs is 400 days. Just acknowledge briefly.');
// a REAL message in a different conversation drives flushProjectPending —
// recall-preview is pure observability and does not flush
const conv5 = await newConv();
const r7 = await chat(conv5, 'How long do we retain audit logs? Answer with just the duration.');
check('queued fact recalled cross-chat without explicit extract', /400\s*days?/i.test(r7.text), r7.text.slice(0, 300));

console.log('8. teardown wipe');
await j(`/projects/${P}/memory/wipe`, { method: 'POST' });
const final = await exportScope();
check('scope empty after teardown', final.kv.length === 0 && final.notes.length === 0 && final.facts.length === 0);

console.log(`\nmemory-eval: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
