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
