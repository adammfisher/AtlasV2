/** Unit test: healConstraints trims the exact over-generation the screenshot hit
 * (a column with 5 items where max is 4), a 30-slide deck, over-long strings,
 * and stray keys — then the payload validates. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { healConstraints, validateJson } from '../../../server/src/pipeline/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const schema = JSON.parse(readFileSync(path.join(root, 'skills/pptx/schema.json'), 'utf8')) as Record<string, unknown>;

// a 30-slide deck (schema now allows 40); slide 5 has an over-full column + long title + stray key
const slides = Array.from({ length: 30 }, (_, i) => ({
  archetype: 'content_bullets',
  title: `Slide ${i + 1}`,
  speaker_notes: 'notes here',
  bullets: ['one', 'two', 'three'],
}));
(slides[4] as Record<string, unknown>) = {
  archetype: 'comparison',
  title: 'X'.repeat(140), // maxLength 90
  speaker_notes: 'notes',
  columns: [
    { head: 'A', items: ['a', 'b', 'c', 'd', 'e'] }, // maxItems 4 → the screenshot bug
    { head: 'B', items: ['x', 'y'] },
  ],
  bogusKey: 'should be dropped', // additionalProperties:false
};
const payload = { title: 'Deck', slides };

const before = validateJson('pptx', schema, JSON.stringify(payload));
console.log('before heal: valid =', before.ok, before.ok ? '' : `(${before.error})`);
const { value: healed, fixes } = healConstraints('pptx', schema, payload);
const after = validateJson('pptx', schema, JSON.stringify(healed));
const h = healed as { slides: Array<Record<string, unknown>> };
const col0 = (h.slides[4].columns as Array<{ items: string[] }>)[0];
console.log(`fixes applied: ${fixes}`);
console.log(`slide5 col0 items: ${col0.items.length} (expect 4)`);
console.log(`slide5 title len: ${(h.slides[4].title as string).length} (expect <=90)`);
console.log(`stray key dropped: ${!('bogusKey' in h.slides[4])}`);
console.log(`slides count: ${h.slides.length} (expect 30)`);
console.log('after heal: valid =', after.ok, after.ok ? '' : `(${after.error})`);
const pass = !before.ok && after.ok && col0.items.length === 4 && !('bogusKey' in h.slides[4]) && h.slides.length === 30;
console.log(pass ? '\nHEAL-CHECK: PASS' : '\nHEAL-CHECK: FAIL');
process.exit(pass ? 0 : 1);
