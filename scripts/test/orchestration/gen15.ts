/**
 * Generate a 15-slide pptx payload on the doc-gen model (haiku unless sonnet),
 * writing the schema-valid JSON. Chat model is set to NEMOTRON to also prove the
 * officeGenerationModel policy substitutes a non-Claude selection → haiku.
 *
 *   pnpm tsx scripts/test/orchestration/gen15.ts <out.json> [requestFile]
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { runAsAccount } from '../../../server/src/lib/account.js';
import { setSetting } from '../../../server/src/db/db.js';
import {
  ensureBedrockConnected, bedrockSettings, activeModel, officeGenerationModel, officeMaxTokens,
} from '../../../server/src/providers/bedrock.js';
import { completeJsonOffice } from '../../../server/src/llama/json.js';
import { loadSkill } from '../../../server/src/pipeline/skills.js';
import { validateJson, officeDoctrineCheck } from '../../../server/src/pipeline/validate.js';

const OUT = process.argv[2] ?? '/tmp/deck15.json';

/** Trim a string to maxLen at a word boundary (no ellipsis — must stay ≤ cap). */
function trimTo(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(' ');
  return (sp > maxLen * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, '');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Enforce the schema's string maxLength + array maxItems recursively. Length-cap
 * violations are cosmetic (a too-long label), so trimming is content-preserving
 * and far more reliable than re-prompting the model until it happens to comply. */
function sanitize(node: any, schema: any): any {
  if (!schema || node == null) return node;
  if (typeof node === 'string' && typeof schema.maxLength === 'number') return trimTo(node, schema.maxLength);
  if (Array.isArray(node)) {
    let arr = schema.items ? node.map((it) => sanitize(it, schema.items)) : node;
    if (typeof schema.maxItems === 'number') arr = arr.slice(0, schema.maxItems);
    return arr;
  }
  if (node && typeof node === 'object' && schema.properties) {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) out[k] = schema.properties[k] ? sanitize(v, schema.properties[k]) : v;
    return out;
  }
  return node;
}

/** Fix structural archetype/field mismatches haiku commonly makes. The only one
 * observed: two_column emitted with `columns` (the comparison field) instead of
 * `bullets`. Relabel it to `comparison` — same two-column visual, and the field
 * it actually produced is the one comparison requires. */
function fixArchetypes(payload: any): void {
  for (const s of payload.slides ?? []) {
    if ((s.archetype === 'two_column' || s.archetype === 'agenda') && !s.bullets && Array.isArray(s.columns)) {
      s.archetype = 'comparison';
    }
  }
}

const nWords = (s: unknown): number => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const trimWords = (s: string, n: number): string => {
  const w = String(s).trim().split(/\s+/);
  return w.length <= n ? s : w.slice(0, n).join(' ');
};
/** Total words the doctrine gate counts for a slide (mirrors validate_common._content_audit). */
function slideWords(s: any): number {
  let t = nWords(s.title) + nWords(s.subtitle);
  for (const b of s.bullets ?? []) t += nWords(b);
  for (const c of s.columns ?? []) { t += nWords(c.head); for (const it of c.items ?? []) t += nWords(it); }
  for (const st of s.steps ?? []) t += nWords(st.label) + nWords(st.detail);
  if (s.stat) t += nWords(s.stat.label);
  return t;
}
const CONTENT_TYPES = new Set(['content_bullets', 'content_chart', 'comparison', 'two_column', 'table', 'timeline_process']);
/** Deterministic backstop guaranteeing the doctrine word caps the Python builder
 * hard-gates on: ≤12 words/bullet & /column-item, ≤40 words on a content slide.
 * The model writes tight copy when prompted; this only nibbles the tail so a
 * marginally-long slide never fails the build. */
function enforceDoctrine(payload: any): void {
  for (const s of payload.slides ?? []) {
    if (Array.isArray(s.bullets)) s.bullets = s.bullets.map((b: string) => trimWords(b, 12));
    for (const c of s.columns ?? []) if (Array.isArray(c.items)) c.items = c.items.map((it: string) => trimWords(it, 12));
    if (!CONTENT_TYPES.has(s.archetype)) continue;
    let guard = 0;
    while (slideWords(s) > 40 && guard++ < 60) {
      if (Array.isArray(s.bullets) && s.bullets.length > 1) {
        let mi = 0; s.bullets.forEach((b: string, ix: number) => { if (nWords(b) > nWords(s.bullets[mi])) mi = ix; });
        s.bullets.splice(mi, 1);
      } else if (Array.isArray(s.steps) && s.steps.length) {
        let mi = 0; s.steps.forEach((st: any, ix: number) => { if (nWords(st.detail) > nWords(s.steps[mi].detail)) mi = ix; });
        const cur = nWords(s.steps[mi].detail);
        s.steps[mi].detail = trimWords(s.steps[mi].detail, Math.max(2, cur - 2));
        if (cur <= 2) s.steps[mi].label = trimWords(s.steps[mi].label, 2);
      } else if (Array.isArray(s.columns) && s.columns.some((c: any) => (c.items ?? []).length)) {
        for (const c of s.columns) { if ((c.items ?? []).length) { let mi = 0; c.items.forEach((it: string, ix: number) => { if (nWords(it) > nWords(c.items[mi])) mi = ix; }); c.items.splice(mi, 1); break; } }
      } else if (Array.isArray(s.bullets) && s.bullets.length === 1) {
        s.bullets[0] = trimWords(s.bullets[0], Math.max(3, nWords(s.bullets[0]) - 2));
      } else { s.title = trimWords(s.title, Math.max(3, nWords(s.title) - 1)); }
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
const DEFAULT_REQUEST = `Create a polished 15-slide board presentation titled "Axiom 2026 Strategy" for an AI document-generation company.
Use varied slide archetypes and concise, executive copy (no filler). Cover, roughly in order:
1. Title slide
2. Agenda
3. Section divider: "The Opportunity"
4. Market opportunity as a big single statistic
5. The problem (bullets)
6. Our solution (bullets with icons)
7. How it works — a 4-step process
8. Product pillars in two columns
9. Section divider: "Traction"
10. Quarterly revenue growth as a bar chart
11. Competitive comparison table
12. A customer quote
13. 18-month roadmap as a timeline
14. Pricing tiers as a table
15. Closing call to action
Keep every slide legible: short titles, tight bullets (max 5, one line each), real numbers.`;

async function main(): Promise<void> {
  const request = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : DEFAULT_REQUEST;
  await runAsAccount('adammfisher', async () => {
    await ensureBedrockConnected();
    if (!bedrockSettings().connected) throw new Error('Bedrock not connected — check the `default` AWS profile');

    setSetting('selectedModel', 'nemotron'); // non-Claude → must substitute to haiku
    const gen = officeGenerationModel();
    console.log(`chat model      : ${activeModel().name}`);
    console.log(`doc-gen model   : ${gen.name}  [${/haiku/i.test(gen.model) ? 'OK — haiku (rule default)' : /claude/i.test(gen.model) ? 'Claude but not haiku' : 'NOT CLAUDE — FAIL'}]`);

    const skill = loadSkill('pptx');
    const schema = skill.schema as Record<string, unknown>;
    const system = `You are a document-generation backend. You produce ONLY a raw JSON object conforming exactly
to the schema described below. No markdown, no code fences, no prose, no extra keys.
SCHEMA (described): ${JSON.stringify(schema)}
DESIGN GUIDANCE: ${skill.guidance}
PROJECT INSTRUCTIONS: (none)
HARD LIMITS (a slide that breaks these is rejected — obey them exactly):
- Content slides (content_bullets, content_chart, comparison, two_column, table, timeline_process): at most 40 words TOTAL across title + bullets + column items + step labels/details combined. Count them.
- Each bullet ≤ 12 words, and at most 4 bullets per slide. Prefer 3 short bullets over 5 long ones.
- timeline_process: at most 4 steps; each step label ≤ 4 words and detail ≤ 9 words.
- comparison / two_column: at most 3 items per column, each ≤ 8 words.
- Titles ≤ 9 words. speaker_notes ≤ 3 sentences. Write like an executive deck: terse, concrete, no filler.
USER REQUEST: ${request}`;

    // Give the model attempts to satisfy BOTH the schema and the numeric design
    // doctrine (word caps) by re-prompting with the exact findings — model-written
    // tight copy beats deterministic trimming for quality. fixArchetypes+sanitize
    // clean the cosmetic misses each round; enforceDoctrine is only the last-resort
    // backstop so the hard build gate never fails.
    const t0 = Date.now();
    const MAX_ATTEMPTS = 4;
    let best: any = null;
    let lastError = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const messages =
        attempt === 0
          ? [{ role: 'system' as const, content: system }, { role: 'user' as const, content: request }]
          : [
              { role: 'system' as const, content: system },
              { role: 'user' as const, content: request },
              { role: 'user' as const, content: `Your previous deck was rejected: ${lastError}. Output ONLY corrected raw JSON, all 15 slides. Fixes: cut copy so every content slide is ≤40 words total and every bullet ≤12 words; archetype "two_column"/"agenda" need a "bullets" array, only "comparison" uses "columns".` },
            ];
      const raw = await completeJsonOffice(messages, schema, { maxTokens: officeMaxTokens(gen), temperature: 0.3, onDelta: () => {} });
      let payload: any;
      try { payload = JSON.parse(raw); } catch { lastError = 'unparseable JSON'; console.log(`attempt ${attempt + 1}: ${lastError}`); continue; }
      fixArchetypes(payload);
      payload = sanitize(payload, schema);
      best = payload;
      const schemaRes = validateJson('pptx', schema, JSON.stringify(payload));
      const docRes = officeDoctrineCheck('pptx', payload, false);
      if (schemaRes.ok && docRes.ok) { lastError = ''; console.log(`attempt ${attempt + 1}: clean (schema + doctrine)`); break; }
      lastError = [schemaRes.ok ? '' : schemaRes.error, docRes.ok ? '' : docRes.error].filter(Boolean).join(' | ');
      console.log(`attempt ${attempt + 1}: ${lastError}`);
    }

    // last-resort deterministic backstop: guarantee the doctrine word caps so the
    // Python builder's hard spec-gate accepts the deck
    if (best) {
      enforceDoctrine(best);
      best = sanitize(best, schema);
    }
    const schemaRes = validateJson('pptx', schema, JSON.stringify(best));
    const docRes = officeDoctrineCheck('pptx', best, false);
    console.log(`generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (!schemaRes.ok) {
      writeFileSync(OUT + '.raw.txt', JSON.stringify(best, null, 2));
      console.log(`\nFAIL — schema invalid after backstop: ${schemaRes.error}`);
      process.exitCode = 1;
      return;
    }

    const p = best as { title?: string; slides?: Array<Record<string, unknown>> };
    const slides = p.slides ?? [];
    console.log(`\ndeck "${p.title}" — ${slides.length} slides`);
    slides.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${String(s.archetype).padEnd(16)} ${slideWords(s) || ''}${CONTENT_TYPES.has(String(s.archetype)) ? 'w ' : '   '}${String(s.title ?? '').slice(0, 48)}`));
    console.log(`\ndoctrine: ${docRes.ok ? 'clean' : docRes.error}`);

    writeFileSync(OUT, JSON.stringify(best, null, 2));
    console.log(`payload → ${OUT}`);
  });
}

void main();
