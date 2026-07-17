/**
 * SSE stream recorder (TESTPLAN.md §4). Records one real streaming transcript
 * per skill into tests/fixtures/sse/<name>.sse.jsonl:
 *   line 1: {"meta": {name, prompt, convId, recordedAt, events: {...counts}}}
 *   rest:   {"t": <ms offset>, "chunk": "<raw bytes as utf8>"}
 * Raw chunks (not parsed events) so the replayer reproduces exact wire framing,
 * including multi-event chunks and split frames.
 *
 * Usage: npx tsx tests/helpers/sse-record.ts <name> "<prompt>"
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConv, streamMessage, MARK } from './atlas-api.js';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sse');

export async function recordTranscript(name: string, prompt: string): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const conv = await createConv();
  const frames: Array<{ t: number; chunk: string }> = [];
  const counts: Record<string, number> = {};
  for await (const f of streamMessage(conv.id, `${MARK} ${prompt}`)) {
    frames.push(f);
    for (const m of f.chunk.matchAll(/^event: (\S+)$/gm)) counts[m[1]!] = (counts[m[1]!] ?? 0) + 1;
  }
  const file = path.join(outDir, `${name}.sse.jsonl`);
  const meta = { name, prompt, convId: conv.id, recordedAt: new Date().toISOString(), events: counts };
  writeFileSync(file, [JSON.stringify({ meta }), ...frames.map((f) => JSON.stringify(f))].join('\n'));
  return file;
}

const [name, prompt] = process.argv.slice(2);
if (name && prompt) {
  recordTranscript(name, prompt)
    .then((f) => {
      console.log(`recorded → ${f}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('record failed:', err);
      process.exit(1);
    });
}
