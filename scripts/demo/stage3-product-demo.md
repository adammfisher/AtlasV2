# Stage 3 product demo — auto loan payment calculator (Amendment §A10)

Automated equivalent: gate 3/4 of `pnpm test:stage3-e2e`.

1. **Define** — empty chat → click the sixth suggestion chip
   (`Define a product — auto loan payment calculator`), add context if you like:
   problem (applicants abandon when they can't estimate payments) and a benefit
   hypothesis (+15% application completion). The pipeline card shows the product
   validation chain — Schema ✓, Completeness, and the exact KC skip-ambers
   (`Spine check skipped — Knowledge Core not connected`, collision, dependencies).
2. **Promote → endorsed** — artifact card → panel → Promote. The stamp records
   userName, version, and outstanding ambers verbatim in the note.
3. **Three targeted edits** (each runs the field router + per-field constrained edits;
   untouched fields are byte-identical by server merge):
   - `Add capabilities to the product: payment estimate calculator (S), rate lookup by credit tier (M), amortization schedule view (M)`
   - `Add acceptance criteria: for payment estimate — given a loan amount, term and rate, when the user submits, then monthly payment displays within 1 second`
   - `Add KPIs: application completion rate target +15%, calculator engagement target 40% of applicants`
4. **Promote → specified** — unlocks now that capabilities/AC/KPIs exist.
5. **Regenerate all local projections** — panel → PROJECTIONS → generate each:
   concept_md, concept_docx, brd_docx, gate_pptx, context_mermaid (deterministic),
   prototype_react (generated). Stale chips appear if you edit the master again.
6. **Export bundle** — panel → Export bundle (unlocked from `specified`). Unzip:
   CLAUDE.md, definition.json, acceptance/criteria.{json,md}, context/{dependencies,decisions}.md.
7. **Hand off** — open the bundle folder in a fresh Claude Code project and ask it to
   explore; its first exploration answer should cite bundle content (CLAUDE.md scope,
   acceptance criteria). [Manual step for Adam.]
8. **Writeback** — back in the product chat:
   `log a decision on the auto loan calculator: we went client-side calculation, rate API only for personalization`
   → field router resolves to `decisions`, append-only edit, version bumps, and the
   gate_pptx projection shows a stale chip until regenerated.
