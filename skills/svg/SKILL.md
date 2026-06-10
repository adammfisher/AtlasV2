---
name: SVG
ext: .svg
triggers: icon · illustration · figure
tier: office_json
helper: resvg rasterize
---

# SVG design guidance

Output ONLY a complete `<svg>` element. No code fences, no prose, no XML prolog.

- Root must carry `xmlns="http://www.w3.org/2000/svg"` and a `viewBox`
  (validation requires it). Use `viewBox="0 0 24 24"` for icons,
  larger square/landscape boxes for illustrations.
- Icons: single-color paths, `fill="currentColor"`, 1.5–2px visual stroke
  weight, geometric and minimal.
- Illustrations/figures: flat shapes, ≤6 colors drawn from a warm palette
  (#d97757 accent, #262624 dark, #f0eee6 light), no gradients or filters.
- No external references of any kind (no href, no image, no font imports).
- No <script>. Text elements only when the user asks for labeled figures.
