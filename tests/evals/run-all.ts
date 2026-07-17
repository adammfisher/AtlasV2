/**
 * Eval runner (npm run test:evals / test:ceiling).
 *
 * Default: the deterministic eval set (no model cost, no server).
 * --live:  adds the live Bedrock evals at their historical gates
 *          (routing 3-tier, e2e-brain, polish) — minutes + token cost.
 * --ceiling: everything in --live; kept as a distinct flag because Phase 7's
 *          final sweep tags frontier-tier runs @ceiling (Sonnet 4.6 today —
 *          Sonnet 5 is quota-blocked, see TESTPLAN §1.4).
 *
 * Exit nonzero if any selected suite fails. Prints a per-suite table.
 */
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const live = args.has('--live') || args.has('--ceiling') || process.env.AXIOM_CEILING === '1';

interface Suite {
  name: string;
  cmd: string[];
  live?: boolean;
}

const SUITES: Suite[] = [
  { name: 'behavior-block', cmd: ['pnpm', 'run', 'test:behavior-block'] },
  { name: 'det-check', cmd: ['npx', 'tsx', 'scripts/test/orchestration/det-check.ts'] },
  { name: 'stage1-smoke', cmd: ['npx', 'tsx', 'scripts/test/orchestration/stage1-smoke.ts'] },
  { name: 'heal-check', cmd: ['npx', 'tsx', 'scripts/test/orchestration/heal-check.ts'] },
  { name: 'salvage-check', cmd: ['npx', 'tsx', 'scripts/test/orchestration/salvage-check.ts'] },
  { name: 'parity-s1', cmd: ['npx', 'tsx', 'scripts/test/parity-s1-disclosure.ts'] },
  { name: 'design-eval', cmd: ['pnpm', 'run', 'test:design'] },
  { name: 'routing-3tier', cmd: ['pnpm', 'run', 'test:routing'], live: true },
  { name: 'e2e-brain', cmd: ['pnpm', 'run', 'test:e2e-brain'], live: true },
  { name: 'polish-A-F', cmd: ['pnpm', 'run', 'test:polish'], live: true },
];

const selected = SUITES.filter((s) => !s.live || live);
const results: Array<{ name: string; ok: boolean; ms: number }> = [];

for (const s of selected) {
  const t0 = Date.now();
  console.log(`\n═══ ${s.name} ═══`);
  const r = spawnSync(s.cmd[0]!, s.cmd.slice(1), { stdio: 'inherit', cwd: process.cwd() });
  results.push({ name: s.name, ok: r.status === 0, ms: Date.now() - t0 });
}

console.log('\n══════ EVAL SUMMARY ══════');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${(r.ms / 1000).toFixed(0)}s)`);
const failed = results.filter((r) => !r.ok);
if (!live) console.log('  (live evals skipped — pass --live or --ceiling)');
process.exit(failed.length ? 1 : 0);
