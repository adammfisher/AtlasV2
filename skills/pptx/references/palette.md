# PPTX palette reference — DFS theme slots and roles

The renderer styles everything through MSO theme color slots (plus brightness
adjustments). No RGB literal exists outside the palette module; specs never
carry hex values. This file documents the mapping for maintainers and for the
vision-critique rubric.

## Theme slots (from dfs_default.potx)

| Slot | Hex (theme source) | Semantic role |
|---|---|---|
| dk1 | #371447 | `text` — primary text on light backgrounds; also the DOMINANT brand color on covers/dividers |
| lt1 | #FFFFFF | `background` — content-slide background; text color on dark slides |
| dk2 | #650360 | `supporting` — secondary headings, table header fill |
| accent1 | #300942 | `dominant-dark` — full-bleed backgrounds on title/section_divider/closing slides |
| accent2 | #26A697 | `accent` — the single highlight color: stat values, chart emphasis series, icons |
| accent3 | #8D4CAB | chart series 2 |
| accent4 | #BB72DD | chart series 3 |
| accent5 | #5DE2CC | chart series 4 (large elements only — fails contrast for text on white) |
| accent6 | #5F2779 | chart series 5 |

Fonts: Poppins major (display) + Poppins minor (body) — one family used at two
weights satisfies the ≤ 2 family cap with room for a data/mono face if a table
ever needs it.

## Weighting rule (60-30-10)

- Dominant (60–70% of visual weight): white background + dk1 text on content
  slides; accent1 field on dark slides.
- Supporting (20–30%): dk2 for secondary structure (section labels, table
  headers, chart series 2).
- Accent (≤ 10%): accent2 for the one thing the eye must find first. If
  everything is teal, nothing is.

## Contrast facts (WCAG 2.1 relative luminance, not rounded)

| Pair | Ratio (computed, 2dp) | Verdict |
|---|---|---|
| dk1 #371447 on lt1 white | 15.52:1 | normal text OK |
| dk2 #650360 on white | 12.10:1 | normal text OK |
| white on accent1 #300942 | 16.89:1 | normal text OK |
| accent2 #26A697 on white | 3.01:1 | large text (≥18pt / ≥14pt bold) and graphics ONLY — fails 4.5:1 normal text |
| accent3 #8D4CAB on white | 5.59:1 | normal text OK (chart series/labels) |
| accent4 #BB72DD on white | 3.20:1 | large text/graphics only |
| accent5 #5DE2CC on white | 1.59:1 | decoration only — never text, never a meaningful icon |
| accent6 #5F2779 on white | 10.23:1 | normal text OK |

Consequences the renderer enforces:
- Teal (accent2) may color big-stat numerals (≥ 18pt bold ⇒ 3:1 bar, 3.01
  passes unrounded) and icons/graphics — never body copy on white.
- No copy is ever set ON a teal panel (white on #26A697 is the same 3.01:1 —
  large text only, so panels use accent1/dk2 fields instead).
- Text on dark slides is always lt1 white on accent1 (16.89:1).
- Chart data labels render in dk1 on white plot areas.

## Brightness adjustments

Panels and subtle fills derive from theme slots with brightness offsets
(e.g. dk2 +90% ≈ soft lavender panel). Use the palette module's named roles —
`panel`, `hairline` — never a new literal.
