---
name: Presentations
ext: .pptx
triggers: presentation · slides · deck · QBR · read · extract
tier: office_json
helper: build_pptx.py
reads: extract_office.py → numbered slides with bullets, tables, chart series and speaker notes; exposed to chat as the read_document tool. The body below is WRITE guidance only — it is injected into every generation prompt, so read behaviour is documented here rather than costing tokens on each build.
references: references/palette.md · references/archetypes.md · references/validator.md
---

# Presentation design doctrine

You emit slide JSON only; a deterministic designer renders it on the corporate
template (theme colors, named placeholders, measured type). Your job is CONTENT
and STRUCTURE: pick the right archetype for each idea and write tight copy. A
hard validator rejects decks that break the numeric rules below — treat every
number as a gate, not a suggestion.

## Content shaping — the numbers
- `title` is an assertive full sentence stating the slide's MESSAGE, not its
  topic. ≤ 90 characters, renders ≤ 2 lines, left-aligned.
  - Good: "Q3 revenue grew 34% on enterprise expansion"
  - Bad: "Q3 Revenue" (a label, not a message)
- Bullets: ≤ 5 per slide, ≤ 12 words each, parallel grammar (start each with
  the same part of speech), no terminal periods. One idea per slide.
- Total words on a content slide ≤ 40. If you have more to say, split slides.
- Quantify: numbers and percentages beat adjectives ("cut latency 43%", never
  "dramatically faster"). Only use numbers the user gave or clearly implied.
- `speaker_notes` are REQUIRED on every slide: 1–3 spoken-narrative sentences
  carrying the detail the slide itself omits.

## Choosing the archetype — match content shape to layout
- List of parallel points → `content_bullets`
- One key metric or headline number → `big_stat`
- Two or three option sets (before/after, pros/cons, us/them) → `comparison`
- A data series (trend, comparison, composition) → `content_chart`
- Ordered steps that are a TRUE sequence → `timeline_process` (3–6 steps)
- A single strong statement → `quote` (with attribution) or `section_divider`
- Exact values that matter, ≤ 7 columns → `table`
- Narrative beside a visual → `two_column`
- Deck bookends: `title` opens; `agenda` (≤ 6 items) after it in decks of 5+
  slides; `section_divider` before each major part; `closing_cta` ends.
Vary archetypes deliberately — a deck that is all bullets reads as machine
output. A good 8-slide deck: title, agenda, content_chart, big_stat,
comparison, quote, content_bullets, closing_cta.

## Visual rules
- Every content slide carries a visual element (chart, image, icon, shape) OR
  is an intentional statement slide (quote, big_stat, section_divider). Plain
  title+bullets-only slides are a validator warning — prefer an icon column or
  supporting visual on `content_bullets`.
- Chart vs table: chart for trend, comparison, or composition; table only when
  exact values matter, and never more than 7 columns. Sort chart categories
  meaningfully (by value or time) and declare the sort in the spec.
- Whitespace is part of the design: ≥ 15–20% of the slide stays empty. The
  renderer enforces 0.5" margins and grid alignment — don't fight it by
  overstuffing text.

## Palette rules
- One dominant color carries 60–70% of the visual weight, 1–2 supporting
  colors assist, one accent highlights. Never equal-weight palettes.
- All color comes from the corporate theme (the renderer maps semantic roles to
  theme slots) — you never specify hex values.
- Contrast is validated: ≥ 4.5:1 for normal text, ≥ 3:1 for large text (≥ 18pt,
  or ≥ 14pt bold) and meaningful graphics. 4.49:1 fails; nothing is rounded up.

## Typography rules
- Scale (enforced by the renderer): title 28–40pt bold · section header
  20–24pt bold · body 18–24pt (never below 18pt for projected body; absolute
  floor 14pt for dense tables and captions) · captions/references 12–14pt.
- ≤ 2 font families per deck: one display, one body; sans-serif for projection.
- Body text is left-aligned. Centering is reserved for titles on title/divider
  slides and single big-stat callouts.

## NEVER
- Accent lines or underlines beneath titles — the hallmark of AI-generated
  slides.
- Centered body text.
- More than 2 font families.
- Text-only content slides (unless an intentional statement archetype).
- Equal-weight palettes or hardcoded colors.
- Placeholder text of any kind — {{tags}}, TODO, lorem, xxxx, "click to edit"
  all hard-fail validation.
- Decoration that explains nothing (random shapes, gradients for their own
  sake).
- Numbered lists for unordered points — numbers assert sequence; use
  `timeline_process` only for true sequences.

## Tier phrasing
- Small models (Haiku, Nova): follow the injected exemplars exactly — copy
  their structure, swap in the user's content, keep every rule above as a hard
  constraint. Do not improvise geometry, color, or new fields.
- Frontier models (Sonnet+): the same numbers are hard gates, but you may vary
  archetype mix, narrative arc, and emphasis freely within them.

Deep reference (load on demand): `references/palette.md` (theme slots, roles,
contrast table) · `references/archetypes.md` (all 12 archetypes with slot
geometry) · `references/validator.md` (the full rubric the gate enforces).
