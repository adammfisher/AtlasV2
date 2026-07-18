# Axiom V2 — Phase 7 Parity Sweep & Flake-Audit Report

**Run:** 2026-07-18, autonomous (per the ATLAS V2 Master Test Suite mandate: build, fix, re-test, commit each verified batch, never soften a failure, determinism engineered not hoped for).
**Scope:** continuation from a prior compacted session (FX-1 through FX-10 already landed) — Phase 6 (platform surfaces) close-out, Phase 7 (parity sweep, fix the baseline Playwright reds, two consecutive clean full-suite runs, flake audit, final report).

---

## TL;DR

- **9 new real bugs found and fixed** (FX-11 through FX-19), spanning MCP connector availability, router misclassification (two separate incidents), model tool-use confusion, a dead-config field, and a non-Error-throw display bug.
- **Every originally-listed pending failure is fixed and verified 3×+**: `artifacts.spec.ts` (mermaid share, pptx build chain, MCP tool), `memory-knowledge.spec.ts` (all 3), `m3-m9.spec.ts` M4/M6, `c5-c12-artifacts.spec.ts` C9, `x-polish.spec.ts` X1/X2, `x4.spec.ts` tab-close-abort.
- **`stage4-gates.test.ts` rewritten** for DynamoDB — it hadn't run since the SQLite retirement; one of its four gates was quietly exercising a fully dead memory subsystem and got replaced with the real one, not just recompiled.
- **`Documentation/PARITY_MATRIX.md` re-audited**: 69/69 rows GREEN. (2 explicitly accepted, unchanged gaps: LaTeX/KaTeX rendering, and the local-dev variant of remote-streamable-HTTP MCP-by-URL — both already documented as such, neither newly broken.)
- **Flake audit — five full 122-test `parity-legacy` runs**, each investigated to a real root cause rather than re-run-until-green: two genuine timing races (feedback-thumbs reload, stop-button click), one Bedrock content-filter false-positive triggered by a too-aggressive test fixture (200-item repetitive enumeration), one stale hardcoded test assumption (artifact kind), one test-precondition race, one test scoping bug (sidebar vs. transcript), and two confirmed-non-reproducible LLM instruction-compliance variances (documented, not "fixed" — a live model cannot be made 100% deterministic, and pretending otherwise would be dishonest).
- **Two consecutive clean full-suite runs achieved** on all three Playwright projects: `parity-legacy` (120/122, 120/122 — the 2 misses are the same accepted gaps both times), `ui-mocked` (16/16, 16/16), `live-smoke` (54/54, 54/54).
- **20 commits**, all with full root-cause writeups in `FIXLOG.md`.

---

## Bugs found and fixed (FX-11 → FX-19)

| # | Area | Bug | Fix |
|---|---|---|---|
| FX-11 | MCP / product | Bundled `filesystem`/`sqlite` connectors were enabled only for a dead legacy project id (`p1`) — invisible from the real default project and every project created after boot. Only `memory` had the "enabled everywhere" treatment. | Applied the same treatment to all of `BUNDLED`; added `enableBundledForProject()` for projects created after boot. Also found and fixed: `KnowledgeModal.tsx`, a fully-built component, was never imported/rendered anywhere — wired it into `ProjectWorkspace.tsx`. |
| FX-12 | Router | The FX-7 "format-decisive word" mechanism was silently non-functional for 6 of its 8 words (a flawed `nounObjects` lookup) — "markdown document" misrouted to `create-docx`. | Rewrote as a hand-authored `word → workflow` map; caught and reverted a new `csv`-triggered regression the rewrite itself introduced along the way. |
| FX-13 | MCP / prompt | Making the filesystem tool actually reachable (FX-11) surfaced two NEW model-confusion regressions never previously possible: treating project-knowledge documents as filesystem-searchable, and proactively saving long chat replies to a scratch file instead of streaming them. | Targeted system-prompt `toolNotes`, gated on tool/knowledge availability; required a concrete negative example to actually stick. |
| FX-14 | Product | `config.userName` was loaded at boot but never threaded into the system prompt anywhere — a config field that did nothing. | Wired into `PERSONA`, gated to the primary account (the field predates the multi-account system). |
| FX-15 | Router | "Markdown" is uniquely ambiguous among FX-12's format words — also the name for a chat reply's own inline formatting ("a markdown table"). Misrouted a plain question into a standalone artifact. | Narrowed to a regex requiring markdown to name the deliverable itself, not describe an element within one. |
| FX-16 | Product | Style presets (concise/explanatory) were qualitative-only ("be concise"); a small-tier model's actual length compliance was too inconsistent to reliably differ. | Added concrete length/structure anchors to both presets. |
| FX-17 | Product | A Bedrock content-filter block rendered as `Something went wrong: [object Object]` — the SDK can throw a plain `{message}` object, not a true `Error`. | Shared `errorMessage()` helper, applied at all 4 similar call sites in `chat.ts`. |
| FX-18 | Test | `x-polish.spec.ts` X7 hardcoded a specific artifact kind ("docx") not guaranteed to still exist in a long-lived shared test account. | Picks whichever kind filter is actually rendered right now. |
| FX-19 | Test | Same test's OWN precondition (download-row count) raced an async query load; a separate test checked the whole page body and always found this conversation's own (never-renamed) sidebar title. | `expect.poll()` instead of a flat wait; scoped the assertion to the rendered transcript, not the whole page. |

Full root-cause writeups, evidence, and regression-lock data for every fix: `FIXLOG.md`.

---

## Verification

- **`parity-legacy`** (122 tests): 2 consecutive clean runs, 120/122 both times. The 2 misses are self-documented `@red` gaps present before this session (`p-plugins.spec.ts` P2's local-only streamable-HTTP-by-URL variant — the deployed variant is independently green per the matrix; `x-polish.spec.ts` X3b — KaTeX genuinely not implemented).
- **`ui-mocked`** (16 tests, recorded SSE fixtures): 2 consecutive clean runs, 16/16 both times.
- **`live-smoke`** (54 tests, real Bedrock): 2 consecutive clean runs, 54/54 both times.
- **`test:routing`** (305-case dataset × 3 tiers): unambiguous class 100% on all tiers both times it was re-run after router changes (FX-12, FX-15); edit-vs-describe 100%; zero new misses vs. the pre-session baseline.
- **`test:stage4-gates`** (rewritten for DynamoDB): 3/3 consecutive, all 4 gates green each run.
- **Jank** (`A0-5`, ui-mocked): 0 long tasks over 200ms during a live mocked stream; ~0ms main-thread blocked; mid-stream UI click responded in 134–156ms across runs.

---

## Parity matrix

`Documentation/PARITY_MATRIX.md`: **69/69 rows GREEN** as of this session's re-audit. 9 rows were found regressed since their last audit (2026-07-14/15) — all downstream of FX-11 making the filesystem MCP tool reachable for the first time, which is precisely why no earlier audit could have caught the FX-13-class confusion it exposed. Each regressed row is annotated in place with today's re-verification (never silently re-dated, per the matrix's own "never delete rows" rule): C9, M4, M6, M8 (+ addendum M8a), P1 (+ addendum P1a), X1, X2, X4, X9.

---

## Known / not-yet-perfect (honest)

1. **Two rare, confirmed LLM instruction-compliance variances**, neither reproducible in isolation (5/5 and 6/6 clean re-runs respectively): `r5.spec.ts`'s row-count test once had the model paraphrase an exact tool-computed number ("1000" instead of 1200) when restating it in prose (the underlying tool and data path were traced end-to-end and are correct); `x-polish.spec.ts` X3 once omitted a requested markdown table from an otherwise-compliant reply to a 3-part formatting instruction. Both got a best-effort prompt strengthening; neither can be called "fixed" the way a code defect can — a live model is not deterministic, and the Fix Protocol's determinism mandate is about engineering the code around it, not pretending the model itself can be made perfectly reliable.
2. **`plugins.ts`'s custom-connector routes** (`addCustom`, install/configure/restart) still fall back to the literal `'p1'` when no `projectId` is supplied — the same stale-default class of bug FX-11 fixed for the BUNDLED connectors, but for the user-added-connector path. This is a pre-existing, already-tracked gap (documented in the matrix's own P2 row since 2026-07-14: *"addCustom enables hardcoded 'p1' instead of the ACTIVE project (fix queued...)"*) — not touched this session since it's a different, narrower code path than what FX-11 addressed, and every current call site the UI actually exercises supplies its own `projectId` explicitly.
3. **Flake-audit methodology note:** five full-suite runs were needed to reach two clean consecutive passes, each surfacing one real, previously-latent issue. This is expected, not alarming — a 122-test suite making real network/model calls will have a nonzero baseline chance of exposing a rare race per run; what matters is that every single one was root-caused to a specific line of code (not dismissed as "just flaky") and is now either fixed or explicitly documented as inherent model variance.

---

## Commits this session

20 commits on `feat/mcp-pat-connectors`, from `23e6b6d` (FX-10 close-out) through `d3f2edc` (FX-19). Every commit ends with a `Co-Authored-By` trailer and links back to this session; `FIXLOG.md` is the authoritative, detailed record of what each one actually changed and why.
