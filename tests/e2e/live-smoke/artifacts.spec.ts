/**
 * Phase 3 — artifact suite (TESTPLAN §5 A{skill}-*). Live Bedrock (Haiku for
 * office/code generation per officeGenerationModel() policy); structural
 * assertions only, never prose. One test.describe.serial block per skill: the
 * create step's conversation + artifact are reused by edit/version/render so
 * each skill costs ~3 model calls instead of regenerating from scratch per
 * assertion. Router decisions are asserted from pipeline.log, never inferred.
 *
 * The zero-tolerance gate (A{skill}-edit): the historical "modify my
 * PowerPoint" bug returned a description instead of an edited file. The
 * assertion here checks the LAST ASSISTANT MESSAGE's kind is 'pipeline' with
 * a bumped version — not just "a pipeline message exists somewhere" (a stale
 * one from create() would false-pass that weaker check).
 */
import { test, expect } from '@playwright/test';
import { createConv, cleanupE2E, MARK } from '../../helpers/axiom-api.js';
import {
  sendAndWait,
  validateFile,
  downloadArtifact,
  validatableFile,
  artifactDetail,
  lastMessage,
  routerDecisions,
} from '../../helpers/artifacts.js';

interface SkillCase {
  id: string;
  ext: string;
  createPrompt: string;
  createSpec?: { slides?: number; contains?: string[]; sheets?: string[]; columns?: string[] };
  editPrompt: string;
  editMustContain: string; // sentinel the edit introduces — proves it's a real edit, not a no-op
  createMustContain?: string; // sentinel from create that must survive the edit untouched
}

const CASES: SkillCase[] = [
  {
    id: 'pptx',
    ext: 'pptx',
    createPrompt: `${MARK} Build a four-slide deck introducing our incident management process: overview, roles, escalation, postmortems.`,
    createSpec: { contains: ['incident'] },
    editPrompt: 'Change the title of the first slide to exactly "AUDIT-EDIT-PPTX-TITLE".',
    editMustContain: 'AUDIT-EDIT-PPTX-TITLE',
    createMustContain: 'incident',
  },
  {
    id: 'docx',
    ext: 'docx',
    createPrompt: `${MARK} Write a one-page memo announcing a new travel expense policy effective August 1, with sections for scope, limits, and approvals.`,
    createSpec: { contains: ['travel'] },
    editPrompt: 'Add a final section titled exactly "AUDIT-EDIT-DOCX-SECTION" covering international travel.',
    editMustContain: 'AUDIT-EDIT-DOCX-SECTION',
    createMustContain: 'travel',
  },
  {
    id: 'xlsx',
    ext: 'xlsx',
    createPrompt: `${MARK} Build a budget tracker spreadsheet: 5 expense categories, columns for monthly plan, actual, and a variance formula per row.`,
    // no createSpec: header wording is the model's reasonable choice to make
    // ("Expense Category" vs "Category" vs "Line Item" are all correct) —
    // v_xlsx's structural checks (real formulas, no #REF!/#DIV/0!) apply
    // regardless of spec and are the actual gate here.
    editPrompt: 'Add a sixth category row named exactly "AUDIT-EDIT-XLSX-ROW" with plan 500 and actual 450.',
    editMustContain: 'AUDIT-EDIT-XLSX-ROW',
  },
  {
    id: 'pdf',
    ext: 'pdf',
    createPrompt: `${MARK} Generate a two-page onboarding checklist PDF for new engineers: accounts, tooling, first-week goals.`,
    createSpec: { contains: ['onboarding'] },
    editPrompt: 'Add a section titled exactly "AUDIT-EDIT-PDF-SECTION" about enabling the password manager.',
    editMustContain: 'AUDIT-EDIT-PDF-SECTION',
    createMustContain: 'onboarding',
  },
  {
    id: 'md',
    ext: 'md',
    createPrompt: `${MARK} Write a README for a CLI tool called axiom-sync that syncs folders to S3: purpose, install, usage.`,
    createSpec: { contains: ['axiom-sync'] },
    editPrompt: 'Add a section titled exactly "AUDIT-EDIT-MD-SECTION" documenting the --dry-run flag.',
    editMustContain: 'AUDIT-EDIT-MD-SECTION',
    createMustContain: 'axiom-sync',
  },
  {
    id: 'mermaid',
    ext: 'mmd',
    createPrompt: `${MARK} Diagram the flow of a user login: browser, API, token check, session.`,
    editPrompt: 'Add a node labeled exactly "AUDIT-EDIT-MERMAID-NODE" for a failed-login retry path.',
    editMustContain: 'AUDIT-EDIT-MERMAID-NODE',
  },
  {
    id: 'svg',
    ext: 'svg',
    createPrompt: `${MARK} Design a minimal line-art icon of a paper airplane.`,
    editPrompt: 'Add a text label reading exactly "AUDIT-EDIT-SVG-LABEL" beneath the icon.',
    editMustContain: 'AUDIT-EDIT-SVG-LABEL',
  },
  {
    id: 'react',
    ext: 'jsx',
    createPrompt: `${MARK} Build a small interactive tip calculator component: bill amount, tip percent, total.`,
    editPrompt: 'Add a heading with the exact text "AUDIT-EDIT-REACT-HEADING" above the calculator.',
    editMustContain: 'AUDIT-EDIT-REACT-HEADING',
  },
  {
    id: 'site',
    ext: 'html',
    createPrompt: `${MARK} Build a multi-section landing page prototype for a document automation product: hero, features, footer.`,
    editPrompt: 'Add a footer paragraph with the exact text "AUDIT-EDIT-SITE-FOOTER".',
    editMustContain: 'AUDIT-EDIT-SITE-FOOTER',
  },
];

for (const c of CASES) {
  test.describe(`A${c.id} artifact lifecycle`, () => {
    // scoped to THIS skill's describe block only — a bare top-level
    // configure() call put the whole FILE in one serial suite, so an early
    // xlsx failure cascade-skipped every later skill (pdf through site)
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(240_000);
    let convId: string;
    let artifactId: string;
    let v1File: string;

    test.afterAll(async () => {
      await cleanupE2E().catch(() => undefined);
    });

    test(`A${c.id}-create create → routes correctly → validates`, async () => {
      const conv = await createConv();
      convId = conv.id;
      const res = await sendAndWait(convId, c.createPrompt, { timeoutMs: 200_000 });
      expect(res.error, `create errored: ${res.error}`).toBeUndefined();
      expect(res.artifact, 'no artifact event received').toBeTruthy();
      expect(res.artifact!.kind).toBe(c.id);
      artifactId = res.artifact!.artifactId;

      const decisions = routerDecisions(convId);
      expect(decisions.length, 'no router decision logged for this conversation').toBeGreaterThan(0);
      expect(decisions[0]!.skill).toBe(c.id);

      v1File = await validatableFile(c.id, artifactId, 1, c.ext);
      const verdict = await validateFile(c.id, v1File, c.createSpec);
      expect(verdict.ok, `validity findings: ${JSON.stringify(verdict.findings)}`).toBe(true);
    });

    test(`A${c.id}-edit edit-vs-describe (zero tolerance)`, async () => {
      const res = await sendAndWait(convId, c.editPrompt, { timeoutMs: 200_000 });
      expect(res.error, `edit errored: ${res.error}`).toBeUndefined();

      // THE gate: the last assistant message must be a pipeline (artifact) message,
      // never a text-only description of the requested change.
      const last = await lastMessage(convId);
      expect(last?.kind, `expected an edited artifact, got a "${last?.kind}" message: ${JSON.stringify(last).slice(0, 300)}`).toBe(
        'pipeline',
      );
      expect(last?.artifact?.artifactId).toBe(artifactId);
      expect(last?.artifact?.ver, 'edit must bump the version').toBeGreaterThanOrEqual(2);

      const v2 = last!.artifact!.ver;
      const v2File = await validatableFile(c.id, artifactId, v2, c.ext);
      const verdict = await validateFile(c.id, v2File, { contains: [c.editMustContain] });
      expect(verdict.ok, `post-edit validity findings: ${JSON.stringify(verdict.findings)}`).toBe(true);

      if (c.createMustContain) {
        const untouched = await validateFile(c.id, v2File, { contains: [c.createMustContain] });
        expect(untouched.ok, `edit dropped pre-existing content: ${JSON.stringify(untouched.findings)}`).toBe(true);
      }
    });

    test(`A${c.id}-version both versions listed and retrievable`, async () => {
      const detail = await artifactDetail(artifactId);
      expect(detail.versions.length).toBeGreaterThanOrEqual(2);
      const v1 = detail.versions.find((v) => v.version === 1);
      const latest = detail.versions.find((v) => v.version === Math.max(...detail.versions.map((x) => x.version)));
      expect(v1?.hasFile, 'v1 file missing after edit — edit must not destroy prior versions').toBe(true);
      expect(latest?.hasFile).toBe(true);
    });

    test(`A${c.id}-export downloaded file is non-trivial and re-fetchable`, async () => {
      const detail = await artifactDetail(artifactId);
      const latestVer = Math.max(...detail.versions.map((v) => v.version));
      const file = await downloadArtifact(artifactId, latestVer, c.ext);
      const { statSync } = await import('node:fs');
      expect(statSync(file).size, 'downloaded file implausibly small').toBeGreaterThan(200);
    });
  });
}
