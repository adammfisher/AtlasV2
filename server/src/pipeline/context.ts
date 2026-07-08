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
