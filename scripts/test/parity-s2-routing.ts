/**
 * S2 routing-accuracy eval (parity audit): 20 prompts through the LIVE route()
 * — the same classifier chat uses. Gate: ≥90% (18/20). Categories: clear
 * creation asks, ambiguous-but-reasonable, and statements that must NOT fire
 * a skill (the router's historical failure mode — see commit c397c39).
 *
 * Usage: tsx scripts/test/parity-s2-routing.ts   (needs the dev llama router up)
 */
import { ensureBedrockConnected } from '../../server/src/providers/bedrock.js';
import { route } from '../../server/src/pipeline/router.js';
import type { SkillId } from '../../server/src/pipeline/skills.js';

// mirror the DEPLOYED router path: constrained JSON via Bedrock (llama-server
// does not exist in Lambda; cloudReady() must be true for parity-relevant runs)
await ensureBedrockConnected();

type Expect = { intent: 'chat' } | { intent: 'create_doc'; skill: SkillId[] };

const CASES: Array<[string, Expect]> = [
  // clear creation asks
  ['make me a deck about our Q3 results', { intent: 'create_doc', skill: ['pptx'] }],
  ['create a presentation for the board meeting', { intent: 'create_doc', skill: ['pptx'] }],
  ['write a memo announcing the office move', { intent: 'create_doc', skill: ['docx'] }],
  ['draft a statement of work for the migration project', { intent: 'create_doc', skill: ['docx'] }],
  ['build a budget spreadsheet with monthly variance formulas', { intent: 'create_doc', skill: ['xlsx'] }],
  ['generate an invoice PDF for 3 consulting line items', { intent: 'create_doc', skill: ['pdf'] }],
  ['make a flowchart of our deployment pipeline', { intent: 'create_doc', skill: ['mermaid'] }],
  ['create an architecture diagram for the AWS setup', { intent: 'create_doc', skill: ['mermaid'] }],
  ['design a logo icon for the Atlas project', { intent: 'create_doc', skill: ['svg'] }],
  ['build me an interactive mortgage calculator widget', { intent: 'create_doc', skill: ['react'] }],
  ['create a landing page for our beta signup', { intent: 'create_doc', skill: ['site', 'react'] }],
  ['turn these notes into slides', { intent: 'create_doc', skill: ['pptx'] }],
  // ambiguous but reasonable (chart request → xlsx or react both defensible)
  ['chart this data: Q1 3.1, Q2 3.7, Q3 4.2', { intent: 'create_doc', skill: ['xlsx', 'react', 'svg', 'mermaid', 'pptx'] }],
  ['define a product: a fraud alert triage queue', { intent: 'create_doc', skill: ['product'] }],
  // statements/questions that must NOT fire a skill
  ['we decided the deck should focus on enterprise wins', { intent: 'chat' }],
  ['update: the budget spreadsheet now includes contractor costs', { intent: 'chat' }],
  ['what does the spec say about the payment calculator?', { intent: 'chat' }],
  ['the report is due Friday, just so you know', { intent: 'chat' }],
  ['is a pie chart or bar chart better for market share?', { intent: 'chat' }],
  ['remember that our default region is us-east-1', { intent: 'chat' }],
];

const results: Array<{ prompt: string; want: string; got: string; pass: boolean }> = [];
for (const [prompt, want] of CASES) {
  const r = await route([], prompt, false);
  const pass =
    want.intent === 'chat'
      ? r.intent === 'chat'
      : r.intent === 'create_doc' && r.skill !== null && want.skill.includes(r.skill);
  results.push({
    prompt,
    want: want.intent === 'chat' ? 'chat' : `create_doc:${want.skill.join('|')}`,
    got: `${r.intent}:${r.skill ?? '-'}`,
    pass,
  });
  console.log(`${pass ? '✓' : '✗'} ${prompt.slice(0, 55).padEnd(55)} want=${results.at(-1)!.want} got=${results.at(-1)!.got}`);
}
const passed = results.filter((r) => r.pass).length;
const pct = Math.round((passed / CASES.length) * 100);
console.log(`\nS2 routing: ${passed}/${CASES.length} (${pct}%) — gate ≥90% → ${pct >= 90 ? 'GREEN' : 'RED'}`);
process.exit(pct >= 90 ? 0 : 1);
