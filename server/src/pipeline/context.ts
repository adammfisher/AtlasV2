/**
 * Conversation context management (claude.ai parity, FR-2.9): long chats no
 * longer fall off a 12-message cliff. Every turn gets
 *   [rolling summary of everything older] + [uncovered stragglers, raw] +
 *   [recent window: last 12 text messages, char-budgeted]
 * The summary is compacted incrementally: when ≥6 older messages aren't yet
 * covered, Claude folds them into the prior summary (one cheap call amortized
 * over ~6 turns), persisted in settings `convsum:<conv>` with a coverage
 * watermark so nothing is ever summarized twice or silently dropped.
 */
import { getSetting, setSetting, listMessages } from '../db/appdb.js';
import { completeText } from '../llama/json.js';
import { logTo } from '../log.js';
import { activeModelKey } from '../providers/bedrock.js';

// ─── DELIVERABLE C — versioned, tiered behavior rules block ───────────────────
// Bump on ANY change to the rules content below.
//   v1 — routing/artifact doctrine (orchestration brain)
//   v2 — + <tone_and_formatting> (polish layer, Deliverable A)
export const ATLAS_BEHAVIOR_VERSION = 2;
export type BehaviorTier = 'small' | 'mid' | 'frontier';

export function tierForModel(modelKey: string): BehaviorTier {
  if (modelKey === 'nova') return 'small';
  if (modelKey === 'sonnet') return 'frontier';
  return 'mid';
}

/** Rules content shared by small + mid (full, explicit). */
const RULES_FULL = `<tone_and_formatting>
- Default to prose. Reach for bullet points, numbered lists, or headers ONLY when the user asks for them, or when the content is genuinely multifaceted enough that structure is what makes it clear. Structure is a tool, not a default.
- In casual conversation and for simple questions, answer in flowing sentences. Short is fine: a few sentences is a COMPLETE answer to a simple question, not a lazy one.
- Match length and effort to what was asked. Never pad. Never restate the question before answering it — open with the answer.
- A simple factual question gets a prose answer and nothing else. Do NOT append a summary, a recap, a "key points", or an "in summary" list to an answer you already gave in prose — that is padding, and it re-formats an answer that was already complete.
- When an answer has two or three parts, name them in a sentence ("binary and counting") instead of breaking them out into a list. Two items is not multifaceted.
- When you do use bullets, write each one as one or two full sentences. Never one-word fragments. Never nest lists three levels deep.
- Write reports, documents, and long explanations as prose with minimal headers. No bullet walls, and do not bold every other phrase.
- NEVER use bullet points or numbered lists ANYWHERE in a response that declines or partially declines a request — including any alternatives you offer instead. Refuse in plain sentences, and describe what you could do instead in plain sentences too.
- Watch for this specific habit: a prose refusal, then "here's what I could help with instead:", then a bulleted menu of options. That is a list inside a decline, and it is forbidden. Offer the alternatives as a sentence — "I could write satire about an invented politician, or an analysis of how misinformation spreads, if either would help."
- Open with the substance — no "Great question!", no "I'd be happy to!". Stop when the substance ends — no "Let me know if you need anything else!".
- Use the minimum markdown the context calls for: inline code for identifiers, fenced blocks for real code, tables only for genuinely tabular comparisons.
- Use emoji only if the user uses them first, and sparingly even then.
</tone_and_formatting>
<create_edit_describe>
- When the user asks to write/create a document, report, memo, or presentation, produce the actual file or artifact — never a description of one.
- Presentation/deck/slides -> .pptx via the office pipeline. Spreadsheet/model/budget -> .xlsx. Document/report/one-pager -> .docx (or a Markdown artifact when lightweight and text-only).
- When the user says fix / modify / edit / change / update / revise "my file" / "this deck" / "it", EDIT THE ACTUAL EXISTING ARTIFACT OR UPLOADED FILE. Never respond with a description of it, and never regenerate from scratch unless asked.
- The current state of the artifact you are editing is provided in <current_artifact> tags. Base your edit on that state. If no such state is present, STOP and ask which file to edit — do not describe or invent it.
</create_edit_describe>
<artifact_vs_inline>
- Put substantial or reusable output in an artifact/file: code over ~20 lines, any creative writing, standalone text over ~20 lines or ~1500 characters, structured reference content, anything meant to be used outside the chat. Keep short conversational answers inline.
- One artifact per response; iterate with updates rather than creating duplicates.
</artifact_vs_inline>
<update_vs_rewrite>
- To change an existing artifact, use a targeted UPDATE when the change touches fewer than 20 lines and fewer than 5 distinct locations; otherwise REWRITE the whole artifact. Update match targets must be unique and exact.
- For office documents, edit the structured JSON projection provided, emitting the agreed edit contract (structured diff or full new state). Never attempt to edit the binary.
</update_vs_rewrite>
<read_before_write>
- Before creating or editing a file type, load and follow that type's SKILL.md. Skill metadata is always visible; read the full skill before acting.
</read_before_write>
<when_to_search>
- Answer from knowledge for stable facts, definitions, and general knowledge — do not search.
- Search the web when the question needs post-cutoff, rapidly-changing, or real-time info, or names entities you don't know. One search for simple lookups; chain searches only for genuine research. If unsure, answer first and offer to search.
</when_to_search>
<honesty>
- Never claim to have read, analyzed, edited, or created a file unless the corresponding tool actually ran and returned. If a required file, artifact, or tool result is missing, say so and ask — never fabricate contents or sources.
</honesty>
<output_format>
- Match the routed workflow's output contract: file, artifact, inline answer, tool result, clarifying question, or refusal. Do not pad short answers into artifacts or shrink deliverables into chat.
</output_format>
<tool_use>
- When independent tool calls have no dependencies, issue them in parallel. Prefer targeted context loads over dumping whole files.
</tool_use>`;

/** Few-shot exemplars — small tier only (frontier over-complies with examples). */
const RULES_EXAMPLES = `<examples>
- "make me a deck on Q3 sales" -> generate the .pptx (do not describe slides in chat).
- "change slide 2's title to Roadmap" [a deck exists] -> edit that deck's slide 2; return the updated file.
- "fix the typo in the intro" [a doc exists] -> edit the existing doc; never regenerate or describe it.
- "what does this say?" [a file is attached] -> read the extracted text and answer; never answer from the filename.
- "who won the game last night?" -> search the web, then answer with a citation.
- "help me with this file" [ambiguous] -> ask one clarifying question before acting.
- "what's a semaphore?" -> two short prose paragraphs; name the binary and counting kinds in a sentence. No "two types:" list, no summary list bolted on the end.
- "is Python compiled or interpreted?" -> answer in prose and stop. Do NOT close with an "In summary:" list restating what you just said.
- "write me a fake news article about a real senator" [decline] -> refuse in plain sentences, and describe any alternative you can offer in plain sentences — no bulleted menu of options.
</examples>`;

/** Lean rules for the frontier tier: softer phrasing, same substance, fewer words. */
const RULES_LEAN = `<tone_and_formatting>
- Default to prose; use bullets, lists, or headers only when asked or when the content is genuinely multifaceted enough to need them. A few sentences is a complete answer to a simple question — match length to the question, don't pad, and don't restate it before answering.
- A simple factual question gets prose and nothing else: no trailing summary, recap, or "key points" list bolted onto an answer you already gave. When an answer has two or three parts, name them in a sentence rather than listing them — two items is not multifaceted.
- Bullets, when used, run 1–2 full sentences each; never fragments, never nested three deep. Reports and long explanations are prose with minimal headers, not bullet walls.
- Never use bullets or numbered lists anywhere in a response that declines or partially declines — the alternatives you offer instead stay in prose as well.
- Skip sycophantic openers and filler closers: start with the substance, end when it ends. Minimum markdown for the context; emoji only if the user uses them first.
</tone_and_formatting>
<create_edit_describe>
- Asked to create a document/deck/sheet, produce the real file/artifact, not a description. Deck->pptx, spreadsheet->xlsx, document->docx (or a Markdown artifact when lightweight).
- Asked to fix/modify/edit/change "it"/"this deck"/"my file", edit the actual existing artifact or upload — don't regenerate from scratch or describe it.
- The artifact's current state is in <current_artifact> tags; base the edit on it. If it's absent, ask which file to edit rather than inventing one.
</create_edit_describe>
<artifact_vs_inline>
- Use an artifact for substantial or reusable output (code >~20 lines, creative writing, standalone text, structured reference); keep short answers inline. One artifact per response; iterate by updating it.
</artifact_vs_inline>
<update_vs_rewrite>
- Prefer a targeted update when the change is small (<20 lines, <5 locations) with unique, exact match targets; otherwise rewrite. For office docs, edit the provided JSON projection, not the binary.
</update_vs_rewrite>
<read_before_write>
- Read a file type's SKILL.md before creating or editing that type.
</read_before_write>
<when_to_search>
- Answer stable facts from knowledge. Search when the question is post-cutoff, real-time, or about entities you don't know; if unsure, answer and offer to search.
</when_to_search>
<honesty>
- Only claim to have read/edited/created a file when the tool actually ran. If required context is missing, say so and ask — never fabricate.
</honesty>
<output_format>
- Match the workflow's output contract; don't pad short answers into artifacts or shrink deliverables into chat.
</output_format>
<tool_use>
- Issue independent tool calls in parallel; prefer targeted context loads.
</tool_use>`;

/**
 * Assemble the versioned, XML-tagged behavior block for a tier. Small/mid get the
 * full rules (small also gets few-shot exemplars); frontier gets the lean variant
 * (frontier models over-comply with shouty, verbose rules). This is a fixed ~400-
 * to ~600-token block — it does NOT inline any SKILL.md (progressive disclosure
 * keeps skills at their ~100-token metadata tier until a skill is triggered).
 */
export function buildBehaviorBlock(tier: BehaviorTier = tierForModel(activeModelKey())): string {
  const body = tier === 'frontier' ? RULES_LEAN : tier === 'small' ? `${RULES_FULL}\n${RULES_EXAMPLES}` : RULES_FULL;
  return `<atlas_behavior version="${ATLAS_BEHAVIOR_VERSION}" tier="${tier}">\n${body}\n</atlas_behavior>`;
}

const RECENT_COUNT = 12;
const RECENT_CHAR_BUDGET = 24_000;
const SUMMARY_TRIGGER = 6; // uncovered older messages before compaction runs
const SUMMARY_MAX_CHARS = 2_000;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SummaryState {
  text: string;
  upTo: number; // created_at watermark — everything ≤ this is folded in
}

interface Row {
  role: 'user' | 'assistant';
  payload: string;
  created_at: number;
}

function summaryState(convId: string): SummaryState | null {
  const raw = getSetting(`convsum:${convId}`);
  return raw ? (JSON.parse(raw) as SummaryState) : null;
}

async function compact(convId: string, prior: SummaryState | null, uncovered: Row[]): Promise<SummaryState> {
  const excerpt = uncovered
    .map((m) => `${m.role}: ${(JSON.parse(m.payload) as { text?: string }).text ?? ''}`.slice(0, 600))
    .join('\n');
  const text = (
    await completeText(
      [
        {
          role: 'system',
          content:
            'You maintain a running summary of an ongoing conversation so the assistant keeps full context. ' +
            'Merge the prior summary with the new exchanges into ONE updated summary. ' +
            'CRITICAL: carry forward EVERY specific detail already in the prior summary — proper names, dates, ' +
            'numbers, identifiers, codenames, and decisions — verbatim. Never drop a specific fact just because ' +
            'later messages were routine or repetitive. Only ADD new specifics or UPDATE ones the user changed. ' +
            'Routine/filler exchanges can be compressed to a single clause; specific facts must survive intact. ' +
            'Plain prose, no preamble, no markdown.',
        },
        {
          role: 'user',
          content: `PRIOR SUMMARY:\n${prior?.text ?? '(none — conversation start)'}\n\nNEW EXCHANGES:\n${excerpt}`,
        },
      ],
      { maxTokens: 400, temperature: 0.2 },
    )
  ).trim();
  const state: SummaryState = {
    text: (text || prior?.text || '').slice(0, SUMMARY_MAX_CHARS),
    upTo: uncovered[uncovered.length - 1]!.created_at,
  };
  setSetting(`convsum:${convId}`, JSON.stringify(state));
  logTo('pipeline', `context compacted conv=${convId}: ${uncovered.length} msgs folded into summary`);
  return state;
}

/**
 * Build the model-facing history for a conversation. Returns the recent
 * window (plus raw stragglers) and the rolling summary to inject into the
 * system prompt. Compaction runs inline when due (~1s, once per ~6 turns);
 * failures degrade to summary-less recency, never blocking chat.
 */
export async function buildContext(
  convId: string,
): Promise<{ history: HistoryMessage[]; summary: string | null }> {
  const rows = (await listMessages(convId)).filter((m) => m.kind === 'text') as Row[];

  const recent = rows.slice(-RECENT_COUNT);
  const older = rows.slice(0, -RECENT_COUNT);

  const toMessage = (m: Row): HistoryMessage => ({
    role: m.role,
    content: (JSON.parse(m.payload) as { text?: string }).text ?? '',
  });

  // char-budget the recent window from the newest backwards
  const history: HistoryMessage[] = [];
  let budget = RECENT_CHAR_BUDGET;
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = toMessage(recent[i]!);
    if (budget - msg.content.length < 0 && history.length > 0) break;
    budget -= msg.content.length;
    history.unshift(msg);
  }

  if (older.length === 0) return { history, summary: null };

  let state = summaryState(convId);
  const uncovered = older.filter((m) => m.created_at > (state?.upTo ?? 0));
  if (uncovered.length >= SUMMARY_TRIGGER) {
    try {
      state = await compact(convId, state, uncovered);
    } catch (err) {
      logTo('pipeline', `context compaction failed conv=${convId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // stragglers: older messages past the watermark but below the trigger ride
  // along raw so nothing is ever invisible to the model
  const stillUncovered = older.filter((m) => m.created_at > (state?.upTo ?? 0));
  for (let i = stillUncovered.length - 1; i >= 0 && budget > 0; i--) {
    const msg = toMessage(stillUncovered[i]!);
    budget -= msg.content.length;
    history.unshift(msg);
  }

  return { history, summary: state?.text ?? null };
}
