/**
 * DELIVERABLE D — Edit-state reinjection (artifact-context resolver).
 *
 * The permanent fix for the "modify-my-PowerPoint-returned-a-description" bug.
 * Every edit-class dispatch passes through here first:
 *   resolveEditTarget → loadLatestState → injectEditContext
 * If the artifact's current state cannot be loaded, we throw
 * OrchestrationError('EDIT_STATE_UNAVAILABLE') — the caller surfaces a
 * clarifying question. The system NEVER proceeds to describe or invent the
 * artifact. State is loaded just-in-time, only for an edit workflow.
 */
import { latestPayload, lastPipelineArtifact } from './artifacts.js';
import type { EditContract } from './workflows.js';

export type OrchestrationErrorCode =
  | 'EDIT_STATE_UNAVAILABLE'
  | 'EDIT_TARGET_UNRESOLVED';

/** Typed, non-describing failure. Distinct from PipelineError so the chat route
 * can surface a specific clarifying question rather than a generic error. */
export class OrchestrationError extends Error {
  readonly code: OrchestrationErrorCode;
  constructor(code: OrchestrationErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'OrchestrationError';
    this.code = code;
  }
}

export type ArtifactKind =
  | 'pptx'
  | 'docx'
  | 'xlsx'
  | 'pdf'
  | 'md'
  | 'mermaid'
  | 'svg'
  | 'react'
  | 'site'
  | 'product';

export interface SubTarget {
  type: 'slide' | 'sheet' | 'page' | 'section';
  index: number; // 1-based, as the user says it
}

export interface EditTarget {
  kind: ArtifactKind;
  id: string; // artifact id, or the upload id when source === 'upload'
  name: string;
  source: 'artifact' | 'upload';
  subTarget?: SubTarget;
  /** the type the user's words asked for, if any (for disambiguation/logging) */
  typeHint?: ArtifactKind;
}

export interface EditState {
  kind: ArtifactKind;
  id: string;
  version: number;
  /** the JSON projection (office/product), or {source} / {files} for text/code */
  state: unknown;
}

/** What the caller already knows about the conversation, to avoid a re-scan. */
export interface ConvEditState {
  /** the most recent generated artifact in this conversation, if any */
  lastArtifact?: { artifactId: string; kind: string; name: string } | null;
  /** files uploaded on THIS turn */
  uploads?: Array<{ id: string; name: string; kind: 'image' | 'document' }>;
}

// ─── anaphora + type resolution ──────────────────────────────────────────────

const TYPE_NOUNS: Array<[RegExp, ArtifactKind]> = [
  [/\b(deck|slides?|presentation|slideshow|powerpoint|pptx|pitch)\b/i, 'pptx'],
  [/\b(spreadsheet|workbook|excel|xlsx|worksheet|sheet|pivot)\b/i, 'xlsx'],
  [/\b(pdf)\b/i, 'pdf'],
  [/\b(document|report|memo|letter|brief|docx|word\s+doc)\b/i, 'docx'],
  [/\b(diagram|flowchart|sequence\s+diagram|mermaid|erd)\b/i, 'mermaid'],
  [/\b(icon|logo|svg|vector|illustration)\b/i, 'svg'],
  [/\b(landing\s+page|website|web\s+page|marketing\s+page|site)\b/i, 'site'],
  [/\b(component|react|app|widget|dashboard|calculator|ui)\b/i, 'react'],
  [/\b(product|concept)\b/i, 'product'],
  [/\b(markdown|notes|readme|guide|outline)\b/i, 'md'],
];

const SUBTARGET_PATTERNS: Array<[RegExp, SubTarget['type']]> = [
  [/\bslide\s+#?(\d+)/i, 'slide'],
  [/\b(?:sheet|tab)\s+#?(\d+)/i, 'sheet'],
  [/\bpage\s+#?(\d+)/i, 'page'],
  [/\bsection\s+#?(\d+)/i, 'section'],
];

function parseTypeHint(message: string): ArtifactKind | undefined {
  for (const [re, kind] of TYPE_NOUNS) if (re.test(message)) return kind;
  return undefined;
}

function parseSubTarget(message: string): SubTarget | undefined {
  for (const [re, type] of SUBTARGET_PATTERNS) {
    const m = re.exec(message);
    if (m?.[1]) return { type, index: Number(m[1]) };
  }
  return undefined;
}

function asKind(kind: string): ArtifactKind | undefined {
  return (
    ['pptx', 'docx', 'xlsx', 'pdf', 'md', 'mermaid', 'svg', 'react', 'site', 'product'] as const
  ).includes(kind as ArtifactKind)
    ? (kind as ArtifactKind)
    : undefined;
}

/** Guess an artifact kind from an uploaded file name (best-effort). */
function kindFromFilename(name: string): ArtifactKind | undefined {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pptx' || ext === 'ppt') return 'pptx';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'xlsx';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'svg') return 'svg';
  return undefined;
}

/**
 * Resolve anaphora ("the deck", "slide 3", "it", "this", "that file", "the last
 * one") against conversation state. Prefers the most recent generated artifact;
 * a file uploaded THIS turn is the target when there is no artifact. Returns null
 * when nothing resolves (the caller then fails loudly).
 */
export async function resolveEditTarget(
  conversationId: string,
  message: string,
  convState: ConvEditState = {},
): Promise<EditTarget | null> {
  const typeHint = parseTypeHint(message);
  const subTarget = parseSubTarget(message);

  // caller-provided last artifact wins; else scan the conversation just-in-time
  let last = convState.lastArtifact;
  if (last === undefined) last = await lastPipelineArtifact(conversationId);

  if (last) {
    const kind = asKind(last.kind);
    if (kind) {
      return {
        kind,
        id: last.artifactId,
        name: last.name,
        source: 'artifact',
        ...(subTarget ? { subTarget } : {}),
        ...(typeHint ? { typeHint } : {}),
      };
    }
  }

  // no generated artifact — a file uploaded this turn is the target
  const doc = (convState.uploads ?? []).find((u) => u.kind === 'document');
  if (doc) {
    const kind = typeHint ?? kindFromFilename(doc.name);
    if (kind) {
      return {
        kind,
        id: doc.id,
        name: doc.name,
        source: 'upload',
        ...(subTarget ? { subTarget } : {}),
        ...(typeHint ? { typeHint } : {}),
      };
    }
  }

  return null;
}

/**
 * Load the current state of an edit target. Office/product artifacts → the
 * latest ARTV JSON projection from DynamoDB; code/text artifacts → their current
 * source/file map. Returns null when the state cannot be loaded (missing
 * artifact/version/payload, or an uploaded file with no stored projection).
 */
export async function loadLatestState(target: EditTarget): Promise<EditState | null> {
  if (target.source === 'upload') {
    // an uploaded office file has no stored JSON projection to edit against.
    // Fail honestly rather than "describe" — the caller surfaces a clarification.
    return null;
  }
  const latest = await latestPayload(target.id);
  if (!latest) return null;
  return { kind: target.kind, id: target.id, version: latest.version, state: latest.payload };
}

// ─── prompt injection ────────────────────────────────────────────────────────

function contractSpec(kind: ArtifactKind, editContract: EditContract, sub?: SubTarget): string {
  const focus = sub ? ` The user is targeting ${sub.type} ${sub.index}; change only that ${sub.type}.` : '';
  // Every edit path in this pipeline emits the FULL corrected state and diffs it
  // afterward, so the transport contract is always "reproduce everything, change
  // only what was asked" — regardless of the workflow's declared editContract.
  if (kind === 'md' || kind === 'mermaid' || kind === 'svg') {
    return (
      'EDIT CONTRACT: apply ONLY the requested change to the source above and output the FULL corrected source. ' +
      'Keep every other line identical. Never output a description of the change.' +
      focus
    );
  }
  if (kind === 'react' || kind === 'site') {
    return (
      'EDIT CONTRACT: apply ONLY the requested change and output the FULL corrected file map (all files). ' +
      'Keep untouched files byte-identical. Never output a description of the change.' +
      focus
    );
  }
  // office + product: full corrected JSON
  void editContract;
  return (
    'EDIT CONTRACT: apply ONLY the requested change and reproduce the COMPLETE corrected JSON object. ' +
    'Every unit the user did not mention must stay byte-identical. Output the full JSON, never a description.' +
    focus
  );
}

/**
 * Wrap the current artifact state in <current_artifact> delimiters and append
 * the explicit edit contract. This is what forces the model to EDIT the real
 * artifact instead of describing or reinventing it.
 */
export function injectEditContext(
  prompt: string,
  state: EditState,
  editContract: EditContract = 'full-state',
  subTarget?: SubTarget,
): string {
  if (state == null) throw new OrchestrationError('EDIT_STATE_UNAVAILABLE');
  const body = typeof state.state === 'string' ? state.state : JSON.stringify(state.state);
  const block = `<current_artifact type="${state.kind}" id="${state.id}" version="${state.version}">\n${body}\n</current_artifact>`;
  return `${prompt}\n\n${block}\n\n${contractSpec(state.kind, editContract, subTarget)}`;
}

/**
 * High-level convenience: resolve → load → assert. Throws
 * OrchestrationError('EDIT_STATE_UNAVAILABLE') the moment state is missing, so an
 * edit dispatch can never silently degrade to describing. Returns the resolved
 * target and its loaded state.
 */
export async function requireEditState(
  conversationId: string,
  message: string,
  convState: ConvEditState = {},
): Promise<{ target: EditTarget; state: EditState }> {
  const target = await resolveEditTarget(conversationId, message, convState);
  if (!target) throw new OrchestrationError('EDIT_TARGET_UNRESOLVED');
  const state = await loadLatestState(target);
  if (!state) throw new OrchestrationError('EDIT_STATE_UNAVAILABLE');
  return { target, state };
}
