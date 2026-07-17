/**
 * Cross-cutting Phase 3 checks (TESTPLAN §5): AX-upload-edit is the exact
 * historical bug class stated in the command brief — "create a PowerPoint,
 * then ask to modify it" — replayed against an UPLOADED file instead of a
 * prior artifact. router.ts stage1 rule 7 routes upload+edit-verb straight to
 * an edit workflow (editWorkflowForKind off the upload kind), but chat.ts has
 * no pre-existing `editable` artifact to hand runEditDoc — it falls through to
 * runCreateDoc, using the extracted upload text as context. The zero-tolerance
 * gate is identical either way: the response must be a produced FILE, never a
 * prose description of what changed.
 */
import { test, expect } from '@playwright/test';
import { createConv, cleanupE2E, MARK } from '../../helpers/axiom-api.js';
import { sendAndWait, validateFile, downloadArtifact, lastMessage, uploadFixture, routerDecisions } from '../../helpers/artifacts.js';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => {
  await cleanupE2E().catch(() => undefined);
});

interface UploadCase {
  skill: string;
  ext: string;
  file: string;
  editPrompt: string;
  sentinel: string;
}

const CASES: UploadCase[] = [
  {
    skill: 'docx',
    ext: 'docx',
    file: 'sample.docx',
    editPrompt: `${MARK} Fix this document: add a section titled exactly "AUDIT-UPLOAD-EDIT-DOCX" covering rollback procedures.`,
    sentinel: 'AUDIT-UPLOAD-EDIT-DOCX',
  },
  {
    skill: 'xlsx',
    ext: 'xlsx',
    file: 'sample.xlsx',
    editPrompt: `${MARK} Fix this spreadsheet: add a row named exactly "AUDIT-UPLOAD-EDIT-XLSX" with plan 300 and actual 250.`,
    sentinel: 'AUDIT-UPLOAD-EDIT-XLSX',
  },
  {
    skill: 'pdf',
    ext: 'pdf',
    file: 'sample.pdf',
    editPrompt: `${MARK} Fix this PDF: add a section titled exactly "AUDIT-UPLOAD-EDIT-PDF" about badge access.`,
    sentinel: 'AUDIT-UPLOAD-EDIT-PDF',
  },
];

for (const c of CASES) {
  test(`AX-upload-edit [${c.skill}] uploaded file edit never describes — produces a real file`, async () => {
    test.setTimeout(240_000);
    const conv = await createConv();
    const att = await uploadFixture(c.file);
    const res = await sendAndWait(conv.id, c.editPrompt, { attachments: [att], timeoutMs: 200_000 });
    expect(res.error, `edit errored: ${res.error}`).toBeUndefined();

    const decisions = routerDecisions(conv.id);
    expect(decisions.length, 'no router decision logged').toBeGreaterThan(0);
    expect(decisions[0]!.intent, 'router must classify an upload+edit-verb request as edit_doc, not chat').toBe('edit_doc');

    const last = await lastMessage(conv.id);
    expect(
      last?.kind,
      `expected a produced file, got a "${last?.kind}" message (description-only — the historical modify-bug class): ${JSON.stringify(last).slice(0, 300)}`,
    ).toBe('pipeline');
    expect(last?.artifact?.kind).toBe(c.skill);

    const file = await downloadArtifact(last!.artifact!.artifactId, last!.artifact!.ver, c.ext);
    const verdict = await validateFile(c.skill, file, { contains: [c.sentinel] });
    expect(verdict.ok, `validity findings: ${JSON.stringify(verdict.findings)}`).toBe(true);
  });
}

test('AX-multi prose + artifact: chat keeps prose, artifact keeps the document (no full-document dump in transcript)', async () => {
  test.setTimeout(180_000);
  const conv = await createConv();
  const res = await sendAndWait(
    conv.id,
    `${MARK} Create a two-page onboarding checklist PDF for new analysts, and briefly tell me what you included.`,
    { timeoutMs: 150_000 },
  );
  expect(res.error, `errored: ${res.error}`).toBeUndefined();
  expect(res.artifact?.kind).toBe('pdf');

  const last = await lastMessage(conv.id);
  expect(last?.kind).toBe('pipeline');
  const chatText = last?.text ?? '';
  // the chat-facing summary must stay a short blurb, not the whole document
  // dumped into the transcript (heuristic: nowhere near a full checklist's length)
  expect(chatText.length, `chat text looks like a full document dump (${chatText.length} chars): ${chatText.slice(0, 200)}`).toBeLessThan(
    900,
  );

  const file = await downloadArtifact(res.artifact!.artifactId, res.artifact!.ver, 'pdf');
  const verdict = await validateFile('pdf', file, { contains: ['onboarding'] });
  expect(verdict.ok, `validity findings: ${JSON.stringify(verdict.findings)}`).toBe(true);
});
