/**
 * C1–C4 office creation round-trips. Evidence standard: the produced file is
 * DOWNLOADED and opened with the real parser (python-pptx/docx/openpyxl/
 * pdfplumber via the bundled venv) — panel rendering alone is not proof.
 * Edit round-trip must bump the version and preserve the sentinel change.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composer, waitIdle, cleanupMarked, api, MARK } from './helpers';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PY = path.join(ROOT, 'runtimes/python/venv/bin/python');
const TMP = mkdtempSync(path.join(tmpdir(), 'parity-c-'));

interface ArtifactRow { id: string; kind: string; name: string; ver: number; created_at: number }

async function latestArtifact(kind: string, after: number): Promise<ArtifactRow> {
  const rows = await api<ArtifactRow[]>('/artifacts');
  const hit = rows.filter((a) => a.kind === kind && a.created_at > after).sort((a, b) => b.created_at - a.created_at)[0];
  expect(hit, `no ${kind} artifact created after t0`).toBeTruthy();
  return hit!;
}

async function download(id: string, ver: number, out: string): Promise<string> {
  const res = await fetch(`${process.env.ATLAS_BASE ?? 'http://127.0.0.1:5175'}/api/artifacts/${id}/versions/${ver}/download`);
  expect(res.ok, `download v${ver} → ${res.status}`).toBe(true);
  const file = path.join(TMP, out);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function py(code: string): string {
  return execFileSync(PY, ['-c', code], { encoding: 'utf8', timeout: 60_000 }).trim();
}

async function create(page: import('@playwright/test').Page, prompt: string): Promise<void> {
  await page.goto('/');
  await page.getByText('New chat', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await composer(page).fill(`${MARK} ${prompt}`);
  await composer(page).press('Enter');
  await waitIdle(page, 200_000);
}

async function edit(page: import('@playwright/test').Page, prompt: string): Promise<void> {
  await composer(page).fill(`${MARK} ${prompt}`);
  await composer(page).press('Enter');
  await waitIdle(page, 200_000);
}

test.describe('C1-C4 office creation', () => {
  test.afterAll(cleanupMarked);

  test('C1 pptx: create 6 slides → valid, no placeholders → edit slide 3 title → v2', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Create a 6-slide deck about migrating a monolith to services: drivers, risks, phased plan, costs, wins, next steps.');
    const art = await latestArtifact('pptx', t0);
    const v1 = await download(art.id, 1, 'c1-v1.pptx');
    const check = py(`
from pptx import Presentation
p = Presentation(${JSON.stringify(v1)})
texts = "\\n".join(sh.text_frame.text for s in p.slides for sh in s.shapes if getattr(sh, "has_text_frame", False))
bad = [t for t in ("{{", "TODO_", "lorem", "PLACEHOLDER") if t.lower() in texts.lower()]
print(len(list(p.slides)), "|", bad)
`);
    expect(check).toMatch(/^[5-8] \| \[\]$/); // 6±: slide count sane, zero placeholder text

    await edit(page, 'Change slide 3\'s title to exactly "AUDIT-EDIT-TITLE" and add a bar chart of costs 100, 80, 60 for years 1-3.');
    const v2row = await latestArtifact('pptx', t0);
    expect(v2row.ver, 'edit must bump version').toBeGreaterThanOrEqual(2);
    const v2 = await download(art.id, v2row.ver, 'c1-v2.pptx');
    const title = py(`
from pptx import Presentation
p = Presentation(${JSON.stringify(v2)})
print("AUDIT-EDIT-TITLE" in "\\n".join(sh.text_frame.text for s in p.slides for sh in s.shapes if getattr(sh, "has_text_frame", False)))
`);
    expect(title).toBe('True');
  });

  test('C2 docx: create → headings present → edit adds a section → v2', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Write a one-page memo announcing a new travel expense policy effective August 1, with sections for scope, limits, and approvals.');
    const art = await latestArtifact('docx', t0);
    const v1 = await download(art.id, 1, 'c2-v1.docx');
    const check = py(`
from docx import Document
d = Document(${JSON.stringify(v1)})
heads = [p.text for p in d.paragraphs if p.style and p.style.name.startswith("Heading")]
body = "\\n".join(p.text for p in d.paragraphs)
print(len(heads) >= 2, "|", "{{" not in body and "TODO_" not in body)
`);
    expect(check).toBe('True | True');

    await edit(page, 'Add a final section titled exactly "AUDIT-ADDENDUM" covering international travel.');
    const v2row = await latestArtifact('docx', t0);
    expect(v2row.ver).toBeGreaterThanOrEqual(2);
    const v2 = await download(art.id, v2row.ver, 'c2-v2.docx');
    expect(py(`
from docx import Document
print("AUDIT-ADDENDUM" in "\\n".join(p.text for p in Document(${JSON.stringify(v2)}).paragraphs))
`)).toBe('True');
  });

  test('C3 xlsx: create budget → WORKING formulas (not baked values) → edit → v2', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Build a budget tracker spreadsheet: 6 expense categories, columns for monthly plan, actual, and a variance formula per row, plus a totals row.');
    const art = await latestArtifact('xlsx', t0);
    const v1 = await download(art.id, 1, 'c3-v1.xlsx');
    const check = py(`
from openpyxl import load_workbook
wb = load_workbook(${JSON.stringify(v1)})
formulas = [c.value for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("=")]
print(len(formulas) >= 3, "|", sum("SUM" in f.upper() or "-" in f or "+" in f for f in formulas) >= 1)
`);
    expect(check, 'must contain real formulas, not baked numbers').toBe('True | True');

    await edit(page, 'Add a seventh category row named exactly "AUDIT-CATEGORY" with plan 500 and actual 450.');
    const v2row = await latestArtifact('xlsx', t0);
    expect(v2row.ver).toBeGreaterThanOrEqual(2);
    const v2 = await download(art.id, v2row.ver, 'c3-v2.xlsx');
    expect(py(`
from openpyxl import load_workbook
wb = load_workbook(${JSON.stringify(v2)})
print(any(c.value == "AUDIT-CATEGORY" for ws in wb.worksheets for row in ws.iter_rows() for c in row))
`)).toBe('True');
  });

  test('C4 pdf: create → pages+text verify → edit → v2', async ({ page }) => {
    const t0 = Date.now();
    await create(page, 'Generate a two-page onboarding checklist PDF for new engineers: accounts, tooling, first-week goals.');
    const art = await latestArtifact('pdf', t0);
    const v1 = await download(art.id, 1, 'c4-v1.pdf');
    const check = py(`
import pdfplumber
with pdfplumber.open(${JSON.stringify(v1)}) as pdf:
    text = "\\n".join(pg.extract_text() or "" for pg in pdf.pages)
    print(len(pdf.pages) >= 1, "|", len(text) > 200, "|", "{{" not in text)
`);
    expect(check).toBe('True | True | True');

    await edit(page, 'Add a section titled exactly "AUDIT-SECURITY-STEP" about enabling the password manager.');
    const v2row = await latestArtifact('pdf', t0);
    expect(v2row.ver).toBeGreaterThanOrEqual(2);
    const v2 = await download(art.id, v2row.ver, 'c4-v2.pdf');
    expect(py(`
import pdfplumber
with pdfplumber.open(${JSON.stringify(v2)}) as pdf:
    print("AUDIT-SECURITY-STEP" in "\\n".join(pg.extract_text() or "" for pg in pdf.pages))
`)).toBe('True');
  });
});
