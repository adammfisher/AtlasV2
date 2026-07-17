import { Ajv, type ValidateFunction } from 'ajv';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const ajv = new Ajv({ allErrors: false, strict: false });
const compiled = new Map<string, ValidateFunction>();

// A second validator that reports EVERY error at once — drives deterministic
// constraint healing (below), which needs the full violation set per pass.
const ajvAll = new Ajv({ allErrors: true, strict: false });
const compiledAll = new Map<string, ValidateFunction>();

/** Resolve a JSON Pointer (RFC 6901) to its parent container + final key. */
function resolvePointer(root: unknown, pointer: string): { parent: unknown; key: string | number } | null {
  if (pointer === '') return null;
  const parts = pointer.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (Array.isArray(node)) node = node[Number(part)];
    else if (node && typeof node === 'object') node = (node as Record<string, unknown>)[part];
    else return null;
  }
  const last = parts[parts.length - 1]!;
  return { parent: node, key: Array.isArray(node) ? Number(last) : last };
}

/**
 * Deterministically heal the "over-generation" violations a model repeats and
 * that the cloud path can no longer escalate past: arrays past maxItems (trim),
 * strings past maxLength (truncate), and extra keys under additionalProperties:
 * false (drop). Error-driven (not schema-walking) so it works through oneOf/
 * anyOf branches and arbitrary nesting. Leaves un-healable violations (minItems,
 * required, type, numeric bounds) for the caller to fail on honestly. Returns a
 * healed clone and how many fixes were applied.
 */
export function healConstraints(
  skillId: string,
  schema: Record<string, unknown>,
  value: unknown,
): { value: unknown; fixes: number } {
  let fn = compiledAll.get(skillId);
  if (!fn) {
    fn = ajvAll.compile(schema);
    compiledAll.set(skillId, fn);
  }
  const clone = structuredClone(value);
  let fixes = 0;
  for (let pass = 0; pass < 6; pass++) {
    if (fn(clone)) break;
    let healedThisPass = 0;
    for (const err of fn.errors ?? []) {
      if (err.keyword === 'maxItems') {
        const arr = resolveSelf(clone, err.instancePath);
        if (Array.isArray(arr)) {
          arr.length = (err.params as { limit: number }).limit;
          healedThisPass++;
        }
      } else if (err.keyword === 'maxLength') {
        const loc = resolvePointer(clone, err.instancePath);
        if (loc && loc.parent && typeof loc.parent === 'object') {
          const p = loc.parent as Record<string | number, unknown>;
          if (typeof p[loc.key] === 'string') {
            p[loc.key] = (p[loc.key] as string).slice(0, (err.params as { limit: number }).limit).trimEnd();
            healedThisPass++;
          }
        }
      } else if (err.keyword === 'additionalProperties') {
        const obj = resolveSelf(clone, err.instancePath);
        if (obj && typeof obj === 'object') {
          delete (obj as Record<string, unknown>)[(err.params as { additionalProperty: string }).additionalProperty];
          healedThisPass++;
        }
      }
    }
    fixes += healedThisPass;
    if (healedThisPass === 0) break; // only un-healable violations remain
  }
  return { value: clone, fixes };
}

/** Remove the element at the FIRST array index in a JSON Pointer (e.g.
 * "/slides/7/columns/0/head" → drop slides[7]). Returns true if it removed one. */
function dropOutermostArrayElement(root: unknown, pointer: string): boolean {
  const parts = pointer.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node: unknown = root;
  for (const part of parts) {
    if (Array.isArray(node)) {
      const idx = Number(part);
      if (Number.isInteger(idx) && idx >= 0 && idx < node.length) {
        node.splice(idx, 1);
        return true;
      }
      return false;
    }
    if (node && typeof node === 'object') node = (node as Record<string, unknown>)[part];
    else return false;
  }
  return false;
}

/**
 * Last-resort salvage for a large document: heal the count/length violations,
 * then DROP the array elements (individual slides/sections) that remain
 * structurally invalid — one malformed slide in a 30-slide deck yields a
 * 29-slide deck instead of a total failure. Stops when the payload validates or
 * when the remaining error isn't tied to a droppable element (e.g. a top-level
 * minItems that dropping can't fix), so it degrades honestly.
 */
export function salvageConstraints(
  skillId: string,
  schema: Record<string, unknown>,
  value: unknown,
): { value: unknown; ok: boolean; dropped: number } {
  let fn = compiledAll.get(skillId);
  if (!fn) {
    fn = ajvAll.compile(schema);
    compiledAll.set(skillId, fn);
  }
  let healed = healConstraints(skillId, schema, value).value;
  let dropped = 0;
  for (let pass = 0; pass < 12; pass++) {
    if (fn(healed)) break;
    // prefer an error inside an array element; splicing the outermost index
    // removes the whole bad slide, then re-heal since indices/limits shifted.
    const err = (fn.errors ?? []).find((e) => /\/\d+(\/|$)/.test(e.instancePath)) ?? fn.errors?.[0];
    if (!err || !dropOutermostArrayElement(healed, err.instancePath)) break;
    dropped++;
    healed = healConstraints(skillId, schema, healed).value;
  }
  return { value: healed, ok: fn(healed), dropped };
}

/** Resolve a JSON Pointer to the node it points AT (not its parent). */
function resolveSelf(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  const parts = pointer.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node: unknown = root;
  for (const part of parts) {
    if (Array.isArray(node)) node = node[Number(part)];
    else if (node && typeof node === 'object') node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

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

/**
 * Deterministically trim office copy to the design-doctrine word budgets, the
 * heal that pairs with officeDoctrineCheck: an over-written slide is tightened
 * in place rather than dropped or fatal. Mirrors the pptx word rules exactly
 * (bullet ≤ 12 words, content slide ≤ 40 words) and only trims those — trailing
 * copy is cut first (least-important), then the longest remaining text is
 * shortened to shed the excess, so a content slide always lands within budget.
 * Structural doctrine issues (position_overrides, heading skips) are left for
 * the caller's element-drop salvage. Returns the healed clone and a trim count.
 */
export function healDoctrine(skillId: string, payload: unknown): { value: unknown; fixes: number } {
  const clone = structuredClone(payload);
  let fixes = 0;
  const words = (s: unknown): string[] => String(s ?? '').split(/\s+/).filter(Boolean);
  const nwords = (s: unknown): number => words(s).length;
  const cut = (s: unknown, max: number): string => words(s).slice(0, Math.max(1, max)).join(' ');

  if (skillId === 'pptx') {
    const slides = (clone as { slides?: Array<Record<string, unknown>> }).slides ?? [];
    const CONTENT = new Set(['content_bullets', 'content_chart', 'comparison', 'two_column', 'table', 'timeline_process']);
    const BULLET_MAX = 12;
    const SLIDE_MAX = 40;
    for (const slide of slides) {
      // 1. per-bullet cap: truncate any bullet over the word ceiling
      const bullets = slide.bullets as string[] | undefined;
      if (Array.isArray(bullets)) {
        for (let i = 0; i < bullets.length; i++) {
          if (nwords(bullets[i]) > BULLET_MAX) {
            bullets[i] = cut(bullets[i], BULLET_MAX);
            fixes++;
          }
        }
      }
      if (!CONTENT.has(String(slide.archetype))) continue;

      // 2. total-words cap: shed the excess. Counts the exact same fields as
      // officeDoctrineCheck so a heal here guarantees that gate passes.
      const columns = (slide.columns as Array<{ head?: string; items?: string[] }> | undefined) ?? [];
      const steps = (slide.steps as Array<{ label?: string; detail?: string }> | undefined) ?? [];
      const total = (): number => {
        let t = nwords(slide.title) + nwords(slide.subtitle);
        for (const b of (slide.bullets as string[] | undefined) ?? []) t += nwords(b);
        for (const c of columns) { t += nwords(c.head); for (const it of c.items ?? []) t += nwords(it); }
        for (const s of steps) t += nwords(s.label) + nwords(s.detail);
        return t;
      };

      let guard = 0;
      while (total() > SLIDE_MAX && guard++ < 500) {
        // drop trailing body units first, keeping at least one of each kind
        const b = slide.bullets as string[] | undefined;
        if (Array.isArray(b) && b.length > 1) { b.pop(); fixes++; continue; }
        const col = [...columns].reverse().find((c) => (c.items ?? []).length > 1);
        if (col?.items) { col.items.pop(); fixes++; continue; }
        if (steps.length > 1) { steps.pop(); fixes++; continue; }
        // only singletons remain — shorten the longest text field by the excess
        const excess = total() - SLIDE_MAX;
        const fields: Array<{ get: () => string; set: (v: string) => void }> = [];
        if (Array.isArray(b)) b.forEach((_, i) => fields.push({ get: () => String(b[i] ?? ''), set: (v) => (b[i] = v) }));
        for (const c of columns) (c.items ?? []).forEach((_, i) => fields.push({ get: () => String(c.items![i] ?? ''), set: (v) => (c.items![i] = v) }));
        for (const s of steps) {
          fields.push({ get: () => String(s.detail ?? ''), set: (v) => (s.detail = v) });
          fields.push({ get: () => String(s.label ?? ''), set: (v) => (s.label = v) });
        }
        fields.push({ get: () => String(slide.subtitle ?? ''), set: (v) => (slide.subtitle = v) });
        fields.push({ get: () => String(slide.title ?? ''), set: (v) => (slide.title = v) });
        const longest = fields.filter((f) => nwords(f.get()) > 1).sort((a, z) => nwords(z.get()) - nwords(a.get()))[0];
        if (!longest) break; // every field is down to one word; can't reduce further
        longest.set(cut(longest.get(), nwords(longest.get()) - Math.max(1, excess)));
        fixes++;
      }
    }
  }
  return { value: clone, fixes };
}

/**
 * Deterministic overflow repair for the fix-and-rebuild loop. Given the visual
 * gate's findings (e.g. "slide 5: text overflow — needs 0.82in in a 0.50in
 * frame"), trim the flagged slides' copy in place so the SAME deck is tightened
 * and rebuilt — no LLM regeneration, so successive passes can't drift into a
 * different deck. Each call removes ONE increment of content from each flagged
 * slide (drop the last bullet / column item / step, else shorten the longest
 * text field by a third); the caller rebuilds and re-measures, trimming again
 * only where a frame still overflows. Returns the trimmed clone and how many
 * slides it changed (0 ⇒ nothing left to trim, so the caller stops).
 */
export function repairOverflow(
  skillId: string,
  payload: unknown,
  findings: string[],
): { value: unknown; fixes: number } {
  if (skillId !== 'pptx') return { value: payload, fixes: 0 };
  const clone = structuredClone(payload);
  const slides = (clone as { slides?: Array<Record<string, unknown>> }).slides ?? [];
  // slides the gate flagged, 1-based in the finding text
  const flagged = new Set<number>();
  for (const f of findings) {
    const m = /\bslide\s+(\d+)\b/i.exec(f);
    if (m) flagged.add(Number(m[1]) - 1);
  }
  const words = (s: unknown): string[] => String(s ?? '').split(/\s+/).filter(Boolean);
  let fixes = 0;
  for (const idx of flagged) {
    const slide = slides[idx];
    if (!slide || typeof slide !== 'object') continue;
    const bullets = slide.bullets as string[] | undefined;
    const columns = (slide.columns as Array<{ head?: string; items?: string[] }> | undefined) ?? [];
    const steps = (slide.steps as Array<{ label?: string; detail?: string }> | undefined) ?? [];
    // 1. drop a trailing body unit, keeping at least one of each kind
    if (Array.isArray(bullets) && bullets.length > 1) { bullets.pop(); fixes++; continue; }
    const col = [...columns].reverse().find((c) => (c.items ?? []).length > 1);
    if (col?.items) { col.items.pop(); fixes++; continue; }
    if (steps.length > 1) { steps.pop(); fixes++; continue; }
    // 2. only singletons left — shorten the longest text field by ~a third
    const fields: Array<{ get: () => string; set: (v: string) => void }> = [];
    if (Array.isArray(bullets)) bullets.forEach((_, i) => fields.push({ get: () => String(bullets[i] ?? ''), set: (v) => (bullets[i] = v) }));
    for (const c of columns) (c.items ?? []).forEach((_, i) => fields.push({ get: () => String(c.items![i] ?? ''), set: (v) => (c.items![i] = v) }));
    for (const s of steps) fields.push({ get: () => String(s.detail ?? ''), set: (v) => (s.detail = v) });
    fields.push({ get: () => String(slide.subtitle ?? ''), set: (v) => (slide.subtitle = v) });
    const longest = fields.filter((f) => words(f.get()).length > 2).sort((a, z) => words(z.get()).length - words(a.get()).length)[0];
    if (longest) {
      const w = words(longest.get());
      longest.set(w.slice(0, Math.max(2, Math.ceil(w.length * 0.66))).join(' '));
      fixes++;
    }
  }
  return { value: clone, fixes };
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
 * Extract the first balanced top-level JSON value from text that may carry
 * leading/trailing non-JSON content — the unconstrained plain-text streaming
 * path (bedrock.ts viaPlain, used for all office-JSON generation) only
 * demands JSON via the system prompt, nothing structurally stops the model
 * from appending a trailing sentence of commentary, especially when the
 * user's own request explicitly invites it ("...and tell me what you
 * included"). `JSON.parse` treats one extra character after a complete,
 * valid object as a hard failure — this recovers the value that's actually
 * there instead of discarding a correct generation over trailing prose.
 * Returns the input trimmed, unchanged, if no balanced structure is found, so
 * a genuinely malformed response still fails validation with an honest error.
 */
export function extractJsonValue(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.search(/[{[]/);
  if (start === -1) return trimmed;
  const open = trimmed[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed; // never balanced — let JSON.parse report the real error
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
