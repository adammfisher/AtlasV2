/**
 * ULTRA file-type sweep: every major accepted upload kind carries a sentinel
 * only readable from inside the file; the model must return it. One test per
 * kind so the matrix can cite per-type evidence. Office kinds covered deeply
 * in R1-R4; this sweep proves the BREADTH claim ("most popular file types").
 */
import { test } from '@playwright/test';
import { attachAndAsk, pollBody, cleanupMarked, fixture } from './helpers';

const CASES: Array<{ kind: string; file: string; ask: string; expect: RegExp }> = [
  { kind: 'pptx', file: 'deck-small.pptx', ask: 'What are the two chart series names on the revenue slide?', expect: /Plan.*Actual|Actual.*Plan/is },
  { kind: 'docx', file: 'manual.docx', ask: 'What is the northern zone codeword?', expect: /HELIOTROPE-9/ },
  { kind: 'xlsx', file: 'model.xlsx', ask: 'What sentinel text is in the Notes sheet?', expect: /XLSX-SHEET3-OSPREY/ },
  { kind: 'pdf', file: 'survey.pdf', ask: 'What is the marker on page 3?', expect: /PDFPAGE-3-LYNX/ },
  { kind: 'csv', file: 'readings.csv', ask: 'Name the four columns.', expect: /station[\s\S]*flow_lps/i },
  { kind: 'json', file: 'config.json', ask: 'What is flags.sentinel?', expect: /JSON-NIGHTJAR-77/ },
  { kind: 'yaml', file: 'notes.yaml', ask: 'What is the sentinel value?', expect: /YAML-CORMORANT-5/ },
  { kind: 'md', file: 'spec.md', ask: 'What is the review codeword?', expect: /MD-TANAGER-8/ },
  { kind: 'txt', file: 'notes.txt', ask: 'What is the fixture codeword?', expect: /KESTREL-42/ },
  { kind: 'py', file: 'calc.py', ask: 'What is SENTINEL, and what does total([2]) return?', expect: /PY-IBEX-31/ },
  { kind: 'png', file: 'red.png', ask: 'One word: what color is this image?', expect: /\bred\b/i },
  { kind: 'jpg', file: 'green.jpg', ask: 'One word: what color is this image?', expect: /\bgreen\b/i },
];

test.describe('ULTRA file types', () => {
  test.afterAll(cleanupMarked);

  for (const c of CASES) {
    test(`${c.kind}: sentinel read from inside the file`, async ({ page }) => {
      await attachAndAsk(page, [fixture(c.file)], c.ask);
      await pollBody(page, c.expect, 120_000);
    });
  }

  test('py: computed answer proves code comprehension', async ({ page }) => {
    await attachAndAsk(page, [fixture('calc.py')], 'What does total([2]) return? Just the number.');
    await pollBody(page, /\b6\b/, 120_000);
  });
});
