/**
 * Web tools for chat (claude.ai parity): web_search via DuckDuckGo's HTML
 * endpoint (no API key) and web_fetch for pulling a page's readable text.
 * Both are best-effort with short timeouts — failures return honest error
 * strings the model can relay.
 */
import type { SourceRegistry } from './sources.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Atlas/1.0';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/* ─── DELIVERABLE F — tool specs are prompts ────────────────────────────────── */

/**
 * The search tool's description carries the whole decision tree, because for a
 * small model the tool description IS the policy: it is read at the exact moment
 * the decision is made, while a rule buried in the system prompt is competing
 * with everything else in context.
 *
 * `searchCap` is tier-dependent — the small tier is capped at one call, since it
 * is the tier most likely to loop on near-identical queries.
 */
export function webToolSpecs(tier: 'small' | 'mid' | 'frontier'): Array<{ name: string; description: string; schema: Record<string, unknown> }> {
  const scale =
    tier === 'small'
      ? 'SCALE: exactly ONE search per question. Search once, then answer from what you get. Do not chain searches.'
      : 'SCALE: one search for a simple lookup. Two to five only for genuine multi-part research. Never more.';
  return [
    {
      name: 'web_search',
      description: [
        'Search the web. Returns indexed <document> blocks with per-sentence indices you can cite.',
        'SEARCH WHEN: the answer changed after your training cutoff; the topic moves fast (prices, releases, standings, weather, news); the question names a person, company, product, or event you do not recognise; or it uses temporal words — today, now, current, latest, this week, in 2026.',
        'NEVER SEARCH WHEN: the answer is a stable fact, a definition, or settled history; the user wants code written, explained, or debugged; the task is reasoning, writing, or maths over what is already in the conversation. You already know these, and searching makes the answer slower and worse, not better.',
        scale,
        'QUERY: 2–6 keywords, the way a person types into a search box. No boolean operators, no quotes, no site: filters. Add the year when the answer is dated ("nvidia earnings 2026").',
        'ANTI-PATTERNS: never fire a second query that is a near-paraphrase of the first — if the results were poor, change the terms or answer with what you have and say it was thin. Never search to confirm something you already know. Never search for the user\'s own words back at them.',
        'If you are unsure whether to search, answer from knowledge first and offer to search.',
      ].join(' '),
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: { query: { type: 'string', description: '2–6 plain keywords, no operators' } },
      },
    },
    {
      name: 'web_fetch',
      description: [
        'Fetch one web page and return its readable text as an indexed <document> you can cite.',
        'FETCH WHEN: the user gave you a URL and the answer is inside it, or a search snippet is too thin to answer from and one specific result clearly holds the answer.',
        'DO NOT FETCH: a page you will not actually read and use; a URL you guessed or constructed rather than one that came from the user or a search result; several results one after another hoping one helps. Fetch the single page you have a reason to believe answers the question.',
      ].join(' '),
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['url'],
        properties: { url: { type: 'string', description: 'an exact URL from the user or a search result — never invented' } },
      },
    },
  ];
}

/** One DDG-endpoint pass. The html endpoint intermittently returns a shell
 * page with zero results — the lite endpoint has different markup and often
 * succeeds when html fails (W1: measured 7/10 on html alone). */
async function ddgPass(query: string, endpoint: 'html' | 'lite'): Promise<SearchHit[]> {
  const url =
    endpoint === 'html'
      ? `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      : `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const html = await res.text();
  const results: SearchHit[] = [];
  if (endpoint === 'html') {
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const snippets = [...html.matchAll(snippetRe)].map((m) => decodeEntities(m[1]!.replace(/<[^>]+>/g, '')).trim());
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = linkRe.exec(html)) !== null && results.length < 5) {
      let u = m[1]!;
      const uddg = /uddg=([^&]+)/.exec(u);
      if (uddg) u = decodeURIComponent(uddg[1]!);
      results.push({
        title: decodeEntities(m[2]!.replace(/<[^>]+>/g, '')).trim(),
        url: u,
        snippet: snippets[i] ?? '',
      });
      i++;
    }
  } else {
    // lite: bare <a rel="nofollow" href="url">title</a> rows
    for (const m of html.matchAll(/<a[^>]*rel="nofollow"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      if (results.length >= 5) break;
      results.push({ title: decodeEntities(m[2]!.replace(/<[^>]+>/g, '')).trim(), url: m[1]!, snippet: '' });
    }
  }
  return results;
}

const SEARCH_FAILED = 'search failed: no results from any endpoint — tell the user search is currently unreliable';

/** W1 hardening: html endpoint → lite fallback → one retry of each. Empty only
 * after all passes come back empty. */
async function searchHits(query: string): Promise<SearchHit[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of ['html', 'lite'] as const) {
      try {
        const results = await ddgPass(query, endpoint);
        if (results.length) return results;
      } catch {
        // timeout/network — try the next pass
      }
    }
    // DDG's bot detection is bursty — backoff with jitter recovers it
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) + Math.random() * 1000));
  }
  return [];
}

export async function webSearch(query: string): Promise<string> {
  const hits = await searchHits(query);
  if (!hits.length) return SEARCH_FAILED;
  return hits.map((h) => [h.title, h.url, h.snippet].filter(Boolean).join('\n')).join('\n\n');
}

/**
 * D.1: search, then hand the model INDEXED documents rather than a text blob, so
 * every claim it draws can be cited to a real sentence and validated afterwards.
 * Each hit becomes one document; its sentences come from the title + snippet,
 * which is all a search result actually asserts.
 */
export async function webSearchIndexed(query: string, registry: SourceRegistry): Promise<string> {
  const hits = await searchHits(query);
  if (!hits.length) return SEARCH_FAILED;
  const from = registry.size;
  for (const h of hits) {
    registry.add({ title: h.title, url: h.url, text: [h.title, h.snippet].filter(Boolean).join('. ') });
  }
  return registry.renderFrom(from);
}

/** D.1: fetch, then present the page as one indexed document. */
export async function webFetchIndexed(url: string, registry: SourceRegistry): Promise<string> {
  const raw = await webFetch(url);
  // pass failures straight through — they are instructions to the model, not sources
  if (/^(only http|fetch failed|unsupported content-type|page contained no readable text)/.test(raw)) return raw;
  const from = registry.size;
  registry.add({ title: url, url, text: raw, maxSentences: 120 });
  return registry.renderFrom(from);
}

const FETCH_CAP = 24_000;

export async function webFetch(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return 'only http(s) URLs are supported';
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000), redirect: 'follow' });
  if (!res.ok) return `fetch failed: HTTP ${res.status}`;
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|text\/plain|application\/json|xml/.test(type)) return `unsupported content-type: ${type}`;
  const raw = await res.text();

  // API/JSON endpoints: return the data verbatim (SPAs often serve their numbers here)
  if (/application\/json/.test(type)) return raw.slice(0, FETCH_CAP);

  // Data-heavy SPAs (Next.js etc.) render their content client-side but embed the
  // source data in <script> JSON blobs — extract those so the model sees the real
  // numbers instead of just the shell/nav text.
  const embedded: string[] = [];
  const nextData = /<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(raw);
  if (nextData?.[1]) embedded.push(nextData[1].trim());
  for (const m of raw.matchAll(/<script[^>]*type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1] && m[1].trim().length > 40) embedded.push(m[1].trim());
  }

  const text = decodeEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();

  const dataBlob = embedded.join('\n').slice(0, FETCH_CAP - 4000);
  const combined = [dataBlob ? `EMBEDDED PAGE DATA (JSON):\n${dataBlob}` : '', text ? `PAGE TEXT:\n${text}` : '']
    .filter(Boolean)
    .join('\n\n');
  return combined.slice(0, FETCH_CAP) || 'page contained no readable text';
}
