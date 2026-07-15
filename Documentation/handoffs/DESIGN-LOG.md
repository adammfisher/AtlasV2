# DESIGN-LOG — Document Design Doctrine (office skills)

Running log for the design-doctrine workstream: SKILL.md doctrine, ugliness-resistant
schemas, deterministic builders, exemplar library, hard visual gate, design eval.
Routing (three-stage router, `<atlas_behavior>`) is owned by a parallel workstream and
is untouched here.

---

## 2026-07-15 — Current-state survey (pre-change baseline)

### PPTX
- `skills/pptx/SKILL.md` (~600 tokens): 9-layout vocabulary (`title, section, bullets,
  two_col, stat, quote, chart, summary, closing`), decent copy rules ("one idea per
  slide", assertion headings), but no numeric doctrine — no char/word caps, no type
  scale, no whitespace/contrast rules, no NEVER list, no per-tier phrasing.
- `skills/pptx/schema.json`: `layout`/`heading`/`notes` fields. Bullets maxItems 7 (too
  many), zero maxLength constraints, `notes` optional, chart series unbounded, no sort
  declaration. Nothing stops a 300-char heading or an 8-bullet wall.
- `scripts/office/build_pptx.py`: draws every slide from scratch. **Ignores the
  `--template` arg entirely** — `Presentation()` bare, so `dfs_default.potx` never
  loads. Hardcoded RGB palette (warm off-white/clay accent — an Anthropic-style theme,
  not the DFS brand). **Draws an accent underline beneath every content title**
  (`_title_block`) — the exact AI-slide tell the doctrine bans. No text measurement:
  headings/bullets can overflow their fixed boxes silently. Body bullets drop to 15pt
  when >5 items (below the 18pt projected-body floor); footers at 9.5pt.
- `scripts/office/exemplar_engine.py` + `dfs_exemplars.json` (16 exemplars, 5
  categories): a working shape-id-mapped copier from `dfs_library.pptx` (286 slides) —
  **but dead code**: `build_pptx.py` never imports it ("Self-contained — no template or
  exemplar library dependency").
- Templates: `dfs_default.potx` theme = dk1 #371447 (deep purple), dk2 #650360 (plum),
  accents #300942/#26A697/#8D4CAB/#BB72DD/#5DE2CC/#5F2779, Poppins major+minor; 21
  layouts incl. custom chart/2-col layouts. `dfs_library.pptx`: 286 curated slides.

### DOCX
- `build_docx.py`: renders onto `atlas_default.dotx` styles but hardcodes table header
  shading (#371447 + white bold) as direct formatting, not a named table style. No
  heading-hierarchy validation (level skips pass silently).
- Schema: heading/level/paragraphs/table; no block-type enum, no style-name discipline.

### XLSX
- `build_xlsx.py`: direct `Font`/`PatternFill` per cell — no `NamedStyle`s, no number
  formats, no freeze panes, no `Table`/`TableStyleInfo`, no print area, no column
  autosize (manual `widths` only). Validation: formula tokenizer + soffice recalc scan
  (good bones — recalc scan finds #REF!/#DIV/0!/#VALUE!/#NAME? but misses #N/A).
- Schema: per-cell ref/value/formula; can't express column number formats or table style.

### PDF
- `build_pdf.py`: h1 carries a `border-bottom` accent line; **no running header/footer,
  no page counter**, no `page-break-inside: avoid`, no orphans/widows. WeasyPrint with
  xhtml2pdf fallback (fallback can't do `counter(pages)` — flagged for Deliverable C).
- Schema: heading/para/table blocks only; no margins/page-size fields.

### Validation & pipeline
- `validate_common.py`: zip sanity, optional openxml-audit, placeholder grep
  ({{…}}/TODO_ only — no lorem/xxxx/"click to edit"), soffice convert as a
  **non-blocking amber skip**. No overflow, collision, margin, contrast, font-count,
  or content-audit checks. Nothing gates on visual quality.
- Server: `officePrompt()` (orchestrator.ts) injects full schema JSON + SKILL.md
  guidance; `validateJson` (ajv) + one repair retry + Bedrock escalation.
  `templatePath()` prefers dfs templates. This is where retrieved exemplars will be
  wired (Deliverable D) — routing files themselves stay untouched.
- Lambda (`lambda_handler.py`): imports `build_<skill>.main()` in-process; bundles
  `templates/` beside the handler; scale-to-zero preserved throughout.

### Baseline gaps vs doctrine (summary)
| Doctrine area | Current state |
|---|---|
| 12 archetypes | 9 layouts, no agenda/timeline/table/big-stat-single |
| Title ≤90 chars, ≤2 lines, assertive | No cap, no measurement |
| ≤5 bullets ×12 words, ≤40 words/slide | maxItems 7, no word caps |
| Theme-colors-only | Hardcoded RGB everywhere; template unused |
| No accent line under titles | Drawn on every content slide |
| Overflow/collision/margin/contrast gates | None |
| Speaker notes required | Optional |
| Exemplar retrieval into prompt | Engine exists, dead code |
| XLSX named styles/formats/freeze/tables | None |
| PDF running header/footer + counters | None |

---

## 2026-07-15 — Deliverable A: design doctrine in SKILLs

**What changed**
- `skills/pptx/SKILL.md` rewritten around the 12-archetype vocabulary with the full
  numeric doctrine as model-readable gates: title ≤ 90 chars/≤ 2 lines/assertive (good
  + bad example), ≤ 5 bullets × ≤ 12 words, ≤ 40 words/slide, quantify-over-adjectives,
  required speaker_notes, content-shape→archetype selection map, chart-vs-table rule,
  ≥ 15–20% whitespace, 60-30-10 palette weighting, theme-colors-only, unrounded WCAG
  thresholds, type scale (title 28–40 / section 20–24 / body 18–24 / floor 14 /
  captions 12–14), ≤ 2 families, NEVER list (accent-line-under-title first), and a
  per-tier phrasing block (small = follow exemplars exactly; frontier = latitude within
  the same numbers). Body ~1.4k tokens (cap 5k).
- Long reference material moved to `skills/pptx/references/`: `palette.md` (DFS theme
  slots→roles + **computed** contrast table — teal #26A697 on white is 3.01:1: large
  text/graphics only; #5DE2CC 1.59:1: decoration only), `archetypes.md` (all 12 with
  grid geometry intent + required/optional fields), `validator.md` (the full gate
  rubric + bounded 2-retry loop semantics).
- `skills/docx/SKILL.md`: typed blocks, named-styles-only (inline overrides forbidden),
  no-level-skip heading hierarchy, named table styles, 11–12pt body, ≤ 2 families.
- `skills/xlsx/SKILL.md`: zero-formula-error gate (all five markers), three-layer model
  shape, named table_style + frozen header + print area + content-sized widths,
  explicit number formats per numeric column, formulas-never-hardcoded, blue/black/
  green/red financial color code.
- `skills/pdf/SKILL.md`: paged-media architecture (running header/footer with
  page-N-of-M, ≥ 0.75in margins, 10–11pt body, single-column), typed sections,
  no-break tables/figures, orphans/widows ≥ 3.

**Why** — doctrine must live where every generation prompt reads it (SKILL.md bodies
are injected verbatim by `officePrompt()`); numbers phrased as hard gates because the
Deliverable E validator will enforce exactly these values.

**Tests** — all four files parse under the exact `loadSkill()` frontmatter regex
(name/helper extracted correctly, node repro run); token budgets measured: pptx 1,356 ·
docx 483 · xlsx 496 · pdf 457 (references 571–1,043 each, loaded on demand only).
Contrast table values computed with the WCAG relative-luminance formula, not guessed.

**Open** — SKILL.md now describes the `archetype`/`title`/`speaker_notes` vocabulary
that lands in the schema in Deliverable B and the builder in C; the trio is coupled and
the pipeline is fully consistent again at commit C. Registry metadata (frontmatter)
unchanged except a `references:` pointer line on pptx.

---

## 2026-07-15 — Deliverable B: ugliness-resistant schemas

**What changed**
- `skills/pptx/schema.json`: full rewrite to the 12-archetype vocabulary. Every slide
  requires `archetype` (enum of 12) + `title` (maxLength 90) + `speaker_notes`
  (minLength 1). `bullets` maxItems 5 × maxLength 90. Charts require `sort`
  declaration, ≤ 5 series, ≤ 12 categories. Per-archetype conditional requireds via
  allOf/if/then (content_chart→chart, comparison→columns 2–3, big_stat→stat,
  quote→quote+attribution, timeline_process→steps 3–6, table→table ≤ 7 cols).
  Raw x/y/w/h is unrepresentable (additionalProperties:false); the only positioning
  door is a typed `position_overrides` array (0.5"-margin-bounded), to be gated to the
  frontier tier in code (Deliverable C wiring).
- `skills/docx/schema.json`: typed block enum (heading{1–3}, paragraph, bulleted_list,
  numbered_list, table, figure, quote, page_break) with per-kind requireds; inline
  font/size overrides unrepresentable. `figure` = caption + chart data (rendered
  deterministically via Pillow in C — real content, not an image placeholder).
- `skills/xlsx/schema.json`: table model — every sheet requires `name`, `table_style`
  (enum of built-in Excel table styles), `columns` (each requiring `header` +
  `format` enum text/integer/decimal/currency/percent/date, optional financial-color
  `role`), and typed `rows` where every cell is exactly one of {t}/{n}/{f:"=…"}/null.
- `skills/pdf/schema.json`: `meta` requires title + page_size (A4/Letter) +
  margins_in ≥ 0.75; typed section enum mirroring docx; absolute positioning
  unrepresentable.
- `scripts/office/validate_common.py`: added a stdlib-only mini JSON-Schema validator
  (`_schema_errors` — exactly the subset our schemas use; the office Lambda deploy
  swaps *.py into a prebuilt zip, so no jsonschema pip dep is possible) +
  `_content_audit` for the rules schemas can't express: ≤ 12 words/bullet,
  ≤ 40 words/content-slide, chart series↔category length equality, ragged table rows,
  heading-hierarchy skips (docx/pdf), hardcoded-number-in-derived-row heuristic
  (xlsx: rows labeled Total/Sum/Variance/… must compute), and the doctrine
  placeholder scan (xxxx/lorem/ipsum/click-to-edit/TODO/{{}}). `validate_spec()`
  returns error lists; `spec_gate()` hard-fails a build.

**Proof (both validators, same 8 fixtures)**
- validate.ts (exact pipeline entry point, ajv): 4 valid accepted, 4 invalid rejected
  — first errors: pptx missing speaker_notes · docx "must NOT have additional
  properties" (inline font) · xlsx table_style enum · pdf page_size enum.
- validate_common.py: same verdicts, richer findings — pptx 8 errors (title 91+,
  6 bullets, missing chart, lorem/TODO, 13-word bullet, x/y rejected) · docx 5
  (font+size overrides, level skip 1→3, ragged row, placeholder) · xlsx 4 (style enum,
  format enum, formula missing "=", hardcoded Total) · pdf 5 (A5, 0.25" margin,
  absolute position, opens at level 2, xxxx placeholder).

**Why** — bad output becomes unrepresentable at the schema layer where possible;
everything countable-but-not-schema-expressible moves to code that runs on BOTH sides
(server repair loop gets ajv; Lambda gets the same schema through the mini-validator
plus the content audit as the belt to that brace).

**Open** — builders still consume the old field names until Deliverable C lands (the
known A/B/C coupling); `position_overrides` tier gating is wired in C.

### Open questions carried into A–G
- The 12-archetype schema renames fields (`layout`→`archetype`, `heading`→`title`,
  `notes`→`speaker_notes`): the office **edit** flows re-emit full JSON against the
  same schema, so renames must land in schema + builder + SKILL.md + exemplars in one
  commit series (B and C are coupled; A writes doctrine against the new vocabulary).
- xhtml2pdf fallback cannot render `counter(pages)`; the doctrine header/footer works
  under WeasyPrint (available in the office Lambda per spec). Fallback keeps a
  page-number-only footer.
