/**
 * Document reading tools for chat — the read half of the office skills.
 *
 * Upload-time extraction injects a capped text blob for files attached to the
 * CURRENT message. That is not enough to actually work with a deck: the blob is
 * truncated, it carries no slide addressing, and a file uploaded in an earlier
 * chat only ever surfaces as semantic recall fragments. read_document opens any
 * document in scope — this message's attachments or the project's knowledge —
 * and returns real structure: numbered slides with bullets, tables, chart
 * series and speaker notes.
 */
import path from 'node:path';
import { attachmentExtract, attachmentContent } from '../routes/uploads.js';
import { listKnowledge, knowledgeExtract } from '../memory/knowledge.js';
import type { OfficeExtract, Slide } from '../office/extract.js';
import { logTo } from '../log.js';

export interface DocRef {
  id: string;
  name: string;
  kind: 'image' | 'document';
}

const READ_CAP = 24_000;

/** Documents the model may open: this message's attachments, then project
 * knowledge (deduped by name — an attachment in a project is also indexed). */
interface ScopedDoc {
  source: 'attachment' | 'knowledge';
  id: string;
  name: string;
}

async function inScope(projectId: string, atts: DocRef[]): Promise<ScopedDoc[]> {
  const out: ScopedDoc[] = atts
    .filter((a) => a.kind === 'document')
    .map((a) => ({ source: 'attachment', id: a.id, name: a.name }));
  const seen = new Set(out.map((d) => d.name.toLowerCase()));
  try {
    for (const f of await listKnowledge(projectId)) {
      if (f.status !== 'ready' || seen.has(f.name.toLowerCase())) continue;
      out.push({ source: 'knowledge', id: f.id, name: f.name });
      seen.add(f.name.toLowerCase());
    }
  } catch (err) {
    logTo('app', `read_document: knowledge list unavailable: ${err instanceof Error ? err.message : err}`);
  }
  return out;
}

/** Loosest match that stays unambiguous: exact name, then case-insensitive,
 * then substring — the model rarely echoes a filename character-perfect. */
function pick<T extends { name: string }>(docs: T[], query: string): T | null {
  const q = query.trim().toLowerCase();
  const exact = docs.find((d) => d.name.toLowerCase() === q);
  if (exact) return exact;
  const base = docs.find((d) => d.name.toLowerCase().replace(path.extname(d.name).toLowerCase(), '') === q);
  if (base) return base;
  const partial = docs.filter((d) => d.name.toLowerCase().includes(q) || q.includes(d.name.toLowerCase()));
  return partial.length === 1 ? partial[0]! : null;
}

/** "2", "3-7", "" → the slide indices to render (1-based input, 0-based out). */
function parseRange(spec: string | undefined, total: number): number[] {
  const all = Array.from({ length: total }, (_, i) => i);
  if (!spec?.trim()) return all;
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(spec);
  if (!m) return all;
  const from = Math.max(1, Number(m[1]));
  const to = m[2] ? Number(m[2]) : from;
  return all.filter((i) => i + 1 >= from && i + 1 <= Math.min(to, total));
}

function renderSlide(i: number, s: Slide): string {
  const parts = [`## Slide ${i + 1}${s.title ? `: ${s.title}` : ''}`];
  parts.push(...s.bullets.map((b) => `- ${b}`));
  for (const tbl of s.tables ?? []) parts.push(...tbl.map((row) => row.join(' | ')));
  for (const ch of s.charts ?? []) {
    parts.push(`[${ch.type} chart] categories: ${ch.categories.join(', ')}`);
    for (const sr of ch.series) {
      parts.push(`  ${sr.name || 'series'}: ${sr.values.map((v) => (v === null ? '—' : String(v))).join(', ')}`);
    }
  }
  if (s.notes) parts.push(`Speaker notes: ${s.notes}`);
  return parts.join('\n');
}

function render(name: string, ex: OfficeExtract, range?: string): string {
  if (ex.slides) {
    const idx = parseRange(range, ex.slides.length);
    const head = `${name} — ${ex.slides.length} slide${ex.slides.length === 1 ? '' : 's'}${
      idx.length < ex.slides.length ? ` (showing ${idx.length})` : ''
    }`;
    const d = ex.design;
    // lead with look & feel so the model can discuss the deck's design
    const design = d
      ? `Visual design: ${d.aspect}, palette ${d.palette.slice(0, 4).join(' ')}, fonts ${d.fonts.slice(0, 3).join(', ') || 'theme default'}${d.images ? `, ${d.images} images` : ''}${d.charts ? `, ${d.charts} charts` : ''}`
      : '';
    return [head, design, ...idx.map((i) => renderSlide(i, ex.slides![i]!))]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, READ_CAP);
  }
  if (ex.sheets) {
    const head = `${name} — ${ex.sheets.length} sheet${ex.sheets.length === 1 ? '' : 's'}`;
    return [head, ...ex.sheets.map((sh) => `[${sh.name}]\n${sh.rows.map((r) => r.join(' | ')).join('\n')}`)]
      .join('\n\n')
      .slice(0, READ_CAP);
  }
  if (ex.blocks) {
    const parts = ex.blocks.map((b) => {
      if (b.rows) return b.rows.map((r) => r.join(' | ')).join('\n');
      return b.style.startsWith('Heading') || b.style === 'Title' ? `## ${b.text ?? ''}` : (b.text ?? '');
    });
    return `${name}\n\n${parts.join('\n')}`.slice(0, READ_CAP);
  }
  return `${name}\n\n${ex.text}`.slice(0, READ_CAP);
}

/** Parse an attached tabular file (csv/tsv, or an xlsx sheet) into rows. */
async function tabularRows(projectId: string, atts: DocRef[], name: string, sheet?: string): Promise<{ header: string[]; rows: string[][] } | string> {
  const docs = await inScope(projectId, atts);
  const hit = pick(docs, name);
  if (!hit) return `no document matches "${name}". Available:\n${docs.map((d) => d.name).join('\n')}`;
  const ext = path.extname(hit.name).toLowerCase();
  if (ext === '.csv' || ext === '.tsv') {
    const content = hit.source === 'attachment' ? await attachmentContent(hit.id) : null;
    if (!content || !content.ok) return `${hit.name} could not be read`;
    const sep = ext === '.tsv' ? '\t' : ',';
    const lines = content.text.split(/\r?\n/).filter((l) => l.trim());
    const cells = lines.map((l) => l.split(sep).map((c) => c.trim()));
    return { header: cells[0] ?? [], rows: cells.slice(1) };
  }
  const cached = hit.source === 'attachment' ? await attachmentExtract(hit.id) : null;
  const sheets = cached && cached.ok ? cached.extract.sheets : null;
  if (sheets?.length) {
    const ws = sheet ? sheets.find((s) => s.name.toLowerCase() === sheet.toLowerCase()) ?? sheets[0]! : sheets[0]!;
    return { header: ws.rows[0] ?? [], rows: ws.rows.slice(1) };
  }
  return `${hit.name} is not a tabular file (csv, tsv or xlsx)`;
}

/** Tool: deterministic table math — the model must never eyeball aggregates.
 * (Model-computed row counts measured 355 of 1200 on the audit fixture.) */
export async function analyzeTable(
  projectId: string,
  atts: DocRef[],
  name: string,
  operation: string,
  column?: string,
  sheet?: string,
): Promise<string> {
  const t = await tabularRows(projectId, atts, name, sheet);
  if (typeof t === 'string') return t;
  const { header, rows } = t;
  if (operation === 'shape') {
    return `${rows.length} data rows × ${header.length} columns. Columns: ${header.join(', ')}`;
  }
  if (!column) return 'a column name is required for this operation';
  const idx = header.findIndex((h) => h.toLowerCase() === column.toLowerCase());
  if (idx === -1) return `no column "${column}". Columns: ${header.join(', ')}`;
  const nums = rows.map((r) => Number(r[idx])).filter((v) => Number.isFinite(v));
  if (!nums.length) return `column "${column}" has no numeric values`;
  const sum = nums.reduce((a, b) => a + b, 0);
  const stats: Record<string, number> = {
    mean: sum / nums.length,
    sum,
    min: Math.min(...nums),
    max: Math.max(...nums),
    count: nums.length,
  };
  const val = stats[operation];
  if (val === undefined) return `unknown operation "${operation}" — use shape, mean, sum, min, max or count`;
  return `${operation}(${header[idx]}) = ${Math.round(val * 10000) / 10000} (over ${nums.length} numeric rows)`;
}

/** Tool: list what's readable. Cheap, and stops the model guessing filenames. */
export async function listDocuments(projectId: string, atts: DocRef[]): Promise<string> {
  const docs = await inScope(projectId, atts);
  if (!docs.length) return 'no documents are attached to this message or stored in this project';
  return docs.map((d) => `${d.name} (${d.source})`).join('\n');
}

/** Tool: open one document and return its structure. */
export async function readDocument(
  projectId: string,
  atts: DocRef[],
  name: string,
  range?: string,
): Promise<string> {
  const docs = await inScope(projectId, atts);
  if (!docs.length) return 'no documents are attached to this message or stored in this project';
  const hit = pick(docs, name);
  if (!hit) {
    return `no document matches "${name}". Available:\n${docs.map((d) => d.name).join('\n')}`;
  }
  try {
    if (hit.source === 'attachment') {
      const cached = await attachmentExtract(hit.id);
      if (cached) {
        if (!cached.ok) return `${hit.name} could not be read: ${cached.error}`;
        return render(hit.name, cached.extract, range);
      }
      // not an office kind — text/code/data files read verbatim. A "cannot be
      // read" here made the model distrust content that was in fact available.
      const content = await attachmentContent(hit.id);
      if (!content.ok) return `${hit.name} could not be read: ${content.error}`;
      return `${hit.name}\n\n${content.text}`.slice(0, READ_CAP);
    }
    const ex = await knowledgeExtract(projectId, hit.id);
    if (!ex) return `${hit.name} is no longer available`;
    return render(hit.name, ex, range);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logTo('app', `read_document failed for ${hit.name}: ${msg}`);
    return `${hit.name} could not be read: ${msg}`;
  }
}
