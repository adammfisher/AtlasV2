/**
 * DELIVERABLE B — runtime rule reinjection.
 *
 * Models drift over long conversations and small models drift fast, but paying
 * for the full rule block on every turn is the wrong trade: the system prefix is
 * the cached part of the prompt, and growing it costs on every single turn.
 *
 * So the base prompt stays lean and a compact <behavior_reminder> is appended to
 * the CURRENT USER MESSAGE when drift becomes likely. Appending to the user turn
 * — not the system prompt — is deliberate: the system prefix stays byte-identical
 * across turns, so the Bedrock cachePoint (Deliverable E) keeps hitting. Putting
 * the reminder in the system block would invalidate the cache on the exact turns
 * a long conversation can least afford it.
 *
 * The reminder is invisible: it is added to the in-flight payload only, never
 * persisted as a message and never echoed to the transcript.
 *
 * State lives in the settings KV as `remind:<conv>`, mirroring how `convsum:<conv>`
 * already persists per-conversation state. Settings are DynamoDB items, so this
 * survives Lambda recycling exactly as the brief requires, without widening
 * ConversationRow.
 */
import { getSetting, setSetting } from '../db/appdb.js';
import { logTo } from '../log.js';
import type { BehaviorTier } from './context.js';

/** Turns since the last reminder before we re-anchor. Per-tier: small models
 * drift fastest and get reminded most often. */
export const REMINDER_TURNS = 12;
export const REMINDER_TURNS_BY_TIER: Record<BehaviorTier, number> = {
  small: 8,
  mid: REMINDER_TURNS,
  frontier: REMINDER_TURNS,
};

/** Context growth (in tokens, from the stored Converse usage of prior turns)
 * since the last reminder before we re-anchor. */
export const REMINDER_TOKENS = 30_000;

export function reminderTurnsFor(tier: BehaviorTier): number {
  return REMINDER_TURNS_BY_TIER[tier];
}

/**
 * ~150 tokens distilling the most drift-prone rules: formatting discipline,
 * create-vs-edit-vs-describe, honesty, and memory etiquette (Deliverable C).
 * Deliberately terse — this rides on every reminded turn.
 */
export const BEHAVIOR_REMINDER = `<behavior_reminder>
Still in force, from your instructions:
- Prose by default. Bullets or headers only when asked or when the content is genuinely multifaceted. Never bolt a summary or "key points" list onto an answer you already gave in prose, and never use a list anywhere in a response that declines or partly declines. Match length to the question; no "Great question!" opener, no "let me know if you need anything else" closer.
- Asked to create a document, deck, or sheet: produce the real file, not a description of one. Asked to fix or change "it": edit the existing artifact given in <current_artifact> — never regenerate it from scratch, never describe it instead.
- Only claim to have read, edited, or created something if a tool actually did it. Never invent file contents, sources, or tool results.
- Apply anything you remember about the user as if you simply know it. Never narrate retrieval — no "based on what I know about you", no "my records show".
</behavior_reminder>`;

interface ReminderState {
  /** conversation depth (approx. user turns) at the last reminder */
  lastTurn: number;
  /** context size in tokens at the last reminder */
  lastTokens: number;
  /** most recent observed context size, from the last turn's Converse usage */
  ctxTokens: number;
}

const ZERO: ReminderState = { lastTurn: 0, lastTokens: 0, ctxTokens: 0 };

export function reminderState(convId: string): ReminderState {
  const raw = getSetting(`remind:${convId}`);
  if (!raw) return { ...ZERO };
  try {
    return { ...ZERO, ...(JSON.parse(raw) as Partial<ReminderState>) };
  } catch {
    return { ...ZERO };
  }
}

function write(convId: string, state: ReminderState): void {
  setSetting(`remind:${convId}`, JSON.stringify(state));
}

/**
 * Record the context size observed for this turn. inputTokens from the Converse
 * usage IS the context size — it counts the whole prompt the model just read —
 * so "tokens since the last reminder" is how much the context has GROWN, not the
 * sum of tokens billed (which would re-count the same history every turn and
 * trip the threshold on conversation length alone).
 */
export function recordUsage(convId: string, inputTokens: number): void {
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return;
  const state = reminderState(convId);
  // tool loops report usage per round; the largest round is the fullest context
  if (inputTokens <= state.ctxTokens) return;
  write(convId, { ...state, ctxTokens: inputTokens });
}

export interface ReminderDecision {
  due: boolean;
  reason: 'turns' | 'tokens' | null;
  turnsSince: number;
  tokensSince: number;
}

/** Is this turn due for a reminder? `turn` is the approximate depth (user turns). */
export function reminderDue(convId: string, turn: number, tier: BehaviorTier): ReminderDecision {
  const state = reminderState(convId);
  const turnsSince = turn - state.lastTurn;
  const tokensSince = Math.max(0, state.ctxTokens - state.lastTokens);
  if (turnsSince >= reminderTurnsFor(tier)) return { due: true, reason: 'turns', turnsSince, tokensSince };
  if (tokensSince >= REMINDER_TOKENS) return { due: true, reason: 'tokens', turnsSince, tokensSince };
  return { due: false, reason: null, turnsSince, tokensSince };
}

/** Mark this turn as reminded — the position survives Lambda recycling. */
export function markReminded(convId: string, turn: number): void {
  const state = reminderState(convId);
  write(convId, { ...state, lastTurn: turn, lastTokens: state.ctxTokens });
}

/**
 * Append the reminder to the last user message of the outgoing payload when due.
 * Returns the (possibly unchanged) messages plus whether it fired. Never mutates
 * stored history — the caller passes the in-flight copy.
 */
export function applyReminder<T extends { role: string; content: unknown }>(
  messages: T[],
  convId: string,
  turn: number,
  tier: BehaviorTier,
): { messages: T[]; fired: boolean; decision: ReminderDecision } {
  const decision = reminderDue(convId, turn, tier);
  if (!decision.due) return { messages, fired: false, decision };

  const idx = messages.map((m) => m.role).lastIndexOf('user');
  if (idx === -1) return { messages, fired: false, decision };

  const target = messages[idx]!;
  const appended: T = { ...target };
  if (typeof target.content === 'string') {
    appended.content = `${target.content}\n\n${BEHAVIOR_REMINDER}` as T['content'];
  } else if (Array.isArray(target.content)) {
    // multimodal turn: the reminder is a trailing text part so images are untouched
    appended.content = [...target.content, { type: 'text', text: BEHAVIOR_REMINDER }] as T['content'];
  } else {
    return { messages, fired: false, decision };
  }

  const out = [...messages];
  out[idx] = appended;
  markReminded(convId, turn);
  logTo('pipeline', `behavior reminder injected conv=${convId} turn=${turn} reason=${decision.reason} (turnsSince=${decision.turnsSince}, tokensSince=${decision.tokensSince})`);
  return { messages: out, fired: true, decision };
}
