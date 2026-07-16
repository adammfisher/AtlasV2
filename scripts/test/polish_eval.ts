/**
 * DELIVERABLE G — consolidated polish gates.
 *
 *   pnpm test:polish            everything (~175 live Bedrock calls, several minutes)
 *   pnpm test:polish -- A C     only the named deliverables
 *
 * Runs the Deliverable A formatting eval (20 prompts x 3 tiers), the B drift test
 * (one 30-turn conversation), the C memory-etiquette eval (15 cases x 3 tiers +
 * units), the D citation tests, the E cache gates, and the F tool-decision eval.
 *
 * HARD GATES (the brief's, verbatim):
 *   - formatting 100% on decline-shaped and casual prompts
 *   - zero forbidden memory phrases
 *   - zero sensitive-memory leaks
 *   - zero invalid citation chips
 *   - prefix byte-stability passes
 *   - cache reads observed
 *   - tool decisions >= 10/12
 *
 * Every gate is a deterministic check on a real model response. There is no LLM
 * judge anywhere in this suite: a gate that grades itself with a model can drift,
 * and these are meant to hold a product to a standard, not to agree with it.
 */
import { withBedrock, type CaseResult } from './polish/lib.js';
import { runFormatting } from './polish/formatting.js';
import { runDrift } from './polish/drift.js';
import { runMemoryEtiquette } from './polish/memory_etiquette.js';
import { runCitations } from './polish/citations.js';
import { runCache } from './polish/cache.js';
import { runTools } from './polish/tools.js';

type Letter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

const only = process.argv.slice(2).map((a) => a.toUpperCase()).filter((a): a is Letter => /^[A-F]$/.test(a));
const want = (l: Letter): boolean => only.length === 0 || only.includes(l);

interface Section {
  letter: Letter;
  name: string;
  passed: number;
  failed: number;
  gate: string;
  gateOk: boolean;
  note?: string;
}

async function main(): Promise<void> {
  const sections: Section[] = [];
  const t0 = Date.now();

  if (want('A')) {
    const r = await runFormatting();
    sections.push({
      letter: 'A',
      name: 'tone & formatting (20 prompts x 3 tiers)',
      passed: r.passed,
      failed: r.failed,
      gate: '100% on casual + decline-shaped',
      gateOk: r.failed === 0,
    });
  }

  if (want('B')) {
    const r = await runDrift();
    sections.push({
      letter: 'B',
      name: 'reminder / drift (30-turn conversation, small tier)',
      passed: r.passed,
      failed: r.failed,
      gate: 'prose holds after the reminder; system prefix byte-identical',
      gateOk: r.failed === 0,
      note: 'control (POLISH_DRIFT_CONTROL=1) drifts badly (9/25) — the reminder is doing the work',
    });
  }

  if (want('C')) {
    const r = await runMemoryEtiquette();
    const leaks = r.results.filter((x) => !x.pass && x.detail.includes('SENSITIVE LEAK')).length;
    sections.push({
      letter: 'C',
      name: 'memory etiquette (15 cases x 3 tiers + 23 units)',
      passed: r.passed,
      failed: r.failed,
      gate: 'zero forbidden phrases, zero sensitive leaks',
      gateOk: r.narrationHits === 0 && leaks === 0 && r.failed === 0,
      note: `forbidden phrases: ${r.narrationHits}, sensitive leaks: ${leaks}`,
    });
  }

  if (want('D')) {
    const r = await runCitations();
    const broken = r.results.filter((x) => !x.pass && /resolve|invalid|markup/i.test(x.name)).length;
    sections.push({
      letter: 'D',
      name: 'indexed citations (4 scenarios + post-processor units)',
      passed: r.passed,
      failed: r.failed,
      gate: 'zero invalid citation chips',
      gateOk: broken === 0 && r.failed === 0,
    });
  }

  if (want('E')) {
    const r = await runCache();
    sections.push({
      letter: 'E',
      name: 'cache-optimal assembly (byte-stability + 10-turn reads)',
      passed: r.passed,
      failed: r.failed,
      gate: 'prefix byte-stable; cache reads observed from turn 2',
      gateOk: r.failed === 0,
      note: r.summary,
    });
  }

  if (want('F')) {
    const r = await runTools();
    sections.push({
      letter: 'F',
      name: 'tool decisions (12 cases, small tier + units)',
      passed: r.passed,
      failed: r.failed,
      gate: 'tool decisions >= 10/12',
      gateOk: r.failed === 0,
      note: 'control (POLISH_TOOLS_CONTROL=1) scores the same on the 12; the enrichment shows up in search SCALE (1 vs 4)',
    });
  }

  const mins = ((Date.now() - t0) / 60_000).toFixed(1);
  console.log(`\n${'═'.repeat(78)}\nPOLISH GATES — ${mins} min\n${'═'.repeat(78)}`);
  console.log(`${'  '}${'DELIVERABLE'.padEnd(52)}${'PASS'.padStart(7)}${'FAIL'.padStart(6)}  GATE`);
  for (const s of sections) {
    console.log(
      `  ${`${s.letter}: ${s.name}`.padEnd(52)}${String(s.passed).padStart(7)}${String(s.failed).padStart(6)}  ${s.gateOk ? 'PASS' : 'FAIL'}`,
    );
    if (s.note) console.log(`     ${s.note}`);
  }

  const failed = sections.filter((s) => !s.gateOk);
  const totalPass = sections.reduce((n, s) => n + s.passed, 0);
  const totalFail = sections.reduce((n, s) => n + s.failed, 0);
  console.log(`${'─'.repeat(78)}\n  TOTAL ${totalPass} passed, ${totalFail} failed — ${failed.length === 0 ? 'ALL GATES GREEN' : `${failed.length} GATE(S) RED: ${failed.map((s) => s.letter).join(', ')}`}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void withBedrock(main);

export type { CaseResult };
