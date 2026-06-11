---
name: Presentations
ext: .pptx
triggers: presentation · slides · deck · QBR
tier: office_json
helper: build_pptx.py
---

# Presentation design guidance

You emit slide JSON only; a deterministic helper fills a branded .potx template.
Never emit prose outside the JSON object.

Your slides render onto DESIGNED brand templates (Poppins, Ally purple) —
bullets become styled callout boxes, so each bullet must stand alone as one
punchy line. Your job is content and structure, never styling.

Pick the best designed slide for each content shape via the optional `style`
field (omit it and a sensible one is chosen by item count):
- `exec_pillars` — exactly 4 items: current state / changes / benefits / next steps. THE executive summary.
- `steps_5` — numbered process or sequence, up to 5 steps.
- `list_blocks4` — numbered list, up to 4 items.
- `bullets2` / `bullets3` / `bullets5` — 2, 3-4, or 5 callout boxes.
- `compare_3` — up to 4 labeled columns with icons (options, tracks, teams).
- `timeline_4` — 4 quarter/phase columns (roadmaps by period).
- `timeline_3` — horizontal arrow timeline, 4 short milestone labels (heading counts as the first).
- `roadmap_4` — road graphic with up to 5 milestone cards.
- `quote_panel` — testimonials or key takeaways, up to 5 short quotes.
- `two_col` — left summary + right stacked boxes.
- `chart_line` / `chart_bar` — only with a real chart object.
Match style capacity to your item count — extra slots are removed automatically,
but a 2-item exec_pillars looks empty. Vary styles across the deck.

Structure a deck like a consultant, not a stenographer:
- Open with a `title` slide: the deck's claim as the heading, one-line context
  (audience · date · team) as the only bullet.
- For decks of 5+ slides, divide topic groups with `section` slides — heading
  only, 2-5 words, no bullets.
- One idea per slide. The heading is a full assertion ("Win rate up 9 points"), never a label ("Win rate").
- `bullets` slides: 2–5 bullets, each ≤10 words, parallel grammar, no terminal periods.
  Each renders as its own designed box — no sub-bullets, no run-on sentences.
- `two_col` for genuine contrasts (before/after, option A/B, scope in/out). Balance the columns.
- `chart` slides when the user gives or implies numbers. Pick `bar` for comparisons, `line` for
  trends over time, `pie` only for shares that sum to a whole and have ≤5 labels. Series values
  must align 1:1 with labels. Never invent numbers — if the user gave none, use a bullets slide
  that names the metric instead.
- Before the closer, a `summary` slide: decisions made, asks, next steps — in that order.
- End with a `closing` slide: heading "Thank You" or "Q&A", no bullets.
- 6–12 slides for a typical request; never pad to a count.
- `notes` carries the spoken narrative for a presenter, max 2 sentences, only when useful.

Tone: terse, concrete, executive. No "In this slide we will…". No placeholder text of any kind —
{{tags}}, TODO_, lorem — validation rejects the deck.
