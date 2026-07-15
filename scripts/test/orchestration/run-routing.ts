/**
 * DELIVERABLE E — routing eval runner.
 *
 * Runs every dataset case through the REAL three-stage router at each tier
 * (small=nova, mid=haiku, frontier=sonnet), pinned via routeWorkflow({tier}).
 * Computes overall + per-class accuracy, a confusion matrix per tier
 * (docs/orchestration/confusion-<tier>.md), escalation rate, and clarify rate.
 *
 * HARD GATES (non-zero exit if any unmet, on ANY tier):
 *   - edit-vs-describe class: 100%
 *   - unambiguous class:      >= 95%
 *   - overall routing:        >= 85%
 *
 *   pnpm test:routing
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAsAccount } from '../../../server/src/lib/account.js';
import { ensureBedrockConnected } from '../../../server/src/providers/bedrock.js';
import { routeWorkflow } from '../../../server/src/pipeline/router.js';
import type { RouterSignals } from '../../../server/src/pipeline/router.types.js';
import type { ModelTier } from '../../../server/src/pipeline/workflows.js';

interface PriorContext { lastArtifact?: string; upload?: string; uploads?: string[]; image?: string; url?: boolean; lastAnswer?: boolean }
interface Case { id: string; prompt: string; priorContext?: PriorContext; expectedWorkflowId?: string; expectedOrderedPlan?: string[]; class: string }

const here = path.dirname(fileURLToPath(import.meta.url));
const cases: Case[] = readFileSync(path.join(here, 'dataset.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Case);

const TIERS: Array<{ tier: ModelTier; model: string }> = [
  { tier: 'small', model: 'nova' },
  { tier: 'mid', model: 'haiku' },
  { tier: 'frontier', model: 'sonnet' },
];
const CONCURRENCY = 4;

function signalsFrom(pc?: PriorContext): RouterSignals {
  const uploads = pc?.uploads ?? (pc?.upload ? [pc.upload] : []);
  return {
    artifactInContext: !!pc?.lastArtifact,
    lastArtifactKind: pc?.lastArtifact ?? null,
    lastMsgProducedArtifact: !!pc?.lastArtifact,
    lastMsgWasSubstantive: !!pc?.lastAnswer || !!pc?.lastArtifact,
    fileUploadPresent: uploads.length > 0,
    imageUploadPresent: !!pc?.image,
    multipleUploads: uploads.length > 1,
    uploadKinds: uploads.map((f) => f.split('.').pop() ?? ''),
    urlInMessage: !!pc?.url,
  };
}
const eq = (a?: string[], b?: string[]): boolean => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
const expectedOf = (c: Case): string => c.expectedWorkflowId ?? c.expectedOrderedPlan?.[0] ?? '?';

interface Pred { predicted: string; plan?: string[]; escalated: boolean; correct: boolean }

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = idx++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

async function runTier(tier: ModelTier): Promise<{ preds: Pred[] }> {
  const preds = await mapLimit(cases, CONCURRENCY, async (c) => {
    const d = await routeWorkflow({ message: c.prompt, history: [], signals: signalsFrom(c.priorContext), tier });
    const expected = expectedOf(c);
    const correct = c.expectedOrderedPlan
      ? eq(d.orderedPlan, c.expectedOrderedPlan) || d.workflowId === c.expectedOrderedPlan[0]
      : d.workflowId === expected;
    return { predicted: d.workflowId, plan: d.orderedPlan, escalated: d.escalated, correct };
  });
  return { preds };
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`;
}

function writeConfusion(tier: ModelTier, preds: Pred[]): void {
  const labels = [...new Set(cases.map(expectedOf))].sort();
  const conf = new Map<string, Map<string, number>>();
  cases.forEach((c, i) => {
    const e = expectedOf(c);
    const p = preds[i]!.predicted;
    if (!conf.has(e)) conf.set(e, new Map());
    const row = conf.get(e)!;
    row.set(p, (row.get(p) ?? 0) + 1);
  });
  const lines: string[] = [`# Confusion matrix — ${tier}`, '', 'Rows = expected, entries = predicted (only mispredictions listed; ✓ = count correct).', ''];
  for (const e of labels) {
    const row = conf.get(e) ?? new Map();
    const total = [...row.values()].reduce((a, b) => a + b, 0);
    const right = row.get(e) ?? 0;
    const wrong = [...row.entries()].filter(([p]) => p !== e).map(([p, n]) => `${p}×${n}`);
    lines.push(`- **${e}** (${right}/${total} ✓)${wrong.length ? ` → ${wrong.join(', ')}` : ''}`);
  }
  const dir = path.join(here, '..', '..', '..', 'docs', 'orchestration');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `confusion-${tier}.md`), lines.join('\n') + '\n');
}

function classAcc(preds: Pred[], klass: string): { n: number; ok: number } {
  let n = 0, ok = 0;
  cases.forEach((c, i) => { if (c.class === klass) { n++; if (preds[i]!.correct) ok++; } });
  return { n, ok };
}

async function main(): Promise<void> {
  await runAsAccount('adammfisher', async () => {
    await ensureBedrockConnected();
    const classes = [...new Set(cases.map((c) => c.class))].sort();
    const summary: string[] = [];
    const report: string[] = []; // compact, written to docs/orchestration/last-run.md
    let gatesPass = true;

    for (const { tier } of TIERS) {
      const t0 = Date.now();
      const { preds } = await runTier(tier);
      writeConfusion(tier, preds);
      const overall = { n: preds.length, ok: preds.filter((p) => p.correct).length };
      const esc = preds.filter((p) => p.escalated).length;
      const clar = preds.filter((p) => p.predicted === 'clarify-before-acting').length;
      const evd = classAcc(preds, 'edit-vs-describe');
      const unamb = classAcc(preds, 'unambiguous');

      // hard gates
      const gEdit = evd.n === 0 || evd.ok === evd.n;
      const gUnamb = unamb.n === 0 || unamb.ok / unamb.n >= 0.95;
      const gOverall = overall.ok / overall.n >= 0.85;
      if (!gEdit || !gUnamb || !gOverall) gatesPass = false;

      console.log(`\n═══ TIER ${tier.toUpperCase()} (${((Date.now() - t0) / 1000).toFixed(0)}s) ═══`);
      report.push(`## ${tier}  overall ${pct(overall.ok, overall.n)} · edit-vs-describe ${pct(evd.ok, evd.n)} · unambiguous ${pct(unamb.ok, unamb.n)} · esc ${pct(esc, preds.length)} · clarify ${pct(clar, preds.length)}  [gates ${gEdit && gUnamb && gOverall ? 'PASS' : 'FAIL'}]`);
      cases.forEach((c, i) => { if (!preds[i]!.correct) report.push(`- [${c.class}] exp ${expectedOf(c)} → got ${preds[i]!.predicted}${preds[i]!.plan ? ` plan=[${preds[i]!.plan}]` : ''} :: ${c.prompt.slice(0, 70)}`); });
      report.push('');
      console.log(`  overall            ${overall.ok}/${overall.n}  ${pct(overall.ok, overall.n)}   ${gOverall ? 'PASS' : 'FAIL (<85%)'}`);
      console.log(`  edit-vs-describe   ${evd.ok}/${evd.n}  ${pct(evd.ok, evd.n)}   ${gEdit ? 'PASS' : 'FAIL (<100%)'}`);
      console.log(`  unambiguous        ${unamb.ok}/${unamb.n}  ${pct(unamb.ok, unamb.n)}   ${gUnamb ? 'PASS' : 'FAIL (<95%)'}`);
      console.log(`  escalation rate    ${pct(esc, preds.length)}   clarify rate ${pct(clar, preds.length)}`);
      console.log('  per-class:');
      for (const k of classes) {
        const a = classAcc(preds, k);
        console.log(`    ${k.padEnd(18)} ${a.ok}/${a.n}  ${pct(a.ok, a.n)}`);
      }
      summary.push(
        `| ${tier} | ${pct(overall.ok, overall.n)} | ${pct(evd.ok, evd.n)} | ${pct(unamb.ok, unamb.n)} | ${pct(esc, preds.length)} | ${pct(clar, preds.length)} |`,
      );

      // print the mispredictions for this tier (diagnosis for the stop-on-failure loop)
      const misses = cases.map((c, i) => ({ c, p: preds[i]! })).filter((x) => !x.p.correct);
      if (misses.length) {
        console.log(`  misses (${misses.length}):`);
        for (const { c, p } of misses.slice(0, 40)) {
          console.log(`    [${c.class}] exp ${expectedOf(c)} got ${p.predicted}${p.plan ? ` plan=[${p.plan}]` : ''} :: ${c.prompt.slice(0, 60)}`);
        }
      }
    }

    console.log('\n╔═══ SUMMARY MATRIX ═══╗');
    console.log('| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |');
    console.log('|---|---|---|---|---|---|');
    for (const s of summary) console.log(s);

    const stamp = process.env.EVAL_STAMP ?? 'local';
    const block = [
      '', `### Routing gate run (${stamp})`, '',
      '| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |',
      '|---|---|---|---|---|---|',
      ...summary, '',
      `Gates: ${gatesPass ? 'ALL PASS ✅' : 'FAILURES ✗'} (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)`, '',
    ].join('\n');
    const logPath = path.join(here, '..', '..', '..', 'Documentation', 'handoffs', 'BRAIN-LOG.md');
    try { writeFileSync(logPath, readFileSync(logPath, 'utf8') + block); } catch { /* ignore */ }

    const rdir = path.join(here, '..', '..', '..', 'docs', 'orchestration');
    mkdirSync(rdir, { recursive: true });
    writeFileSync(path.join(rdir, 'last-run.md'), [`# Routing run — gates ${gatesPass ? 'PASS' : 'FAIL'}`, '', ...summary, '', ...report].join('\n') + '\n');

    console.log(gatesPass ? '\nROUTING GATES: ALL PASS' : '\nROUTING GATES: FAILED');
    process.exit(gatesPass ? 0 : 1);
  });
}
void main();
