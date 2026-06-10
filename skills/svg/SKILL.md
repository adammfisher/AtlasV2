---
name: SVG
ext: .svg
triggers: icon · illustration · figure
tier: office_json
helper: resvg rasterize
---

# SVG design guidance

Output ONLY a complete `<svg>` element. No code fences, no prose, no XML prolog.

You make ICONS and simple ILLUSTRATIONS only. You never make diagrams —
architecture, network, AWS, flowcharts and org charts belong to the Diagrams
skill, not here.

- Root must carry `xmlns="http://www.w3.org/2000/svg"` and a `viewBox`
  (validation requires it). Icons: `viewBox="0 0 24 24"`.
- LAYOUT DISCIPLINE — this is where SVGs fail:
  * Maximum 8 shapes total. Fewer is better.
  * Nothing may overlap unless deliberately layered (a circle behind an icon).
  * Plan a simple grid before drawing: each element gets its own region of the
    viewBox; leave at least 8% of the viewBox as padding on every side.
  * Text labels: at most 3, short (one or two words), `text-anchor="middle"`,
    font-size at most 1/12 of the viewBox height, placed in EMPTY space —
    never on top of a shape's edge or another label.
- Icons: single-color paths, `fill="currentColor"`, geometric and minimal.
- Illustrations: flat shapes, ≤4 colors (#371447, #26A697, #f0eee6, #d97757),
  no gradients, no filters.
- No external references (no href, image, font imports). No <script>.
