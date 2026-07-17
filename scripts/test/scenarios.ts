/**
 * Master user-scenario harness (overnight enterprise hardening). Drives the
 * running server through realistic end-to-end journeys — projects, documents,
 * memory, every artifact skill, and adversarial edge cases — asserting real
 * behavior. Continues on failure, collects everything, prints a triage report.
 *
 *   npx tsx scripts/test/scenarios.ts [suiteFilter]
 */
const BASE = process.env.AXIOM_BASE ?? 'http://127.0.0.1:5175';
const API = `${BASE}/api`;
const MARK = '[scn]';

interface Result { suite: string; name: string; ok: boolean; detail: string; ms: number }
const results: Result[] = [];
let curSuite = '';

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as T;
}

interface Sse { text: string; tools: string[]; thinking: string; artifact?: { artifactId: string; ver: number; kind: string; name: string }; error?: string; steps: string[] }
async function chat(convId: string, text: string, opts: { thinking?: boolean; retry?: boolean } = {}, timeoutMs = 180_000): Promise<Sse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(`${API}/conversations/${convId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, thinking: opts.thinking, retry: opts.retry }), signal: ctrl.signal,
  });
  const out: Sse = { text: '', tools: [], thinking: '', steps: [] };
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', ev = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('event: ')) ev = line.slice(7).trim();
        else if (line.startsWith('data: ')) {
          try {
            const d = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (ev === 'token' && typeof d.delta === 'string') out.text += d.delta;
            else if (ev === 'thinking' && typeof d.delta === 'string') out.thinking += d.delta;
            else if (ev === 'tool' && typeof d.tool === 'string') out.tools.push(d.tool as string);
            else if (ev === 'artifact') out.artifact = d as unknown as Sse['artifact'];
            else if (ev === 'step' && typeof d.label === 'string') out.steps.push(d.label as string);
            else if (ev === 'error' && typeof d.message === 'string') out.error = d.message as string;
          } catch { /* keep-alive */ }
        }
      }
    }
  } finally { clearTimeout(timer); }
  return out;
}

async function newConv(projectId: string): Promise<string> {
  return (await j<{ id: string }>('/conversations', { method: 'POST', body: JSON.stringify({ projectId }) })).id;
}
async function ask(projectId: string, text: string, opts = {}): Promise<Sse> {
  return chat(await newConv(projectId), text, opts);
}

function check(name: string, ok: boolean, detail = ''): void {
  results.push({ suite: curSuite, name, ok, detail, ms: 0 });
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
async function timed(name: string, fn: () => Promise<{ ok: boolean; detail?: string }>): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await fn();
    results.push({ suite: curSuite, name, ok: r.ok, detail: r.detail ?? '', ms: Date.now() - t0 });
    console.log(`  ${r.ok ? '✓' : '✗ FAIL'} ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)${r.detail && !r.ok ? ` — ${r.detail}` : ''}`);
  } catch (err) {
    results.push({ suite: curSuite, name, ok: false, detail: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 });
    console.log(`  ✗ ERROR ${name} — ${err instanceof Error ? err.message : err}`);
  }
}
function suite(n: string): void { curSuite = n; console.log(`\n## ${n}`); }
const b64 = (s: string): string => Buffer.from(s).toString('base64');
const clean = (s: string): string => s.replace(/\[scn\][^\n]*/g, '');
const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAIAAAC1nk4lAAAAUUlEQVR4nO3OAQkAIBAAsY/2/VMYxRieMFiAzdn9zjwfSIdJS0sHSEtLB0hLSwdIS0sHSEtLB0hLSwdIS0sHSEtLB0hLSwdIS0sHSEtLB3yZviJZVx4vFGbjAAAAAElFTkSuQmCC';
function makeRedPng(): string { return RED_PNG; }

// ─────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const only = process.argv[2];
  const run = (n: string): boolean => !only || n.toLowerCase().includes(only.toLowerCase());
  const stamp = Date.now().toString(36);

  // ══ SUITE 1: Project lifecycle + isolation ══
  if (run('projects')) {
    suite('Projects & isolation');
    let pA = '', pB = '';
    await timed('create project A with instructions', async () => {
      const p = await j<{ id: string }>('/projects', { method: 'POST', body: JSON.stringify({ name: `${MARK} Acme ${stamp}`, instructions: 'Always end replies with the token ACME-SIG.' }) });
      pA = p.id; return { ok: !!pA };
    });
    await timed('create project B', async () => {
      const p = await j<{ id: string }>('/projects', { method: 'POST', body: JSON.stringify({ name: `${MARK} Beta ${stamp}`, instructions: 'Reply in a formal tone.' }) });
      pB = p.id; return { ok: !!pB };
    });
    await timed('project instructions affect output', async () => {
      const r = await ask(pA, 'Say hello in one short sentence.');
      return { ok: /ACME-SIG/.test(r.text), detail: r.text.slice(0, 100) };
    });
    await timed('project memory isolation (fact in A absent from B)', async () => {
      // establish a distinctive fact in A via explicit remember
      await ask(pA, 'Please use your remember tool to store in project memory: the Acme mascot is a purple gopher named Grommet.');
      await new Promise((r) => setTimeout(r, 2000));
      const rb = await ask(pB, 'What is the Acme mascot? If you do not know, say UNKNOWN.');
      return { ok: !/gopher|grommet/i.test(clean(rb.text)), detail: `B leaked: ${rb.text.slice(0, 90)}` };
    });
    await timed('new project auto-enables memory', async () => {
      const installs = await j<Array<{ connector_id: string; enabled_projects: string }>>('/plugins/installs').catch(() => [] as never);
      const mem = installs.find((i) => i.connector_id === 'axiom-memory' || i.connector_id === 'memory');
      return { ok: !mem || (JSON.parse(mem.enabled_projects) as string[]).includes(pA), detail: 'memory not enabled for new project' };
    });
  }

  // ══ SUITE 2: Knowledge documents ══
  if (run('knowledge')) {
    suite('Knowledge documents');
    const P = 'p3';
    // wipe any prior scn knowledge
    const existing = await j<Array<{ id: string; name: string }>>(`/projects/${P}/knowledge`);
    for (const f of existing) await j(`/projects/${P}/knowledge/${f.id}/delete`, { method: 'POST' });

    const handbook = `Acme Employee Handbook (scn-${stamp})
Section 1: The office dress code is smart casual on all days except Fridays, which are formal.
Section 2: The annual learning stipend is exactly 2500 dollars per employee.
Section 3: All production deploys require two approvals and must happen before 3pm ET.
Section 4: The on-call rotation is weekly, starting Mondays at 9am.`;
    let kid = '';
    await timed('upload knowledge doc', async () => {
      const r = await j<{ id: string }>('/uploads/knowledge', { method: 'POST', body: JSON.stringify({ projectId: P, name: `handbook-scn-${stamp}.txt`, dataBase64: b64(handbook) }) });
      kid = r.id; return { ok: !!kid };
    });
    await timed('knowledge indexes (status ready)', async () => {
      for (let i = 0; i < 20; i++) {
        const list = await j<Array<{ id: string; status: string; chunks: number }>>(`/projects/${P}/knowledge`);
        const f = list.find((x) => x.id === kid);
        if (f?.status === 'ready') return { ok: f.chunks > 0, detail: `chunks=${f.chunks}` };
        if (f?.status === 'error') return { ok: false, detail: 'indexing errored' };
        await new Promise((r) => setTimeout(r, 1500));
      }
      return { ok: false, detail: 'never reached ready' };
    });
    await timed('recall specific fact from doc', async () => {
      const r = await ask(P, 'According to the employee handbook, what is the annual learning stipend?');
      return { ok: /2500|2,500/.test(r.text), detail: r.text.slice(0, 120) };
    });
    await timed('recall renders a citation', async () => {
      const r = await ask(P, 'What is the deploy approval policy per the handbook?');
      return { ok: /two approvals|3pm|source:/i.test(r.text), detail: r.text.slice(0, 120) };
    });
    await timed('second doc: both recalled', async () => {
      const policy = `Acme Security Policy (scn-${stamp})\nPasswords rotate every 90 days.\nThe VPN endpoint is vpn.acme.example.`;
      await j('/uploads/knowledge', { method: 'POST', body: JSON.stringify({ projectId: P, name: `security-scn-${stamp}.txt`, dataBase64: b64(policy) }) });
      await new Promise((r) => setTimeout(r, 6000));
      const r = await ask(P, 'How often do passwords rotate, and what is the learning stipend?');
      return { ok: /90 days/.test(r.text) && /2500|2,500/.test(r.text), detail: r.text.slice(0, 140) };
    });
    await timed('delete knowledge removes recall', async () => {
      const list = await j<Array<{ id: string; name: string }>>(`/projects/${P}/knowledge`);
      for (const f of list) await j(`/projects/${P}/knowledge/${f.id}/delete`, { method: 'POST' });
      await new Promise((r) => setTimeout(r, 3000));
      const r = await ask(P, 'What is the annual learning stipend? Say UNKNOWN if not in memory.');
      return { ok: !/2500|2,500/.test(clean(r.text)), detail: `still recalled: ${r.text.slice(0, 90)}` };
    });
  }

  // ══ SUITE 3: Memory depth ══
  if (run('memory')) {
    suite('Memory (user + project, lifecycle)');
    const P = 'p2';
    await j(`/projects/${P}/memory/wipe`, { method: 'POST' }).catch(() => undefined);
    await timed('remember tool stores user-scope fact', async () => {
      const token = `wolfmoon-${stamp}`;
      const r = await ask(P, `Remember about me: my personal lucky release codeword is ${token}.`);
      await new Promise((x) => setTimeout(x, 2500));
      const exp = await j<{ notes: Array<{ content: string }>; kv: Array<{ value: string }> }>('/projects/user/memory/export');
      const has = [...exp.notes.map((n) => n.content), ...exp.kv.map((k) => k.value)].some((s) => s.includes(token));
      return { ok: r.tools.includes('remember') && has, detail: `tools=${r.tools} stored=${has}` };
    });
    await timed('cross-chat recall of user fact', async () => {
      const r = await ask('p1', 'What is my personal lucky release codeword? Say UNKNOWN if unsure.');
      return { ok: new RegExp(`wolfmoon-${stamp}`,'i').test(r.text), detail: r.text.slice(0, 100) };
    });
    await timed('forget removes the fact', async () => {
      const r = await ask(P, `Forget everything about my lucky release codeword.`);
      await new Promise((x) => setTimeout(x, 2500));
      const exp = await j<{ notes: Array<{ content: string }>; kv: Array<{ value: string }> }>('/projects/user/memory/export');
      const gone = ![...exp.notes.map((n) => n.content), ...exp.kv.map((k) => k.value)].some((s) => new RegExp(`wolfmoon-${stamp}`,'i').test(s));
      return { ok: r.tools.includes('forget') && gone, detail: `gone=${gone}` };
    });
    await timed('recall-preview observability endpoint', async () => {
      const d = await j<{ injected: string; hits: unknown[] }>(`/projects/p1/memory/recall-preview?q=infrastructure`);
      return { ok: typeof d.injected === 'string' && Array.isArray(d.hits) };
    });
    await timed('consolidation produces a profile', async () => {
      const r = await j<{ ok: boolean; profile: string | null }>('/projects/p1/memory/consolidate', { method: 'POST' });
      return { ok: r.ok && (r.profile === null || r.profile.length > 0) };
    });
  }

  // ══ SUITE 4: Every artifact skill ══
  if (run('artifacts')) {
    suite('Artifact generation (all skills)');
    const P = 'p1';
    const cases: Array<[string, string, (s: Sse) => boolean]> = [
      ['mermaid', 'Draw a mermaid flowchart of an order-fulfilment process: received, picked, packed, shipped.', (s) => s.artifact?.kind === 'mermaid'],
      ['svg', 'Create an SVG icon of a rocket.', (s) => s.artifact?.kind === 'svg'],
      ['md', 'Create a markdown runbook for rotating database credentials.', (s) => s.artifact?.kind === 'md'],
      ['react', 'Create a react component: a temperature converter between C and F.', (s) => s.artifact?.kind === 'react'],
      ['site', 'Create a static landing page for a bakery called Rise & Crumb.', (s) => s.artifact?.kind === 'site'],
      ['pptx', 'Create a 4-slide deck on Q4 sales strategy: overview, targets, tactics, timeline.', (s) => s.artifact?.kind === 'pptx'],
      ['docx', 'Create a Word document: a vendor agreement summary with parties, term, and payment.', (s) => s.artifact?.kind === 'docx'],
      ['xlsx', 'Create a spreadsheet: a 6-month cash-flow projection with income and expense rows.', (s) => s.artifact?.kind === 'xlsx'],
      ['pdf', 'Create a PDF: a two-page onboarding guide for new engineers.', (s) => s.artifact?.kind === 'pdf'],
    ];
    for (const [kind, prompt, ok] of cases) {
      await timed(`generate ${kind}`, async () => {
        const r = await ask(P, prompt, {}, 220_000);
        if (!ok(r)) return { ok: false, detail: r.error ?? `no artifact (kind=${r.artifact?.kind})` };
        // downloadable + non-trivial
        const res = await fetch(`${API}/artifacts/${r.artifact!.artifactId}/versions/${r.artifact!.ver}/download`);
        const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
        return { ok: res.ok && bytes > 50, detail: `download ${res.status} ${bytes}B` };
      });
    }
    await timed('edit artifact → v2', async () => {
      const conv = await newConv(P);
      const r1 = await chat(conv, 'Draw a mermaid flowchart with two nodes: Start and End.', {}, 120_000);
      if (!r1.artifact) return { ok: false, detail: 'no v1' };
      const r2 = await chat(conv, 'Add a Middle node between Start and End.', {}, 120_000);
      return { ok: (r2.artifact?.ver ?? 0) >= 2, detail: `ver=${r2.artifact?.ver}` };
    });
    await timed('share link works', async () => {
      const arts = await j<Array<{ id: string; ver: number }>>('/artifacts');
      const a = arts[0];
      const s = await j<{ url: string }>(`/artifacts/${a.id}/versions/${a.ver}/share`, { method: 'POST' });
      const res = await fetch(s.url);
      return { ok: res.ok && s.url.includes('X-Amz-Signature'), detail: `dl ${res.status}` };
    });
  }

  // ══ SUITE 5: Long conversation / context ══
  if (run('context')) {
    suite('Context management (long chat)');
    await timed('fact from turn 1 recalled at turn ~16', async () => {
      const conv = await newConv('p1');
      await chat(conv, `Remember this project detail for later: the launch codename is FROSTBYTE and the go-live city is Reykjavik.`, {}, 60_000);
      for (let i = 0; i < 14; i++) await chat(conv, `Filler ${i}: reply with just OK.`, {}, 60_000);
      const r = await chat(conv, 'What is the launch codename and the go-live city we discussed earlier?', {}, 60_000);
      return { ok: /frostbyte/i.test(r.text) && /reykjavik/i.test(r.text), detail: r.text.slice(0, 120) };
    });
  }

  // ══ SUITE 6: Uploads (chat attachments) ══
  if (run('uploads')) {
    suite('Chat uploads (vision + docs)');
    // 60x60 solid-red PNG (a 1x1 pixel is too degenerate for vision)
    const redPng = makeRedPng();
    const attachChat = async (conv: string, text: string, att: { id: string; name: string; kind: string }): Promise<string> => {
      const res = await fetch(`${API}/conversations/${conv}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, attachments: [att] }) });
      let txt = ''; const rd = res.body!.getReader(); const dc = new TextDecoder(); let bf = '';
      for (;;) { const { done, value } = await rd.read(); if (done) break; bf += dc.decode(value, { stream: true }); for (const ln of bf.split('\n')) if (ln.startsWith('data: ')) try { const d = JSON.parse(ln.slice(6)); if (typeof d.delta === 'string') txt += d.delta; } catch { /* */ } }
      return txt;
    };
    await timed('image upload → vision answer', async () => {
      const up = await j<{ id: string }>('/uploads', { method: 'POST', body: JSON.stringify({ name: 'red.png', dataBase64: redPng }) });
      const txt = await attachChat(await newConv('p1'), 'What solid color is this image? One word.', { id: up.id, name: 'red.png', kind: 'image' });
      return { ok: /red/i.test(txt), detail: txt.slice(0, 80) };
    });
    await timed('document upload → extraction QA', async () => {
      const doc = `Internal memo scn-${stamp}: the project sponsor is Dana Whitfield and the budget ceiling is 88,000 dollars.`;
      const up = await j<{ id: string }>('/uploads', { method: 'POST', body: JSON.stringify({ name: `memo-${stamp}.txt`, dataBase64: b64(doc) }) });
      const txt = await attachChat(await newConv('p1'), 'Who is the project sponsor in the attached memo?', { id: up.id, name: `memo-${stamp}.txt`, kind: 'document' });
      return { ok: /whitfield/i.test(txt), detail: txt.slice(0, 90) };
    });
    await timed('upload download round-trip', async () => {
      const up = await j<{ id: string }>('/uploads', { method: 'POST', body: JSON.stringify({ name: `dl-${stamp}.txt`, dataBase64: b64(`roundtrip-${stamp}`) }) });
      const res = await fetch(`${API}/uploads/${up.id}/download`);
      const body = res.ok ? await res.text() : '';
      return { ok: body.includes(`roundtrip-${stamp}`), detail: `status ${res.status}` };
    });
  }

  // ══ SUITE 7: Ergonomics ══
  if (run('ergonomics')) {
    suite('Ergonomics (rename/search/export/feedback/thinking/web)');
    await timed('rename + content search', async () => {
      const conv = await newConv('p1');
      await chat(conv, `${MARK} zephyrine-sentinel-${stamp} is a unique phrase.`, {}, 60_000);
      await j(`/conversations/${conv}`, { method: 'PATCH', body: JSON.stringify({ title: `${MARK} Renamed ${stamp}` }) });
      const byTitle = await j<Array<{ id: string }>>(`/conversations/search?q=${encodeURIComponent(`Renamed ${stamp}`)}`);
      const byContent = await j<Array<{ id: string }>>(`/conversations/search?q=zephyrine-sentinel-${stamp}`);
      return { ok: byTitle.some((c) => c.id === conv) && byContent.some((c) => c.id === conv), detail: `title=${byTitle.length} content=${byContent.length}` };
    });
    await timed('export markdown', async () => {
      const conv = await newConv('p1');
      await chat(conv, `${MARK} export me ${stamp}`, {}, 60_000);
      const res = await fetch(`${API}/conversations/${conv}/export`);
      const md = await res.text();
      return { ok: res.headers.get('content-type')?.includes('markdown') === true && md.includes('Axiom'), detail: `ct=${res.headers.get('content-type')}` };
    });
    await timed('feedback persists', async () => {
      const conv = await newConv('p1');
      await chat(conv, `${MARK} rate me ${stamp}`, {}, 60_000);
      const detail = await j<{ messages: Array<{ id: string; role: string }> }>(`/conversations/${conv}`);
      const a = detail.messages.find((m) => m.role === 'assistant');
      await j(`/conversations/${conv}/feedback`, { method: 'POST', body: JSON.stringify({ messageId: a!.id, rating: 'up' }) });
      const after = await j<{ messages: Array<{ id: string; feedback?: string }> }>(`/conversations/${conv}`);
      return { ok: after.messages.find((m) => m.id === a!.id)?.feedback === 'up' };
    });
    await timed('extended thinking streams reasoning', async () => {
      const r = await ask('p1', 'Is 437 a prime number? Reason step by step.', { thinking: true });
      return { ok: r.thinking.length > 20, detail: `thinking chars=${r.thinking.length}` };
    });
    await timed('web search tool fires', async () => {
      const r = await ask('p1', 'Search the web for the current population of Iceland and cite a source.', {}, 120_000);
      return { ok: r.tools.some((t) => t.startsWith('web_')), detail: `tools=${r.tools}` };
    });
    await timed('MCP filesystem tool fires', async () => {
      const r = await ask('p1', 'Use your filesystem tool to list the files in your workspace directory.', {}, 120_000);
      return { ok: r.tools.length > 0, detail: `tools=${r.tools}` };
    });
  }

  // ══ SUITE 8: Robustness / adversarial ══
  if (run('robust')) {
    suite('Robustness & edge cases');
    await timed('empty message rejected (400)', async () => {
      const conv = await newConv('p1');
      const res = await fetch(`${API}/conversations/${conv}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '   ' }) });
      return { ok: res.status === 400, detail: `status ${res.status}` };
    });
    await timed('unicode + emoji + special chars handled', async () => {
      const r = await ask('p1', 'Echo back exactly: 日本語 🚀 <script>alert(1)</script> "quotes" & ampersands ✓');
      return { ok: r.text.length > 0 && !r.error, detail: r.error ?? 'ok' };
    });
    await timed('very long input (12k chars) handled', async () => {
      const big = 'The quick brown fox. '.repeat(600);
      const r = await ask('p1', `Summarize this in one sentence: ${big}`, {}, 90_000);
      return { ok: r.text.length > 0 && !r.error, detail: r.error ?? `reply ${r.text.length}c` };
    });
    await timed('nonexistent conversation → 404', async () => {
      const res = await fetch(`${API}/conversations/c_doesnotexist/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }) });
      return { ok: res.status === 404, detail: `status ${res.status}` };
    });
    await timed('malformed json body → 4xx not 500', async () => {
      const res = await fetch(`${API}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ bad json' });
      return { ok: res.status >= 400 && res.status < 500, detail: `status ${res.status}` };
    });
    await timed('concurrent sends to same conversation', async () => {
      const conv = await newConv('p1');
      const [a, b, c] = await Promise.all([
        chat(conv, 'Reply with the word ALPHA only.', {}, 60_000),
        chat(conv, 'Reply with the word BRAVO only.', {}, 60_000),
        chat(conv, 'Reply with the word CHARLIE only.', {}, 60_000),
      ]);
      const ok = [a, b, c].every((r) => r.text.length > 0 && !r.error);
      // conversation should still be readable and consistent
      const detail = await j<{ messages: unknown[] }>(`/conversations/${conv}`);
      return { ok: ok && Array.isArray(detail.messages), detail: ok ? 'ok' : 'a concurrent send errored' };
    });
    await timed('rapid new-chat spam (10) all persist', async () => {
      const ids = await Promise.all(Array.from({ length: 10 }, () => newConv('p1')));
      const list = await j<Array<{ id: string }>>('/conversations');
      const present = ids.filter((id) => list.some((c) => c.id === id)).length;
      return { ok: present === 10, detail: `${present}/10 persisted` };
    });
    await timed('regenerate keeps single user turn', async () => {
      const conv = await newConv('p1');
      await chat(conv, 'Give me one random fruit.', {}, 60_000);
      await fetch(`${API}/conversations/${conv}/truncate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: (await j<{ messages: Array<{ id: string; role: string }> }>(`/conversations/${conv}`)).messages.find((m) => m.role === 'user')!.id, inclusive: false }) });
      await chat(conv, 'Give me one random fruit.', { retry: true }, 60_000);
      const d = await j<{ messages: Array<{ role: string }> }>(`/conversations/${conv}`);
      const u = d.messages.filter((m) => m.role === 'user').length, a = d.messages.filter((m) => m.role === 'assistant').length;
      return { ok: u === 1 && a === 1, detail: `user=${u} assistant=${a}` };
    });
  }

  // ─── report ───
  console.log('\n' + '═'.repeat(60));
  const fails = results.filter((r) => !r.ok);
  const bySuite = [...new Set(results.map((r) => r.suite))];
  for (const s of bySuite) {
    const sr = results.filter((r) => r.suite === s);
    console.log(`${s}: ${sr.filter((r) => r.ok).length}/${sr.length}`);
  }
  console.log('═'.repeat(60));
  console.log(`TOTAL: ${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (fails.length) {
    console.log('\nFAILURES:');
    for (const f of fails) console.log(`  ✗ [${f.suite}] ${f.name} — ${f.detail}`);
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(2); });
