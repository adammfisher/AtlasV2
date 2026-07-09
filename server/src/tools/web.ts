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

export async function webSearch(query: string): Promise<string> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return `search failed: HTTP ${res.status}`;
  const html = await res.text();
  const results: string[] = [];
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets = [...html.matchAll(snippetRe)].map((m) => decodeEntities(m[1]!.replace(/<[^>]+>/g, '')).trim());
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(html)) !== null && results.length < 5) {
    let url = m[1]!;
    const uddg = /uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]!);
    const title = decodeEntities(m[2]!.replace(/<[^>]+>/g, '')).trim();
    results.push(`${title}\n${url}\n${snippets[i] ?? ''}`);
    i++;
  }
  return results.length ? results.join('\n\n') : 'no results found';
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
