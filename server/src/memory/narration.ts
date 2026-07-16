/**
 * DELIVERABLE C.2 — memory-narration detector.
 *
 * The <memory_etiquette> rules tell the model never to narrate retrieval. This
 * enforces it MECHANICALLY rather than trusting the prompt: the buffered final
 * text is scanned for the forbidden phrasings and every hit is logged as a
 * MEMORY_NARRATION event.
 *
 * It deliberately does NOT block or rewrite the response. A false positive that
 * swallowed a real answer would be far worse than the tic it removed, and by the
 * time the text is buffered the user has already watched it stream. The eval
 * surfaces the count; the log names the conversation.
 *
 * Scanning the buffered final text is what makes this streaming-safe — a phrase
 * split across two SSE deltas would defeat a per-delta scan.
 */
import { logTo } from '../log.js';

/** The forbidden list, fuzzy on pronouns and near-synonyms so trivial rewordings
 * ("based on what I know about YOUR work") do not slip past a literal match. */
const NARRATION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'based on what I know about you', re: /based on (?:what|everything|all) I know about (?:you|your)\b/i },
  { label: 'according to my memory', re: /according to my (?:memory|memories|notes|records)\b/i },
  { label: 'my records show', re: /my (?:records|notes|memory|memories|files) (?:show|shows|indicate|indicates|say|says|tell me)\b/i },
  { label: 'I can see that you', re: /\bI can see (?:that )?(?:you|your)\b/i },
  { label: 'based on our previous conversations', re: /based on (?:our|your|the|my) (?:previous|earlier|past|prior|last) (?:conversation|conversations|chats?|discussions?|exchanges?)\b/i },
  { label: 'from your profile', re: /from (?:your|the user's) profile\b/i },
  { label: 'my memory indicates', re: /my memory (?:indicates|shows|says|tells)\b/i },
  { label: 'I have stored', re: /\bI (?:have|'ve) (?:stored|saved|recorded|got stored)\b/i },
  { label: "according to what you've told me before", re: /according to what you(?:'ve| have)? (?:told|said to|mentioned to) me\b/i },
  // adjacent tics the same rule forbids — narrating retrieval by another name
  { label: 'from what I remember about you', re: /from what I (?:remember|recall) about (?:you|your)\b/i },
  { label: 'I remember that you', re: /\bI remember (?:that )?(?:you|your)\b/i },
  { label: 'in my memory', re: /\bin my (?:memory|records|notes)\b/i },
];

export interface NarrationHit {
  label: string;
  match: string;
}

/** Every forbidden phrasing present in the text. Empty array = clean. */
export function findNarration(text: string): NarrationHit[] {
  const hits: NarrationHit[] = [];
  for (const { label, re } of NARRATION_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push({ label, match: m[0] });
  }
  return hits;
}

/**
 * Scan a completed response and log a MEMORY_NARRATION event per hit. Returns the
 * hits so callers (the eval) can count them. Never throws, never blocks.
 */
export function scanForNarration(text: string, convId: string): NarrationHit[] {
  if (!text) return [];
  const hits = findNarration(text);
  for (const hit of hits) {
    logTo('memory', `MEMORY_NARRATION conv=${convId} phrase="${hit.label}" matched="${hit.match}"`);
  }
  return hits;
}
