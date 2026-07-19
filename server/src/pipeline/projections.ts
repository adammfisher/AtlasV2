import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config, repoRoot } from '../config.js';
import { newId, now } from '../db/db.js';
import { listProjectionsFor, putProjection } from '../db/appdb.js';
import { completeJson } from '../llama/json.js';
import { officeMaxTokens } from '../providers/bedrock.js';
import { loadSkill } from './skills.js';
import { validateJson } from './validate.js';
import { latestPayload, writeVersionFiles } from './artifacts.js';

const execFileAsync = promisify(execFile);

export const LOCAL_KINDS = [
  'concept_md',
  'concept_docx',
  'brd_docx',
  'gate_pptx',
  'context_mermaid',
  'prototype_react',
] as const;
export type LocalKind = (typeof LOCAL_KINDS)[number];
export type ProjectionKind = LocalKind | 'bundle' | 'confluence_page' | 'jira_epics';

type Payload = Record<string, unknown>;

const arr = (p: Payload, k: string): Array<Record<string, unknown>> =>
  Array.isArray(p[k]) ? (p[k] as Array<Record<string, unknown>>) : [];
const str = (p: Payload, k: string): string => (typeof p[k] === 'string' ? (p[k] as string) : '');

/* ---------- deterministic transforms (A6): master payload → skill payloads ---------- */

export function toConceptMd(p: Payload): string {
  const spine = (p.spine ?? {}) as Payload;
  const lines: string[] = [
    `# ${str(p, 'name')}`,
    '',
    `**Spine:** ${str(spine, 'lob')} / ${str(spine, 'domain')}${str(spine, 'capability_code') ? ` · ${str(spine, 'capability_code')} ${str(spine, 'capability_name')}` : ''}`,
    str(p, 'swag') ? `**SWAG:** ${str(p, 'swag')}` : '',
    '',
    '## Problem',
    str(p, 'problem'),
    '',
    '## Value proposition',
    str(p, 'value_prop'),
    '',
    '## Scope',
    '### In',
    ...arr(p, 'scope_in').map((s) => `- ${String(s)}`),
    '### Out',
    ...arr(p, 'scope_out').map((s) => `- ${String(s)}`),
  ];
  if (str(p, 'benefit_hypothesis')) {
    lines.push('', '## Benefit hypothesis', str(p, 'benefit_hypothesis'));
  }
  const kpis = arr(p, 'kpis');
  if (kpis.length > 0) {
    lines.push('', '## KPIs', '| KPI | Target | Measure |', '| --- | --- | --- |');
    for (const k of kpis) {
      lines.push(`| ${String(k.name ?? '')} | ${String(k.target ?? '')} | ${String(k.measure ?? '')} |`);
    }
  }
  const refs = arr(p, 'strategy_refs');
  if (refs.length > 0) lines.push('', '## Strategy references', ...refs.map((r) => `- ${String(r)}`));
  return lines.filter((l) => l !== undefined).join('\n');
}

// docx skill payloads are a FLAT array of typed blocks (skills/docx/schema.json
// — heading/paragraph/table/…), not nested sections. These transforms target
// that schema directly; earlier versions emitted a `sections` shape the real
// build_docx.py has never accepted (caught by product-lifecycle.spec.ts).
function heading(text: string): Record<string, unknown> {
  return { kind: 'heading', level: 1, text };
}
function paragraph(text: string): Record<string, unknown> | null {
  return text ? { kind: 'paragraph', text } : null;
}
function table(headers: string[], rows: string[][]): Record<string, unknown> {
  return { kind: 'table', headers, rows };
}

function conceptBlocks(p: Payload): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    heading('Problem'),
    paragraph(str(p, 'problem')),
    heading('Value proposition'),
    paragraph(str(p, 'value_prop')),
    heading('Scope'),
    table(['In scope', 'Out of scope'], zipColumns(arr(p, 'scope_in').map(String), arr(p, 'scope_out').map(String))),
  ].filter((b): b is Record<string, unknown> => b !== null);
  if (str(p, 'benefit_hypothesis')) {
    blocks.push(heading('Benefit hypothesis'), paragraph(str(p, 'benefit_hypothesis'))!);
  }
  const kpis = arr(p, 'kpis');
  if (kpis.length > 0) {
    blocks.push(
      heading('KPIs'),
      table(
        ['KPI', 'Target', 'Measure'],
        kpis.map((k) => [String(k.name ?? ''), String(k.target ?? ''), String(k.measure ?? '')]),
      ),
    );
  }
  return blocks;
}

function zipColumns(a: string[], b: string[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < Math.max(a.length, b.length, 1); i++) rows.push([a[i] ?? '', b[i] ?? '']);
  return rows;
}

export function toConceptDocx(p: Payload): Payload {
  return {
    metadata: { title: `${str(p, 'name')} — Concept`, author: 'Axiom projection engine' },
    blocks: conceptBlocks(p),
  };
}

export function toBrdDocx(p: Payload): Payload {
  const blocks = conceptBlocks(p);
  const useCases = arr(p, 'use_cases');
  if (useCases.length > 0) {
    blocks.push(
      heading('Use cases'),
      table(
        ['Title', 'Actor', 'Flow'],
        useCases.map((u) => [String(u.title ?? ''), String(u.actor ?? ''), String(u.flow ?? '')]),
      ),
    );
  }
  const capabilities = arr(p, 'capabilities');
  if (capabilities.length > 0) {
    blocks.push(
      heading('Capabilities'),
      table(
        ['Capability', 'Value', 'SWAG'],
        capabilities.map((c) => [String(c.name ?? ''), String(c.value ?? ''), String(c.swag ?? '')]),
      ),
    );
  }
  const ac = arr(p, 'acceptance_criteria');
  if (ac.length > 0) {
    blocks.push(
      heading('Acceptance criteria'),
      table(
        ['Capability', 'Given', 'When', 'Then'],
        ac.map((c) => [String(c.capability ?? ''), String(c.given ?? ''), String(c.when ?? ''), String(c.then ?? '')]),
      ),
    );
  }
  const deps = arr(p, 'dependencies');
  if (deps.length > 0) {
    blocks.push(
      heading('Dependencies'),
      table(['System', 'Nature'], deps.map((d) => [String(d.system ?? ''), String(d.nature ?? '')])),
    );
  }
  const risks = arr(p, 'risks');
  if (risks.length > 0) {
    blocks.push(
      heading('Risks'),
      table(['Risk', 'Mitigation'], risks.map((r) => [String(r.desc ?? ''), String(r.mitigation ?? '')])),
    );
  }
  return {
    metadata: { title: `${str(p, 'name')} — BRD`, author: 'Axiom projection engine' },
    blocks,
  };
}

// pptx skill payloads (skills/pptx/schema.json + scripts/office/validate_common.py
// _content_audit — word-count doctrine a JSON schema can't express): every
// slide requires archetype + title + speaker_notes; any single bullet/column
// item over 12 words is rejected outright; a "content" archetype's title +
// subtitle + bullets/columns/steps must total ≤40 words. Earlier versions
// targeted a shape (col_left/col_right, unbounded bullet text) the real
// build_pptx.py has never accepted (caught by product-lifecycle.spec.ts) —
// this targets both the schema AND the word-budget doctrine directly, with a
// dynamic per-slide fit rather than a guessed fixed item count.
const CONTENT_SLIDE_WORD_BUDGET = 40;
const PER_ITEM_WORD_MAX = 12;
function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}
function wordCount(s: string): number {
  return words(s).length;
}
/** Bullets/columns/titles are dual-constrained: ≤maxWords words (the Python
 * word-count doctrine) AND ≤maxChars characters (the JSON schema's own
 * maxLength) — a 12-word clip can still overflow 90 chars on long words. */
function clipWords(s: string, maxWords: number, maxChars = 90): string {
  const ws = words(s);
  let out = ws.length > maxWords ? ws.slice(0, maxWords).join(' ') : s;
  let cut = ws.length > maxWords;
  if (out.length > maxChars - 1) {
    out = out.slice(0, maxChars - 1);
    cut = true;
  }
  return cut ? `${out}…` : out;
}
/** Greedily keeps items until the running word budget would be exceeded —
 * never returns empty (bullets/column-items both require ≥1). */
function fitToWordBudget(items: string[], budget: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const raw of items) {
    const clipped = clipWords(raw, PER_ITEM_WORD_MAX);
    const w = wordCount(clipped);
    if (out.length > 0 && used + w > budget) break;
    out.push(clipped);
    used += w;
  }
  return out;
}
function bulletsSlide(title: string, notes: string, items: string[]): Record<string, unknown> {
  const t = clipWords(title, PER_ITEM_WORD_MAX);
  const bullets = fitToWordBudget(items.length > 0 ? items : ['(none specified)'], CONTENT_SLIDE_WORD_BUDGET - wordCount(t));
  return { archetype: 'content_bullets', title: t, speaker_notes: clipWords(notes, 200, 600), bullets };
}

export function toGatePptx(p: Payload, state: string, ambers: string[]): Payload {
  const slides: Array<Record<string, unknown>> = [
    {
      // 'title' isn't a word-budgeted archetype, but keep it short regardless
      archetype: 'title',
      title: clipWords(str(p, 'name'), PER_ITEM_WORD_MAX),
      subtitle: clipWords(`Gate review · state: ${state}`, PER_ITEM_WORD_MAX),
      speaker_notes: `Gate review for ${str(p, 'name')}, currently in the ${state} state.`,
    },
    bulletsSlide('Problem & value', 'What problem this solves and why it matters.', [str(p, 'problem'), str(p, 'value_prop')].filter(Boolean)),
  ];
  const scopeIn = arr(p, 'scope_in').map(String);
  const scopeOut = arr(p, 'scope_out').map(String);
  {
    const title = 'Scope';
    const heads = ['In scope', 'Out of scope'];
    const fixedWords = wordCount(title) + heads.reduce((n, h) => n + wordCount(h), 0);
    const perColBudget = Math.floor((CONTENT_SLIDE_WORD_BUDGET - fixedWords) / 2);
    slides.push({
      archetype: 'comparison',
      title,
      speaker_notes: 'What is explicitly in and out of scope for this product.',
      columns: [
        { head: heads[0], items: fitToWordBudget(scopeIn.length > 0 ? scopeIn : ['(none specified)'], perColBudget) },
        { head: heads[1], items: fitToWordBudget(scopeOut.length > 0 ? scopeOut : ['(none specified)'], perColBudget) },
      ],
    });
  }
  const capabilities = arr(p, 'capabilities');
  if (capabilities.length > 0) {
    slides.push(
      bulletsSlide(
        'Capabilities',
        'Core capabilities this product delivers.',
        capabilities.map((c) => `${String(c.name ?? '')} — ${String(c.swag ?? '?')}`),
      ),
    );
  }
  const kpis = arr(p, 'kpis');
  if (kpis.length > 0) {
    slides.push(
      bulletsSlide(
        'KPIs',
        'How success is measured.',
        kpis.map((k) => `${String(k.name ?? '')}: ${String(k.target ?? '')}`),
      ),
    );
  }
  const risks = arr(p, 'risks');
  if (risks.length > 0) {
    slides.push(bulletsSlide('Risks', 'Known risks going into this gate.', risks.map((r) => String(r.desc ?? ''))));
  }
  slides.push(
    bulletsSlide(
      'State & checks',
      'Current gate state and any outstanding warnings.',
      [`Current state: ${state}`, ...(ambers.length > 0 ? ambers.slice(0, 4) : ['All checks green'])],
    ),
  );
  return { title: `${str(p, 'name')} — Gate review`.slice(0, 90), slides };
}

export function toContextMermaid(p: Payload): string {
  const spine = (p.spine ?? {}) as Payload;
  const lines = [
    'flowchart TD',
    `  P["${str(p, 'name').replace(/"/g, "'")}"]`,
    `  LOB["LOB: ${str(spine, 'lob').replace(/"/g, "'")}"]`,
    `  DOM["Domain: ${str(spine, 'domain').replace(/"/g, "'")}"]`,
    '  LOB --> DOM',
    '  DOM --> P',
  ];
  arr(p, 'dependencies').forEach((d, i) => {
    lines.push(`  D${i}["${String(d.system ?? '').replace(/"/g, "'")}"]`);
    lines.push(`  P -->|${String(d.nature ?? 'depends').replace(/[|"]/g, ' ')}| D${i}`);
  });
  return lines.join('\n');
}

/* ---------- engine ---------- */

export interface ProjectionResult {
  id: string;
  kind: ProjectionKind;
  atVersion: number;
  outputRef: string;
  generated: boolean;
}

function projectionDir(projectId: string, artifactId: string, kind: string, version: number): string {
  const dir = path.join(config.dataDir, 'artifacts', projectId, artifactId, 'projections', `${kind}-v${version}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function runHelperFor(kind: 'docx' | 'pptx', payload: unknown, outFile: string): Promise<void> {
  const tmpFile = path.join(path.dirname(outFile), `payload-${kind}.json`);
  writeFileSync(tmpFile, JSON.stringify(payload));
  const { templatePath } = await import('./skills.js');
  const template = templatePath(kind) ?? path.join(repoRoot,
    kind === 'docx' ? 'skills/docx/templates/axiom_default.dotx' : 'skills/pptx/templates/axiom_default.potx');
  const { stdout } = await execFileAsync(
    path.join(repoRoot, 'runtimes/python/venv/bin/python'),
    [
      path.join(repoRoot, `scripts/office/build_${kind}.py`),
      '--payload', tmpFile,
      '--out', outFile,
      '--template', template,
    ],
    { cwd: repoRoot, timeout: 180_000 },
  );
  const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { ok?: boolean };
  if (!parsed.ok) throw new Error(`projection helper build_${kind} reported failure`);
}

export async function generateProjection(
  projectId: string,
  artifactId: string,
  artifactName: string,
  kind: LocalKind | 'bundle',
  state: string,
  signal?: AbortSignal,
): Promise<ProjectionResult> {
  const current = await latestPayload(artifactId);
  if (!current) throw new Error('product has no payload to project');
  const payload = current.payload as Payload;
  const dir = projectionDir(projectId, artifactId, kind, current.version);
  const base = artifactName.replace(/\.product\.json$/, '');
  let outputRef: string;
  let generated = false;

  switch (kind) {
    case 'concept_md': {
      outputRef = path.join(dir, `${base}-concept.md`);
      writeFileSync(outputRef, toConceptMd(payload));
      break;
    }
    case 'concept_docx': {
      outputRef = path.join(dir, `${base}-concept.docx`);
      await runHelperFor('docx', toConceptDocx(payload), outputRef);
      break;
    }
    case 'brd_docx': {
      outputRef = path.join(dir, `${base}-brd.docx`);
      await runHelperFor('docx', toBrdDocx(payload), outputRef);
      break;
    }
    case 'gate_pptx': {
      outputRef = path.join(dir, `${base}-gate.pptx`);
      await runHelperFor('pptx', toGatePptx(payload, state, []), outputRef);
      break;
    }
    case 'context_mermaid': {
      outputRef = path.join(dir, `${base}-context.mmd`);
      writeFileSync(outputRef, toContextMermaid(payload));
      break;
    }
    case 'prototype_react': {
      // the one model-assisted projection (labeled `generated` in the UI)
      generated = true;
      const skill = loadSkill('react');
      const raw = await completeJson(
        [
          {
            role: 'system',
            content: `${skill.guidance}\n\nYou are generating a clickable prototype FROM a product definition. Build the primary use case as a working UI.`,
          },
          { role: 'user', content: `Product definition: ${JSON.stringify(payload)}` },
        ],
        skill.schema as Record<string, unknown>,
        // a real multi-file react app runs far past a token count this small
        // (measured ~18k output tokens elsewhere in this pipeline) — the same
        // office budget every other real-document generation call site uses
        { maxTokens: officeMaxTokens(), signal },
      );
      const result = validateJson('react', skill.schema as Record<string, unknown>, raw);
      if (!result.ok) throw new Error(`prototype generation failed validation: ${result.error}`);
      const files = ((result.value as Payload).files ?? {}) as Record<string, string>;
      writeVersionFiles(dir, files);
      outputRef = dir;
      break;
    }
    case 'bundle': {
      outputRef = await buildBundle(projectId, artifactId, artifactName, payload, current.version);
      break;
    }
    default:
      throw new Error(`unsupported projection kind: ${String(kind)}`);
  }

  // upsert the projections row for this kind (regenerate replaces)
  const existing = (await listProjectionsFor(artifactId)).find((r) => r.kind === kind);
  const id = existing?.id ?? newId('pj');
  await putProjection({
    id,
    artifact_id: artifactId,
    kind,
    at_version: current.version,
    output_ref: outputRef,
    target_ref: existing?.target_ref ?? null,
    status: 'local',
    created_at: now(),
  });
  return { id, kind, atVersion: current.version, outputRef, generated };
}

/* ---------- Stage 4 push projections (Amendment A6: confluence_page, jira_epics) ---------- */

export function toConfluencePage(p: Payload): { title: string; space: string; storage: string } {
  const esc = (v: string): string =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const spine = (p.spine ?? {}) as Payload;
  const caps = arr(p, 'capabilities');
  const kpis = arr(p, 'kpis');
  const parts = [
    `<h1>${esc(str(p, 'name'))}</h1>`,
    `<p><strong>Spine:</strong> ${esc(str(spine, 'lob'))} / ${esc(str(spine, 'domain'))}</p>`,
    `<h2>Problem</h2><p>${esc(str(p, 'problem'))}</p>`,
    `<h2>Value proposition</h2><p>${esc(str(p, 'value_prop'))}</p>`,
  ];
  if (caps.length > 0) {
    parts.push('<h2>Capabilities</h2><ul>');
    for (const c of caps) parts.push(`<li><strong>${esc(String(c.name ?? ''))}</strong> — ${esc(String(c.description ?? ''))}</li>`);
    parts.push('</ul>');
  }
  if (kpis.length > 0) {
    parts.push('<h2>KPIs</h2><table><tbody><tr><th>KPI</th><th>Target</th></tr>');
    for (const k of kpis) parts.push(`<tr><td>${esc(String(k.name ?? ''))}</td><td>${esc(String(k.target ?? ''))}</td></tr>`);
    parts.push('</tbody></table>');
  }
  return { title: `${str(p, 'name')} — product definition`, space: str(spine, 'lob') || 'PRODUCT', storage: parts.join('') };
}

export function toJiraEpics(p: Payload): {
  epics: Array<{ summary: string; description: string; stories: Array<{ summary: string }> }>;
} {
  const ac = arr(p, 'acceptance_criteria');
  return {
    epics: arr(p, 'capabilities').map((c) => ({
      summary: String(c.name ?? ''),
      description: String(c.description ?? ''),
      stories: ac
        .filter((a) => String(a.capability ?? '') === String(c.name ?? ''))
        .map((a) => ({ summary: `Given ${String(a.given ?? '')}, when ${String(a.when ?? '')}, then ${String(a.then ?? '')}` })),
    })),
  };
}

/** Find a connected connector for a push target in this project (directory id or custom-*). */
async function pushConnector(target: 'confluence' | 'jira', projectId: string) {
  const { installs, callTool } = await import('../mcp/manager.js');
  for (const row of await installs()) {
    if (row.status !== 'connected') continue;
    const matches =
      row.connector_id === target ||
      (row.connector_id.startsWith('custom-') && row.connector_id.includes(target));
    if (!matches) continue;
    const enabled = JSON.parse(row.enabled_projects) as string[];
    if (!enabled.includes(projectId)) continue;
    return {
      connectorId: row.connector_id,
      call: (tool: string, args: Record<string, unknown>) => callTool(row.connector_id, projectId, tool, args),
    };
  }
  return null;
}

export async function generatePushProjection(
  projectId: string,
  artifactId: string,
  artifactName: string,
  kind: 'confluence_page' | 'jira_epics',
): Promise<ProjectionResult & { status: string; note?: string; targetRef?: string }> {
  const current = await latestPayload(artifactId);
  if (!current) throw new Error('product has no payload to project');
  const payload = current.payload as Payload;
  const dir = projectionDir(projectId, artifactId, kind, current.version);
  const base = artifactName.replace(/\.product\.json$/, '');

  let outputRef: string;
  let targetRef: string | undefined;
  let status: 'local' | 'pushed' | 'error' = 'local';
  let note: string | undefined;

  if (kind === 'confluence_page') {
    const page = toConfluencePage(payload);
    outputRef = path.join(dir, `${base}-confluence.storage.xml`);
    writeFileSync(outputRef, page.storage);
    const conn = await pushConnector('confluence', projectId);
    if (conn) {
      try {
        targetRef = (await conn.call('confluence_create_page', page)).slice(0, 200);
        status = 'pushed';
      } catch (err) {
        status = 'error';
        note = err instanceof Error ? err.message : String(err);
      }
    } else {
      note = 'connect Confluence to push';
    }
  } else {
    const epics = toJiraEpics(payload);
    outputRef = path.join(dir, `${base}-jira-epics.json`);
    writeFileSync(outputRef, JSON.stringify(epics, null, 2));
    const conn = await pushConnector('jira', projectId);
    if (conn) {
      try {
        const refs: string[] = [];
        for (const epic of epics.epics) {
          refs.push(await conn.call('jira_create_epic', epic));
        }
        targetRef = refs.join('; ').slice(0, 200);
        status = 'pushed';
      } catch (err) {
        status = 'error';
        note = err instanceof Error ? err.message : String(err);
      }
    } else {
      note = 'connect Jira to push';
    }
  }

  const existing = (await listProjectionsFor(artifactId)).find((r) => r.kind === kind);
  const id = existing?.id ?? newId('pj');
  await putProjection({
    id,
    artifact_id: artifactId,
    kind,
    at_version: current.version,
    output_ref: outputRef,
    target_ref: targetRef ?? null,
    status,
    created_at: now(),
  });
  return { id, kind, atVersion: current.version, outputRef, generated: false, status, note, targetRef };
}

/* ---------- A7 context bundle ---------- */

async function buildBundle(
  projectId: string,
  artifactId: string,
  artifactName: string,
  payload: Payload,
  version: number,
): Promise<string> {
  const base = artifactName.replace(/\.product\.json$/, '');
  const root = projectionDir(projectId, artifactId, 'bundle', version);
  const bundleDir = path.join(root, `${base}-bundle-v${version}`);
  mkdirSync(path.join(bundleDir, 'acceptance'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'context'), { recursive: true });

  const ac = arr(payload, 'acceptance_criteria');
  const decisions = arr(payload, 'decisions');
  const deps = arr(payload, 'dependencies');
  const spine = (payload.spine ?? {}) as Payload;

  writeFileSync(path.join(bundleDir, 'definition.json'), JSON.stringify(payload, null, 2));
  writeFileSync(path.join(bundleDir, 'acceptance/criteria.json'), JSON.stringify(ac, null, 2));
  writeFileSync(
    path.join(bundleDir, 'acceptance/criteria.md'),
    ac.length > 0
      ? ac
          .map(
            (c, i) =>
              `## AC-${i + 1} (${String(c.capability ?? '')})\n- **Given** ${String(c.given ?? '')}\n- **When** ${String(c.when ?? '')}\n- **Then** ${String(c.then ?? '')}`,
          )
          .join('\n\n')
      : '_No acceptance criteria recorded yet._',
  );
  writeFileSync(
    path.join(bundleDir, 'context/dependencies.md'),
    deps.length > 0
      ? deps.map((d) => `- **${String(d.system ?? '')}** — ${String(d.nature ?? '')}`).join('\n')
      : '_No dependencies recorded._',
  );
  writeFileSync(
    path.join(bundleDir, 'context/decisions.md'),
    decisions.length > 0
      ? decisions
          .map(
            (d) =>
              `## ${String(d.title ?? '')}\n**Choice:** ${String(d.choice ?? '')}${d.rationale ? `\n**Rationale:** ${String(d.rationale)}` : ''}${d.date ? `\n**Date:** ${String(d.date)}` : ''}`,
          )
          .join('\n\n')
      : '_No decisions logged yet._',
  );
  writeFileSync(
    path.join(bundleDir, 'CLAUDE.md'),
    [
      `# ${str(payload, 'name')} — build context`,
      '',
      `**Spine:** ${str(spine, 'lob')} / ${str(spine, 'domain')}${str(spine, 'capability_code') ? ` · ${str(spine, 'capability_code')}` : ''}`,
      '',
      '## Problem',
      str(payload, 'problem'),
      '',
      '## Value proposition',
      str(payload, 'value_prop'),
      '',
      '## Scope',
      'In scope:',
      ...arr(payload, 'scope_in').map((s) => `- ${String(s)}`),
      'Out of scope:',
      ...arr(payload, 'scope_out').map((s) => `- ${String(s)}`),
      '',
      '## Where to look',
      '- `definition.json` — the full product master (source of truth, version ' + version + ')',
      '- `acceptance/criteria.md` + `criteria.json` — testable given/when/then',
      '- `context/dependencies.md` — systems this product touches',
      '- `context/decisions.md` — the decision log; append outcomes here via Axiom writeback',
      '',
      'Report build decisions and as-built facts back to the product master in Axiom',
      '(chat: "log a decision on ' + str(payload, 'name') + ': …").',
      '',
      'Consume via your agentic build workflow (EPCC or equivalent).',
    ].join('\n'),
  );
  // A7: .mcp.json included now that Knowledge Core can be connected (Stage 4)
  const { installFor } = await import('../mcp/manager.js');
  const kc = await installFor('knowledge-core');
  if (kc && kc.status === 'connected') {
    writeFileSync(
      path.join(bundleDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'knowledge-core': { type: 'http', url: 'http://127.0.0.1:7979/mcp' } } }, null, 2),
    );
  }

  const zipPath = path.join(root, `${base}-bundle-v${version}.zip`);
  await execFileAsync('/usr/bin/zip', ['-r', '-q', zipPath, path.basename(bundleDir)], { cwd: root });
  return zipPath;
}

export async function listProjections(
  artifactId: string,
  currentVersion: number,
): Promise<Array<{
  id: string;
  kind: string;
  atVersion: number;
  status: string;
  stale: boolean;
  generated: boolean;
  outputRef: string | null;
  targetRef: string | null;
}>> {
  const rows = await listProjectionsFor(artifactId); // sorted created_at ascending
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    atVersion: r.at_version,
    status: r.at_version < currentVersion ? 'stale' : r.status,
    stale: r.at_version < currentVersion,
    generated: r.kind === 'prototype_react',
    outputRef: r.output_ref,
    targetRef: r.target_ref,
  }));
}

export async function bundleExists(artifactId: string): Promise<boolean> {
  const rows = await listProjectionsFor(artifactId);
  return rows.some((r) => r.kind === 'bundle');
}
