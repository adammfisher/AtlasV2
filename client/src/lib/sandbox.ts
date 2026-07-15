/**
 * Offline preview plumbing: esbuild-wasm bundling (its wasm runs in a worker)
 * plus srcdoc builders for CSP-locked sandboxed iframes. No CDN, ever — vendor
 * scripts are fetched from /vendor/* (same origin) and inlined into srcdocs.
 */
import * as esbuild from 'esbuild-wasm';

let initPromise: Promise<void> | null = null;

/** Warm at app load — first wasm compile is the slow part (PRD §11). */
export function warmEsbuild(): Promise<void> {
  initPromise ??= esbuild.initialize({ wasmURL: '/vendor/esbuild.wasm', worker: true });
  return initPromise;
}

const vendorCache = new Map<string, string>();

async function vendorText(file: string): Promise<string> {
  const hit = vendorCache.get(file);
  if (hit) return hit;
  const res = await fetch(`/vendor/${file}`);
  if (!res.ok) throw new Error(`vendor asset missing: ${file}`);
  const text = await res.text();
  vendorCache.set(file, text);
  return text;
}

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:;";

/**
 * Claude-artifact-style base stylesheet for generated pages/components: clean
 * system typography, sensible spacing, readable measure. Injected BEFORE any
 * generated CSS so the model's own styles always win.
 */
const BASE_STYLE = `<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  background:#fafaf8;color:#1a1a18;line-height:1.6;font-size:16px;
  -webkit-font-smoothing:antialiased}
main,article,.container,body>div:only-child{max-width:760px;margin:0 auto;padding:40px 28px}
h1,h2,h3,h4{line-height:1.25;font-weight:650;letter-spacing:-0.01em;margin:1.4em 0 .5em}
h1{font-size:2rem;margin-top:.4em}h2{font-size:1.4rem}h3{font-size:1.15rem}
p{margin:.65em 0}ul,ol{padding-left:1.4em}li{margin:.3em 0}
a{color:#c2562f;text-decoration:none}a:hover{text-decoration:underline}
button{font:inherit;background:#1a1a18;color:#fff;border:none;border-radius:8px;
  padding:9px 18px;cursor:pointer}button:hover{opacity:.85}
input,select,textarea{font:inherit;border:1px solid #d5d2ca;border-radius:8px;padding:8px 12px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #e4e1d9}
th{font-weight:650}
code,pre{font-family:ui-monospace,Menlo,monospace;background:#f0eee8;border-radius:6px;padding:2px 6px;font-size:.9em}
hr{border:none;border-top:1px solid #e4e1d9;margin:2em 0}
img,svg{max-width:100%}
section{margin:2.5em 0}
</style>`;

/** Records fetch/XHR attempts and reports them to the parent (CSP blocks them anyway). */
const NET_SHIM = `<script>
(function(){
  let attempts = 0;
  const report = () => parent.postMessage({ type: 'atlas-net-attempt', attempts }, '*');
  window.fetch = function(){ attempts++; report(); return Promise.reject(new Error('network disabled in sandbox')); };
  window.XMLHttpRequest = function(){ attempts++; report(); throw new Error('network disabled in sandbox'); };
  window.WebSocket = function(){ attempts++; report(); throw new Error('network disabled in sandbox'); };
})();
</script>`;

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

export interface BundleResult {
  srcdoc: string | null;
  ok: boolean;
  error: string | null;
  ms: number;
}

/** Bundle a react-skill files map and compose the sandboxed document. */
export async function buildReactSrcdoc(
  files: Record<string, string>,
  entry: string,
): Promise<BundleResult> {
  const started = performance.now();
  try {
    await warmEsbuild();
    const vfs: esbuild.Plugin = {
      name: 'atlas-vfs',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === 'react' || args.path === 'react-dom' || args.path === 'react-dom/client') {
            return { path: args.path, namespace: 'host-react' };
          }
          const key = args.path.startsWith('/')
            ? args.path
            : '/' + args.path.replace(/^\.\//, '').replace(/^\.\.\//, '');
          if (files[key] !== undefined) return { path: key, namespace: 'vfs' };
          const withExt = ['.jsx', '.js', '.css']
            .map((e) => key + e)
            .find((k) => files[k] !== undefined);
          if (withExt) return { path: withExt, namespace: 'vfs' };
          return { errors: [{ text: `unresolved import ${args.path}` }] };
        });
        build.onLoad({ filter: /.*/, namespace: 'host-react' }, (args) => ({
          contents:
            args.path === 'react'
              ? 'module.exports = window.React'
              : args.path === 'react-dom/client'
                ? 'module.exports = { createRoot: window.ReactDOM.createRoot, hydrateRoot: window.ReactDOM.hydrateRoot }'
                : 'module.exports = window.ReactDOM',
          loader: 'js',
        }));
        build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => ({
          contents: files[args.path] ?? '',
          loader: args.path.endsWith('.css') ? 'css' : 'jsx',
        }));
      },
    };
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      // outdir names the outputs (/out/*.js, /out/*.css) — without it,
      // write:false + a css import dies with 'Cannot import ... without an
      // output path', and single outputs get the unfindable '<stdout>' name
      outdir: '/out',
      format: 'iife',
      // hand the entry's exports to the mount script — without globalName the
      // IIFE returns nothing and AtlasEntry was always {} (blank frames since)
      globalName: 'AtlasEntry',
      jsx: 'transform',
      plugins: [vfs],
      logLevel: 'silent',
    });
    // write:false output paths vary: '<stdout>' for a single output, entry-
    // derived names when css splits out. Filtering on endsWith('.js') silently
    // dropped the whole bundle in the single-output case (blank frames).
    const outs = result.outputFiles ?? [];
    const css = outs.find((f) => f.path.endsWith('.css'))?.text ?? '';
    const code = (outs.find((f) => f.path.endsWith('.js')) ?? outs.find((f) => !f.path.endsWith('.css')))?.text ?? '';
    const [react, reactDom] = await Promise.all([
      vendorText('react.production.min.js'),
      vendorText('react-dom.production.min.js'),
    ]);
    const mount = `const __root=document.getElementById('root');
const __mod = typeof AtlasEntry !== 'undefined' ? AtlasEntry : null;
const __C = __mod && (__mod.default || __mod);
if (typeof __C === 'function') { window.ReactDOM.createRoot(__root).render(window.React.createElement(__C)); }
else if (!__root.hasChildNodes()) {
  // a silent blank frame hides the failure — surface it honestly instead
  __root.innerHTML = '<div style="font-family:monospace;padding:1rem;color:#b45309">' +
    'Render failed: the entry file has no default-exported component.</div>';
}`;
    const srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}">
${BASE_STYLE}
<style>${css}</style></head>
<body>${NET_SHIM}<div id="root"></div>
<script>${escapeScript(react)}</script>
<script>${escapeScript(reactDom)}</script>
<script>${escapeScript(code)}</script>
<script>${mount}</script>
</body></html>`;
    return { srcdoc, ok: true, error: null, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return {
      srcdoc: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Math.round(performance.now() - started),
    };
  }
}

/** Compose a site files map into one offline document (inlines local css/js refs). */
export function buildSiteSrcdoc(files: Record<string, string>): BundleResult {
  const started = performance.now();
  const html = files['/index.html'];
  if (!html) return { srcdoc: null, ok: false, error: '/index.html missing', ms: 0 };
  let doc = html;
  doc = doc.replace(
    /<link[^>]+href=["']\.?\/?([^"']+\.css)["'][^>]*>/gi,
    (_m, href: string) => `<style>${files['/' + href] ?? ''}</style>`,
  );
  doc = doc.replace(
    /<script[^>]+src=["']\.?\/?([^"']+\.js)["'][^>]*><\/script>/gi,
    (_m, src: string) => `<script>${escapeScript(files['/' + src] ?? '')}</script>`,
  );
  const cspTag = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  doc = doc.includes('<head>')
    ? doc.replace('<head>', `<head>${cspTag}${BASE_STYLE}${NET_SHIM}`)
    : `${cspTag}${BASE_STYLE}${NET_SHIM}${doc}`;
  return { srcdoc: doc, ok: true, error: null, ms: Math.round(performance.now() - started) };
}

export async function buildMermaidSrcdoc(source: string): Promise<string> {
  const mermaid = await vendorText('mermaid.min.js');
  // mermaid.parse is the authoritative check — its verdict is reported to the
  // parent as a chip; render only proceeds when the parse passes.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>body{margin:12px;background:#262624;color:#f0eee6;font-family:-apple-system,sans-serif}
.err{color:#d4ad6a;font-size:12px;white-space:pre-wrap}</style></head><body>${NET_SHIM}
<div id="out"></div>
<script>${escapeScript(mermaid)}</script>
<script>
const SRC = ${JSON.stringify(source)};
mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
mermaid.parse(SRC).then(async () => {
  parent.postMessage({ type: 'atlas-mermaid-parse', ok: true }, '*');
  const { svg } = await mermaid.render('atlas-diagram', SRC);
  document.getElementById('out').innerHTML = svg;
}).catch((err) => {
  parent.postMessage({ type: 'atlas-mermaid-parse', ok: false, error: String(err && err.message || err) }, '*');
  document.getElementById('out').innerHTML = '<div class="err">Diagram failed to parse — ask Atlas to fix it (e.g. "fix the diagram — quote labels with parentheses").\\n\\n' + String(err && err.message || err).replace(/</g,'&lt;') + '</div>';
});
</script>
</body></html>`;
}

export async function buildMarkdownSrcdoc(source: string): Promise<string> {
  const marked = await vendorText('marked.min.js');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>body{margin:16px;background:#262624;color:#f0eee6;font-family:Georgia,serif;line-height:1.55}
h1,h2,h3{font-family:Georgia,serif;color:#f0eee6}a{color:#d97757}code,pre{font-family:Menlo,monospace;background:#1f1e1c;border-radius:4px;padding:1px 4px}
table{border-collapse:collapse}td,th{border:1px solid #3c3a36;padding:4px 8px}</style></head><body>${NET_SHIM}
<div id="out"></div>
<script>${escapeScript(marked)}</script>
<script>const SRC=${JSON.stringify(source)};document.getElementById('out').innerHTML=marked.parse(SRC);</script>
</body></html>`;
}

export function buildSvgSrcdoc(source: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>body{margin:0;display:flex;align-items:center;justify-content:center;background:#1f1e1c;min-height:100vh}svg{max-width:90%;max-height:90vh}</style>
</head><body>${NET_SHIM}${source}</body></html>`;
}
