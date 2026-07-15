import { routeWorkflow } from '../../../server/src/pipeline/router.js';
import type { RouterSignals } from '../../../server/src/pipeline/router.types.js';

const base: RouterSignals = {
  artifactInContext: false, lastArtifactKind: null, lastMsgProducedArtifact: false,
  lastMsgWasSubstantive: false, fileUploadPresent: false, imageUploadPresent: false,
  multipleUploads: false, uploadKinds: [], urlInMessage: false,
};
const withArt = (k: string): RouterSignals => ({ ...base, artifactInContext: true, lastArtifactKind: k, lastMsgProducedArtifact: true });
const withUpload = (ext: string): RouterSignals => ({ ...base, fileUploadPresent: true, uploadKinds: [ext] });

const cases: Array<[string, RouterSignals, string]> = [
  ['make me a 10-slide deck on Q3 sales', base, 'create-pptx'],
  ['modify it', withArt('pptx'), 'edit-pptx'],
  ['change slide 3 title to Roadmap', withArt('pptx'), 'edit-pptx'],
  ['fix the typo in the intro paragraph', withArt('docx'), 'edit-docx'],
  ['add a column for margin', withArt('xlsx'), 'edit-xlsx'],
  ['make it shorter', withArt('md'), 'followup-anaphora'],
  ['remember my manager is Dana', base, 'remember-fact'],
  ['forget that my car is blue', base, 'forget-fact'],
  ['write a report on climate policy', base, 'create-docx'],
  ['build a spreadsheet to track my budget', base, 'create-xlsx'],
  ['create a flowchart of the login flow', base, 'create-diagram'],
  ['design an icon of a paper plane', base, 'create-svg'],
  ['build an interactive dashboard for sales', base, 'create-react-app'],
  ['summarize the csv and then build a deck from it', withUpload('csv'), 'data-analysis-on-file'],
  ['what does this say?', withUpload('pdf'), 'read-summarize-file'],
  ['analyze this and chart revenue by region', withUpload('csv'), 'data-analysis-on-file'],
  ['refactor the handleClick function', withArt('react'), 'edit-code-artifact'],
  ['convert the deck to a pdf', withArt('pptx'), 'convert-between-formats'],
];

async function main(): Promise<void> {
  let pass = 0;
  for (const [msg, sig, expect] of cases) {
    const d = await routeWorkflow({ message: msg, history: [], signals: sig });
    const ok = d.workflowId === expect && d.stage === 'deterministic';
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${d.workflowId}/${d.stage}  (exp ${expect})  :: ${msg}`);
    if (d.orderedPlan) console.log(`        orderedPlan=${d.orderedPlan.join(' -> ')}`);
  }
  console.log(`\n${pass}/${cases.length} deterministic Stage-1 hits`);
}
void main();
