/** Unit test: a 30-slide deck with one STRUCTURALLY broken slide (bad archetype
 * enum — non-healable) is salvaged to a valid 29-slide deck, not a hard failure. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { salvageConstraints, validateJson } from '../../../server/src/pipeline/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const schema = JSON.parse(readFileSync(path.join(root, 'skills/pptx/schema.json'), 'utf8')) as Record<string, unknown>;

const slides: Array<Record<string, unknown>> = Array.from({ length: 30 }, (_, i) => ({
  archetype: 'content_bullets', title: `Slide ${i + 1}`, speaker_notes: 'notes', bullets: ['one', 'two'],
}));
// slide 10: invalid archetype (enum violation) — NON-healable → must be dropped
slides[9] = { archetype: 'not_a_real_archetype', title: 'Broken', speaker_notes: 'x', bullets: ['a'] };
// slide 20: missing required speaker_notes — NON-healable → must be dropped
slides[19] = { archetype: 'content_bullets', title: 'Also broken', bullets: ['a'] };
// slide 5: over-full bullets (healable — trim, keep the slide)
slides[4] = { archetype: 'content_bullets', title: 'Fixable', speaker_notes: 'n', bullets: ['1','2','3','4','5','6','7'] };

const payload = { title: 'Horse Farms', slides };
const before = validateJson('pptx', schema, JSON.stringify(payload));
const { value: salvaged, ok, dropped } = salvageConstraints('pptx', schema, payload);
const s = salvaged as { slides: unknown[] };
console.log(`before: valid=${before.ok} (${before.ok ? '' : before.error})`);
console.log(`salvaged: ok=${ok} dropped=${dropped} slides=${s.slides.length}`);
const after = validateJson('pptx', schema, JSON.stringify(salvaged));
console.log(`after: valid=${after.ok}`);
const pass = !before.ok && ok && after.ok && dropped === 2 && s.slides.length === 28;
console.log(pass ? '\nSALVAGE-CHECK: PASS (dropped 2 broken slides, kept 28 valid, healed the over-full one)' : `\nSALVAGE-CHECK: FAIL`);
process.exit(pass ? 0 : 1);
