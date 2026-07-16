/** Unit test (Deliverable C): the assembled behavior block is versioned and
 * contains every required tag per tier; small gets few-shots, frontier is lean. */
import { buildBehaviorBlock, ATLAS_BEHAVIOR_VERSION, type BehaviorTier } from '../../../server/src/pipeline/context.js';

const REQUIRED = [
  'create_edit_describe', 'artifact_vs_inline', 'update_vs_rewrite', 'read_before_write',
  'when_to_search', 'honesty', 'output_format', 'tool_use',
  'tone_and_formatting', // polish layer, Deliverable A
  'memory_etiquette', // polish layer, Deliverable C
];
let fails = 0;
const check = (cond: boolean, msg: string): void => { if (!cond) { console.log(`FAIL ${msg}`); fails++; } };

for (const tier of ['small', 'mid', 'frontier'] as BehaviorTier[]) {
  const block = buildBehaviorBlock(tier);
  check(block.includes(`<atlas_behavior version="${ATLAS_BEHAVIOR_VERSION}" tier="${tier}"`), `${tier}: versioned root tag`);
  for (const tag of REQUIRED) {
    check(block.includes(`<${tag}>`) && block.includes(`</${tag}>`), `${tier}: has <${tag}>`);
  }
  check(block.includes('<current_artifact>'), `${tier}: references <current_artifact>`);
  const hasExamples = block.includes('<examples>');
  check(tier === 'small' ? hasExamples : !hasExamples, `${tier}: examples ${tier === 'small' ? 'present' : 'absent'}`);
  console.log(`${tier}: ${block.length} chars, examples=${hasExamples}`);
}
console.log(fails === 0 ? '\nBEHAVIOR-BLOCK: PASS' : `\nBEHAVIOR-BLOCK: ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
