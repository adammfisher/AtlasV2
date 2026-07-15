/**
 * W1 search-reliability (parity audit): 10 varied queries through the LIVE
 * webSearch used by chat. Gate ≥9/10 usable (≥2 results with real URLs).
 * Usage: tsx scripts/test/parity-w1-search.ts
 */
import { webSearch } from '../../server/src/tools/web.js';

const QUERIES = [
  'current AWS Lambda timeout maximum',
  'python-pptx add speaker notes example',
  'weather in Osaka today',
  'DynamoDB single table design pros cons',
  'React useEffect cleanup function',
  'EU AI Act enforcement date',
  'best practices S3 presigned URL expiry',
  'TypeScript satisfies operator',
  'CloudFront origin read timeout default',
  'LibreOffice headless convert pptx to pdf',
];

let usable = 0;
for (const q of QUERIES) {
  // realistic pacing — the gate measures user-facing reliability, and DDG
  // bot-detects rapid-fire query batteries (which no human produces)
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const out = await webSearch(q);
    const urls = (out.match(/https?:\/\//g) ?? []).length;
    const ok = urls >= 2 && !/search failed|no results/i.test(out);
    if (ok) usable++;
    console.log(`${ok ? '✓' : '✗'} ${q} (${urls} urls)`);
  } catch (err) {
    console.log(`✗ ${q} — threw: ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`\nW1: ${usable}/10 usable — gate ≥9 → ${usable >= 9 ? 'GREEN' : 'RED'}`);
process.exit(usable >= 9 ? 0 : 1);
