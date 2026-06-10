---
name: Documents
ext: .docx
triggers: document · report · letter · redline
tier: office_json
helper: build_docx.py
---

# Document design guidance

You emit sections JSON only; the helper renders onto a styled .dotx base
(Heading 1–3 + body styles are inherited — never describe styling in text).

- `metadata.title` is the document's real title; it renders as the title heading.
- Sections follow a logical document arc: context → substance → implications → appendix.
- `level` builds the outline: level 1 for major parts, 2 for subsections, 3 sparingly.
- Paragraphs are complete prose, 2–5 sentences each. No bullet glyphs inside paragraphs —
  if the content is a list, make it a table or separate short paragraphs.
- Use a `table` when data has two or more aligned attributes (KPI/target, term/definition,
  risk/mitigation). Headers are short nouns. Every row must fill every column.
- `pageBreakBefore` only for genuinely new parts (appendices, signature pages).
- Letters: one level-1 section per logical block (salutation body, terms, closing).
- Reports: 4–8 sections typical. Never a section with an empty paragraphs array.

No placeholder text — {{tags}}, TODO_, lorem all fail validation.
