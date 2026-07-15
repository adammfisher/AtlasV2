# PPTX archetype gallery — the 12 layouts

Each archetype maps to a fixed layout in `dfs_default.potx`; content lands in
named placeholders. Positions come from archetype + template — specs never
carry x/y/w/h (frontier tier may override; small tiers cannot). Geometry below
is the design intent the renderer implements on the 12-column grid (0.5"
margins, 13.333"×7.5" slide, one consistent 0.3–0.5" block gap per deck).

| # | Archetype | Purpose | Required fields | Optional fields |
|---|---|---|---|---|
| 1 | `title` | Deck opener: claim + context | title, speaker_notes | subtitle (audience · date · presenter) |
| 2 | `agenda` | Ordered section list | title, bullets (≤ 6 section names), speaker_notes | — |
| 3 | `section_divider` | Big section title, dark field | title, speaker_notes | subtitle, section number (auto) |
| 4 | `content_bullets` | Sentence headline + parallel points | title, bullets (≤ 5), speaker_notes | icon column |
| 5 | `content_chart` | Headline + one native chart | title, chart, speaker_notes | bullets (≤ 3 annotations) |
| 6 | `comparison` | 2–3 parallel option columns | title, columns (2–3 × {head, items}), speaker_notes | — |
| 7 | `big_stat` | One number that matters | title, stat {value, label}, speaker_notes | support sentence |
| 8 | `quote` | Pull-quote + attribution | title(short intro or ""), quote, attribution, speaker_notes | — |
| 9 | `timeline_process` | True sequence, 3–6 steps | title, steps (3–6 × {label, detail?}), speaker_notes | — |
| 10 | `two_column` | Narrative + visual | title, body (text side), visual ref, speaker_notes | half-bleed image flag |
| 11 | `table` | Exact values, ≤ 7 columns | title, table {headers, rows}, speaker_notes | sort column note |
| 12 | `closing_cta` | Close + ask + contact | title, speaker_notes | cta line, contact |

## Geometry intent per archetype

- **title** — dark accent1 field. Title on the left two-thirds, baseline on the
  lower-third power line (rule of thirds); subtitle beneath with ≥ 0.5" gap.
- **agenda** — white field. Headline top; ≤ 6 numbered rows in a single left
  column occupying grid cols 1–7; cols 8–12 stay empty (whitespace budget).
- **section_divider** — accent1 field, auto section number (01, 02…) small at
  top-left, title 32–40pt white on the lower-third line. Minimal by design.
- **content_bullets** — headline across cols 1–12; bullets in cols 1–8 (with
  icon column at col 1 when icons requested → text cols 2–8); cols 9–12 open.
- **content_chart** — headline; chart fills cols 1–8 full height under the
  headline; ≤ 3 annotation bullets stack in cols 9–12.
- **comparison** — 2 cols → each 6 grid cols minus gap; 3 cols → 4 each.
  Column heads 20pt bold dk2; items parallel, ≤ 4 per column.
- **big_stat** — the numeral 60–72pt bold at the left-third/center power point,
  label 18–20pt beneath, one supporting sentence max. ≥ 40% empty area.
- **quote** — generous field: quote 28–32pt across cols 2–11 centered
  vertically, attribution 14pt right-aligned beneath. Dark or light field.
- **timeline_process** — steps flow left→right on a horizontal connector along
  the vertical center; step labels ≤ 4 words, detail ≤ 8 words beneath each
  node. Numbered because it IS a sequence.
- **two_column** — text in cols 1–6, visual in cols 7–12 (or half-bleed to the
  right edge when flagged). Text side ≤ 40 words like any content slide.
- **table** — headline; table across cols 1–12, banded rows, header row in dk2
  fill + white text, ≤ 7 columns, rows sorted by the leading data column.
- **closing_cta** — accent1 field like title; closing line + one CTA + contact
  small at the bottom. No new information on this slide.

## Selection quick-map (content shape → archetype)

parallel points → content_bullets · one metric → big_stat · option sets →
comparison · data series → content_chart · true sequence → timeline_process ·
single statement → quote / section_divider · exact values → table ·
narrative + visual → two_column · open → title(+agenda) · close → closing_cta
