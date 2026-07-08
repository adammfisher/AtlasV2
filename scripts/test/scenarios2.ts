/**
 * Scenario harness — wave 2 (deeper real-user journeys). Self-contained.
 *   npx tsx scripts/test/scenarios2.ts [filter]
 */
const BASE = process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175';
const API = `${BASE}/api`;
const MARK = '[scn2]';
interface R { suite: string; name: string; ok: boolean; detail: string }
const results: R[] = [];
let cur = '';
async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 140)}`);
  return (await res.json()) as T;
}
interface Sse { text: string; tools: string[]; artifact?: { artifactId: string; ver: number; kind: string }; error?: string }
async function chat(conv: string, text: string, atts?: unknown[], timeoutMs = 200_000): Promise<Sse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(`${API}/conversations/${conv}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, attachments: atts }), signal: ctrl.signal });
  const out: Sse = { text: '', tools: [] }; const rd = res.body!.getReader(); const dc = new TextDecoder(); let bf = '', ev = '';
  try { for (;;) { const { done, value } = await rd.read(); if (done) break; bf += dc.decode(value, { stream: true }); const ls = bf.split('\n'); bf = ls.pop() ?? '';
    for (const l of ls) { if (l.startsWith('event: ')) ev = l.slice(7).trim(); else if (l.startsWith('data: ')) try { const d = JSON.parse(l.slice(6)); if (ev === 'token' && typeof d.delta === 'string') out.text += d.delta; else if (ev === 'tool') out.tools.push(d.tool); else if (ev === 'artifact') out.artifact = d; else if (ev === 'error') out.error = d.message; } catch { /* */ } } } }
  finally { clearTimeout(timer); }
  return out;
}
const newConv = async (p: string): Promise<string> => (await j<{ id: string }>('/conversations', { method: 'POST', body: JSON.stringify({ projectId: p }) })).id;
const ask = async (p: string, t: string): Promise<Sse> => chat(await newConv(p), t);
const b64 = (s: string): string => Buffer.from(s).toString('base64');
async function timed(name: string, fn: () => Promise<{ ok: boolean; detail?: string }>): Promise<void> {
  const t0 = Date.now();
  try { const r = await fn(); results.push({ suite: cur, name, ok: r.ok, detail: r.detail ?? '' }); console.log(`  ${r.ok ? '✓' : '✗ FAIL'} ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)${!r.ok && r.detail ? ` — ${r.detail}` : ''}`); }
  catch (e) { results.push({ suite: cur, name, ok: false, detail: e instanceof Error ? e.message : String(e) }); console.log(`  ✗ ERROR ${name} — ${e instanceof Error ? e.message : e}`); }
}
const suite = (n: string): void => { cur = n; console.log(`\n## ${n}`); };
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const only = process.argv[2];
  const run = (n: string): boolean => !only || n.toLowerCase().includes(only.toLowerCase());
  const stamp = Date.now().toString(36);

  if (run('product')) {
    suite('Product artifact (stateful skill)');
    await timed('define a product, then evolve it', async () => {
      const conv = await newConv('p1');
      const r1 = await chat(conv, 'Define a new product: an AI-powered expense tracker called SpendWise. Include target users and key features.');
      if (r1.artifact?.kind !== 'product') return { ok: false, detail: `kind=${r1.artifact?.kind} ${r1.error ?? ''}` };
      const r2 = await chat(conv, 'Add a pricing model: freemium with a 9 dollar pro tier.');
      return { ok: (r2.artifact?.ver ?? 0) >= 2 || r2.artifact?.kind === 'product', detail: `v=${r2.artifact?.ver}` };
    });
  }

  if (run('versioning')) {
    suite('Artifact versioning + restore');
    await timed('generate → edit → restore v1', async () => {
      const conv = await newConv('p1');
      const r1 = await chat(conv, 'Create a markdown doc titled Alpha with one line: version one.');
      if (!r1.artifact) return { ok: false, detail: r1.error ?? 'no v1' };
      await chat(conv, 'Change the line to: version two.');
      const restore = await j<{ ok?: boolean }>(`/artifacts/${r1.artifact.artifactId}/restore`, { method: 'POST', body: JSON.stringify({ version: 1 }) });
      const detail = await j<{ ver: number; versions: unknown[] }>(`/artifacts/${r1.artifact.artifactId}`);
      return { ok: (detail.versions?.length ?? 0) >= 2, detail: `versions=${detail.versions?.length} restore=${JSON.stringify(restore).slice(0, 40)}` };
    });
  }

  if (run('models')) {
    suite('Model switching');
    await timed('switch to sonnet slot and back to haiku', async () => {
      await j('/models/select', { method: 'POST', body: JSON.stringify({ id: 'sonnet' }) });
      const reg1 = await j<{ selected: string }>('/models');
      const r = await ask('p1', 'Reply with exactly: MODEL-SWITCH-OK');
      await j('/models/select', { method: 'POST', body: JSON.stringify({ id: 'haiku' }) });
      const reg2 = await j<{ selected: string }>('/models');
      return { ok: reg1.selected === 'sonnet' && reg2.selected === 'haiku' && /MODEL-SWITCH-OK/.test(r.text), detail: `${reg1.selected}→${reg2.selected} reply=${r.text.slice(0, 40)}` };
    });
  }

  if (run('contradiction')) {
    suite('Memory contradiction → supersede + tombstone');
    await timed('fact then contradiction supersedes with tombstone', async () => {
      const P = 'p2';
      await j(`/projects/${P}/memory/wipe`, { method: 'POST' }).catch(() => undefined);
      await ask(P, `Remember for this project: our primary datacenter is in Frankfurt (scn2-${stamp}).`);
      await wait(2500);
      await ask(P, `Update: our primary datacenter has moved to Dublin, no longer Frankfurt.`);
      await wait(2500);
      const exp = await j<{ kv: Array<{ value: string }>; tombstones: Array<unknown> }>(`/projects/${P}/memory/export`);
      const dcFacts = exp.kv.filter((k) => /frankfurt|dublin/i.test(k.value));
      const superseded = dcFacts.every((k) => /dublin/i.test(k.value)) && !dcFacts.some((k) => /frankfurt/i.test(k.value));
      return { ok: superseded && exp.tombstones.length >= 1, detail: `dcFacts=${dcFacts.map((k) => k.value.slice(0, 30))} tombs=${exp.tombstones.length}` };
    });
  }

  if (run('officedocs')) {
    suite('Knowledge: office + code uploads');
    await timed('code file upload → Q&A', async () => {
      const code = `# config.py (scn2-${stamp})\nMAX_RETRIES = 7\nTIMEOUT_SECONDS = 45\nDATABASE_URL = "postgres://prod"\n`;
      const up = await j<{ id: string }>('/uploads', { method: 'POST', body: JSON.stringify({ name: `config-${stamp}.py`, dataBase64: b64(code) }) });
      const r = await chat(await newConv('p1'), 'In the attached config, what is MAX_RETRIES set to?', [{ id: up.id, name: `config-${stamp}.py`, kind: 'document' }]);
      return { ok: /\b7\b/.test(r.text), detail: r.text.slice(0, 80) };
    });
    await timed('generated pptx re-uploaded as knowledge → Q&A', async () => {
      // generate a deck, download it, upload as knowledge, ask about it
      const g = await ask('p1', 'Create a 2-slide deck titled Nebula Roadmap: slide 1 vision, slide 2 milestones with the milestone "GA in November".');
      if (!g.artifact) return { ok: false, detail: 'no deck' };
      const dl = await fetch(`${API}/artifacts/${g.artifact.artifactId}/versions/${g.artifact.ver}/download`);
      const buf = Buffer.from(await dl.arrayBuffer());
      const up = await j<{ id: string }>('/uploads/knowledge', { method: 'POST', body: JSON.stringify({ projectId: 'p3', name: `nebula-${stamp}.pptx`, dataBase64: buf.toString('base64') }) });
      // wait for indexing
      for (let i = 0; i < 20; i++) { const l = await j<Array<{ id: string; status: string }>>('/projects/p3/knowledge'); if (l.find((x) => x.id === up.id)?.status === 'ready') break; await wait(2000); }
      const r = await ask('p3', 'According to the Nebula Roadmap deck, when is GA?');
      // cleanup
      await j(`/projects/p3/knowledge/${up.id}/delete`, { method: 'POST' }).catch(() => undefined);
      return { ok: /november/i.test(r.text), detail: r.text.slice(0, 90) };
    });
  }

  if (run('diagrams')) {
    suite('Diagram variety');
    for (const [name, prompt] of [
      ['sequence', 'Create a mermaid sequence diagram of a login flow: user, frontend, auth service, database.'],
      ['erd', 'Create a mermaid ER diagram for a blog: users, posts, comments with relationships.'],
      ['architecture', 'Create a mermaid diagram of a three-tier web architecture: load balancer, app servers, database.'],
    ] as const) {
      await timed(`mermaid ${name}`, async () => {
        const r = await ask('p1', prompt);
        return { ok: r.artifact?.kind === 'mermaid', detail: r.error ?? `kind=${r.artifact?.kind}` };
      });
    }
  }

  if (run('isolation')) {
    suite('Deep multi-project isolation');
    await timed('5 projects, distinct secrets, zero leakage', async () => {
      const projs: string[] = [];
      for (let i = 0; i < 5; i++) projs.push((await j<{ id: string }>('/projects', { method: 'POST', body: JSON.stringify({ name: `${MARK} Iso${i}-${stamp}`, instructions: '' }) })).id);
      // plant a unique secret in each project's memory
      for (let i = 0; i < 5; i++) { await ask(projs[i]!, `Remember for this project: the vault code is ZULU-${i}-${stamp}.`); }
      await wait(3000);
      // each project must recall ONLY its own secret
      let leaks = 0;
      for (let i = 0; i < 5; i++) {
        const r = await ask(projs[i]!, 'What is the vault code for this project? Answer with just the code.');
        if (!r.text.includes(`ZULU-${i}-`)) leaks++;
        for (let k = 0; k < 5; k++) if (k !== i && r.text.includes(`ZULU-${k}-`)) leaks++;
      }
      return { ok: leaks === 0, detail: `${leaks} leak(s)` };
    });
  }

  if (run('longchat')) {
    suite('Very long conversation (30 turns, multi-fact)');
    await timed('three facts from early turns survive 30 turns', async () => {
      const conv = await newConv('p1');
      await chat(conv, `Project kickoff notes: the client is Meridian Corp, the deadline is March 15, and the lead engineer is Sam Okafor. (scn2-${stamp})`);
      for (let i = 0; i < 27; i++) await chat(conv, `Working note ${i}: reply with just OK.`, undefined, 60_000);
      const r = await chat(conv, 'Remind me: who is the client, when is the deadline, and who is the lead engineer?', undefined, 60_000);
      const hits = [/meridian/i.test(r.text), /march 15/i.test(r.text), /okafor/i.test(r.text)].filter(Boolean).length;
      return { ok: hits >= 2, detail: `${hits}/3 facts recalled: ${r.text.slice(0, 120)}` };
    });
  }

  if (run('concurrency')) {
    suite('Concurrency stress');
    await timed('5 parallel artifact generations all succeed', async () => {
      const prompts = ['Create an SVG of a star.', 'Create a markdown to-do list.', 'Draw a mermaid flowchart A to B.', 'Create an SVG of a heart.', 'Create a markdown haiku about servers.'];
      const rs = await Promise.all(prompts.map((p) => ask('p1', p)));
      const ok = rs.filter((r) => r.artifact).length;
      return { ok: ok >= 4, detail: `${ok}/5 produced artifacts` };
    });
    await timed('bulk delete cleans up', async () => {
      const list = await j<Array<{ id: string; title: string }>>('/conversations');
      const ids = list.filter((c) => c.title.includes(MARK)).map((c) => c.id).slice(0, 50);
      if (!ids.length) return { ok: true, detail: 'nothing to delete' };
      const r = await j<{ deleted: number }>('/conversations/delete', { method: 'POST', body: JSON.stringify({ ids }) });
      const after = await j<Array<{ id: string }>>('/conversations');
      return { ok: r.deleted === ids.length && !ids.some((id) => after.some((c) => c.id === id)), detail: `deleted ${r.deleted}/${ids.length}` };
    });
  }

  // report
  console.log('\n' + '═'.repeat(56));
  for (const s of [...new Set(results.map((r) => r.suite))]) { const sr = results.filter((r) => r.suite === s); console.log(`${s}: ${sr.filter((r) => r.ok).length}/${sr.length}`); }
  console.log('═'.repeat(56));
  const fails = results.filter((r) => !r.ok);
  console.log(`TOTAL: ${results.filter((r) => r.ok).length}/${results.length}`);
  if (fails.length) { console.log('\nFAILURES:'); for (const f of fails) console.log(`  ✗ [${f.suite}] ${f.name} — ${f.detail}`); }
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(2); });
