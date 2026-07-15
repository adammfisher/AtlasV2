/**
 * Types for the three-stage model-agnostic router (Deliverable B).
 */
import type { WorkflowId, ModelTier } from './workflows.js';

/** Boolean context the caller computes about the current turn. */
export interface RouterSignals {
  /** a generated artifact exists in this conversation to edit */
  artifactInContext: boolean;
  /** kind of the most recent generated artifact (pptx/docx/react/…), if any */
  lastArtifactKind?: string | null;
  /** the previous assistant turn produced an artifact */
  lastMsgProducedArtifact: boolean;
  /** the previous assistant turn was a substantive answer (for anaphora) */
  lastMsgWasSubstantive: boolean;
  /** a document was uploaded this turn */
  fileUploadPresent: boolean;
  /** an image was uploaded this turn */
  imageUploadPresent: boolean;
  /** more than one file uploaded this turn */
  multipleUploads: boolean;
  /** file extensions of uploaded documents (csv/xlsx/pptx/pdf/docx/…) */
  uploadKinds?: string[];
  /** the message contains a URL */
  urlInMessage: boolean;
  /** project knowledge is likely relevant to the question */
  projectKnowledgeRelevant?: boolean;
}

export interface RouterInput {
  /** the latest user message text */
  message: string;
  /** prior turns (most recent last), excluding the latest message */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  signals: RouterSignals;
  /** starting tier for LLM classification; defaults from the active model */
  tier?: ModelTier;
}

export type RouteStage = 'deterministic' | 'llm' | 'escalated' | 'clarify' | 'fallback';

export interface RoutingDecision {
  workflowId: WorkflowId;
  confidence: number;
  stage: RouteStage;
  tier: ModelTier;
  escalated: boolean;
  /** ordered chain for mixed intent (read/analyze before create before convert) */
  orderedPlan?: WorkflowId[];
  /** candidate set considered by the LLM stage (for the run log / confusion matrix) */
  candidates?: WorkflowId[];
  reasoning?: string;
}

/** One structured log line per routing decision (run log / eval). */
export interface RouteLogEntry {
  input: string;
  stage: RouteStage;
  candidates: WorkflowId[];
  chosen: WorkflowId;
  confidence: number;
  tier: ModelTier;
  escalated: boolean;
}
