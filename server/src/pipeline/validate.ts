import { Ajv, type ValidateFunction } from 'ajv';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const ajv = new Ajv({ allErrors: false, strict: false });
const compiled = new Map<string, ValidateFunction>();

/** Parse + ajv-validate a constrained-JSON emission. Returns the parsed object or an error string. */
export function validateJson(
  skillId: string,
  schema: Record<string, unknown>,
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${err instanceof Error ? err.message : err}` };
  }
  let fn = compiled.get(skillId);
  if (!fn) {
    fn = ajv.compile(schema);
    compiled.set(skillId, fn);
  }
  if (!fn(value)) {
    const first = fn.errors?.[0];
    return { ok: false, error: `schema violation at ${first?.instancePath || '/'}: ${first?.message ?? 'invalid'}` };
  }
  return { ok: true, value };
}

/**
 * Office design-doctrine checks the JSON schema can't express, run inside the
 * generation repair loop so the model gets actionable feedback BEFORE the
 * build (the Python builder re-runs the full audit as the authoritative gate).
 * `frontier` gates position_overrides: small tiers never position anything.
 */
export function officeDoctrineCheck(
  skillId: string,
  payload: unknown,
  frontier: boolean,
): { ok: true } | { ok: false; error: string } {
  const words = (s: unknown): number => String(s ?? '').split(/\s+/).filter(Boolean).length;
  if (skillId === 'pptx') {
    const slides = (payload as { slides?: Array<Record<string, unknown>> }).slides ?? [];
    const CONTENT = new Set(['content_bullets', 'content_chart', 'comparison', 'two_column', 'table', 'timeline_process']);
    for (const [i, slide] of slides.entries()) {
      if (slide.position_overrides && !frontier) {
        return { ok: false, error: `slide ${i + 1}: position_overrides are not available — remove them; layout comes from the archetype` };
      }
      const bullets = (slide.bullets as string[] | undefined) ?? [];
      for (const b of bullets) {
        if (words(b) > 12) return { ok: false, error: `slide ${i + 1}: bullet over 12 words — tighten: "${String(b).slice(0, 50)}"` };
      }
      if (CONTENT.has(String(slide.archetype))) {
        let total = words(slide.title) + words(slide.subtitle) + bullets.reduce((n, b) => n + words(b), 0);
        for (const col of (slide.columns as Array<{ head?: string; items?: string[] }> | undefined) ?? []) {
          total += words(col.head) + (col.items ?? []).reduce((n, it) => n + words(it), 0);
        }
        for (const st of (slide.steps as Array<{ label?: string; detail?: string }> | undefined) ?? []) {
          total += words(st.label) + words(st.detail);
        }
        if (total > 40) return { ok: false, error: `slide ${i + 1}: ${total} words on a content slide (max 40) — split the slide or cut copy` };
      }
    }
  }
  if (skillId === 'docx' || skillId === 'pdf') {
    const blocks =
      ((payload as Record<string, unknown>).blocks as Array<Record<string, unknown>> | undefined) ??
      ((payload as Record<string, unknown>).sections as Array<Record<string, unknown>> | undefined) ??
      [];
    let level = 0;
    for (const [i, blk] of blocks.entries()) {
      if (blk.kind === 'heading') {
        const lv = Number(blk.level ?? 1);
        if (level === 0 && lv !== 1) return { ok: false, error: `block ${i + 1}: document must open at heading level 1` };
        if (level > 0 && lv > level + 1) return { ok: false, error: `block ${i + 1}: heading level skip ${level} → ${lv}` };
        level = lv;
      }
    }
  }
  return { ok: true };
}

const MERMAID_TYPES = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'erDiagram',
  'stateDiagram-v2',
  'stateDiagram',
  'classDiagram',
  'gantt',
  'pie',
];

/**
 * Lexical mermaid validation (full parse happens in the client's vendored
 * mermaid before render — that render is the authoritative check; this gate
 * catches the common failure shapes early for the repair loop).
 */
export function validateMermaid(source: string): { ok: true } | { ok: false; error: string } {
  const text = source.trim().replace(/^```(?:mermaid)?\n?|```$/g, '').trim();
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  if (!MERMAID_TYPES.some((t) => firstLine.startsWith(t))) {
    return { ok: false, error: `first line must declare a diagram type, got: "${firstLine.slice(0, 60)}"` };
  }
  const quotes = (text.match(/"/g) ?? []).length;
  if (quotes % 2 !== 0) return { ok: false, error: 'unbalanced quotes' };
  // the most common real-world parse failure in flowcharts: unquoted (), {} or |
  // inside [] node labels (other diagram types use different bracket syntax)
  if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph')) {
    for (const match of text.matchAll(/\[([^\]]*)\]/g)) {
      const label = match[1] ?? '';
      if (label.startsWith('"') && label.endsWith('"')) continue;
      if (/[(){}|]/.test(label)) {
        return {
          ok: false,
          error: `node label ${JSON.stringify(label.slice(0, 40))} contains (), {} or | — wrap the whole label in double quotes`,
        };
      }
    }
  }
  return { ok: true };
}

/** Cut the <svg>…</svg> span out of an emission. Models intermittently wrap
 * the element in prose ("Here's your icon: … Let me know!") — that text made
 * validation fail with "Extra text at the end" even though the SVG inside was
 * fine. Deterministic extraction, applied before validate AND persist. */
export function extractSvg(source: string): string {
  const text = stripFences(source);
  const start = text.indexOf('<svg');
  const end = text.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + '</svg>'.length);
}

export function validateSvg(source: string): { ok: true } | { ok: false; error: string } {
  const text = source.trim().replace(/^```(?:svg|xml)?\n?|```$/g, '').trim();
  if (!text.startsWith('<svg')) return { ok: false, error: 'output must be a single <svg> element' };
  const wellFormed = XMLValidator.validate(text);
  if (wellFormed !== true) {
    return { ok: false, error: `XML not well-formed: ${wellFormed.err.msg}` };
  }
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(text) as {
    svg?: Record<string, unknown>;
  };
  if (!parsed.svg?.['@_viewBox']) return { ok: false, error: 'missing viewBox attribute' };
  if (text.includes('<script')) return { ok: false, error: 'script elements are not allowed' };
  return { ok: true };
}

/** Strip accidental code fences from direct text emissions. */
export function stripFences(source: string): string {
  return source.trim().replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
}

/**
 * E4B sometimes writes literal backslash-n sequences (and stray JSON fragments)
 * inside react/site file strings instead of real newlines — the rendered page
 * then shows "\n" as text. Caught here so the repair loop fixes it honestly.
 */
/** Heal a file map whose entry file arrived under a near-miss name — models
 * (esp. non-Claude tiers) emit App.js, app.jsx, /src/App.jsx or index.jsx for
 * a demanded /App.jsx. Deterministic: prefer a case/extension/path variant,
 * else a SINGLE jsx/js file; never guess between multiple candidates. */
export function healEntryFile(files: Record<string, string>, entry: string): Record<string, string> {
  const base = entry.replace(/^\//, '').toLowerCase().replace(/\.(jsx|js|tsx|ts)$/, '');
  const names = Object.keys(files);
  // the sandbox renders the entry's DEFAULT EXPORT — prefer (1) a name variant
  // that actually exports one, (2) ANY script exporting one, (3) a name
  // variant, (4) a single script. index.* often holds the render call, not
  // the component — never prefer it over an export-default file.
  const hasDefault = (n: string): boolean => /export\s+default/.test(files[n] ?? '');
  const nameMatch = (n: string): boolean =>
    n.toLowerCase().replace(/^.*\//, '').replace(/\.(jsx|js|tsx|ts)$/, '') === base;
  const scripts = names.filter((n) => /\.(jsx|js|tsx)$/i.test(n));
  const source = files[entry]
    ? entry
    : (scripts.find((n) => nameMatch(n) && hasDefault(n)) ??
      scripts.find(hasDefault) ??
      scripts.find(nameMatch) ??
      (scripts.length === 1 ? scripts[0] : undefined));
  if (!source) return files;
  let content = files[source]!;
  // some models emit pre-ESM React (component + ReactDOM.render, no exports) —
  // EVEN under the demanded entry name. The sandbox mounts the entry's default
  // export, so append one for the detected component — deterministic: the LAST
  // capitalized function/const declaration wins; none found = leave untouched
  // (the sandbox then surfaces an honest render error).
  if (!/export\s+default/.test(content)) {
    const decls = [...content.matchAll(/(?:function|const)\s+([A-Z][A-Za-z0-9_]*)\s*[=(]/g)].map((m) => m[1]!);
    const name = decls[decls.length - 1];
    if (name) content += `\nexport default ${name};\n`;
  }
  if (source === entry && content === files[entry]) return files;
  return { ...files, [entry]: content };
}

export function validateFileMap(
  files: Record<string, string>,
): { ok: true } | { ok: false; error: string } {
  for (const [name, content] of Object.entries(files)) {
    const literalEscapes = (content.match(/\\n/g) ?? []).length;
    if (literalEscapes >= 3) {
      return {
        ok: false,
        error: `${name} contains ${literalEscapes} literal backslash-n sequences — emit real newlines inside file contents, never the two characters \\ and n`,
      };
    }
    if (/^\s*\{\s*"/.test(content)) {
      return { ok: false, error: `${name} starts with a JSON fragment — file contents must be the raw file source` };
    }
  }
  return { ok: true };
}
