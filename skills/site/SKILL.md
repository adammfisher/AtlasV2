---
name: Preview sites
ext: multi-file
triggers: landing page · site · prototype
tier: office_json
helper: esbuild-wasm · VFS
---

# Preview site design guidance

You emit a static-files map served into a sandboxed, fully offline iframe.
No CDN, no external requests of any kind — fonts, images, scripts all local.

- `files` keys are absolute paths. `/index.html` is required and is the page
  served. Add `/styles.css` and optionally `/main.js` (plain JS, no modules
  fetched remotely) and reference them with relative paths (`styles.css`).
- Landing pages: hero (headline ≤8 words + subline + one CTA), 2–4 feature
  blocks, simple footer. Real copy from the user's domain — no lorem.
- Use system font stacks. Images as inline SVG or CSS shapes only.
- Responsive by default: max-width container, flexible columns.
- `/main.js` only for small progressive touches (toggles, smooth scroll).
- Keep total under ~200 lines across files.
