/**
 * DELIVERABLE D.1 — index-grounded sources.
 *
 * Every document put in front of the model — web search results, fetched pages,
 * project-knowledge passages — is split into sentences and presented with STABLE
 * indices:
 *
 *   <document index="0" title="…" url="…">
 *     <sentence index="0">…</sentence>
 *   </document>
 *
 * The model then cites <cite index="0-1">claim</cite>, and the post-processor
 * (citations.ts) validates each index against the same registry. That is the
 * whole point: a citation either resolves to a real sentence the model was shown
 * or it is dropped. The old approach — mapping URLs back onto claims after the
 * fact — could not tell a grounded claim from an invented one.
 *
 * One registry per turn, threaded through the tool executor.
 */

export interface IndexedSource {
  index: number;
  title?: string;
  url?: string;
  /** knowledge passages: the id the client needs to open the right passage */
  passageId?: string;
  sentences: string[];
}

/** Abbreviations that must not end a sentence. Deliberately short — a missed
 * split costs a slightly long citation target, a wrong split costs a broken one. */
const ABBREV = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|approx|Inc|Ltd|Co|Corp|No|Fig|Vol|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.)$/i;

/**
 * Split text into sentences. Regex-based on purpose: this runs on every search
 * result on the chat path, so it must be fast and dependency-free. Guards the
 * common false splits (abbreviations, decimals, initials).
 */
export function splitSentences(text: string, maxSentences = 40): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const next = clean[i + 1];
    // a terminator must be followed by whitespace and then a new sentence
    if (next !== undefined && next !== ' ') continue;
    const head = clean.slice(start, i + 1);
    if (ABBREV.test(head)) continue; // "e.g. " / "Dr. "
    if (/\d\.$/.test(head) && /^\s*\d/.test(clean.slice(i + 1))) continue; // 3.14
    if (/\b[A-Z]\.$/.test(head)) continue; // initials: "J. Smith"
    const sentence = head.trim();
    if (sentence) out.push(sentence);
    start = i + 1;
    if (out.length >= maxSentences) return out;
  }
  const tail = clean.slice(start).trim();
  if (tail && out.length < maxSentences) out.push(tail);
  return out;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Per-turn registry of everything the model was shown, and the only authority
 * on whether a <cite index> is real. */
export class SourceRegistry {
  private sources: IndexedSource[] = [];

  get size(): number {
    return this.sources.length;
  }

  all(): IndexedSource[] {
    return this.sources;
  }

  get(index: number): IndexedSource | undefined {
    return this.sources[index];
  }

  /** Register a document and return its stable index. */
  add(doc: { title?: string; url?: string; passageId?: string; text: string; maxSentences?: number }): IndexedSource {
    const source: IndexedSource = {
      index: this.sources.length,
      title: doc.title,
      url: doc.url,
      passageId: doc.passageId,
      sentences: splitSentences(doc.text, doc.maxSentences ?? 40),
    };
    this.sources.push(source);
    return source;
  }

  /** Is this (document, sentence) pair real? The validation the whole design rests on. */
  valid(docIndex: number, sentIndex: number): boolean {
    const doc = this.sources[docIndex];
    return !!doc && sentIndex >= 0 && sentIndex < doc.sentences.length;
  }

  /** Render the given documents for the model. Indices are compact — the
   * document's own index and 0-based sentence indices, nothing else. */
  static render(sources: IndexedSource[]): string {
    return sources
      .map((s) => {
        const attrs = [
          `index="${s.index}"`,
          s.title ? `title="${escapeXml(s.title.slice(0, 160))}"` : '',
          s.url ? `url="${escapeXml(s.url)}"` : '',
        ]
          .filter(Boolean)
          .join(' ');
        const body = s.sentences.map((sent, i) => `<sentence index="${i}">${escapeXml(sent)}</sentence>`).join('');
        return `<document ${attrs}>${body}</document>`;
      })
      .join('\n');
  }

  /** Render only the documents added since `from` — a tool result shows its own
   * documents, not everything gathered earlier in the turn. */
  renderFrom(from: number): string {
    return SourceRegistry.render(this.sources.slice(from));
  }
}
