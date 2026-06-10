/**
 * Stage 3 gate: constrained-JSON first-pass validity on E4B.
 *  - 20-prompt office set (5 × pptx/docx/xlsx/pdf) — gate ≥90%
 *  - 10-prompt product definition set — gate ≥90% (Amendment §A10)
 * Mirrors the live pipeline exactly: same schemas, same §4.3.2 prompt builder,
 * same sampling. Logs every result; prints the percentages for the handoff.
 */
import { loadSkill, type SkillId } from '../../server/src/pipeline/skills.js';
import { validateJson } from '../../server/src/pipeline/validate.js';
import { completeJson } from '../../server/src/llama/json.js';
import { logTo } from '../../server/src/log.js';

const OFFICE_PROMPTS: Array<[SkillId, string]> = [
  ['pptx', 'Build a QBR deck from the Q3 pipeline numbers: revenue 4.2M vs 3.8M plan, win rate 31%'],
  ['pptx', 'Five-slide kickoff deck for the Meridian enterprise rollout'],
  ['pptx', 'Board update deck: hiring on plan, burn 510k/mo, runway 19 months'],
  ['pptx', 'Training deck introducing our incident management process'],
  ['pptx', 'Competitive overview deck comparing us to two legacy vendors on speed, cost, security'],
  ['docx', 'A statement of work for a 6-week data migration engagement'],
  ['docx', 'One-page memo announcing the new travel expense policy, effective August 1'],
  ['docx', 'Project status report: milestones M1 done, M2 at risk due to vendor delay'],
  ['docx', 'An offer letter for a senior data engineer, salary 185k, start date July 15'],
  ['docx', 'Meeting minutes for the Q3 steering committee: 3 decisions, 4 action items'],
  ['xlsx', 'A simple budget tracker: 6 expense categories with monthly actual vs plan and variance formulas'],
  ['xlsx', 'Headcount plan by quarter for engineering, sales, support with totals row'],
  ['xlsx', 'Sales pipeline tracker: 8 deals with stage, value, probability, weighted value formula'],
  ['xlsx', 'A loan amortization sheet: principal 30000, rate 6.5%, 12 monthly rows'],
  ['xlsx', 'Project cost model: labor, software, infra sheets with a summary sheet referencing them'],
  ['pdf', 'A two-page onboarding checklist for new engineers'],
  ['pdf', 'A one-page invoice for consulting services: 3 line items, total, payment terms'],
  ['pdf', 'A security incident summary report with timeline table and findings'],
  ['pdf', 'A certificate of completion for the Atlas pilot program'],
  ['pdf', 'A three-page product brief for the auto loan payment calculator'],
];

const PRODUCT_PROMPTS: string[] = [
  'Define a product: an auto loan payment calculator for the consumer lending LOB, payments domain',
  'Define a product: a self-service password reset portal for the IT services LOB, identity domain',
  'Define a product: a vendor risk scoring dashboard for procurement, third-party risk domain',
  'Define a product: an SMS appointment reminder service for retail banking, customer engagement domain',
  'Define a product: a document OCR intake pipeline for insurance claims, claims processing domain',
  'Define a product: a branch wait-time predictor for retail banking, branch operations domain',
  'Define a product: a chargeback dispute tracker for cards LOB, disputes domain',
  'Define a product: an employee skills directory for HR, talent management domain',
  'Define a product: a fraud alert triage queue for payments LOB, fraud operations domain',
  'Define a product: a regulatory filing calendar for compliance, reporting obligations domain',
];

function officePrompt(skillId: SkillId, text: string): { system: string; user: string } {
  const skill = loadSkill(skillId);
  return {
    system: `You are a document-generation backend. You produce ONLY a raw JSON object conforming exactly
to the schema described below. No markdown, no code fences, no prose, no extra keys.
SCHEMA (described): ${JSON.stringify(skill.schema)}
DESIGN GUIDANCE: ${skill.guidance}
PROJECT INSTRUCTIONS: (none)
USER REQUEST: ${text}`,
    user: text,
  };
}

async function runSet(name: string, prompts: Array<[SkillId, string]>): Promise<number> {
  let pass = 0;
  for (const [i, [skillId, text]] of prompts.entries()) {
    const skill = loadSkill(skillId);
    const { system, user } = officePrompt(skillId, text);
    const started = Date.now();
    try {
      const raw = await completeJson(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        skill.schema as Record<string, unknown>,
        { maxTokens: skillId === 'product' ? 4096 : 3072, temperature: 0.2 },
      );
      const result = validateJson(skillId, skill.schema as Record<string, unknown>, raw);
      const ok = result.ok;
      if (ok) pass += 1;
      const line = `${name} ${i + 1}/${prompts.length} ${skillId} first-pass=${ok ? 'VALID' : `INVALID (${(result as { error?: string }).error})`} ${Date.now() - started}ms`;
      console.log(`  ${ok ? '✓' : '✗'} ${line}`);
      logTo('pipeline', `validity-gate ${line}`);
    } catch (err) {
      console.log(`  ✗ ${name} ${i + 1} ${skillId} ERROR ${err instanceof Error ? err.message : err}`);
      logTo('pipeline', `validity-gate ${name} ${i + 1} ${skillId} ERROR`);
    }
  }
  const pct = Math.round((pass / prompts.length) * 1000) / 10;
  console.log(`${name}: ${pass}/${prompts.length} first-pass valid = ${pct}%`);
  logTo('pipeline', `validity-gate ${name} RESULT ${pass}/${prompts.length} = ${pct}%`);
  return pct;
}

async function main(): Promise<void> {
  console.log('— office 20-prompt set (gate ≥90%)');
  const office = await runSet('office', OFFICE_PROMPTS);
  console.log('— product 10-prompt set (gate ≥90%)');
  const product = await runSet(
    'product',
    PRODUCT_PROMPTS.map((p): [SkillId, string] => ['product', p]),
  );
  console.log(`\nGATE office-validity: ${office >= 90 ? 'PASS' : 'FAIL'} (${office}%)`);
  console.log(`GATE product-validity: ${product >= 90 ? 'PASS' : 'FAIL'} (${product}%)`);
  if (office < 90 || product < 90) process.exitCode = 1;
}

void main();
