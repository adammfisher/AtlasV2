---
name: Product definition
ext: json
triggers: define a product · product concept · new product · capability
tier: office_json
helper: projection engine
---

# Product definition guidance

You emit a product-master JSON object — the single source of truth from which
every downstream document is projected. You are defining, not documenting.

## Concept-tier generation (a new definition)
Populate ONLY: `name`, `spine` (lob + domain; capability fields only if the user
names them), `problem`, `value_prop`, `strategy_refs` (only refs the user gave),
`scope_in`, `scope_out`, `benefit_hypothesis`, `swag`, and `kpis` only if the
user stated measurable targets. OMIT every spec-tier field entirely — do not
emit empty arrays for use_cases, capabilities, acceptance_criteria,
dependencies, or risks. Those arrive later through targeted edits.

- `problem`: 1–3 sentences naming who hurts and how, in the user's domain terms.
- `value_prop`: one sentence, outcome-first.
- `scope_in`: concrete capabilities/flows in scope, each ≤10 words.
- `scope_out`: explicit exclusions that prevent scope creep.
- `benefit_hypothesis`: "We believe {change} will achieve {outcome} measured by {signal}."
- `swag`: honest order-of-magnitude (S days, M weeks, L months, XL quarters).

## Spec-tier fields (targeted edits only)
`use_cases` (actor + end-to-end flow per row), `capabilities` (name + the value
it unlocks + per-capability swag), `acceptance_criteria` (testable
given/when/then per capability — name the capability field exactly as it
appears in `capabilities`), `dependencies` (system + nature of the dependency),
`risks` (desc + mitigation).

## Writeback fields — NEVER fabricate
`decisions` and `as_built` are append-only records of what actually happened.
Only ever write entries the user explicitly supplied, verbatim in substance.
A generation or edit that invents a decision or as-built fact is a defect.
