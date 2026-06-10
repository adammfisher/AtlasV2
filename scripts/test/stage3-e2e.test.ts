/**
 * Stage 3 end-to-end gates, against the real running server + real model:
 *  1. each of the nine skills produces a validated artifact end-to-end
 *  2. targeted edit leaves untouched sections byte-identical (extracted text)
 *  3. product lifecycle: define → promote endorsed → field edits → promote
 *     specified → all six local projections → bundle (merge assertion is
 *     server-side; this confirms untouched fields byte-identical via API)
 *  4. deterministic projections are idempotent at the extracted-text level
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../server/src/config.js';

const API = 'http://127.0.0.1:5175/api';
const PY = path.join(repoRoot, 'runtimes/python/venv/bin/python');

async function api<T>(p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${p}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${p} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

interface SseResult {
  steps: Array<{ state: string; label: string; detail?: string }>;
  artifact: { artifactId: string; name: string; kind: string; ver: number } | null;
  error: string | null;
  text: string;
}

async function send(convId: string, text: string): Promise<SseResult> {
  const res = await fetch(`${API}/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) throw new Error(`POST messages → ${res.status}`);
  const raw = await res.text();
  const result: SseResult = { steps: [], artifact: null, error: null, text: '' };
  let event = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
      if (event === 'step') result.steps.push(data as unknown as SseResult['steps'][number]);
      else if (event === 'artifact') result.artifact = data as unknown as SseResult['artifact'];
      else if (event === 'error') result.error = String(data.message ?? 'error');
      else if (event === 'token') result.text += String(data.delta ?? '');
    }
  }
  return result;
}

async function newConv(): Promise<string> {
  const conv = await api<{ id: string }>('/conversations', { method: 'POST', body: '{}' });
  return conv.id;
}

function extractText(file: string): string {
  return execFileSync(PY, ['-m', 'markitdown', file], { encoding: 'utf8', timeout: 120_000 });
}

function extractPptxSlides(file: string): string[] {
  const out = execFileSync(
    PY,
    [
      '-c',
      `import json,sys
from pptx import Presentation
texts=[]
for s in Presentation(sys.argv[1]).slides:
    texts.append("\\n".join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame))
print(json.dumps(texts))`,
      file,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(out) as string[];
}

function versionFile(artifactId: string, version: number): Promise<string> {
  return api<{ versions: Array<{ version: number }> }>(`/artifacts/${artifactId}`).then(() => {
    // file paths live server-side; resolve through the DB-free download? we need the path:
    // use sqlite directly for the gate (test-only)
    const out = execFileSync(
      'sqlite3',
      [
        `${process.env.HOME}/Library/Application Support/AtlasLocal/data/atlas.db`,
        `SELECT file_path FROM artifact_versions WHERE artifact_id='${artifactId}' AND version=${version}`,
      ],
      { encoding: 'utf8' },
    ).trim();
    return out;
  });
}

let green = 0;
function pass(label: string): void {
  green += 1;
  console.log(`  ✓ ${label}`);
}

async function main(): Promise<void> {
  const health = await api<{ llama: { status: string } }>('/health');
  assert.equal(health.llama.status, 'ready', 'llama must be ready');

  console.log('— gate 1: nine skills end-to-end');
  const NINE: Array<[string, string]> = [
    ['pptx', 'Build a five-slide deck summarizing the Atlas pilot results: 12 teams onboarded, 87% weekly active, 3 blockers'],
    ['docx', 'Write a one-page project kickoff memo for the data migration: goals, timeline, owners'],
    ['xlsx', 'Create a budget tracker spreadsheet: 5 expense categories, monthly plan vs actual with variance formulas'],
    ['pdf', 'Create a two-page onboarding checklist PDF for new analysts'],
    ['md', 'Write a README for the atlas-org-intel service: purpose, setup, API overview'],
    ['mermaid', 'Diagram the org-intel ingest flow: sources, embed, graph store, MCP tools'],
    ['svg', 'Create an icon of a compass, minimal line style'],
    ['react', 'Build a small counter widget with increment and reset buttons'],
    ['site', 'Static HTML landing page (plain HTML and CSS, no React) for Atlas: hero, three feature blocks, footer'],
  ];
  const artifacts: Record<string, { artifactId: string; ver: number; conv: string }> = {};
  for (const [skill, prompt] of NINE) {
    const conv = await newConv();
    const result = await send(conv, prompt);
    assert.equal(result.error, null, `${skill}: ${result.error}`);
    assert.ok(result.artifact, `${skill}: no artifact event`);
    assert.equal(result.artifact?.kind, skill, `${skill}: routed to ${result.artifact?.kind}`);
    const blockers = result.steps.filter((s) => s.state === 'warn' && !/skip/i.test(s.label));
    assert.equal(blockers.length, 0, `${skill}: warn steps ${JSON.stringify(blockers)}`);
    artifacts[skill] = { artifactId: result.artifact!.artifactId, ver: result.artifact!.ver, conv };
    pass(`${skill} → ${result.artifact?.name} v${result.artifact?.ver} (${result.steps.length} steps green)`);
  }

  console.log('— gate 2: targeted edit leaves untouched slides byte-identical (extracted text)');
  {
    const deck = artifacts.pptx!;
    const fileV1 = await versionFile(deck.artifactId, deck.ver);
    const slidesV1 = extractPptxSlides(fileV1);
    const edit = await send(deck.conv, 'Make the blockers slide punchier — lead with the number of blockers resolved.');
    assert.equal(edit.error, null, `edit error: ${edit.error}`);
    assert.ok(edit.artifact && edit.artifact.ver === deck.ver + 1, 'edit must bump version');
    const fileV2 = await versionFile(deck.artifactId, edit.artifact!.ver);
    const slidesV2 = extractPptxSlides(fileV2);
    assert.equal(slidesV1.length, slidesV2.length, 'slide count changed');
    const changed = slidesV1.flatMap((s, i) => (s !== slidesV2[i] ? [i] : []));
    assert.ok(changed.length >= 1, 'edit changed nothing');
    const untouchedIdentical = slidesV1.every((s, i) => changed.includes(i) || s === slidesV2[i]);
    assert.ok(untouchedIdentical, 'untouched slide text differs');
    pass(`targeted edit: slides ${JSON.stringify(changed)} changed, ${slidesV1.length - changed.length} untouched byte-identical`);
  }

  console.log('— gate 3: product lifecycle');
  {
    const conv = await newConv();
    const define = await send(conv, 'Define a product — auto loan payment calculator for the consumer lending LOB, payments domain. Problem: applicants abandon when they cannot estimate payments. Benefit hypothesis: we believe an instant calculator will lift application completion by 15% measured by funnel conversion.');
    assert.equal(define.error, null, `define error: ${define.error}`);
    assert.equal(define.artifact?.kind, 'product', `routed to ${define.artifact?.kind}`);
    const pid = define.artifact!.artifactId;
    const skipAmbers = define.steps.filter((s) => /Knowledge Core not connected/.test(s.label));
    assert.ok(skipAmbers.length >= 2, 'KC skip ambers missing');
    pass(`define → ${define.artifact?.name} with ${skipAmbers.length} KC skip-ambers`);

    await api(`/artifacts/${pid}/state`, { method: 'POST', body: JSON.stringify({ to: 'endorsed', note: 'gate test' }) });
    pass('promote → endorsed');

    const detailAfterDefine = await api<{ payload: Record<string, unknown> }>(`/artifacts/${pid}`);
    const before = detailAfterDefine.payload;

    const editCap = await send(conv, 'Add capabilities to the product: payment estimate calculator (S), rate lookup by credit tier (M), amortization schedule view (M)');
    assert.equal(editCap.error, null, `cap edit: ${editCap.error}`);
    const editAc = await send(conv, 'Add acceptance criteria: for payment estimate — given a loan amount, term and rate, when the user submits, then monthly payment displays within 1 second');
    assert.equal(editAc.error, null, `ac edit: ${editAc.error}`);
    const editKpi = await send(conv, 'Add KPIs: application completion rate target +15%, calculator engagement target 40% of applicants');
    assert.equal(editKpi.error, null, `kpi edit: ${editKpi.error}`);

    const after = (await api<{ payload: Record<string, unknown> }>(`/artifacts/${pid}`)).payload;
    const editedFields = new Set(['capabilities', 'acceptance_criteria', 'kpis']);
    for (const key of Object.keys(before)) {
      if (!editedFields.has(key)) {
        assert.equal(JSON.stringify(after[key]), JSON.stringify(before[key]), `untouched field ${key} changed`);
      }
    }
    pass('three field-scoped edits — all untouched fields byte-identical');

    await api(`/artifacts/${pid}/state`, { method: 'POST', body: JSON.stringify({ to: 'specified', note: 'gate test' }) });
    pass('promote → specified');

    for (const kind of ['concept_md', 'concept_docx', 'brd_docx', 'gate_pptx', 'context_mermaid'] as const) {
      await api(`/artifacts/${pid}/projections`, { method: 'POST', body: JSON.stringify({ kind }) });
    }
    pass('five deterministic projections generated');

    console.log('— gate 4: deterministic projection idempotence (extracted text)');
    const projections = await api<Array<{ id: string; kind: string; outputRef: string }>>(`/artifacts/${pid}/projections`);
    const docx1 = projections.find((p) => p.kind === 'concept_docx')!.outputRef;
    const text1 = extractText(docx1);
    const md1 = readFileSync(projections.find((p) => p.kind === 'concept_md')!.outputRef, 'utf8');
    await api(`/artifacts/${pid}/projections`, { method: 'POST', body: JSON.stringify({ kind: 'concept_docx' }) });
    await api(`/artifacts/${pid}/projections`, { method: 'POST', body: JSON.stringify({ kind: 'concept_md' }) });
    const projections2 = await api<Array<{ id: string; kind: string; outputRef: string }>>(`/artifacts/${pid}/projections`);
    const text2 = extractText(projections2.find((p) => p.kind === 'concept_docx')!.outputRef);
    const md2 = readFileSync(projections2.find((p) => p.kind === 'concept_md')!.outputRef, 'utf8');
    assert.equal(text1, text2, 'concept_docx extracted text differs between regenerations');
    assert.equal(md1, md2, 'concept_md differs between regenerations');
    pass('concept_docx + concept_md idempotent at extracted-text level');

    const bundleRes = await fetch(`${API}/artifacts/${pid}/bundle`);
    assert.ok(bundleRes.ok, `bundle export: ${bundleRes.status}`);
    const bytes = (await bundleRes.arrayBuffer()).byteLength;
    assert.ok(bytes > 1000, 'bundle too small');
    pass(`bundle exported (${Math.round(bytes / 1024)} KB zip)`);
  }

  console.log(`\nSTAGE3 E2E PASS — ${green} checks green`);
}

main().catch((err) => {
  console.error('\nSTAGE3 E2E FAIL');
  console.error(err);
  process.exitCode = 1;
});
