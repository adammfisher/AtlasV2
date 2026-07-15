# PPTX validator rubric — what the hard gate enforces

Two layers: DETERMINISTIC checks (the gate — a failing deck is never returned
as success) and an optional advisory vision critique (`ATLAS_VISION_CRITIQUE`,
default off). Bounded fix loop: validator findings feed a spec-revision prompt,
max 2 retries, then an honest hard failure with findings attached.

## Deterministic gate (hard)

| Check | Rule |
|---|---|
| Overflow | Pillow-measured required text height ≤ placeholder height for every frame (per-line measurement; font stepping happens at build; still overflowing at the 14pt floor ⇒ OVERFLOW flag ⇒ fail) |
| Collision | No two shape rectangles overlap beyond tolerance (EMU); footers/citations keep ≥ 0.3" clearance from content |
| Margins | Every element inside 0.5" slide margins |
| Contrast | WCAG 2.1 relative luminance (L1+0.05)/(L2+0.05) per text/background pair: ≥ 4.5:1 normal, ≥ 3:1 large (≥ 18pt, or ≥ 14pt bold). Never rounded — 4.49:1 fails |
| Fonts | ≤ 2 font families across the deck |
| Content audit | bullets ≤ 5 · ≤ 12 words/bullet · ≤ 40 words/slide · title ≤ 90 chars and ≤ 2 measured lines |
| Placeholder scan | reject xxxx, lorem, ipsum, "click to edit", TODO, {{tags}} |
| Speaker notes | present and non-empty on every content slide |

## Post-render check (second overflow signal)

soffice --headless --convert-to pdf → pdftoppm -jpeg -r 150 → edge-bleed /
clipping heuristic on each page image. Advisory when soffice is absent
(local dev), enforced in environments that ship it.

## Vision critique (advisory, flag-gated)

Thumbnail grid → active multimodal model → strict JSON
`{slide_index, pass, issues:[{type, severity, fix}]}` scored on: overlap,
overflow, contrast, alignment/grid, whitespace balance, palette coherence,
one-idea-per-slide, accent-line-under-title tell. Cost + latency logged per
run. Never gates — deterministic checks decide.

## Per-type gates (siblings)

- docx: heading hierarchy (no level skips) + named-styles-only.
- xlsx: ZERO formula errors after recalc (#REF! #DIV/0! #VALUE! #N/A #NAME?),
  named styles, number formats on numeric columns, frozen header row.
- pdf: no tables/figures broken across pages, running header/footer present,
  page counter renders.
