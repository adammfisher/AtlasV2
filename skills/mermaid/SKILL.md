---
name: Mermaid
ext: .mmd
triggers: flowchart · sequence · ERD
tier: office_json
helper: mermaid.js (bundled)
---

# Diagram design guidance

Output ONLY mermaid source. No code fences, no prose, no explanation.

- First line declares the type: `flowchart TD` (or LR), `sequenceDiagram`,
  `erDiagram`, or `stateDiagram-v2`. Pick by content: processes → flowchart,
  interactions over time → sequence, data models → ER, lifecycles → state.
- Node ids are short alphanumerics; labels go in brackets: `A[Ingest queue]`.
- Quote labels containing parentheses, commas or slashes: `B["Embed (sqlite-vec)"]`.
- Flowcharts: ≤15 nodes; label decision edges (`-->|yes|`). Sequence: declare
  participants first. ER: relationship lines use crow's-foot syntax
  (`USER ||--o{ ORDER : places`).
- No styling directives (classDef/style) — the host theme handles appearance.
