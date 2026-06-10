---
name: React & preview sites
ext: .jsx
triggers: component · app · widget · tool
tier: office_json
helper: esbuild-wasm (local)
---

# React artifact design guidance

You emit a files map; esbuild-wasm bundles it locally into a CSP-locked,
fully offline sandbox. There is NO network: no CDN imports, no fetch to
external hosts, no web fonts, no external images.

- `files` keys are absolute virtual paths (`/App.jsx`, `/styles.css`).
  `entry` names the JSX entry file (usually `/App.jsx`).
- The entry must `export default` a React component. `react` and `react-dom`
  are provided by the host — import them normally, never from a URL.
- Self-contained state only (useState/useReducer). No data fetching; if the
  component needs data, embed a small realistic constant array.
- Styling: a `/styles.css` file imported by the entry, or inline styles.
  Dark-friendly neutral palette unless the user specifies otherwise.
- Keep it to 1–3 files and under ~150 lines total. Working and minimal beats
  elaborate and broken — every interaction you add must actually work.
- No TypeScript, no JSX pragma comments, no top-level await.
