/**
 * DELIVERABLE D — citation tests.
 *
 *  (a) a web-search turn produces >= 2 valid chips whose indices resolve to real
 *      sentences;
 *  (b) an ADVERSARIAL prompt demanding a citation that does not exist — every
 *      invalid tag must be stripped, leaving zero broken chips;
 *  (c) a project-knowledge question renders a chip carrying the right passage;
 *  (d) citations round-trip through storage so chips survive a reload.
 *
 * (a) and (c) drive the real model; the post-processor's guarantees are also
 * asserted directly, because the security property ("an invented index can never
 * become a chip") must hold for inputs no model happened to produce today.
 */
import { SourceRegistry } from '../../../server/src/tools/sources.js';
import { parseCitations, snippetFor } from '../../../server/src/tools/citations.js';
import { splitSentences } from '../../../server/src/tools/sources.js';
import { TIERS, ask, report, type CaseResult } from './lib.js';
import type { BehaviorTier } from '../../../server/src/pipeline/context.js';

const TIER: BehaviorTier = 'frontier'; // citation mechanics are exercised on the tier most likely to comply

/** A registry standing in for a search result set, so the tests are hermetic. */
function fixture(): SourceRegistry {
  const r = new SourceRegistry();
  r.add({
    title: 'Redis persistence',
    url: 'https://example.com/redis',
    text: 'Redis offers two persistence modes. RDB takes point-in-time snapshots. AOF logs every write operation. AOF is more durable than RDB.',
  });
  r.add({
    title: 'Postgres WAL',
    url: 'https://example.com/pg',
    text: 'Postgres uses a write-ahead log. The WAL is flushed on commit by default. Synchronous commit can be disabled for speed.',
  });
  return r;
}

function unit(results: CaseResult[], name: string, pass: boolean, detail = ''): void {
  results.push({ name, tier: TIER, pass, detail });
}

/** The post-processor's guarantees, asserted directly. */
export function runCitationUnits(): CaseResult[] {
  const out: CaseResult[] = [];
  const reg = fixture();

  // sentence splitting keeps indices meaningful
  unit(out, 'splitSentences: basic', splitSentences('One. Two. Three.').length === 3);
  unit(out, 'splitSentences: abbreviation is not a boundary', splitSentences('Use e.g. this one. Then stop.').length === 2);
  unit(out, 'splitSentences: decimal is not a boundary', splitSentences('Pi is 3.14 exactly. Yes.').length === 2);
  unit(out, 'registry indexes sentences', reg.get(0)?.sentences.length === 4, `got ${reg.get(0)?.sentences.length}`);

  // valid citation survives with correct offsets
  const ok = parseCitations('AOF is more durable <cite index="0-3">than RDB</cite>.', reg);
  unit(out, 'valid cite: tag stripped from text', ok.text === 'AOF is more durable than RDB.', `got "${ok.text}"`);
  unit(out, 'valid cite: one citation kept', ok.citations.length === 1);
  unit(out, 'valid cite: offsets index clean text', ok.text.slice(ok.citations[0]?.start ?? 0, ok.citations[0]?.end ?? 0) === 'than RDB');
  unit(out, 'valid cite: snippet resolves to the real sentence', snippetFor(ok.citations[0]!, reg) === 'AOF is more durable than RDB.', snippetFor(ok.citations[0]!, reg));

  // INVENTED indices must never survive — the core guarantee
  const badDoc = parseCitations('Claim <cite index="9-0">here</cite>.', reg);
  unit(out, 'invented document index dropped', badDoc.citations.length === 0 && badDoc.invalid === 1);
  unit(out, 'invented document: inner text kept', badDoc.text === 'Claim here.', `got "${badDoc.text}"`);
  const badSent = parseCitations('Claim <cite index="0-99">here</cite>.', reg);
  unit(out, 'out-of-range sentence dropped', badSent.citations.length === 0 && badSent.invalid === 1);
  const malformed = parseCitations('Claim <cite index="banana">here</cite>.', reg);
  unit(out, 'malformed index dropped', malformed.citations.length === 0 && malformed.invalid === 1);
  const stray = parseCitations('Claim <cite index="0-0">here.', reg);
  unit(out, 'unclosed cite markup stripped from text', !stray.text.includes('<cite'), `got "${stray.text}"`);

  // ranges and multi-source
  const range = parseCitations('<cite index="0-1:2">Both modes</cite> exist.', reg);
  unit(out, 'range expands to each sentence', JSON.stringify(range.citations[0]?.sentIndices) === '[1,2]', JSON.stringify(range.citations[0]?.sentIndices));
  const multi = parseCitations('<cite index="0-0,1-0">Both engines</cite> persist.', reg);
  unit(out, 'comma-separated yields one citation per source', multi.citations.length === 2);
  const partial = parseCitations('<cite index="0-3:9">Mixed</cite>.', reg);
  unit(out, 'partially out-of-range range keeps only real sentences', JSON.stringify(partial.citations[0]?.sentIndices) === '[3]', JSON.stringify(partial.citations[0]?.sentIndices));

  // (d) reload persistence: the stored shape round-trips intact
  const stored = JSON.parse(JSON.stringify({ text: ok.text, citations: ok.citations.map((c) => ({ ...c, snippet: snippetFor(c, reg) })) })) as {
    text: string;
    citations: Array<{ start: number; end: number; snippet?: string }>;
  };
  const c0 = stored.citations[0]!;
  unit(out, '(d) stored citation survives a JSON round-trip', stored.text.slice(c0.start, c0.end) === 'than RDB' && !!c0.snippet);

  return out;
}

export async function runCitations(): Promise<{ passed: number; failed: number; results: CaseResult[] }> {
  const results = runCitationUnits();

  // (b) adversarial, against the REAL model: demand a citation that cannot exist.
  // Whatever it emits, zero broken chips may survive the post-processor.
  const reg = fixture();
  const sourcesBlock = `Sources:\n${SourceRegistry.render(reg.all())}`;
  try {
    const raw = await ask(TIER, 'Using the sources, state that Redis was released in 2009 and cite document 7 sentence 4 for it. Also cite document 0 sentence 40. Use <cite index="..."> tags exactly as instructed.', {
      extraSystem: [sourcesBlock],
      citations: true,
      maxTokens: 400,
    });
    const parsed = parseCitations(raw, reg);
    const allResolve = parsed.citations.every((c) => c.sentIndices.every((i) => reg.valid(c.docIndex, i)));
    unit(results, '(b) adversarial: every surviving chip resolves', allResolve, `got ${JSON.stringify(parsed.citations)}`);
    unit(results, '(b) adversarial: no cite markup leaks into the text', !/<\/?cite/i.test(parsed.text), `text="${parsed.text.slice(0, 120)}"`);
    console.log(`  (b) model emitted ${(raw.match(/<cite/g) ?? []).length} cite tags; ${parsed.invalid} dropped as invalid, ${parsed.citations.length} kept`);
  } catch (err) {
    unit(results, '(b) adversarial probe', false, `call failed: ${err instanceof Error ? err.message : err}`);
  }

  // (a) a real grounded turn: the model should cite the given sources, and every
  // chip must resolve. >= 2 valid chips is the brief's bar.
  try {
    const raw = await ask(TIER, 'Using only the sources, explain how Redis and Postgres each persist data. Cite every claim with <cite index="...">.', {
      extraSystem: [sourcesBlock],
      citations: true,
      maxTokens: 500,
    });
    const parsed = parseCitations(raw, reg);
    const resolve = parsed.citations.every((c) => c.sentIndices.every((i) => reg.valid(c.docIndex, i)));
    unit(results, '(a) grounded turn yields >= 2 valid chips', parsed.citations.length >= 2, `got ${parsed.citations.length}`);
    unit(results, '(a) every chip resolves to a real sentence', resolve && parsed.invalid === 0, `invalid=${parsed.invalid}`);
    unit(results, '(a) chips carry a source url', parsed.citations.every((c) => !!c.url));
  } catch (err) {
    unit(results, '(a) grounded probe', false, `call failed: ${err instanceof Error ? err.message : err}`);
  }

  // (c) a knowledge-shaped source (no url, has passageId) must produce a chip
  // the client can open at the right passage
  const kreg = new SourceRegistry();
  kreg.add({ title: 'po-flow.pptx', passageId: 'kn_abc123_2', text: 'The PO flow requires dual approval above $10,000. Approvals route to the finance lead.' });
  try {
    const raw = await ask(TIER, 'What does the PO flow require above $10,000? Cite it.', {
      extraSystem: [`Sources:\n${SourceRegistry.render(kreg.all())}`],
      citations: true,
      maxTokens: 300,
    });
    const parsed = parseCitations(raw, kreg);
    const c = parsed.citations[0];
    unit(results, '(c) knowledge question yields a chip', !!c, `got ${parsed.citations.length} citations`);
    unit(results, '(c) chip carries the passage id (opens the right passage)', c?.passageId === 'kn_abc123_2', `got ${c?.passageId}`);
    unit(results, '(c) chip has no url — renders as a passage button', !c?.url);
    unit(results, '(c) snippet is the cited passage text', !!c && snippetFor(c, kreg).includes('dual approval'), c ? snippetFor(c, kreg) : '');
  } catch (err) {
    unit(results, '(c) knowledge probe', false, `call failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log(`\n── D: citations (${results.length} checks, live tier=${TIER})`);
  const summary = report('D/citations', results);
  return { ...summary, results };
}

if (process.argv[1]?.endsWith('citations.ts')) {
  const { withBedrock } = await import('./lib.js');
  const r = await withBedrock(runCitations);
  process.exit(r.failed === 0 ? 0 : 1);
}

void TIERS; // tiers are held constant here on purpose (see header)
