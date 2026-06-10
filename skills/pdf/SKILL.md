---
name: PDF
ext: .pdf
triggers: pdf · form · fill · extract
tier: office_json
helper: build_pdf.py · weasyprint
---

# PDF design guidance

You emit pages/blocks JSON only; weasyprint renders it (pure Python, no browser).
The text layer is validated by extraction — write real, searchable content.

- The first block of page 1 must be a `heading` — it becomes the document title.
- `heading` blocks need `text`. Page-level headings open each page when the pages
  represent real divisions (chapters, statements); otherwise let content flow and
  use fewer pages with more blocks.
- `para` blocks are complete prose paragraphs (2–6 sentences).
- `table` blocks need `headers` + `rows`, every row filling every column.
- 1–6 pages typical. A page holds roughly 5–10 blocks; don't overstuff one page.
- For "fill this form"-type requests, render label/value pairs as a two-column table.

No placeholder text — extraction-based validation greps headings verbatim.
