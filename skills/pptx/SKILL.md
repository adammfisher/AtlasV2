---
name: Presentations
ext: .pptx
triggers: presentation · slides · deck · QBR
tier: office_json
helper: build_pptx.py
---

# Presentation design guidance

You emit slide JSON only; a deterministic designer renders each slide into a
premium 16:9 deck (warm palette, strong type hierarchy, accent details, real
charts). Never emit prose outside the JSON object. Your job is CONTENT and
STRUCTURE — pick the right layout for each idea and write tight copy.

## Layouts — choose the one that fits the idea, and VARY them
A deck that is all `bullets` looks cheap. Mix these deliberately:
- `title` — opening slide. `heading` = the deck's claim; `subtitle` = audience · date · context.
- `section` — a divider before a new topic group (auto-numbered 01, 02…). `heading` = 2–5 words; optional `subtitle`. Use one before each major part in decks of 5+ slides.
- `bullets` — 3–6 points, each ≤10 words, parallel grammar, no terminal periods. One idea per slide.
- `two_col` — a genuine contrast (before/after, option A/B, meaning vs happiness). Set `col_left_head`/`col_right_head` and balance the two `col_left`/`col_right` lists (≤6 each).
- `stat` — 1–3 headline metrics. Each `stats` item = a short `value` ("77%", "2.3x", "#1", "$4.2M") + a one-line `label`. Use this whenever you have punchy numbers — it is far stronger than a bullet.
- `quote` — a testimonial or a memorable line. `quote` = the sentence; `attribution` = who said it. Great for opening a section or landing a point.
- `chart` — only with a real `chart` object. `bar` for comparisons, `line` for trends over time, `pie` only for shares summing to a whole (≤5 labels). Series values align 1:1 with labels. Never invent numbers — if none were given, use `bullets` or `stat` naming the metric instead.
- `closing` — final slide. `heading` = "Thank you" / "Q&A" / a closing line; optional `subtitle`.

## Structure a deck like a designer, not a stenographer
- Open with `title`. In decks of 5+, use `section` dividers between topic groups.
- One idea per slide. The `heading` is a full assertion ("Win rate up 9 points"), never a bare label ("Win rate").
- Reach for `stat` and `quote` to break up bullet monotony — a good 8-slide deck might be title, section, bullets, stat, two_col, quote, chart, closing.
- Put the spoken narrative in `notes` (≤2 sentences) only when it adds value.
- 6–12 slides for a typical request; never pad to a count.

## Copy rules
Terse, concrete, executive. No "In this slide we will…". No placeholder text of
any kind — {{tags}}, TODO_, lorem — validation rejects the deck. Headings and
bullets carry real substance; every number must be one the user gave or clearly
implied.
