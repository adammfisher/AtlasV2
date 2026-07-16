/**
 * DELIVERABLE D.3 — citation post-processor.
 *
 * Parses <cite index="DOC-SENT">…</cite> spans out of the streamed text and
 * validates EVERY index against the turn's SourceRegistry. A tag naming a
 * document or sentence the model was never shown is dropped (its inner text is
 * kept) and logged as CITE_INVALID — an invented citation must never reach the
 * client as a chip, because a chip is a promise that the claim is grounded.
 *
 * Emits clean text plus a structured citations array whose offsets index the
 * CLEAN text, so the client can decorate without re-parsing anything.
 *
 * Index syntax (per the citation rules the model is given):
 *   "3-2"      document 3, sentence 2
 *   "3-2:5"    document 3, sentences 2..5
 *   "3-2,4-0"  multiple, comma-separated
 */
import { logTo } from '../log.js';
import type { SourceRegistry } from './sources.js';

export interface Citation {
  /** offsets into the CLEAN text */
  start: number;
  end: number;
  docIndex: number;
  sentIndices: number[];
  url?: string;
  title?: string;
  passageId?: string;
}

export interface ParsedCitations {
  text: string;
  citations: Citation[];
  invalid: number;
}

const CITE_RE = /<cite\s+index="([^"]*)"\s*>([\s\S]*?)<\/cite>/gi;

/** Parse one index attribute into (doc, sentences) pairs. Returns null if any
 * token is malformed — a partly-valid attribute is still a broken citation. */
function parseIndex(attr: string): Array<{ docIndex: number; sentIndices: number[] }> | null {
  const tokens = attr.split(',').map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return null;
  const out: Array<{ docIndex: number; sentIndices: number[] }> = [];
  for (const token of tokens) {
    const m = /^(\d+)-(\d+)(?::(\d+))?$/.exec(token);
    if (!m) return null;
    const docIndex = Number(m[1]);
    const from = Number(m[2]);
    const to = m[3] !== undefined ? Number(m[3]) : from;
    if (to < from) return null;
    // a runaway range would balloon the payload; real citations are short
    if (to - from > 50) return null;
    const sentIndices: number[] = [];
    for (let i = from; i <= to; i++) sentIndices.push(i);
    out.push({ docIndex, sentIndices });
  }
  return out;
}

/**
 * Strip <cite> tags, validate indices, and return clean text + citations.
 * Invalid tags lose the tag and keep the words: the claim may still be fine, it
 * simply is not evidenced, and silently deleting the model's prose would be a
 * worse failure than dropping a chip.
 */
export function parseCitations(raw: string, registry: SourceRegistry, convId = '-'): ParsedCitations {
  if (!raw.includes('<cite')) return { text: raw, citations: [], invalid: 0 };

  const citations: Citation[] = [];
  let text = '';
  let cursor = 0;
  let invalid = 0;
  CITE_RE.lastIndex = 0;

  for (let m = CITE_RE.exec(raw); m !== null; m = CITE_RE.exec(raw)) {
    text += raw.slice(cursor, m.index);
    const inner = m[2] ?? '';
    const start = text.length;
    text += inner;
    const end = text.length;
    cursor = m.index + m[0].length;

    const parsed = parseIndex(m[1] ?? '');
    if (!parsed) {
      invalid++;
      logTo('pipeline', `CITE_INVALID conv=${convId} unparseable index="${m[1]}"`);
      continue;
    }
    for (const { docIndex, sentIndices } of parsed) {
      const good = sentIndices.filter((i) => registry.valid(docIndex, i));
      if (!good.length) {
        invalid++;
        logTo('pipeline', `CITE_INVALID conv=${convId} index="${docIndex}-${sentIndices.join(':')}" resolves to no real sentence`);
        continue;
      }
      if (good.length !== sentIndices.length) {
        logTo('pipeline', `CITE_INVALID conv=${convId} index="${docIndex}-${sentIndices.join(':')}" partially out of range — kept ${good.length}`);
      }
      const doc = registry.get(docIndex)!;
      citations.push({
        start,
        end,
        docIndex,
        sentIndices: good,
        ...(doc.url ? { url: doc.url } : {}),
        ...(doc.title ? { title: doc.title } : {}),
        ...(doc.passageId ? { passageId: doc.passageId } : {}),
      });
    }
  }
  text += raw.slice(cursor);

  // a stray unclosed <cite ...> would otherwise render as literal markup
  const stray = /<\/?cite\b[^>]*>/gi;
  if (stray.test(text)) {
    text = text.replace(stray, '');
    logTo('pipeline', `CITE_INVALID conv=${convId} stripped unclosed cite markup`);
  }
  return { text, citations, invalid };
}

/** The snippet a chip shows on hover: the exact sentences cited. */
export function snippetFor(citation: Citation, registry: SourceRegistry): string {
  const doc = registry.get(citation.docIndex);
  if (!doc) return '';
  return citation.sentIndices.map((i) => doc.sentences[i] ?? '').filter(Boolean).join(' ');
}
