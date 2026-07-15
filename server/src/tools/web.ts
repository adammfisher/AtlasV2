/**
 * Web tools for chat (claude.ai parity): web_search via DuckDuckGo's HTML
 * endpoint (no API key) and web_fetch for pulling a page's readable text.
 * Both are best-effort with short timeouts — failures return honest error
 * strings the model can relay.
 */
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

/** One DDG-endpoint pass. The html endpoint intermittently returns a shell
 * page with zero results — the lite endpoint has different markup and often
 * succeeds when html fails (W1: measured 7/10 on html alone). */
async function ddgPass(query: string, endpoint: 'html' | 'lite'): Promise<string[]> {
  const url =
    endpoint === 'html'
      ? `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      : `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const html = await res.text();
  const results: string[] = [];
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
      results.push(`${decodeEntities(m[2]!.replace(/<[^>]+>/g, '')).trim()}\n${u}\n${snippets[i] ?? ''}`);
      i++;
    }
  } else {
    // lite: bare <a rel="nofollow" href="url">title</a> rows
    for (const m of html.matchAll(/<a[^>]*rel="nofollow"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      if (results.length >= 5) break;
      results.push(`${decodeEntities(m[2]!.replace(/<[^>]+>/g, '')).trim()}\n${m[1]!}`);
    }
  }
  return results;
}

export async function webSearch(query: string): Promise<string> {
  // W1 hardening: html endpoint → lite fallback → one retry of each. Honest
  // failure text only after all four passes come back empty.
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of ['html', 'lite'] as const) {
      try {
        const results = await ddgPass(query, endpoint);
        if (results.length) return results.join('\n\n');
      } catch {
        // timeout/network — try the next pass
      }
    }
    // DDG's bot detection is bursty — backoff with jitter recovers it
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) + Math.random() * 1000));
  }
  return 'search failed: no results from any endpoint — tell the user search is currently unreliable';
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
