/**
 * DELIVERABLE A — Canonical workflow registry.
 *
 * The single source of truth for what Atlas can be asked to do. Every routing
 * decision resolves to exactly one `WorkflowId` (or an ordered chain of them for
 * mixed intent). The deterministic Stage-1 pre-router (router.ts) generates its
 * verb/object/predicate tables FROM this file — trigger lists are NOT duplicated
 * anywhere else. The LLM Stage-2 classifier uses `intent` as each candidate's
 * label help-text and `tierNotes` to shape per-tier prompting.
 *
 * Design invariant: any workflow whose id starts with "edit-" (plus
 * convert-between-formats / export-download-request / followup-anaphora when they
 * resolve to an edit) MUST obtain non-null artifact state from the Deliverable-D
 * resolver before dispatch, or fail loudly (EDIT_STATE_UNAVAILABLE). It must
 * NEVER degrade to describing the artifact.
 */

export type ModelTier = 'small' | 'mid' | 'frontier';

/** Boolean context signals the router computes about the current turn. */
export type WorkflowPredicate =
  | 'lastMsgProducedArtifact'
  | 'lastMsgWasSubstantive'
  | 'fileUploadPresent'
  | 'imageUploadPresent'
  | 'multipleUploads'
  | 'artifactInContext'
  | 'urlInMessage'
  | 'noEditTarget'
  | 'projectKnowledgeRelevant'
  | 'codeReusableOrLong';

/** Context that MUST be assembled before dispatch, or the workflow fails loudly. */
export type RequiredContext =
  | 'userRequest' // the user's message text
  | 'projectKnowledge' // KNOW# project knowledge, when referenced
  | 'skillDoc' // the routed skill's full SKILL.md + schema
  | 'resolvedEditTarget' // anaphora resolved to a concrete artifact/file id
  | 'latestArtifactState' // the edit target's current JSON projection / source
  | 'userDelta' // the specific change the user asked for
  | 'fileExtraction' // extracted text of an uploaded file (just-in-time)
  | 'parsedTabularData' // parsed rows/columns of a csv/xlsx upload
  | 'currentArtifactSource' // current source of a code/text artifact being edited
  | 'sourceArtifactOrFile' // the source artifact/file for a conversion/export
  | 'targetFormat' // the destination format for a conversion
  | 'memoryRecall' // injected long-term memory block
  | 'sourceCitations' // retrieval hits with citable sources
  | 'allUploads' // every uploaded file this turn
  | 'imageParts' // image content blocks for vision
  | 'resolvedReferent' // the last artifact/answer an anaphor points at
  | 'candidateTools' // the narrowed MCP tool candidate(s)
  | 'factToStore' // the durable fact to remember
  | 'forgetQuery'; // what to forget, in the user's words

export type ExecutionPlan =
  | 'office-lambda'
  | 'artifact-renderer'
  | 'tool-loop'
  | 'memory-engine'
  | 'plain-chat'
  | 'clarify'
  | 'refuse';

export type OutputContract =
  | 'file'
  | 'artifact'
  | 'inline'
  | 'tool-result'
  | 'clarifying-question'
  | 'refusal';

export type EditContract = 'full-state' | 'structured-diff' | 'na';

export interface TriggerSignals {
  /** lemmatized action verbs */
  verbs?: string[];
  /** deliverable/object nouns */
  nounObjects?: string[];
  /** file-type context that supports this workflow */
  fileTypeContext?: string[];
  /** boolean context predicates that must hold (router encodes AND/OR groups) */
  predicates?: WorkflowPredicate[];
  /** words that REDUCE the match (disambiguation) */
  antiSignals?: string[];
}

export type WorkflowId =
  // document creation (office lambda)
  | 'create-pptx'
  | 'create-docx'
  | 'create-xlsx'
  | 'create-pdf'
  | 'create-md'
  // document editing (reinjection mandatory)
  | 'edit-pptx'
  | 'edit-docx'
  | 'edit-xlsx'
  | 'edit-pdf'
  | 'edit-md'
  // read / analyze uploads
  | 'read-summarize-file'
  | 'data-analysis-on-file'
  // code / visual artifacts
  | 'create-code-artifact'
  | 'edit-code-artifact'
  | 'create-diagram'
  | 'create-svg'
  | 'create-react-app'
  | 'create-site'
  | 'edit-visual-artifact'
  // conversion
  | 'convert-between-formats'
  // web / research
  | 'web-search-then-answer'
  | 'fetch-url-then-answer'
  | 'multi-step-research'
  // memory
  | 'remember-fact'
  | 'forget-fact'
  | 'recall-from-memory'
  | 'project-knowledge-qa'
  // tools / mcp
  | 'mcp-tool-invocation'
  // conversation / control
  | 'plain-conversation-qa'
  | 'clarify-before-acting'
  | 'refuse-decline'
  | 'image-understanding'
  | 'multi-file-synthesis'
  | 'export-download-request'
  | 'followup-anaphora';

export interface Workflow {
  id: WorkflowId;
  /** one sentence; doubles as the classifier label help-text */
  intent: string;
  triggers: TriggerSignals;
  /** MUST be assembled or the workflow FAILS LOUDLY */
  requiredContext: RequiredContext[];
  executionPlan: ExecutionPlan;
  /** SKILL.md ids to progressively load */
  skills: string[];
  outputContract: OutputContract;
  tierNotes: Record<ModelTier, string>;
  editContract?: EditContract;
}

// ─── verb / noun vocab shared across create+edit families ────────────────────
const CREATE_VERBS = ['create', 'make', 'build', 'generate', 'draft', 'write', 'put together', 'produce'];
const EDIT_VERBS = ['edit', 'modify', 'change', 'update', 'fix', 'revise', 'tweak', 'replace', 'add', 'remove', 'adjust', 'rewrite'];
const EDIT_ANTI = ['new', 'another', 'from scratch', 'fresh', 'separate'];

export const WORKFLOWS: Workflow[] = [
  // ─────────────────────────── DOCUMENT CREATION ────────────────────────────
  {
    id: 'create-pptx',
    intent: 'Build a new PowerPoint presentation from a request.',
    triggers: {
      verbs: [...CREATE_VERBS],
      nounObjects: ['deck', 'presentation', 'slides', 'slideshow', 'pitch', 'pitch deck', 'powerpoint'],
      fileTypeContext: ['pptx'],
      predicates: ['noEditTarget'],
    },
    requiredContext: ['userRequest', 'projectKnowledge', 'skillDoc'],
    executionPlan: 'office-lambda',
    skills: ['pptx'],
    outputContract: 'file',
    editContract: 'na',
    tierNotes: {
      small: 'Force tool-choice on emit_pptx_spec; give 2 few-shot spec examples; no free text.',
      mid: 'Force the spec schema; one design instruction is enough.',
      frontier: 'Single instruction, richer design latitude.',
    },
  },
  {
    id: 'create-docx',
    intent: 'Write a new Word document, report, memo, letter, or brief.',
    triggers: {
      verbs: ['write', 'create', 'draft', 'make', 'compose', 'put together'],
      nounObjects: ['document', 'report', 'memo', 'letter', 'one-pager', 'essay', 'brief', 'word doc', 'writeup'],
      fileTypeContext: ['docx'],
      predicates: ['noEditTarget'],
    },
    requiredContext: ['userRequest', 'projectKnowledge', 'skillDoc'],
    executionPlan: 'office-lambda',
    skills: ['docx'],
    outputContract: 'file',
    editContract: 'na',
    tierNotes: {
      small: 'Force the docx schema; short section outline first. Route lightweight text-only writing to create-md instead.',
      mid: 'Force the docx schema.',
      frontier: 'Single instruction; allow structured multi-section output.',
    },
  },
  {
    id: 'create-xlsx',
    intent: 'Build a new spreadsheet, workbook, budget, model, or tracker.',
    triggers: {
      verbs: ['create', 'build', 'make', 'model', 'generate'],
      nounObjects: ['spreadsheet', 'workbook', 'budget', 'model', 'tracker', 'excel', 'sheet'],
      fileTypeContext: ['xlsx', 'csv'],
      predicates: ['noEditTarget'],
    },
    requiredContext: ['userRequest', 'projectKnowledge', 'skillDoc', 'parsedTabularData'],
    executionPlan: 'office-lambda',
    skills: ['xlsx'],
    outputContract: 'file',
    editContract: 'na',
    tierNotes: {
      small: 'Force the xlsx schema; if data was uploaded, inject the parsed rows before generation.',
      mid: 'Force the xlsx schema.',
      frontier: 'Single instruction; allow formulas and multiple sheets.',
    },
  },
  {
    id: 'create-pdf',
    intent: 'Generate a new PDF one-pager, flyer, or report.',
    triggers: {
      verbs: ['create', 'generate', 'export', 'make', 'produce'],
      nounObjects: ['pdf', 'one-pager', 'flyer', 'report', 'brochure'],
      fileTypeContext: ['pdf'],
      predicates: ['noEditTarget'],
    },
    requiredContext: ['userRequest', 'projectKnowledge', 'skillDoc'],
    executionPlan: 'office-lambda',
    skills: ['pdf'],
    outputContract: 'file',
    editContract: 'na',
    tierNotes: {
      small: 'Force the pdf schema.',
      mid: 'Force the pdf schema.',
      frontier: 'Single instruction.',
    },
  },
  {
    id: 'create-md',
    intent:
      'Produce a standalone text document as a markdown artifact (long text, creative writing, or structured reference).',
    triggers: {
      verbs: ['write', 'draft', 'create', 'compose'],
      nounObjects: ['doc', 'notes', 'guide', 'plan', 'poem', 'story', 'outline', 'readme', 'spec', 'checklist'],
      fileTypeContext: ['md'],
      predicates: ['noEditTarget'],
    },
    requiredContext: ['userRequest', 'projectKnowledge', 'skillDoc'],
    executionPlan: 'artifact-renderer',
    skills: ['md'],
    outputContract: 'artifact',
    editContract: 'na',
    tierNotes: {
      small: 'Enforce the >20-line / >1500-char threshold in code, not the prompt; below it, answer inline (plain-conversation-qa).',
      mid: 'Emit markdown directly.',
      frontier: 'Emit markdown directly; richer structure allowed.',
    },
  },

  // ─────────────────────────── DOCUMENT EDITING ─────────────────────────────
  {
    id: 'edit-pptx',
    intent: 'Edit the actual existing presentation — never describe or regenerate it.',
    triggers: {
      verbs: [...EDIT_VERBS],
      nounObjects: ['deck', 'slide', 'presentation', 'slideshow', 'powerpoint', 'title', 'bullet'],
      fileTypeContext: ['pptx'],
      predicates: ['artifactInContext', 'fileUploadPresent'],
      antiSignals: [...EDIT_ANTI],
    },
    requiredContext: ['resolvedEditTarget', 'latestArtifactState', 'userDelta'],
    executionPlan: 'office-lambda',
    skills: ['pptx'],
    outputContract: 'file',
    editContract: 'structured-diff',
    tierNotes: {
      small: 'Present ONLY the edit tool; force tool-choice; inject current state inside <current_artifact>; forbid describing.',
      mid: 'Inject <current_artifact>; force the edit schema.',
      frontier: 'Inject <current_artifact>; ask for the per-slide edit ops.',
    },
  },
  {
    id: 'edit-docx',
    intent: 'Edit the actual existing document — never describe or regenerate it.',
    triggers: {
      verbs: [...EDIT_VERBS],
      nounObjects: ['doc', 'document', 'section', 'paragraph', 'intro', 'report', 'heading'],
      fileTypeContext: ['docx'],
      predicates: ['artifactInContext', 'fileUploadPresent'],
      antiSignals: [...EDIT_ANTI],
    },
    requiredContext: ['resolvedEditTarget', 'latestArtifactState', 'userDelta'],
    executionPlan: 'office-lambda',
    skills: ['docx'],
    outputContract: 'file',
    editContract: 'structured-diff',
    tierNotes: {
      small: 'Present ONLY the edit tool; force tool-choice; inject <current_artifact>; forbid describing.',
      mid: 'Inject <current_artifact>; force the edit schema.',
      frontier: 'Inject <current_artifact>; per-section edit ops.',
    },
  },
  {
    id: 'edit-xlsx',
    intent: 'Edit the actual existing spreadsheet — never describe or regenerate it.',
    triggers: {
      verbs: [...EDIT_VERBS, 'recalculate', 'sum'],
      nounObjects: ['sheet', 'column', 'cell', 'formula', 'pivot', 'row', 'workbook', 'tab'],
      fileTypeContext: ['xlsx', 'csv'],
      predicates: ['artifactInContext', 'fileUploadPresent'],
      antiSignals: [...EDIT_ANTI],
    },
    requiredContext: ['resolvedEditTarget', 'latestArtifactState', 'userDelta'],
    executionPlan: 'office-lambda',
    skills: ['xlsx'],
    outputContract: 'file',
    editContract: 'structured-diff',
    tierNotes: {
      small: 'Present ONLY the edit tool; force tool-choice; inject <current_artifact>; forbid describing.',
      mid: 'Inject <current_artifact>; force the edit schema.',
      frontier: 'Inject <current_artifact>; per-sheet edit ops.',
    },
  },
  {
    id: 'edit-pdf',
    intent: 'Edit the actual existing PDF by regenerating from its source JSON — never describe it.',
    triggers: {
      verbs: [...EDIT_VERBS],
      nounObjects: ['pdf', 'page', 'flyer', 'one-pager'],
      fileTypeContext: ['pdf'],
      predicates: ['artifactInContext', 'fileUploadPresent'],
      antiSignals: [...EDIT_ANTI],
    },
    requiredContext: ['resolvedEditTarget', 'latestArtifactState', 'userDelta'],
    executionPlan: 'office-lambda',
    skills: ['pdf'],
    outputContract: 'file',
    editContract: 'full-state',
    tierNotes: {
      small: 'Force the pdf schema; inject <current_artifact>; regenerate the full corrected JSON.',
      mid: 'Inject <current_artifact>; regenerate the full corrected JSON.',
      frontier: 'Inject <current_artifact>; regenerate the full corrected JSON.',
    },
  },
  {
    id: 'edit-md',
    intent: 'Edit an existing markdown/text artifact with targeted updates or a rewrite.',
    triggers: {
      verbs: [...EDIT_VERBS, 'shorten', 'lengthen', 'expand', 'condense'],
      nounObjects: ['doc', 'notes', 'guide', 'plan', 'text', 'draft', 'section', 'paragraph'],
      fileTypeContext: ['md'],
      predicates: ['artifactInContext'],
      antiSignals: [...EDIT_ANTI],
    },
    requiredContext: ['resolvedEditTarget', 'currentArtifactSource', 'userDelta'],
    executionPlan: 'artifact-renderer',
    skills: ['md'],
    outputContract: 'artifact',
    editContract: 'structured-diff',
    tierNotes: {
      small: 'Inject <current_artifact>; targeted UPDATE when change < 20 lines AND < 5 locations, else REWRITE. Match targets must be unique+exact.',
      mid: 'Inject <current_artifact>; update-vs-rewrite by the same rule.',
      frontier: 'Inject <current_artifact>; update-vs-rewrite by the same rule.',
    },
  },

  // ────────────────────────── READ / ANALYZE UPLOADS ────────────────────────
  {
    id: 'read-summarize-file',
    intent: 'Read and summarize/explain an uploaded file from its real extracted contents.',
    triggers: {
      verbs: ['summarize', 'read', 'tldr', 'explain', 'what does', 'go over', 'walk through', 'recap'],
      nounObjects: ['file', 'document', 'pdf', 'deck', 'contract', 'attachment'],
      fileTypeContext: ['pdf', 'docx', 'pptx', 'txt', 'md'],
      predicates: ['fileUploadPresent'],
    },
    requiredContext: ['userRequest', 'fileExtraction'],
    executionPlan: 'plain-chat',
    skills: [],
    outputContract: 'inline',
    tierNotes: {
      small: 'If extraction is not finished, WAIT or fail honestly — never answer from the filename.',
      mid: 'Read the extracted text; never guess from the filename.',
      frontier: 'Read the extracted text; cite specific sections.',
    },
  },
  {
    id: 'data-analysis-on-file',
    intent: 'Compute over or chart an uploaded dataset (csv/xlsx).',
    triggers: {
      verbs: ['analyze', 'compute', 'chart', 'plot', 'aggregate', 'trend', 'pivot', 'correlate', 'graph', 'sum', 'average'],
      nounObjects: ['data', 'csv', 'spreadsheet', 'numbers', 'revenue', 'chart', 'trend'],
      fileTypeContext: ['csv', 'xlsx'],
      predicates: ['fileUploadPresent'],
    },
    requiredContext: ['userRequest', 'parsedTabularData'],
    executionPlan: 'tool-loop',
    skills: ['xlsx'],
    outputContract: 'artifact',
    tierNotes: {
      small: 'Use analyze_table for exact aggregates — never estimate from visible text; one chart at a time.',
      mid: 'Compute with analyze_table, then render a chart artifact or xlsx.',
      frontier: 'Chain compute → chart/xlsx; explain the finding inline.',
    },
  },

  // ────────────────────────── CODE / VISUAL ARTIFACTS ───────────────────────
  {
    id: 'create-code-artifact',
    intent: 'Write a new standalone code artifact (function, script, component, app, program).',
    triggers: {
      verbs: ['write', 'build', 'implement', 'create', 'code', 'make'],
      nounObjects: ['function', 'script', 'component', 'app', 'program', 'class', 'module', 'cli'],
      fileTypeContext: ['code'],
      predicates: ['noEditTarget', 'codeReusableOrLong'],
    },
    requiredContext: ['userRequest', 'skillDoc'],
    executionPlan: 'artifact-renderer',
    skills: ['react'],
    outputContract: 'artifact',
    editContract: 'na',
    tierNotes: {
      small: 'Code over ~20 lines → artifact (enforced in code). Short snippets answer inline.',
      mid: 'Emit a single-file artifact with a clear entry.',
      frontier: 'Emit a well-structured artifact; default export for React.',
    },
  },
  {
    id: 'edit-code-artifact',
    intent: 'Edit the current code artifact — never describe or regenerate from scratch.',
    triggers: {
      verbs: ['edit', 'fix', 'refactor', 'change', 'add', 'debug', 'update', 'rename', 'remove'],
      nounObjects: ['function', 'component', 'code', 'bug', 'script', 'app', 'handler'],
      fileTypeContext: ['code'],
      predicates: ['artifactInContext'],
      antiSignals: [...EDIT_ANTI],
    },
    requiredContext: ['resolvedEditTarget', 'currentArtifactSource', 'userDelta'],
    executionPlan: 'artifact-renderer',
    skills: ['react'],
    outputContract: 'artifact',
    editContract: 'structured-diff',
    tierNotes: {
      small: 'Inject <current_artifact>; targeted UPDATE when < 20 lines AND < 5 locations, else REWRITE.',
      mid: 'Inject <current_artifact>; update-vs-rewrite by the same rule.',
      frontier: 'Inject <current_artifact>; update-vs-rewrite by the same rule.',
    },
  },
  {
    id: 'create-diagram',
    intent: 'Create a diagram/flowchart/sequence/graph as a Mermaid artifact.',
    triggers: {
      verbs: [...CREATE_VERBS, 'diagram', 'chart', 'map'],
      nounObjects: ['diagram', 'flowchart', 'sequence', 'graph', 'architecture', 'erd', 'org chart', 'mindmap', 'network'],
      fileTypeContext: ['mermaid'],
      predicates: ['noEditTarget'],
    },
    requiredContext: ['userRequest', 'skillDoc'],
    executionPlan: 'artifact-renderer',
    skills: ['mermaid'],
    outputContract: 'artifact',
    editContract: 'na',
    tierNotes: {
      small: 'Emit valid Mermaid source only; pick the diagram type from the noun.',
      mid: 'Emit Mermaid source.',
      frontier: 'Emit Mermaid source; richer layout.',
    },
  },
  {
    id: 'create-svg',
    intent: 'Create a single icon, logo, or vector illustration as an SVG artifact.',
    triggers: {
      verbs: [...CREATE_VERBS, 'design', 'draw'],
      nounObjects: ['icon', 'logo', 'vector', 'svg', 'illustration', 'glyph', 'badge'],
      fileTypeContext: ['svg'],
      predicates: ['noEditTarget'],
      antiSignals: ['diagram', 'flowchart', 'chart'],
    },
    requiredContext: ['userRequest', 'skillDoc'],
    executionPlan: 'artifact-renderer',
    skills: ['svg'],
    outputContract: 'artifact',
    editContract: 'na',
    tierNotes: {
      small: 'Emit valid SVG markup only; single subject, no diagrams.',
      mid: 'Emit SVG markup.',
      frontier: 'Emit SVG markup; refined paths.',
    },
  },
  {
    id: 'create-react-app',
    intent: 'Build an interactive React component/app/dashboard as a sandboxed artifact.',
    triggers: {
      verbs: [...CREATE_VERBS],
      nounObjects: ['interactive', 'dashboard', 'ui', 'web app', 'component', 'widget', 'calculator', 'game', 'form', 'tool'],
      fileTypeContext: ['react', 'code'],
      predicates: ['noEditTarget'],
    },
    requiredContext: ['userRequest', 'skillDoc'],
    executionPlan: 'artifact-renderer',
    skills: ['react'],
    outputContract: 'artifact',
    editContract: 'na',
    tierNotes: {
      small: 'No localStorage/sessionStorage; Tailwind core classes only; a default export.',
      mid: 'Same artifact rules; single-file bundle.',
      frontier: 'Same rules; richer interactivity allowed.',
    },
  },
  {
    id: 'create-site',
    intent: 'Build a static landing page / marketing site as a sandboxed artifact.',
    triggers: {
      verbs: [...CREATE_VERBS],
      nounObjects: ['landing page', 'website', 'marketing page', 'site', 'homepage', 'web page'],
      fileTypeContext: ['site', 'code'],
      predicates: ['noEditTarget'],
    },
    requiredContext: ['userRequest', 'skillDoc'],
    executionPlan: 'artifact-renderer',
    skills: ['site'],
    outputContract: 'artifact',
    editContract: 'na',
    tierNotes: {
      small: 'Static HTML/CSS; Tailwind core classes; single entry file.',
      mid: 'Static HTML/CSS/JS single bundle.',
      frontier: 'Multi-section responsive page allowed.',
    },
  },
  {
    id: 'edit-visual-artifact',
    intent: 'Edit an existing diagram/svg/site artifact through the code-edit machinery, tagged to its skill.',
    triggers: {
      verbs: [...EDIT_VERBS],
      nounObjects: ['diagram', 'flowchart', 'svg', 'icon', 'logo', 'site', 'landing page', 'website'],
      fileTypeContext: ['mermaid', 'svg', 'site'],
      predicates: ['artifactInContext'],
      antiSignals: [...EDIT_ANTI],
    },
    requiredContext: ['resolvedEditTarget', 'currentArtifactSource', 'userDelta'],
    executionPlan: 'artifact-renderer',
    skills: ['mermaid', 'svg', 'site'],
    outputContract: 'artifact',
    editContract: 'structured-diff',
    tierNotes: {
      small: 'Load the correct current artifact source; inject <current_artifact>; tag the right skill.',
      mid: 'Inject <current_artifact>; update-vs-rewrite by the same rule.',
      frontier: 'Inject <current_artifact>; update-vs-rewrite by the same rule.',
    },
  },

  // ─────────────────────────────── CONVERSION ───────────────────────────────
  {
    id: 'convert-between-formats',
    intent: 'Convert a source artifact/file into a different format (deck→pdf, csv→xlsx, md→docx).',
    triggers: {
      verbs: ['convert', 'turn into', 'export as', 'save as', 'make into', 'transform'],
      nounObjects: ['pdf', 'docx', 'xlsx', 'pptx', 'format', 'version'],
      fileTypeContext: ['pptx', 'docx', 'xlsx', 'pdf', 'csv', 'md'],
      predicates: ['artifactInContext', 'fileUploadPresent'],
    },
    requiredContext: ['sourceArtifactOrFile', 'latestArtifactState', 'targetFormat'],
    executionPlan: 'office-lambda',
    skills: ['pptx', 'docx', 'xlsx', 'pdf'],
    outputContract: 'file',
    editContract: 'full-state',
    tierNotes: {
      small: 'Load the SOURCE state first; map it to the target skill schema; regenerate.',
      mid: 'Load source state; regenerate into the target format.',
      frontier: 'Load source state; regenerate into the target format.',
    },
  },

  // ─────────────────────────────── WEB / RESEARCH ───────────────────────────
  {
    id: 'web-search-then-answer',
    intent: 'Search the web once for post-cutoff / rapidly-changing / real-time info, then answer.',
    triggers: {
      verbs: ['search', 'look up', 'find', 'google', 'check'],
      nounObjects: ['latest', 'current', 'recent', 'today', 'price', 'news', 'score', 'weather', 'now'],
      predicates: [],
      antiSignals: ['from this file', 'in the document', 'you already know'],
    },
    requiredContext: ['userRequest'],
    executionPlan: 'tool-loop',
    skills: [],
    outputContract: 'inline',
    tierNotes: {
      small: 'Cap at 1 search; offer deeper research instead of chaining.',
      mid: 'One search for simple lookups; cite sources.',
      frontier: 'One search; cite sources; chain only for genuine research.',
    },
  },
  {
    id: 'fetch-url-then-answer',
    intent: 'Fetch a URL the user pasted and answer from its readable text.',
    triggers: {
      verbs: ['read', 'summarize', 'what does this say', 'open', 'check', 'fetch'],
      nounObjects: ['link', 'url', 'page', 'article', 'site'],
      predicates: ['urlInMessage'],
    },
    requiredContext: ['userRequest'],
    executionPlan: 'tool-loop',
    skills: [],
    outputContract: 'inline',
    tierNotes: {
      small: 'One web_fetch of the given URL; summarize what came back.',
      mid: 'web_fetch then answer with citations.',
      frontier: 'web_fetch then answer with citations.',
    },
  },
  {
    id: 'multi-step-research',
    intent: 'Run a chained multi-tool research task (compare, deep-dive, evaluate) then synthesize.',
    triggers: {
      verbs: ['research', 'deep dive', 'compare', 'analyze', 'evaluate', 'assess', 'investigate', 'report on'],
      nounObjects: ['comparison', 'report', 'landscape', 'options', 'analysis', 'overview'],
      predicates: [],
    },
    requiredContext: ['userRequest'],
    executionPlan: 'tool-loop',
    skills: [],
    outputContract: 'artifact',
    tierNotes: {
      small: 'ESCALATE to frontier — small models degrade sharply on multi-turn tool use.',
      mid: 'Chain a few tool calls, then synthesize.',
      frontier: 'Up to 15-20 tool calls, then synthesize a cited report.',
    },
  },

  // ─────────────────────────────────── MEMORY ───────────────────────────────
  {
    id: 'remember-fact',
    intent: 'Store a durable fact in long-term memory on an explicit request.',
    triggers: {
      verbs: ['remember', 'note', 'save', 'keep in mind', 'memorize', 'store', "don't forget"],
      nounObjects: ['fact', 'preference', 'detail', 'that'],
      predicates: [],
    },
    requiredContext: ['factToStore'],
    executionPlan: 'memory-engine',
    skills: [],
    outputContract: 'tool-result',
    tierNotes: {
      small: 'Force the remember tool BEFORE replying; pick scope user vs project.',
      mid: 'Call the remember tool, then confirm.',
      frontier: 'Call the remember tool, then confirm.',
    },
  },
  {
    id: 'forget-fact',
    intent: 'Delete a remembered fact on an explicit request.',
    triggers: {
      verbs: ['forget', 'delete that memory', 'stop remembering', 'remove that fact', 'unsave'],
      nounObjects: ['memory', 'fact', 'that'],
      predicates: [],
    },
    requiredContext: ['forgetQuery'],
    executionPlan: 'memory-engine',
    skills: [],
    outputContract: 'tool-result',
    tierNotes: {
      small: 'Force the forget tool BEFORE replying.',
      mid: 'Call the forget tool, then confirm.',
      frontier: 'Call the forget tool, then confirm.',
    },
  },
  {
    id: 'recall-from-memory',
    intent: 'Answer a question that references a stored personal fact.',
    triggers: {
      verbs: ['what did i', 'what is my', 'do you remember', 'what was my', 'recall'],
      nounObjects: ['my', 'preference', 'name', 'manager', 'setting'],
      predicates: [],
    },
    requiredContext: ['memoryRecall', 'userRequest'],
    executionPlan: 'memory-engine',
    skills: [],
    outputContract: 'inline',
    tierNotes: {
      small: 'Answer only from the injected recall block; if absent, say you have nothing stored.',
      mid: 'Answer from the recall block.',
      frontier: 'Answer from the recall block.',
    },
  },
  {
    id: 'project-knowledge-qa',
    intent: 'Answer a question from the project knowledge base with source citations.',
    triggers: {
      verbs: ['what does', 'according to', 'in the project', 'per the', 'explain'],
      nounObjects: ['spec', 'doc', 'knowledge', 'project', 'requirement', 'flow'],
      predicates: ['projectKnowledgeRelevant'],
    },
    requiredContext: ['sourceCitations', 'memoryRecall', 'userRequest'],
    executionPlan: 'tool-loop',
    skills: [],
    outputContract: 'inline',
    tierNotes: {
      small: 'Retrieve, then answer WITH citations; never answer from a guess.',
      mid: 'Retrieve then answer with citations.',
      frontier: 'Retrieve then answer with citations.',
    },
  },

  // ─────────────────────────────── TOOLS / MCP ──────────────────────────────
  {
    id: 'mcp-tool-invocation',
    intent: 'Fulfill a request that maps to a registered MCP tool.',
    triggers: {
      verbs: ['send', 'create', 'fetch', 'list', 'update', 'query', 'run', 'get', 'post'],
      nounObjects: ['issue', 'ticket', 'row', 'record', 'message', 'event', 'file', 'page'],
      predicates: [],
    },
    requiredContext: ['candidateTools', 'userRequest'],
    executionPlan: 'tool-loop',
    skills: [],
    outputContract: 'tool-result',
    tierNotes: {
      small: 'Force tool-choice; expose ONLY the candidate tool(s), never the full toolset.',
      mid: 'Offer the candidate tools; execute and report.',
      frontier: 'Offer the candidate tools; execute and report.',
    },
  },

  // ────────────────────────── CONVERSATION / CONTROL ────────────────────────
  {
    id: 'plain-conversation-qa',
    intent: 'Answer stable facts, definitions, chit-chat, or short how-tos inline. Default fallthrough.',
    triggers: {
      verbs: ['what is', 'how do', 'explain', 'tell me', 'help me', 'why', 'define'],
      nounObjects: [],
      predicates: [],
    },
    requiredContext: ['userRequest'],
    executionPlan: 'plain-chat',
    skills: [],
    outputContract: 'inline',
    tierNotes: {
      small: 'Answer directly; do not search stable facts; do not over-produce artifacts.',
      mid: 'Answer directly.',
      frontier: 'Answer directly and concisely.',
    },
  },
  {
    id: 'clarify-before-acting',
    intent: 'Ask one clarifying question when intent is genuinely ambiguous or required context is missing.',
    triggers: {
      verbs: ['help me with', 'do something with', 'handle', 'deal with'],
      nounObjects: ['this', 'that', 'it'],
      predicates: [],
    },
    requiredContext: ['userRequest'],
    executionPlan: 'clarify',
    skills: [],
    outputContract: 'clarifying-question',
    tierNotes: {
      small: 'When two+ plausible workflows tie or context is missing, ask ONE targeted question.',
      mid: 'Ask one targeted question.',
      frontier: 'Ask one targeted question.',
    },
  },
  {
    id: 'refuse-decline',
    intent: 'Decline a harmful or disallowed request.',
    triggers: {
      verbs: [],
      nounObjects: [],
      predicates: [],
    },
    requiredContext: ['userRequest'],
    executionPlan: 'refuse',
    skills: [],
    outputContract: 'refusal',
    tierNotes: {
      small: 'Refuse briefly and without moralizing.',
      mid: 'Refuse briefly.',
      frontier: 'Refuse briefly; offer a safe alternative when one exists.',
    },
  },
  {
    id: 'image-understanding',
    intent: 'Describe, read, or OCR an uploaded image (never identify real people).',
    triggers: {
      verbs: ['what is', 'describe', 'read', 'extract', 'ocr', "what's in", 'identify'],
      nounObjects: ['image', 'photo', 'picture', 'screenshot', 'diagram'],
      fileTypeContext: ['image'],
      predicates: ['imageUploadPresent'],
    },
    requiredContext: ['imageParts', 'userRequest'],
    executionPlan: 'plain-chat',
    skills: [],
    outputContract: 'inline',
    tierNotes: {
      small: 'Vision answer from the image; never identify real people.',
      mid: 'Vision answer; never identify real people.',
      frontier: 'Vision answer; never identify real people.',
    },
  },
  {
    id: 'multi-file-synthesis',
    intent: 'Combine/compare across multiple uploaded files into one answer or artifact.',
    triggers: {
      verbs: ['combine', 'synthesize', 'compare across', 'merge', 'reconcile', 'diff'],
      nounObjects: ['files', 'documents', 'these', 'both', 'all of them'],
      predicates: ['multipleUploads'],
    },
    requiredContext: ['allUploads', 'userRequest'],
    executionPlan: 'tool-loop',
    skills: [],
    outputContract: 'artifact',
    tierNotes: {
      small: 'Read every upload before answering; do not synthesize from one.',
      mid: 'Read all uploads, then synthesize.',
      frontier: 'Read all uploads, then synthesize into an artifact or answer.',
    },
  },
  {
    id: 'export-download-request',
    intent: 'Resolve the referenced artifact and return its downloadable file.',
    triggers: {
      verbs: ['download', 'give me the file', 'export', 'send me', 'get me the'],
      nounObjects: ['file', 'download', 'copy', 'deck', 'doc', 'sheet'],
      predicates: ['artifactInContext'],
    },
    requiredContext: ['resolvedEditTarget', 'latestArtifactState'],
    executionPlan: 'office-lambda',
    skills: [],
    outputContract: 'file',
    editContract: 'full-state',
    tierNotes: {
      small: 'Resolve the artifact; render/passthrough its file. If it will not resolve, ask which one.',
      mid: 'Resolve and return the file.',
      frontier: 'Resolve and return the file.',
    },
  },
  {
    id: 'followup-anaphora',
    intent: 'Resolve a referent-bearing follow-up ("do it again", "make it shorter", "the same but…") and route to the matching edit/create workflow.',
    triggers: {
      verbs: ['continue', 'do it again', 'make it', 'same but', 'again', 'redo', 'more', 'shorter', 'longer', 'formal'],
      nounObjects: ['it', 'that', 'the same', 'this one', 'the last one'],
      predicates: ['lastMsgProducedArtifact', 'lastMsgWasSubstantive'],
    },
    requiredContext: ['resolvedReferent', 'latestArtifactState', 'userDelta'],
    executionPlan: 'artifact-renderer',
    skills: [],
    outputContract: 'artifact',
    editContract: 'structured-diff',
    tierNotes: {
      small: 'RESOLVE the referent and load its state, then route to the matching edit-*/create-* with carried context.',
      mid: 'Resolve the referent; route to the matching workflow.',
      frontier: 'Resolve the referent; route to the matching workflow.',
    },
  },
];

// ─── indices + helpers ───────────────────────────────────────────────────────

export const WORKFLOW_IDS: WorkflowId[] = WORKFLOWS.map((w) => w.id);

const BY_ID = new Map<WorkflowId, Workflow>(WORKFLOWS.map((w) => [w.id, w]));

export function getWorkflow(id: WorkflowId): Workflow {
  const w = BY_ID.get(id);
  if (!w) throw new Error(`unknown workflow id: ${id}`);
  return w;
}

export function isWorkflowId(v: string): v is WorkflowId {
  return BY_ID.has(v as WorkflowId);
}

/** Every id whose family is an edit that MUST reinject state before dispatch. */
export const EDIT_WORKFLOW_IDS: WorkflowId[] = WORKFLOWS.filter(
  (w) => w.id.startsWith('edit-') || w.editContract === 'structured-diff' || w.editContract === 'full-state',
).map((w) => w.id);

/** Does this workflow require non-null artifact state before dispatch? */
export function requiresEditState(id: WorkflowId): boolean {
  const w = BY_ID.get(id);
  if (!w) return false;
  return (
    w.id.startsWith('edit-') ||
    w.requiredContext.includes('latestArtifactState') ||
    w.requiredContext.includes('currentArtifactSource')
  );
}
