/**
 * DELIVERABLE E — edit-contract e2e gate.
 *
 * Proves the permanent modify-bug fix end-to-end:
 *   G1  state missing  → OrchestrationError thrown 100% of the time (never describe)
 *   G2  state present  → resolver loads it and injectEditContext reinjects the
 *                        ACTUAL current state under <current_artifact> with a
 *                        non-describe contract (the mechanism that forces editing)
 *   G3  routing        → every modify request routes to an edit-* workflow
 *   G4  real edit      → a live md edit (Bedrock, no office lambda) returns a
 *                        MODIFIED artifact whose source DIFFERS from the prior
 *                        version — an artifact, not a text description
 *
 * HARD GATES: G1/G2/G3 = 100%; G4 (representative subset) must produce a
 * differing artifact for every attempted case.
 *
 *   pnpm test:e2e-brain
 */
import { runAsAccount } from '../../../server/src/lib/account.js';
import { ensureBedrockConnected } from '../../../server/src/providers/bedrock.js';
import { createArtifact, addVersion, latestPayload } from '../../../server/src/pipeline/artifacts.js';
import { deleteArtifact } from '../../../server/src/db/appdb.js';
import {
  resolveEditTarget,
  loadLatestState,
  injectEditContext,
  requireEditState,
  OrchestrationError,
  type EditTarget,
} from '../../../server/src/pipeline/artifactContext.js';
import { runEditDoc } from '../../../server/src/pipeline/orchestrator.js';
import { routeWorkflow } from '../../../server/src/pipeline/router.js';
import type { RouterSignals } from '../../../server/src/pipeline/router.types.js';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const PROJECT = 'p-brain-e2e';
const withArt = (kind: string): RouterSignals => ({
  artifactInContext: true, lastArtifactKind: kind, lastMsgProducedArtifact: true, lastMsgWasSubstantive: true,
  fileUploadPresent: false, imageUploadPresent: false, multipleUploads: false, uploadKinds: [], urlInMessage: false,
});
const EDIT_KINDS = ['pptx', 'docx', 'xlsx', 'pdf', 'md', 'react'];

async function main(): Promise<void> {
  await runAsAccount('adammfisher', async () => {
    await ensureBedrockConnected();

    // ── G1: state missing → loud failure, never describe ─────────────────────
    console.log('\nG1 — state missing throws (never describes):');
    // no artifact and no upload → target cannot resolve
    for (const kind of EDIT_KINDS) {
      let threw = '';
      try {
        await requireEditState('conv-none', 'modify it', {});
      } catch (e) {
        threw = e instanceof OrchestrationError ? e.code : 'other';
      }
      ok(`[${kind}] no target → OrchestrationError`, threw === 'EDIT_TARGET_UNRESOLVED', `got ${threw}`);
    }
    // a named artifact that does not exist in the store → state cannot load
    for (const kind of EDIT_KINDS) {
      let threw = '';
      try {
        await requireEditState('conv-x', 'change the title', {
          lastArtifact: { artifactId: 'a-does-not-exist', kind, name: `ghost.${kind}` },
        });
      } catch (e) {
        threw = e instanceof OrchestrationError ? e.code : 'other';
      }
      ok(`[${kind}] missing payload → EDIT_STATE_UNAVAILABLE`, threw === 'EDIT_STATE_UNAVAILABLE', `got ${threw}`);
    }
    // loadLatestState on an upload (no stored projection) is null → resolver throws
    const uploadTarget: EditTarget = { kind: 'pptx', id: 'up1', name: 'x.pptx', source: 'upload' };
    ok('upload with no projection → loadLatestState null', (await loadLatestState(uploadTarget)) === null);

    // ── G2: state present → reinjected under <current_artifact> ───────────────
    console.log('\nG2 — present state is reinjected (edit, not describe):');
    const { id: mdId } = await createArtifact(PROJECT, 'e2e-notes.md', 'md', 'conv-e2e');
    const v1Source = '# Runbook\n\n- step one\n- step two\n';
    await addVersion(mdId, { payload: { source: v1Source }, meta: '3 lines', validation: [{ state: 'ok', label: 'seed' }], filePath: `${PROJECT}/${mdId}/v1/e2e-notes.md` });
    const target = await resolveEditTarget('conv-e2e', 'make it longer', { lastArtifact: { artifactId: mdId, kind: 'md', name: 'e2e-notes.md' } });
    ok('resolveEditTarget → non-null target', !!target && target.id === mdId && target.source === 'artifact');
    const state = target ? await loadLatestState(target) : null;
    ok('loadLatestState → current payload', !!state && (state.state as { source?: string }).source === v1Source);
    if (state) {
      const injected = injectEditContext('Apply this change: "make it longer"', state, 'structured-diff');
      ok('injected prompt has <current_artifact>', injected.includes('<current_artifact'));
      ok('injected prompt embeds the ACTUAL current source', injected.includes('step one') && injected.includes('step two'));
      ok('injected prompt forbids describing', /never .*description/i.test(injected));
    }

    // ── G3: every modify request routes to an edit workflow ──────────────────
    console.log('\nG3 — modify requests route to edit-* (deterministic):');
    const g3: Array<[string, string]> = [
      ['modify it', 'pptx'], ['change slide 2 title to X', 'pptx'],
      ['fix the typo in the intro', 'docx'], ['add a column for margin', 'xlsx'],
      ['update the flyer date', 'pdf'], ['add a troubleshooting section', 'md'],
      ['refactor the render function', 'react'],
    ];
    for (const [msg, kind] of g3) {
      const d = await routeWorkflow({ message: msg, history: [], signals: withArt(kind) });
      const isEdit = d.workflowId.startsWith('edit-') || d.workflowId === 'followup-anaphora';
      ok(`[${kind}] "${msg.slice(0, 28)}" → ${d.workflowId}`, isEdit && d.stage === 'deterministic');
    }

    // ── G4: a live md edit produces a MODIFIED artifact (not a description) ───
    console.log('\nG4 — live md edit differs from prior (Bedrock, no office lambda):');
    const g4Cases = ['add a section titled Extras with two bullet points', 'make it more detailed'];
    for (let i = 0; i < g4Cases.length; i++) {
      const { id } = await createArtifact(PROJECT, `e2e-live-${i}.md`, 'md', 'conv-e2e');
      const seed = '# Guide\n\nIntro paragraph.\n\n## Setup\n\n- install\n- configure\n';
      await addVersion(id, { payload: { source: seed }, meta: 'seed', validation: [{ state: 'ok', label: 'seed' }], filePath: `${PROJECT}/${id}/v1/e2e-live-${i}.md` });
      try {
        const payload = await runEditDoc({
          skillId: 'md', artifactId: id, artifactName: `e2e-live-${i}.md`, text: g4Cases[i]!,
          projectId: PROJECT, instructions: '', routerMs: 0, routerModel: 'test',
          send: () => {}, signal: AbortSignal.timeout(90_000),
        });
        const after = await latestPayload(id);
        const newSource = String((after?.payload as { source?: string })?.source ?? '');
        const producedArtifact = !!(payload as { artifact?: unknown }).artifact;
        ok(`[case ${i}] version incremented`, after?.version === 2, `version=${after?.version}`);
        ok(`[case ${i}] source DIFFERS from prior`, newSource.length > 0 && newSource !== seed);
        ok(`[case ${i}] returned an artifact (not a chat description)`, producedArtifact);
      } catch (e) {
        ok(`[case ${i}] live edit ran`, false, e instanceof Error ? e.message : String(e));
      } finally {
        await deleteArtifact(id).catch(() => undefined);
      }
    }

    await deleteArtifact(mdId).catch(() => undefined);

    console.log(`\n${fail === 0 ? 'E2E-BRAIN GATES: ALL PASS' : `E2E-BRAIN GATES: ${fail} FAILURES`}  (${pass}/${pass + fail})`);
    process.exit(fail === 0 ? 0 : 1);
  });
}
void main();
