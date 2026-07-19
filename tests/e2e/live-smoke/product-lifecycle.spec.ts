/**
 * Product (PRD) lifecycle — the surface a real product owner spends most of
 * their time in, and the one part of the artifact system with ZERO prior
 * coverage: `artifacts-product.spec.ts` proves create/edit/version but never
 * touches the state machine (proposed→endorsed→specified→built→operating,
 * server/src/pipeline/product.ts), its gating (`transitionRules`), or any of
 * the seven projection kinds (concept_md/docx, brd_docx, gate_pptx,
 * context_mermaid, prototype_react, bundle, confluence_page/jira_epics —
 * server/src/pipeline/projections.ts). All scoped to a dedicated project, as
 * a real PM would work, not the shared general project.
 *
 * Structural, not UI: like artifacts-product.spec.ts, the product master is a
 * JSON definition with deterministic projections, not a renderable file — so
 * this reads the API directly and shells real parsers (python-docx/pptx) at
 * the produced projection files, matching this repo's "evidence standard"
 * (download and open with the real tool, not just check panel rendering).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createConv, createProject, deleteProject, cleanupE2E, loginE2E, API, MARK } from '../../helpers/axiom-api.js';
import { sendAndWait, lastMessage } from '../../helpers/artifacts.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PY = path.join(ROOT, 'runtimes/python/venv/bin/python');
const TMP = mkdtempSync(path.join(tmpdir(), 'product-lifecycle-'));

function py(code: string): string {
  return execFileSync(PY, ['-c', code], { encoding: 'utf8', timeout: 60_000 }).trim();
}

interface Projection {
  id: string;
  kind: string;
  atVersion: number;
  status: string;
  stale: boolean;
  generated: boolean;
  outputRef: string | null;
  targetRef: string | null;
}
interface ProductDetail {
  id: string;
  projectId: string;
  kind: string;
  ver: number;
  state: string;
  timeline: Array<{ state: string; note: string; stamped_by: string; at_version: number }>;
  promote: { to: string; unmet: string[] } | null;
  projections: Projection[];
  payload: Record<string, unknown>;
}

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const token = await loginE2E();
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${pathname} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function detail(id: string): Promise<ProductDetail> {
  return api<ProductDetail>(`/artifacts/${id}`);
}

async function promote(id: string, to: string, note?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = await loginE2E();
  const res = await fetch(`${API}/artifacts/${id}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, note }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function project(id: string, kind: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = await loginE2E();
  const res = await fetch(`${API}/artifacts/${id}/projections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Download a binary from a raw artifact/projection endpoint (not JSON). */
async function downloadTo(urlPath: string, outName: string): Promise<string> {
  const token = await loginE2E();
  const res = await fetch(`${API}${urlPath}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok, `${urlPath} → ${res.status}`).toBe(true);
  const file = path.join(TMP, outName);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

test.describe.configure({ mode: 'serial' });
test.describe('product (PRD) lifecycle', () => {
  test.setTimeout(240_000);
  let projectId: string;
  let convId: string;
  let artifactId: string;

  test.afterAll(async () => {
    await cleanupE2E().catch(() => undefined);
    if (projectId) await deleteProject(projectId).catch(() => undefined);
  });

  test('setup: a dedicated project, as its owner', async () => {
    const proj = await createProject(`${MARK} PM Journey — Fraud Alerts`);
    projectId = proj.id;
    const conv = await createConv(projectId);
    convId = conv.id;
    expect(conv.projectId).toBe(projectId);
  });

  test('define product → artifact scoped to the project, starts at proposed', async () => {
    const res = await sendAndWait(
      convId,
      `${MARK} Define a product: real-time fraud alert push notifications for retail banking customers, payments domain. ` +
        'Just the initial framing — name, spine (lob/domain), problem, value proposition, and scope in/out. ' +
        'Do NOT include a benefit hypothesis, capabilities, acceptance criteria, or KPIs yet — those come later.',
      { timeoutMs: 200_000 },
    );
    expect(res.error, `create errored: ${res.error}`).toBeUndefined();
    expect(res.artifact?.kind).toBe('product');
    artifactId = res.artifact!.artifactId;

    const d = await detail(artifactId);
    expect(d.projectId, 'product artifact must carry the owning project, not p_general').toBe(projectId);
    expect(d.state).toBe('proposed');
    expect(d.promote?.to).toBe('endorsed');
  });

  test('promotion is BLOCKED before its gate is met (proposed → endorsed needs benefit_hypothesis)', async () => {
    const r = await promote(artifactId, 'endorsed');
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('benefit_hypothesis');
    // state must not have moved
    expect((await detail(artifactId)).state).toBe('proposed');
  });

  test('a same-state or skip-ahead transition is rejected (forward-one-step only)', async () => {
    const same = await promote(artifactId, 'proposed');
    expect(same.status).toBe(400);
    const skip = await promote(artifactId, 'specified');
    expect(skip.status).toBe(400);
  });

  test('edit adds benefit_hypothesis → gate clears → promotes to endorsed', async () => {
    const res = await sendAndWait(
      convId,
      `${MARK} Update the product: set the benefit hypothesis to "if customers get fraud alerts within 60 seconds, chargeback disputes will drop by 20%".`,
      { timeoutMs: 200_000 },
    );
    expect(res.error).toBeUndefined();
    const payload = (await detail(artifactId)).payload;
    expect(String(payload.benefit_hypothesis ?? '').length).toBeGreaterThan(0);

    const r = await promote(artifactId, 'endorsed');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await detail(artifactId)).state).toBe('endorsed');
  });

  test('endorsed → specified is blocked until capabilities + acceptance_criteria + kpis all exist', async () => {
    const r = await promote(artifactId, 'specified');
    expect(r.status).toBe(400);
    const missing = String(r.body.error);
    expect(missing).toMatch(/capabilities|acceptance_criteria|kpis/);
  });

  test('edit adds capabilities/acceptance-criteria/KPIs → promotes to specified', async () => {
    const res = await sendAndWait(
      convId,
      `${MARK} Update the product: add one capability "instant-push-alert" (value: reduces fraud losses), one acceptance criterion for it (given a suspicious transaction, when it posts, then a push alert fires within 60 seconds), and one KPI named "alert latency p95" with target "<60s".`,
      { timeoutMs: 200_000 },
    );
    expect(res.error).toBeUndefined();
    const payload = (await detail(artifactId)).payload;
    expect((payload.capabilities as unknown[] | undefined)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect((payload.acceptance_criteria as unknown[] | undefined)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect((payload.kpis as unknown[] | undefined)?.length ?? 0).toBeGreaterThanOrEqual(1);

    const r = await promote(artifactId, 'specified');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await detail(artifactId)).state).toBe('specified');
  });

  test('specified → built is blocked until BOTH a bundle projection exists AND a decision/as-built fact is recorded', async () => {
    const r = await promote(artifactId, 'built');
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/bundle|decisions|as_built/);
  });

  test('local projections: concept_md, concept_docx, brd_docx, gate_pptx, context_mermaid — real files with real content', async () => {
    for (const kind of ['concept_md', 'concept_docx', 'brd_docx', 'gate_pptx', 'context_mermaid']) {
      const r = await project(artifactId, kind);
      expect(r.status, `${kind}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.kind).toBe(kind);
    }
    const rows = (await detail(artifactId)).projections;
    for (const kind of ['concept_md', 'concept_docx', 'brd_docx', 'gate_pptx', 'context_mermaid']) {
      const row = rows.find((p) => p.kind === kind);
      expect(row, `${kind} projection row missing`).toBeTruthy();
      expect(row!.generated, `${kind} is a deterministic transform, not model-generated`).toBe(false);
      expect(row!.status).toBe('local');
    }

    const md = rows.find((p) => p.kind === 'concept_md')!;
    const mdFile = await downloadTo(`/artifacts/${artifactId}/projections/${md.id}/download`, 'concept.md');
    const mdText = py(`print(open(${JSON.stringify(mdFile)}).read())`);
    expect(mdText).toContain('Fraud Alert');
    expect(mdText).toContain('## Problem');

    const gate = rows.find((p) => p.kind === 'gate_pptx')!;
    const pptxFile = await downloadTo(`/artifacts/${artifactId}/projections/${gate.id}/download`, 'gate.pptx');
    const slideCount = py(`
from pptx import Presentation
p = Presentation(${JSON.stringify(pptxFile)})
print(len(p.slides))
`);
    expect(Number(slideCount)).toBeGreaterThanOrEqual(4);

    const brd = rows.find((p) => p.kind === 'brd_docx')!;
    const docxFile = await downloadTo(`/artifacts/${artifactId}/projections/${brd.id}/download`, 'brd.docx');
    const docxText = py(`
from docx import Document
d = Document(${JSON.stringify(docxFile)})
paras = [p.text for p in d.paragraphs]
cells = [c.text for t in d.tables for row in t.rows for c in row.cells]
print("\\n".join(paras + cells))
`);
    expect(docxText).toMatch(/instant-push-alert/i);

    const mermaid = rows.find((p) => p.kind === 'context_mermaid')!;
    const mmdFile = await downloadTo(`/artifacts/${artifactId}/projections/${mermaid.id}/download`, 'context.mmd');
    const mmdText = py(`print(open(${JSON.stringify(mmdFile)}).read())`);
    expect(mmdText).toContain('flowchart TD');
  });

  test('prototype_react — the model-assisted projection: a real clickable prototype derived FROM the PRD', async () => {
    const r = await project(artifactId, 'prototype_react');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = (await detail(artifactId)).projections.find((p) => p.kind === 'prototype_react');
    expect(row, 'prototype_react projection row missing').toBeTruthy();
    expect(row!.generated, 'prototype_react is the one model-assisted projection').toBe(true);
    expect(row!.outputRef, 'multi-file react app must have an output directory').toBeTruthy();
  });

  test('push projections degrade gracefully to local-only when no Confluence/Jira connector is present', async () => {
    for (const kind of ['confluence_page', 'jira_epics']) {
      const token = await loginE2E();
      const res = await fetch(`${API}/artifacts/${artifactId}/projections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind }),
      });
      expect(res.ok, `${kind} request itself must succeed even when nothing is connected`).toBe(true);
      const body = (await res.json()) as { status: string; note?: string };
      expect(body.status, `${kind} without a connector must stay local, not silently pretend to push`).toBe('local');
      expect(body.note ?? '').toMatch(/connect/i);
    }
  });

  test('bundle export satisfies the built gate\'s bundle requirement, and is a real zip with the structure a build agent needs', async () => {
    const zipFile = await downloadTo(`/artifacts/${artifactId}/bundle`, 'bundle.zip');
    const listing = py(`
import zipfile
z = zipfile.ZipFile(${JSON.stringify(zipFile)})
names = z.namelist()
print("\\n".join(names))
`);
    expect(listing).toMatch(/definition\.json$/m);
    expect(listing).toMatch(/acceptance\/criteria\.md$/m);
    expect(listing).toMatch(/acceptance\/criteria\.json$/m);
    expect(listing).toMatch(/context\/decisions\.md$/m);
    expect(listing).toMatch(/CLAUDE\.md$/m);

    const rows = (await detail(artifactId)).projections;
    expect(rows.some((p) => p.kind === 'bundle'), 'bundle projection row recorded').toBe(true);
  });

  test('a decision logged against the PRD satisfies the OTHER built-gate condition, and promotion now succeeds', async () => {
    // the bundle gate cleared above; this clears the decisions/as_built gate —
    // both conditions must hold simultaneously for the built promotion below
    const res = await sendAndWait(
      convId,
      `${MARK} Log a decision on the product: title "push provider", chose FCM over APNs-only because it covers both platforms.`,
      { timeoutMs: 200_000 },
    );
    expect(res.error).toBeUndefined();
    const payload = (await detail(artifactId)).payload;
    expect((payload.decisions as unknown[] | undefined)?.length ?? 0).toBeGreaterThanOrEqual(1);

    const r = await promote(artifactId, 'built');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await detail(artifactId)).state).toBe('built');
  });

  test('operating requires a manual stamp note, and is refused without one', async () => {
    const noNote = await promote(artifactId, 'operating');
    expect(noNote.status).toBe(400);
    expect((await detail(artifactId)).state).toBe('built');

    const withNote = await promote(artifactId, 'operating', 'Shipped to 100% of retail banking customers 2026-07-19.');
    expect(withNote.status, JSON.stringify(withNote.body)).toBe(200);
    expect((await detail(artifactId)).state).toBe('operating');
  });

  test('the full timeline is recorded in order (proposed has no explicit stamp — the default start state)', async () => {
    const d = await detail(artifactId);
    expect(d.timeline.map((t) => t.state)).toEqual(['endorsed', 'specified', 'built', 'operating']);
    for (const t of d.timeline) expect(t.stamped_by, 'every stamp records who').toBeTruthy();
  });

  test('editing the PRD after projections exist marks them stale', async () => {
    const before = (await detail(artifactId)).ver;
    const res = await sendAndWait(
      convId,
      `${MARK} Update the product: add scope_out item "SMS fallback channel (phase 2)".`,
      { timeoutMs: 200_000 },
    );
    expect(res.error).toBeUndefined();
    const d = await detail(artifactId);
    expect(d.ver).toBeGreaterThan(before);
    const concept = d.projections.find((p) => p.kind === 'concept_md');
    expect(concept?.stale, 'a projection generated at an earlier version must read as stale').toBe(true);
    // last message must be the edit, not a chatty description (edit-vs-describe zero tolerance)
    const last = await lastMessage(convId);
    expect(last?.kind).toBe('pipeline');
  });
});
