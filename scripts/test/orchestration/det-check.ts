/** Offline (no-Bedrock) deterministic-coverage check: runs every dataset case
 * through Stage 1 only. Reports coverage + any FALSE deterministic matches. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { preRoute } from '../../../server/src/pipeline/router.js';
import type { RouterSignals } from '../../../server/src/pipeline/router.types.js';

interface PC { lastArtifact?: string; upload?: string; uploads?: string[]; image?: string; url?: boolean; lastAnswer?: boolean }
interface Case { prompt: string; priorContext?: PC; expectedWorkflowId?: string; expectedOrderedPlan?: string[]; class: string }
const here = path.dirname(fileURLToPath(import.meta.url));
const cases: Case[] = readFileSync(path.join(here, 'dataset.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Case);
const sig = (pc?: PC): RouterSignals => {
  const uploads = pc?.uploads ?? (pc?.upload ? [pc.upload] : []);
  return { artifactInContext: !!pc?.lastArtifact, lastArtifactKind: pc?.lastArtifact ?? null, lastMsgProducedArtifact: !!pc?.lastArtifact,
    lastMsgWasSubstantive: !!pc?.lastAnswer || !!pc?.lastArtifact, fileUploadPresent: uploads.length > 0, imageUploadPresent: !!pc?.image,
    multipleUploads: uploads.length > 1, uploadKinds: uploads.map((f) => f.split('.').pop() ?? ''), urlInMessage: !!pc?.url };
};
const exp = (c: Case): string => c.expectedWorkflowId ?? c.expectedOrderedPlan?.[0] ?? '?';
let hits = 0, falses = 0, edvdCovered = 0, edvdTotal = 0;
for (const c of cases) {
  const r = preRoute({ message: c.prompt, history: [], signals: sig(c.priorContext) });
  if (c.class === 'edit-vs-describe') edvdTotal++;
  if (!r) continue;
  hits++;
  if (c.class === 'edit-vs-describe') edvdCovered++;
  const ok = c.expectedOrderedPlan ? (r.orderedPlan?.join() === c.expectedOrderedPlan.join() || r.workflowId === c.expectedOrderedPlan[0]) : r.workflowId === exp(c);
  if (!ok) { falses++; console.log(`FALSE  [${c.class}] exp ${exp(c)} → got ${r.workflowId}${r.orderedPlan ? ` plan=[${r.orderedPlan}]` : ''} :: ${c.prompt.slice(0, 62)}`); }
}
console.log(`\nStage-1 coverage: ${hits}/${cases.length} deterministic  ·  edit-vs-describe covered ${edvdCovered}/${edvdTotal}  ·  FALSE matches: ${falses}`);
process.exit(falses === 0 ? 0 : 1);
