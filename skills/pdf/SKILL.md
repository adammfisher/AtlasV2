---
name: PDF
ext: .pdf
triggers: pdf · form · fill · extract
tier: office_json
helper: build_pdf.py · weasyprint
---

# PDF design doctrine

You emit section JSON only; WeasyPrint renders it through a paged-media
stylesheet (`skills/pdf/templates/paged.css`). The stylesheet owns ALL layout —
you never position anything absolutely.

## Page architecture (owned by the stylesheet)
- Running header (document title) and footer with a "page N of M" counter on
  every page.
- Page margins ≥ 0.75in; body 10–11pt; ≤ 2 font families.
- Single-column layouts only — the engine's multi-column support is weak, and
  a clean single column reads better in a report anyway.

## Section rules
- Sections are typed: heading (level 1–3), paragraph, bulleted_list,
  numbered_list, table, figure, quote, page_break. The first block of the
  document is a level-1 heading — it becomes the title in the running header.
- Heading hierarchy: no level skips. Page-level headings only when pages are
  real divisions (chapters, statements); otherwise let content flow.
- Paragraphs are complete prose, 2–6 sentences. Orphan/widow control (≥ 3
  lines) is enforced by the stylesheet — don't fight it with manual breaks.

## Tables and figures
- Tables need headers + rows, every row filling every column, ≤ 8 columns.
- Tables and figures never break across pages (page-break-inside: avoid) —
  a table too tall for one page should be split into logical tables instead.
- `page_break` only before genuinely new parts.

## Content rules
- Quantify claims; real, searchable text (validation extracts and greps it).
- 1–6 pages typical; a page holds roughly 5–10 blocks.
- Form-fill requests: render label/value pairs as a two-column table.

No placeholder text — extraction-based validation greps headings verbatim.
