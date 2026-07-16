/**
 * DELIVERABLE B — Three-stage model-agnostic router.
 *
 * Stage 1  deterministic pre-router (no LLM): high-precision verb/object/predicate
 *          grammar generated FROM the workflow registry triggers. Resolves the
 *          unambiguous cases — critically, every edit request — at confidence 1.0.
 * Stage 2  LLM classification on fall-through: constrained JSON over a narrowed
 *          candidate set. Native structured outputs (Claude tiers) or forced
 *          tool-choice (Nova) — chosen by the per-model capability flag.
 * Stage 3  escalation (small→mid→frontier) when confidence is low, then clarify.
 *
 * A back-compat `route()` adapter preserves the legacy {intent, skill} contract
 * the chat route consumed. The safety invariant (edit-* must reinject non-null
 * state before dispatch) is enforced at dispatch (orchestrator/artifactContext),
 * and the router never emits an edit-* workflow without a resolvable target.
 */
import { logTo } from '../log.js';
import { classifyJson } from '../providers/dispatch.js';
import { activeModelKey, MODEL_KEYS } from '../providers/bedrock.js';
import { modelAllowed } from '../lib/account.js';
import { isSkillId, type SkillId } from './skills.js';
import {
  WORKFLOWS,
  getWorkflow,
  isWorkflowId,
  type Workflow,
  type WorkflowId,
  type ModelTier,
  type OutputContract,
} from './workflows.js';
import type { RouterInput, RouterSignals, RoutingDecision, RouteStage } from './router.types.js';

export type { RouterInput, RouterSignals, RoutingDecision } from './router.types.js';

// ─── tunable thresholds (Deliverable B) ──────────────────────────────────────
export const ESCALATE_THRESHOLD = 0.75;
export const CLARIFY_THRESHOLD = 0.5;

const TIER_MODELS: Record<ModelTier, string> = { small: 'nova', mid: 'haiku', frontier: 'sonnet' };
const TIER_ORDER: ModelTier[] = ['small', 'mid', 'frontier'];

/** The classifier model for a tier. TIER_MODELS names the ideal model per tier,
 * but it is a catalog-wide constant: an account's users.config.json list may not
 * include it (only `nova` is common to every account today). Checking existence
 * alone routed those accounts onto a model they are not allowed to run, since
 * classifyJson pins the model id and so bypasses the activeModelDef clamp.
 * Falling back to the account's own active model keeps escalation useful — the
 * per-tier prompt still gets richer even when the model repeats. */
function resolveTierModel(tier: ModelTier): string {
  const want = TIER_MODELS[tier];
  return MODEL_KEYS.includes(want) && modelAllowed(want) ? want : activeModelKey();
}
function tierOf(modelKey: string): ModelTier {
  if (modelKey === 'nova') return 'small';
  if (modelKey === 'sonnet') return 'frontier';
  return 'mid';
}

// ─── word matching ───────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** word-boundary match for a phrase (spaces are literal). */
function hasWord(message: string, phrase: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${esc(phrase.toLowerCase())}(?:$|[^a-z0-9])`, 'i').test(message.toLowerCase());
}
function anyWord(message: string, phrases: string[]): boolean {
  return phrases.some((p) => hasWord(message, p));
}
/** longest matched phrase length (0 = none). */
function longestHit(message: string, phrases: string[]): number {
  let best = 0;
  for (const p of phrases) if (hasWord(message, p)) best = Math.max(best, p.length);
  return best;
}

// ─── trigger tables derived from the registry (single source of truth) ───────
function wf(id: WorkflowId): Workflow {
  return getWorkflow(id);
}
function verbsOf(ids: WorkflowId[]): string[] {
  return [...new Set(ids.flatMap((id) => wf(id).triggers.verbs ?? []))];
}

const EDIT_IDS: WorkflowId[] = ['edit-pptx', 'edit-docx', 'edit-xlsx', 'edit-pdf', 'edit-md', 'edit-code-artifact', 'edit-visual-artifact'];
const CREATE_IDS: WorkflowId[] = [
  'create-pptx', 'create-docx', 'create-xlsx', 'create-pdf', 'create-md',
  'create-diagram', 'create-svg', 'create-react-app', 'create-site', 'create-code-artifact',
];

// Derived from the registry triggers (single source of truth). The ambiguous
// families (remember/forget/convert and the new/another anti-signals) use the
// precise RE_* patterns below instead of raw word lists — greedy word matches
// (save/note/new) caused misroutes; the regexes keep precision high.
const EDIT_VERBS = verbsOf(EDIT_IDS);
const CREATE_VERBS = verbsOf(CREATE_IDS);
const DOWNLOAD_VERBS = verbsOf(['export-download-request']);
const SUMMARIZE_VERBS = verbsOf(['read-summarize-file']);
const ANALYZE_VERBS = verbsOf(['data-analysis-on-file']);
const MULTIFILE_VERBS = verbsOf(['multi-file-synthesis']);
const IMAGE_VERBS = verbsOf(['image-understanding']);
// anaphoric follow-up modifiers (from followup-anaphora triggers)
const FOLLOWUP_TOKENS = [...verbsOf(['followup-anaphora']), 'redo', 'condense', 'expand', 'casual'];

// create-workflow priority for unique-noun matching (specific → generic)
const CREATE_PRIORITY: WorkflowId[] = [
  'create-pptx', 'create-xlsx', 'create-pdf', 'create-diagram', 'create-svg',
  'create-site', 'create-react-app', 'create-code-artifact', 'create-docx', 'create-md',
];
const CREATE_SKILL: Record<string, SkillId> = {
  'create-pptx': 'pptx', 'create-docx': 'docx', 'create-xlsx': 'xlsx', 'create-pdf': 'pdf',
  'create-md': 'md', 'create-diagram': 'mermaid', 'create-svg': 'svg',
  'create-react-app': 'react', 'create-site': 'site', 'create-code-artifact': 'react',
};

/** kind of the artifact/upload → the edit workflow that handles it. */
function editWorkflowForKind(kind: string | null | undefined): WorkflowId | null {
  switch (kind) {
    case 'pptx': return 'edit-pptx';
    case 'docx': return 'edit-docx';
    case 'xlsx': case 'csv': return 'edit-xlsx';
    case 'pdf': return 'edit-pdf';
    case 'md': return 'edit-md';
    case 'react': return 'edit-code-artifact';
    case 'site': case 'mermaid': case 'svg': return 'edit-visual-artifact';
    default: return null;
  }
}
function kindFromExt(ext: string): string | null {
  const e = ext.toLowerCase().replace(/^\./, '');
  if (e === 'ppt' || e === 'pptx') return 'pptx';
  if (e === 'doc' || e === 'docx') return 'docx';
  if (e === 'xls' || e === 'xlsx') return 'xlsx';
  if (e === 'csv') return 'csv';
  if (e === 'pdf') return 'pdf';
  if (e === 'md' || e === 'markdown') return 'md';
  if (e === 'svg') return 'svg';
  return null;
}

/** unique deliverable-noun match for a create request; null on tie/none. */
function matchCreate(message: string): { id: WorkflowId; skill: SkillId } | null {
  const scored = CREATE_PRIORITY.map((id) => ({ id, hit: longestHit(message, wf(id).triggers.nounObjects ?? []) })).filter((s) => s.hit > 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((s) => s.hit));
  const winners = scored.filter((s) => s.hit === best);
  if (winners.length !== 1) return null; // ambiguous → Stage 2
  const id = winners[0]!.id;
  return { id, skill: CREATE_SKILL[id]! };
}

const URL_RE = /(https?:\/\/|www\.)\S+/i;

// High-precision intent patterns for the ambiguous families the LLM fumbles.
// Kept intentionally narrow (precision over recall) — a miss just falls through
// to Stage 2, but a false positive would misroute a real request.
const RE_RECALL = /\b(do you (remember|recall)|what did i (say|tell|give|mention)|what (is|was) my|what'?s my|remind me what)\b/i;
const RE_REMEMBER = /\b(remember|memoriz(e|ing)|keep in mind|make a note|note that|save that|jot down|don'?t forget|do not forget)\b/i;
const RE_FORGET = /\b(forget|stop remembering|delete that memory|unsave|remove that (fact|memory))\b/i;
const RE_HARM =
  /\b(malware|ransomware|keylogger|spyware|phishing|botnet)\b|\bbuild (a |an )?(bomb|explosive|weapon)\b|\bpick (a |the )?lock\b|\bbreak into\b|\bstalk\b|\bpoison\b|\b(steal|stealing|harvest)\b[\s\S]{0,24}\b(password|login|credential|bank)\b/i;
const RE_MCP =
  /\b(jira|slack|github|gitlab|trello|asana|linear|notion)\b|\bticket\b|\bthe connector\b|#\w+|\bopen issues\b|\bcalendar event\b|\bpull request\b|\badd a row\b|\b(from|in) the database\b/i;
const RE_WEB =
  /\b(latest|current(ly)?|recent(ly)?|today|tonight|right now|this (week|morning|year)|last night|yesterday|breaking)\b|\bwho won\b|\b(score|price) of\b|\bstock price\b|\bnews\b|\bweather\b/i;
const RE_PROJECT_DOC =
  /\b(the spec|the docs?|documentation|the requirements?|project (docs|knowledge)|architecture doc|our (spec|docs))\b|\baccording to the\b|\bper the\b|\bin the docs?\b/i;
const RE_CONVERT = /\b(convert|turn|export|save|render|make)\b[\s\S]{0,30}\b(into|as|to)\b|\bconvert\b/i;
const RE_WANT = /\b(i need|i want|i'?d like|can you (make|build|create|whip up|put together|generate|draft)|how about|let'?s (make|build|create))\b/i;
const RE_QUESTION = /\?|^\s*(what|who|when|where|why|how|which|is|are|do|does|can|could)\b/i;
// a real "produce something" verb — used to gate edit-by-reference and to keep
// image/web questions from being stolen by weak create-noun/verb overlaps.
const RE_STRONG_CREATE = /\b(create|make|build|generate|draft|write|design|produce|compose|draw|put together)\b/i;
// research/analysis lead verb → multi-step research (before a create deliverable steals it)
const RE_RESEARCH = /^\s*(research|compare|investigate|evaluate|assess|do a deep dive|deep dive)\b/i;

/** Explicit "make a NEW/SEPARATE artifact" phrasing that blocks edit inference. */
function createAnti(message: string): boolean {
  return (
    /\b(from scratch|brand[- ]new|separate)\b/i.test(message) ||
    /\b(new|another|a second|a different|fresh)\s+(deck|presentation|slide deck|slides|document|doc|report|memo|spreadsheet|sheet|workbook|pdf|diagram|flowchart|icon|logo|site|website|page|version|one|topic)\b/i.test(message)
  );
}

// ─── STAGE 1: deterministic pre-router ───────────────────────────────────────
interface Stage1Hit {
  workflowId: WorkflowId;
  orderedPlan?: WorkflowId[];
}

function stage1(message: string, signals: RouterSignals): Stage1Hit | null {
  const m = message;
  const targetKind = signals.artifactInContext
    ? signals.lastArtifactKind ?? null
    : signals.fileUploadPresent
      ? kindFromExt((signals.uploadKinds ?? [])[0] ?? '')
      : null;
  const targetPresent = signals.artifactInContext || signals.fileUploadPresent;
  const hasCreate = matchCreate(m);
  const isEdit = anyWord(m, EDIT_VERBS);
  const cAnti = createAnti(m);
  const createVerb = anyWord(m, CREATE_VERBS) || RE_WANT.test(m);
  const isData = (signals.uploadKinds ?? []).some((k) => /csv|xlsx|xls/i.test(k));

  // 1) harmful request → refuse (defense-in-depth; the model also refuses)
  if (RE_HARM.test(m)) return { workflowId: 'refuse-decline' };

  // 2) memory question → recall (before the remember imperative)
  if (RE_RECALL.test(m)) return { workflowId: 'recall-from-memory' };

  // 3) remember / forget imperative
  if (RE_REMEMBER.test(m)) return { workflowId: 'remember-fact' };
  if (RE_FORGET.test(m)) return { workflowId: 'forget-fact' };

  // 4) mixed intent: analyze/summarize an upload AND create a deliverable from it
  //    (before convert, so "go over this report and turn it into a deck" chains)
  if (signals.fileUploadPresent && anyWord(m, [...SUMMARIZE_VERBS, ...ANALYZE_VERBS]) && hasCreate) {
    const first: WorkflowId = isData || anyWord(m, ANALYZE_VERBS) ? 'data-analysis-on-file' : 'read-summarize-file';
    return { workflowId: first, orderedPlan: [first, hasCreate.id] };
  }

  // 5) conversion to a named target format from a present source
  if (targetPresent && RE_CONVERT.test(m) && targetFormatSkill(m)) {
    return { workflowId: 'convert-between-formats' };
  }

  // 6) download / export of a present artifact (convert already handled "as PDF")
  if (signals.artifactInContext && anyWord(m, DOWNLOAD_VERBS)) {
    return { workflowId: 'export-download-request' };
  }

  // 7) explicit edit of a present artifact/upload (THE primary modify-bug fix)
  if (isEdit && targetPresent && !cAnti) {
    const editId = editWorkflowForKind(targetKind);
    if (editId) return { workflowId: editId };
  }

  // 8) a real produce-verb naming the existing artifact's OWN type ("make the deck darker")
  if (signals.artifactInContext && hasCreate && !cAnti && hasCreate.skill === targetKind && RE_STRONG_CREATE.test(m)) {
    const editId = editWorkflowForKind(targetKind);
    if (editId) return { workflowId: editId };
  }

  // 9) anaphoric follow-up modifying the last artifact ("shorter", "again", "expand on that")
  if (signals.lastMsgProducedArtifact && anyWord(m, FOLLOWUP_TOKENS) && !hasCreate && !isEdit) {
    return { workflowId: 'followup-anaphora' };
  }

  // 10) a pasted URL to read
  if ((signals.urlInMessage || URL_RE.test(m)) && anyWord(m, [...SUMMARIZE_VERBS, 'read', 'open', 'fetch', 'check', 'what does this say'])) {
    return { workflowId: 'fetch-url-then-answer' };
  }

  // 11) image + a question/vision cue → describe/OCR (never a new artifact)
  if (signals.imageUploadPresent && (RE_QUESTION.test(m) || anyWord(m, [...IMAGE_VERBS, 'read', 'extract', 'show', 'see'])) && !RE_STRONG_CREATE.test(m)) {
    return { workflowId: 'image-understanding' };
  }

  // 12) single uploaded file: analyze (data) vs summarize/read
  if (signals.fileUploadPresent && !signals.multipleUploads) {
    if (isData && anyWord(m, ANALYZE_VERBS)) return { workflowId: 'data-analysis-on-file' };
    if (anyWord(m, SUMMARIZE_VERBS)) return { workflowId: 'read-summarize-file' };
  }

  // 13) multiple uploads to combine/compare
  if (signals.multipleUploads && anyWord(m, MULTIFILE_VERBS)) {
    return { workflowId: 'multi-file-synthesis' };
  }

  // 14) request maps to an external system → MCP tool
  if (RE_MCP.test(m) && !targetPresent) return { workflowId: 'mcp-tool-invocation' };

  // 15) research/analysis lead verb → multi-step research
  if (RE_RESEARCH.test(m) && !targetPresent) return { workflowId: 'multi-step-research' };

  // 16) real-time / post-cutoff query → web search
  if (RE_WEB.test(m) && !targetPresent && !RE_STRONG_CREATE.test(m)) return { workflowId: 'web-search-then-answer' };

  // 17) question grounded in project knowledge/docs
  if (RE_PROJECT_DOC.test(m) && RE_QUESTION.test(m) && !targetPresent) return { workflowId: 'project-knowledge-qa' };

  // 18) explicit create of a unique deliverable — unless it's clearly an edit
  if (hasCreate && createVerb) {
    if (isEdit && targetPresent && !cAnti) return null; // ambiguous edit/create → Stage 2
    return { workflowId: hasCreate.id };
  }

  return null;
}

/** Stage-1-only result (deterministic; no LLM). Exposed for offline eval. */
export function preRoute(input: RouterInput): { workflowId: WorkflowId; orderedPlan?: WorkflowId[] } | null {
  return stage1(input.message, input.signals);
}

// ─── STAGE 2: LLM classification over a narrowed candidate set ────────────────
function scoreWorkflow(message: string, w: Workflow, signals: RouterSignals): number {
  const t = w.triggers;
  let score = 0;
  score += (t.verbs ?? []).filter((v) => hasWord(message, v)).length * 2;
  score += longestHit(message, t.nounObjects ?? []) > 0 ? 3 : 0;
  score -= (t.antiSignals ?? []).filter((a) => hasWord(message, a)).length * 3;
  const preds = t.predicates ?? [];
  if (preds.includes('fileUploadPresent')) score += signals.fileUploadPresent ? 3 : -4;
  if (preds.includes('imageUploadPresent')) score += signals.imageUploadPresent ? 4 : -6;
  if (preds.includes('multipleUploads')) score += signals.multipleUploads ? 4 : -6;
  if (preds.includes('urlInMessage')) score += signals.urlInMessage ? 5 : -6;
  if (preds.includes('artifactInContext')) score += signals.artifactInContext ? 2 : -8;
  if (preds.includes('lastMsgProducedArtifact')) score += signals.lastMsgProducedArtifact ? 2 : -3;
  return score;
}

/** exclude workflows that cannot possibly apply this turn. */
function admissible(w: Workflow, signals: RouterSignals): boolean {
  const target = signals.artifactInContext || signals.fileUploadPresent;
  if (w.id.startsWith('edit-') && !target) return false;
  if (w.id === 'export-download-request' && !signals.artifactInContext) return false;
  if (w.id === 'convert-between-formats' && !target) return false;
  if (w.id === 'image-understanding' && !signals.imageUploadPresent) return false;
  if (w.id === 'multi-file-synthesis' && !signals.multipleUploads) return false;
  if (w.id === 'followup-anaphora' && !(signals.lastMsgProducedArtifact || signals.lastMsgWasSubstantive)) return false;
  return true;
}

function candidatesFor(message: string, signals: RouterSignals, seed: WorkflowId[], k = 6): WorkflowId[] {
  const ranked = WORKFLOWS.filter((w) => admissible(w, signals))
    .map((w) => ({ id: w.id, s: scoreWorkflow(message, w, signals) }))
    .sort((a, b) => b.s - a.s)
    .filter((x) => x.s > -2)
    .slice(0, k)
    .map((x) => x.id);
  // always-available safety nets + Stage-1 seeds
  const always: WorkflowId[] = ['plain-conversation-qa', 'clarify-before-acting'];
  return [...new Set([...seed, ...ranked, ...always])];
}

function routeSchema(candidates: WorkflowId[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['workflowId', 'confidence'],
    properties: {
      workflowId: { type: 'string', enum: candidates },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
      orderedPlan: { type: 'array', items: { type: 'string', enum: candidates } },
      alternativeWorkflowId: { type: 'string', enum: candidates },
      alternativeConfidence: { type: 'number' },
    },
  };
}

function classifierSystem(candidates: WorkflowId[], tier: ModelTier): string {
  const lines = candidates.map((id) => `- ${id}: ${wf(id).intent}`);
  const base = [
    'You are the routing classifier inside Atlas. Choose the SINGLE workflow id that best fits the',
    "user's latest message, given the conversation and the context signals. Output only the schema.",
    '',
    'Candidates:',
    ...lines,
    '',
    'Rules:',
    '- If the user asks to fix/modify/edit/change/update an existing artifact, pick the matching edit- workflow — never a describe/answer workflow.',
    '- Put substantial or reusable output in a create-/artifact workflow; keep short factual answers as plain-conversation-qa.',
    '- Only pick clarify-before-acting when the intent is genuinely ambiguous or required context is missing.',
    '- confidence is your calibrated probability (0-1). If two very different workflows are equally likely, lower confidence.',
    '- For a message with two intents, set orderedPlan to the ids in dependency order (read/analyze before create before convert/export).',
  ];
  if (tier === 'small') {
    base.push(
      '',
      'Examples:',
      'msg "make me a 10-slide deck on Q3" → {"workflowId":"create-pptx","confidence":0.95}',
      'msg "modify it" [an artifact exists] → the matching edit- workflow, confidence 0.9',
      'msg "what does this say?" [a file is attached] → {"workflowId":"read-summarize-file","confidence":0.9}',
      'msg "who won the game last night?" → {"workflowId":"web-search-then-answer","confidence":0.9}',
      'msg "help me with this file" [ambiguous] → {"workflowId":"clarify-before-acting","confidence":0.4}',
    );
  }
  return base.join('\n');
}

interface LlmResult {
  workflowId: WorkflowId;
  confidence: number;
  orderedPlan?: WorkflowId[];
  alt?: { id: WorkflowId; confidence: number };
  reasoning?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function classifyAtTier(input: RouterInput, tier: ModelTier, candidates: WorkflowId[]): Promise<LlmResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await classifyOnce(input, tier, candidates);
    if (res) return res;
    if (attempt === 0) await sleep(400); // transient throttle/parse hiccup — one retry
  }
  return null;
}

async function classifyOnce(input: RouterInput, tier: ModelTier, candidates: WorkflowId[]): Promise<LlmResult | null> {
  const modelKey = resolveTierModel(tier);
  const schema = routeSchema(candidates);
  const turns = input.history.slice(-6).map((t) => `${t.role}: ${t.content.slice(0, 300)}`);
  const sig = input.signals;
  const signalLine =
    `signals: artifactInContext=${sig.artifactInContext}` +
    (sig.lastArtifactKind ? `(${sig.lastArtifactKind})` : '') +
    ` fileUpload=${sig.fileUploadPresent}${sig.uploadKinds?.length ? `(${sig.uploadKinds.join(',')})` : ''}` +
    ` image=${sig.imageUploadPresent} multi=${sig.multipleUploads} url=${sig.urlInMessage}` +
    ` lastArtifact=${sig.lastMsgProducedArtifact}`;
  const user = [...turns, signalLine, `user (latest): ${input.message}`].join('\n');
  try {
    const raw = await classifyJson(
      modelKey,
      [
        { role: 'system', content: classifierSystem(candidates, tier) },
        { role: 'user', content: user },
      ],
      schema,
      { temperature: 0.1, maxTokens: 256 },
    );
    const parsed = JSON.parse(raw) as {
      workflowId?: string;
      confidence?: number;
      orderedPlan?: string[];
      alternativeWorkflowId?: string;
      alternativeConfidence?: number;
      reasoning?: string;
    };
    if (!parsed.workflowId || !isWorkflowId(parsed.workflowId)) return null;
    const orderedPlan = (parsed.orderedPlan ?? []).filter(isWorkflowId);
    return {
      workflowId: parsed.workflowId,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      orderedPlan: orderedPlan.length >= 2 ? orderedPlan : undefined,
      alt:
        parsed.alternativeWorkflowId && isWorkflowId(parsed.alternativeWorkflowId)
          ? { id: parsed.alternativeWorkflowId, confidence: parsed.alternativeConfidence ?? 0 }
          : undefined,
      reasoning: parsed.reasoning,
    };
  } catch (err) {
    logTo('pipeline', `router classify(${tier}) error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function outputContract(id: WorkflowId): OutputContract {
  return wf(id).outputContract;
}

function logDecision(d: RoutingDecision, message: string): void {
  logTo(
    'pipeline',
    `route stage=${d.stage} tier=${d.tier} esc=${d.escalated} conf=${d.confidence.toFixed(2)} ` +
      `chosen=${d.workflowId} candidates=[${(d.candidates ?? []).join(',')}] :: ${message.slice(0, 80)}`,
  );
}

// ─── the brain: routeWorkflow ────────────────────────────────────────────────
export async function routeWorkflow(input: RouterInput): Promise<RoutingDecision> {
  const startTier: ModelTier = input.tier ?? tierOf(activeModelKey());

  // STAGE 1 — deterministic
  const hit = stage1(input.message, input.signals);
  if (hit) {
    const d: RoutingDecision = {
      workflowId: hit.workflowId,
      confidence: 1,
      stage: 'deterministic',
      tier: startTier,
      escalated: false,
      ...(hit.orderedPlan ? { orderedPlan: hit.orderedPlan } : {}),
      candidates: [hit.workflowId],
    };
    logDecision(d, input.message);
    return d;
  }

  // STAGE 2/3 — LLM classification with small→mid→frontier escalation
  const seed: WorkflowId[] = [];
  const candidates = candidatesFor(input.message, input.signals, seed);
  const order = TIER_ORDER.slice(TIER_ORDER.indexOf(startTier));
  let best: LlmResult | null = null;
  let usedTier: ModelTier = startTier;
  let escalated = false;

  for (let i = 0; i < order.length; i++) {
    const tier = order[i]!;
    const res = await classifyAtTier(input, tier, candidates);
    if (res && (!best || res.confidence > best.confidence)) {
      best = res;
      usedTier = tier;
      escalated = i > 0;
    }
    if (res && res.confidence >= ESCALATE_THRESHOLD) break; // confident enough
    // otherwise escalate to the next tier up (if any)
  }

  let stage: RouteStage = escalated ? 'escalated' : 'llm';
  let chosen: WorkflowId;
  let confidence: number;
  let orderedPlan: WorkflowId[] | undefined;

  if (!best) {
    // total classifier failure → clarify rather than guess
    chosen = 'clarify-before-acting';
    confidence = 0;
    stage = 'fallback';
  } else {
    chosen = best.workflowId;
    confidence = best.confidence;
    orderedPlan = best.orderedPlan;
    // clarify gate: too low, or a near-tie whose alternative differs in output contract
    const nearTieDifferentContract =
      best.alt &&
      Math.abs(confidence - best.alt.confidence) <= 0.1 &&
      outputContract(best.alt.id) !== outputContract(chosen) &&
      confidence < ESCALATE_THRESHOLD;
    if (confidence < CLARIFY_THRESHOLD || nearTieDifferentContract) {
      chosen = 'clarify-before-acting';
      stage = 'clarify';
    }
  }

  const d: RoutingDecision = {
    workflowId: chosen,
    confidence,
    stage,
    tier: usedTier,
    escalated,
    ...(orderedPlan ? { orderedPlan } : {}),
    candidates,
    ...(best?.reasoning ? { reasoning: best.reasoning } : {}),
  };
  logDecision(d, input.message);
  return d;
}

// ─── legacy adapter — {intent, skill} for the chat route ─────────────────────
export interface RouteResult {
  intent: 'chat' | 'create_doc' | 'edit_doc';
  skill: SkillId | null;
}

const CREATE_TO_SKILL: Partial<Record<WorkflowId, SkillId>> = {
  'create-pptx': 'pptx', 'create-docx': 'docx', 'create-xlsx': 'xlsx', 'create-pdf': 'pdf',
  'create-md': 'md', 'create-diagram': 'mermaid', 'create-svg': 'svg',
  'create-react-app': 'react', 'create-site': 'site', 'create-code-artifact': 'react',
};
const EDIT_TO_SKILL: Partial<Record<WorkflowId, SkillId>> = {
  'edit-pptx': 'pptx', 'edit-docx': 'docx', 'edit-xlsx': 'xlsx', 'edit-pdf': 'pdf', 'edit-md': 'md',
};

function targetFormatSkill(message: string): SkillId | null {
  if (/\b(pdf)\b/i.test(message)) return 'pdf';
  if (/\b(xlsx|excel|spreadsheet)\b/i.test(message)) return 'xlsx';
  if (/\b(docx|word\s+doc|word\s+document)\b/i.test(message)) return 'docx';
  if (/\b(pptx|deck|slides?|presentation)\b/i.test(message)) return 'pptx';
  return null;
}

/** Map a workflow decision back onto the legacy pipeline contract. Edit-family
 * workflows become edit_doc (the chat route resolves the concrete skill from the
 * artifact); create-family become create_doc; everything else is chat. */
export function toLegacyRoute(decision: RoutingDecision, signals: RouterSignals, message = ''): RouteResult {
  const id = decision.workflowId;
  if (id in CREATE_TO_SKILL) return { intent: 'create_doc', skill: CREATE_TO_SKILL[id]! };
  if (id.startsWith('edit-')) {
    const kind = signals.lastArtifactKind;
    const skill = EDIT_TO_SKILL[id] ?? (kind && isSkillId(kind) ? kind : null);
    return { intent: 'edit_doc', skill };
  }
  if (id === 'followup-anaphora') {
    const kind = signals.lastArtifactKind;
    if (signals.artifactInContext && kind && isSkillId(kind)) return { intent: 'edit_doc', skill: kind };
    return { intent: 'chat', skill: null };
  }
  if (id === 'convert-between-formats') {
    // regenerate into the named target format; if it's the same skill as the
    // source it's really an edit, else a fresh create in the target format
    const target = targetFormatSkill(message);
    if (target) {
      const sameAsSource = signals.lastArtifactKind === target;
      return { intent: sameAsSource ? 'edit_doc' : 'create_doc', skill: target };
    }
    return { intent: 'chat', skill: null };
  }
  // read/analyze/web/research/memory/mcp/plain/clarify/refuse/image/multi-file/export → chat
  return { intent: 'chat', skill: null };
}

/**
 * Atlas's `product` skill is a concept-definition master that predates — and is
 * outside — the 35 canonical workflows. This conservative pre-check preserves it
 * without inflating the brain: it fires ONLY on an explicit creation/evolve verb
 * aimed at a product/concept (statements and updates stay chat, per the router's
 * long-standing rule), and treats product talk in a conversation that already has
 * a product master as an edit of it. Returns null when product isn't in play.
 */
export function productRoute(message: string, editableKind: string | null): RouteResult | null {
  const explicitCreate = /\b(create|define|build|draft|generate|put together|make|design|model|evolve)\b/i.test(message);
  const productNoun = /\b(product|concept|offering)\b/i.test(message);
  const otherDeliverable =
    /\b(deck|slide|slides|presentation|spreadsheet|workbook|budget|pdf|diagram|flowchart|icon|logo|svg|site|website|landing\s+page|component|app|widget|dashboard|report|memo|letter|document|essay|poem|story|chart|readme)\b/i.test(
      message,
    );
  if (explicitCreate && productNoun && !otherDeliverable) {
    return editableKind === 'product'
      ? { intent: 'edit_doc', skill: 'product' }
      : { intent: 'create_doc', skill: 'product' };
  }
  if (editableKind === 'product' && /\b(evolve|update|revise|change|refine)\s+the\s+product\b/i.test(message)) {
    return { intent: 'edit_doc', skill: 'product' };
  }
  return null;
}

/**
 * Legacy entry point retained for callers that pass (history, text,
 * hasEditableArtifact). Derives minimal signals from the text and delegates to
 * routeWorkflow, then maps back to {intent, skill}. Prefer routeWorkflow +
 * toLegacyRoute with full signals where the caller has them (chat route does).
 */
export async function route(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  text: string,
  hasEditableArtifact: boolean,
): Promise<RouteResult> {
  const signals: RouterSignals = {
    artifactInContext: hasEditableArtifact,
    lastArtifactKind: null,
    lastMsgProducedArtifact: hasEditableArtifact,
    lastMsgWasSubstantive: history.length > 0,
    fileUploadPresent: /\[attached:/i.test(text),
    imageUploadPresent: false,
    multipleUploads: false,
    urlInMessage: URL_RE.test(text),
  };
  const decision = await routeWorkflow({ message: text, history, signals });
  return toLegacyRoute(decision, signals, text);
}
