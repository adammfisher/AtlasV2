/**
 * Node-side validators for kinds whose product validators live in TS
 * (mermaid / react / site). Invoked by validate.py; prints one JSON verdict:
 *   {"ok": bool, "findings": [...]}
 *
 * react/site input file: JSON {"files": {"/App.jsx": "..."}, "entry": "/App.jsx"}
 * mermaid input file: raw mermaid source.
 */
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { validateMermaid, validateFileMap } from '../../server/src/pipeline/validate.js';

async function main(): Promise<number> {
  const [kind, file, specArg] = process.argv.slice(2);
  if (!kind || !file) {
    console.log(JSON.stringify({ ok: false, findings: ['usage: js-validate <kind> <file> [spec.json]'] }));
    return 2;
  }
  const spec = specArg ? (JSON.parse(readFileSync(specArg, 'utf8')) as { contains?: string[] }) : {};
  const findings: string[] = [];
  const raw = readFileSync(file, 'utf8');

  if (kind === 'mermaid') {
    const res = validateMermaid(raw);
    if (!res.ok) findings.push(`mermaid parse failed: ${res.error ?? 'unknown'}`);
    for (const want of spec.contains ?? []) {
      if (!raw.toLowerCase().includes(want.toLowerCase())) findings.push(`missing requested content: ${JSON.stringify(want)}`);
    }
  } else if (kind === 'react' || kind === 'site') {
    let payload: { files?: Record<string, string>; entry?: string };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch (e) {
      console.log(JSON.stringify({ ok: false, findings: [`input is not a files-map JSON: ${String(e)}`] }));
      return 1;
    }
    const files = payload.files ?? {};
    const mapRes = validateFileMap(files);
    if (!mapRes.ok) findings.push(`file map invalid: ${mapRes.error ?? 'unknown'}`);
    if (kind === 'site' && !files['/index.html']) findings.push('site missing /index.html');
    if (kind === 'react') {
      const entry = payload.entry ?? '/App.jsx';
      if (!files[entry]) findings.push(`entry ${entry} missing from files`);
      for (const [name, src] of Object.entries(files)) {
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        try {
          await transform(src, { loader: 'jsx', jsx: 'automatic' });
        } catch (e) {
          findings.push(`${name}: transpile failed: ${(e as Error).message.split('\n')[0]}`);
        }
      }
      if (!/export\s+default/.test(files[entry] ?? '')) findings.push(`entry ${entry} has no default export`);
    }
    const joined = Object.values(files).join('\n').toLowerCase();
    for (const want of spec.contains ?? []) {
      if (!joined.includes(want.toLowerCase())) findings.push(`missing requested content: ${JSON.stringify(want)}`);
    }
  } else {
    findings.push(`unknown kind ${kind}`);
  }

  console.log(JSON.stringify({ ok: findings.length === 0, findings }));
  return findings.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.log(JSON.stringify({ ok: false, findings: [`harness error: ${String(err)}`] }));
    process.exit(2);
  },
);
