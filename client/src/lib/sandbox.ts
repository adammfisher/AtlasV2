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
      format: 'iife',
      jsx: 'transform',
      plugins: [vfs],
      logLevel: 'silent',
    });
    const code = result.outputFiles?.find((f) => f.path.endsWith('.js'))?.text ?? '';
    const css = result.outputFiles?.find((f) => f.path.endsWith('.css'))?.text ?? '';
    const [react, reactDom] = await Promise.all([
      vendorText('react.production.min.js'),
      vendorText('react-dom.production.min.js'),
    ]);
    const mount = `const __root=document.getElementById('root');
const __mod = typeof AtlasEntry !== 'undefined' ? AtlasEntry : null;
const __C = __mod && (__mod.default || __mod);
if (__C) { window.ReactDOM.createRoot(__root).render(window.React.createElement(__C)); }`;
    const srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>body{margin:0;background:#fff;font-family:-apple-system,Helvetica,Arial,sans-serif}${css}</style></head>
<body>${NET_SHIM}<div id="root"></div>
<script>${escapeScript(react)}</script>
<script>${escapeScript(reactDom)}</script>
<script>var AtlasEntry=(function(){var module={exports:{}};var exports=module.exports;${escapeScript(
      code.replace(/^\(\(\)\s*=>\s*\{/, '(() => {'),
    )};return module.exports;})();</script>
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
    ? doc.replace('<head>', `<head>${cspTag}${NET_SHIM}`)
    : `${cspTag}${NET_SHIM}${doc}`;
  return { srcdoc: doc, ok: true, error: null, ms: Math.round(performance.now() - started) };
}

export async function buildMermaidSrcdoc(source: string): Promise<string> {
  const mermaid = await vendorText('mermaid.min.js');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>body{margin:12px;background:#262624;color:#f0eee6}</style></head><body>${NET_SHIM}
<pre class="mermaid">${source.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
<script>${escapeScript(mermaid)}</script>
<script>mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'strict' });</script>
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
