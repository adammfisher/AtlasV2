/**
 * Shared harness for the polish evals (Deliverables A–G).
 *
 * Every eval holds the MODEL constant per tier and varies only the prompt, so
 * what is under test is the doctrine in <atlas_behavior>, never the router or
 * the model picker.
 */
import { runAsAccount } from '../../../server/src/lib/account.js';
import { ensureBedrockConnected, bedrockSettings } from '../../../server/src/providers/bedrock.js';
import { completeTextAs } from '../../../server/src/providers/dispatch.js';
import { buildBehaviorBlock, type BehaviorTier } from '../../../server/src/pipeline/context.js';

export const TIERS: BehaviorTier[] = ['small', 'mid', 'frontier'];

/** Inverse of tierForModel() — the model each tier is evaluated on. */
export const MODEL_FOR_TIER: Record<BehaviorTier, string> = {
  small: 'nova',
  mid: 'haiku',
  frontier: 'sonnet',
};

/** Mirrors the PERSONA line in routes/chat.ts. The behavior block is what is
 * under test; the persona is here only so the prompt is shaped like production. */
const PERSONA =
  'You are Atlas, an AI assistant running on Amazon Bedrock. You help with conversation, analysis, ' +
  'and (via your document pipeline) generating decks, documents, spreadsheets, PDFs, diagrams, and ' +
  'small app prototypes. Be direct, concise, and concrete.';

export interface AskOptions {
  /** extra system sections appended after the behavior block (memory recall, sources, …) */
  extraSystem?: string[];
  maxTokens?: number;
}

/** One turn against a pinned tier with the real behavior block in the system prompt. */
export async function ask(tier: BehaviorTier, prompt: string, opts: AskOptions = {}): Promise<string> {
  const system = [PERSONA, buildBehaviorBlock(tier), ...(opts.extraSystem ?? [])].filter(Boolean).join('\n\n');
  return (
    await completeTextAs(
      MODEL_FOR_TIER[tier],
      [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      { maxTokens: opts.maxTokens ?? 700, temperature: 0 },
    )
  ).trim();
}

export async function withBedrock<T>(fn: () => Promise<T>): Promise<T> {
  return runAsAccount('adammfisher', async () => {
    await ensureBedrockConnected();
    if (!bedrockSettings().connected) throw new Error('Bedrock is not connected — cannot run polish evals');
    return fn();
  });
}

/* ---------- deterministic structure checks ---------- */

/** A markdown bullet or numbered-list item at the start of a line. Excludes
 * ordinary prose that merely contains a dash, and excludes fenced code blocks
 * (a shell snippet legitimately starts lines with `-`). */
export function stripFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

export function hasBullets(text: string): boolean {
  return /^[ \t]*(?:[-*•]|\d+[.)])[ \t]+\S/m.test(stripFences(text));
}

export function hasHeaders(text: string): boolean {
  return /^[ \t]*#{1,6}[ \t]+\S/m.test(stripFences(text));
}

export function hasStructure(text: string): boolean {
  return hasBullets(text) || hasHeaders(text);
}

const OPENERS = [
  /^(?:great|excellent|good|fantastic|wonderful|interesting)\s+question\b/i,
  /^(?:i'd|i would)\s+be\s+happy\s+to\b/i,
  /^(?:sure|certainly|absolutely|of course)[!,.]/i,
  /^great\b[!,]/i,
];
const CLOSERS = [
  /let me know if (?:you|there)\b[^.!?]*[.!?]\s*$/i,
  /feel free to (?:ask|reach out|let me know)\b[^.!?]*[.!?]\s*$/i,
  /(?:hope|happy) (?:this|that) helps\b[^.!?]*[.!?]?\s*$/i,
  /anything else\b[^.!?]*[?!.]\s*$/i,
];

export function hasSycophanticOpener(text: string): boolean {
  return OPENERS.some((re) => re.test(text.trim()));
}

export function hasFillerCloser(text: string): boolean {
  return CLOSERS.some((re) => re.test(text.trim()));
}

/* ---------- reporting ---------- */

export interface CaseResult {
  name: string;
  tier: BehaviorTier;
  pass: boolean;
  detail: string;
}

export function report(label: string, results: CaseResult[]): { passed: number; failed: number } {
  const failed = results.filter((r) => !r.pass);
  for (const r of failed) console.log(`  FAIL [${r.tier}] ${r.name}: ${r.detail}`);
  const passed = results.length - failed.length;
  console.log(`${label}: ${passed}/${results.length} passed`);
  return { passed, failed: failed.length };
}

/** Run tasks with bounded concurrency — the evals are dozens of live calls and
 * fully serial runs take minutes, but Bedrock throttles an unbounded fan-out. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}
