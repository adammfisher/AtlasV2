---
name: Documents
ext: .docx
triggers: document · report · letter · redline
tier: office_json
helper: build_docx.py
---

# Document design doctrine

You emit block JSON only; the helper renders onto a styled .dotx base. All
formatting comes from NAMED STYLES — never describe styling in text and never
request inline font or size overrides (the schema forbids them).

## Structure rules
- `metadata.title` is the document's real title; it renders as the title
  heading. Sections follow a logical arc: context → substance → implications →
  appendix.
- Heading hierarchy is validated: level 1 for major parts, 2 for subsections,
  3 sparingly — and NO level skips (a 3 under a 1 without a 2 fails the gate).
  Headings carry outline levels, so the document navigates and TOCs correctly.
- Blocks are typed: heading (level 1–3), paragraph, bulleted_list,
  numbered_list, table, image, quote, page_break. Pick the type that matches
  the content — numbered lists ONLY for true sequences.

## Writing rules
- Paragraphs are complete prose, 2–5 sentences. No bullet glyphs inside
  paragraphs — a list is a bulleted_list block.
- Body renders at 11–12pt from the Normal style; ≤ 2 font families total
  (inherited from the template — you never pick fonts).
- Quantify claims; keep every number one the user gave or clearly implied.

## Tables
- Use a table when data has 2+ aligned attributes (KPI/target, term/definition,
  risk/mitigation). Headers are short nouns; every row fills every column.
- Tables use the template's named table style — banded, header row styled by
  the style, not by per-cell formatting.

## Layout
- `page_break` only before genuinely new parts (appendices, signature pages).
- Letters: one level-1 section per logical block. Reports: 4–8 sections
  typical. Never a heading with no content under it.

No placeholder text — {{tags}}, TODO, lorem, xxxx all fail validation.
