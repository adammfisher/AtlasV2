# Stage 3 demo — the document factory

One prompt per skill. Run each in a fresh chat (New chat → paste → Enter) and
watch the pipeline card fill in live. Automated equivalent: `pnpm test:stage3-e2e`.

| # | Skill | Prompt |
|---|-------|--------|
| 1 | pptx | Build a five-slide deck summarizing the Atlas pilot results: 12 teams onboarded, 87% weekly active, 3 blockers |
| 2 | docx | Write a one-page project kickoff memo for the data migration: goals, timeline, owners |
| 3 | xlsx | Create a budget tracker spreadsheet: 5 expense categories, monthly plan vs actual with variance formulas |
| 4 | pdf | Create a two-page onboarding checklist PDF for new analysts |
| 5 | md | Write a README for the atlas-org-intel service: purpose, setup, API overview |
| 6 | mermaid | Diagram the org-intel ingest flow: sources, embed, graph store, MCP tools |
| 7 | svg | Create an icon of a compass, minimal line style |
| 8 | react | Build a small counter widget with increment and reset buttons |
| 9 | site | Landing page prototype for Atlas: hero, three feature blocks, footer |

Then exercise the lifecycle on the deck from #1:

10. **Targeted edit** — `Make the blockers slide punchier — lead with the number.`
    The pipeline card shows `Targeted edit · slides[n] regenerated · rest unchanged from v1`;
    the artifact card bumps to v2; untouched slides stay text-identical (gate-checked).
11. **Download** — artifact card → eye icon → panel → Download v2. Open the .pptx in
    Keynote or PowerPoint (manual gate: opens without repair prompts; same for the
    docx from #2 in Word/Pages).
12. **Restore** — panel → select v1 → Restore.
13. **Skill-disabled refusal** — Skills → toggle Presentations off → ask for a deck →
    exact refusal message; toggle back on.
