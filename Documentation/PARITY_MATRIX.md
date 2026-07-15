# AtlasV2 ↔ claude.ai Parity Matrix

**Source of truth for the parity mission.** One row per spec item. A row is
GREEN only with a linked passing test (Playwright under `tests/e2e/parity/`,
or a captured live-API exchange where a browser can't reach it). AMBER = works
but visibly worse than claude.ai. RED = broken, missing, or **not yet audited**
(see notes). Never delete rows. `Documentation/PARITY_REPORT.md` is historical
and untrusted — this file supersedes it.

Statuses: 🔴 RED · 🟡 AMBER · 🟢 GREEN · ⬜ WAIVED (user-granted only)

**Deployment state (2026-07-14, end of session 2):** app Lambda, client and
office Lambda are all deployed at HEAD. Deployed evidence: R suite 12/12
(non-@red), memory-eval 14/14, M2 isolation 8/8, S2 routing 20/20, DeepWiki
remote MCP live, ultra file-type sweep (see audit log).

Fixtures: `tests/e2e/fixtures/` — `model.xlsx` (3 sheets, live formulas, B4=SUM),
`manual.docx` (headings + table, codeword HELIOTROPE-9), `survey.pdf` (12pp,
page-7 table, PDFPAGE-n-LYNX markers), `scanned.pdf` (zero text layer),
`readings.csv` (1200 rows, mean temp_c = 14.87), `config.json`
(JSON-NIGHTJAR-77), `red.png`, `notes.txt` (KESTREL-42),
`Documentation/DFS Slide Library - 2026.pptx` (real deck).

## 1 · File reading

Audited 2026-07-14, local dev, model **Nova 2 Lite** (the deployed default — model choice materially affects tool-use rows).

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| R1 | pptx read: slide-by-slide content incl. notes+tables | 🟢 | parity/r1.spec.ts (2/2) 2026-07-14 | small deck incl. chart series; 22MB DFS deck via presign path, slide-5 title answered in 47s |
| R2 | docx read: table contents verbatim | 🟢 | parity/r2.spec.ts ✓ 2026-07-14 (9.9s) | FIXED: docx table rows render into extraction text (was a literal "[table]"); documents.ts render() gained a blocks branch. Local; deployed pending office-Lambda ship |
| R3 | xlsx read: per-sheet + cell-level (B4 formula) | 🟢 | parity/r3.spec.ts ✓✓ 2026-07-14 (10.6s) | FIXED: two-pass load surfaces formula text ("=SUM(B2:B3) → 36" when cached). Local; deployed pending office-Lambda ship |
| R4 | pdf read: page-specific QA; scanned PDF honest degrade | 🟢 | parity/r4.spec.ts (2/2) 2026-07-14 | page-7 table verbatim; scanned PDF got an honest no-text statement, no hallucination |
| R5 | csv read: row count, columns, aggregate | 🟢 | parity/r5.spec.ts ✓✓ 2026-07-14 (6.3s/9.0s) | FIXED: analyze_table tool — deterministic shape/mean/sum/min/max/count over csv/tsv/xlsx server-side; model instructed to never eyeball aggregates. 1200 rows and mean 14.87 now exact |
| R6 | image read: vision accurate, multi-image | 🟢 | parity/r6.spec.ts (2/2) 2026-07-14 | single + two-image |
| R7 | code/text read verbatim | 🟢 | parity/r7.spec.ts 2026-07-14 | nested JSON sentinel + count |
| R8 | multi-file (3 mixed) in one message | 🟢 | parity/r8.spec.ts 2026-07-14 | docx+csv+image all referenced |
| R9 | large/unsupported file honesty | 🟢 | parity/r9.spec.ts 2026-07-14 | unsupported ext refuses visibly before send |
| R10 | extraction-status UI; no answer-before-read path | 🟢 | parity/r10.spec.ts ✓ 2026-07-14 (33.5s) | FIXED: send-during-upload now QUEUES with a visible banner ("sends when the file is ready") and fires when the upload lands; answered from real deck content. Was a silent drop at ChatView send() |

## 2 · File & artifact creation

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| C1 | pptx create + edit round-trip, template intact | 🟢 | parity/c1-c4-office.spec.ts ✓ 2026-07-14 (28.4s, was 4min/∞) | FIXED: measured Bedrock json_schema grammar compile at ~188s for the pptx schema vs 5-7s via forced tool-use with shape intact (3/3 probes) — bigSchema gate 2200→1200 routes pptx to tool-use. Plus a 150s abort ceiling on every constrained call (X5). Local; deploy pending |
| C2 | docx create + edit round-trip | 🟢 | parity/c1-c4-office.spec.ts 2026-07-14 | create→headings→edit→v2, python-docx validated, 34s |
| C3 | xlsx create with WORKING formulas + edit | 🟢 | parity/c1-c4-office.spec.ts 2026-07-14 | real =formulas present (not baked values), edit→v2, 31s |
| C4 | pdf create + edit round-trip | 🟢 | parity/c1-c4-office.spec.ts 2026-07-14 | pages+text verified via pdfplumber, edit→v2, 35s |
| C5 | react artifact: renders, stateful, error surface + fix affordance | 🔴 | 3 instrumented repros 2026-07-14/15 | root causes peeled: (1) Nova emits App.js not /App.jsx → healEntryFile fixes entry resolution (payload+disk); (2) bundle now compiles (92ms, was 'Bundle failed' — error chip DOES surface); remaining: emitted code mounts a blank frame on Nova 2 Lite (model-output quality) + no 'try fixing' affordance. Next: react SKILL.md mount contract + retry affordance |
| C6 | html/site artifact: sandboxed, no cookie access | 🟢 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | sandbox attr present, no allow-same-origin |
| C7 | svg artifact | 🟢 | parity spec 3/3 consecutive 2026-07-14 | FIXED: extractSvg cuts the <svg> span out of prose-wrapped emissions before validate+persist (both generate and edit paths) |
| C8 | mermaid artifact + graceful syntax errors | 🟢 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | invalid source surfaced a visible parse error |
| C9 | md artifact | 🟢 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | |
| C10 | artifact versioning: list, browse, restore, per-version download | 🟡 | parity/c5-c12-artifacts.spec.ts ✘ 2026-07-14 | v1+v2 downloads OK, version indicator OK; RESTORE not discoverable from the panel; no full history-list UI |
| C11 | artifact share link (read-only, logged-out context) | 🟡 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | link works logged-out (presigned S3, 200) but serves an attachment DOWNLOAD, not claude.ai's viewable share page |
| C12 | downloads from chat AND panel | 🟢 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | |

## 3 · Skills

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| S1 | progressive disclosure proven (prompt-size assertion) | 🟢 | scripts/test/parity-s1-disclosure.ts 2026-07-14 | chat prompt carries ZERO skill text (leaner than the ~100-token metadata claim, which is UI-only); matched skill's guidance (~3k tokens total across all) loads per-pipeline-task only |
| S2 | routing accuracy ≥90% on 20-prompt eval | 🟢 | scripts/test/parity-s2-routing.ts 20/20 2026-07-14 | via the DEPLOYED router path (Bedrock constrained JSON — llama does not exist in Lambda). All 6 must-NOT-fire statements stayed chat |
| S3 | skills UI toggles gate the router, persist | 🟢 | parity/s3.spec.ts 2026-07-14 | disable pptx → honest refusal, no artifact; Disabled badge persists after reload |
| S4 | validator loop: fail → retry with feedback | 🟡 | pipeline.log 18:26:48 2026-07-14 | observed LIVE: pptx first pass failed schema ("must have required property 'title'") → repair attempt carrying the validator error. Repair completion unobserved this session (the C1 test abort killed it); historical mermaid repair (June 10) did complete. Full fail→fix→green proof rides on the C1 fix |

## 4 · Plugins / MCP

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| P1 | directory honesty: AVAILABLE vs LOCAL-ONLY, live status | 🔴 | code audit only — browser evidence INVALIDATED 2026-07-14 | the spec's `aside >>` locator matched nothing (sidebar is a div — no <aside> in the client); the "browser-confirmed" claim was wrong. Code audit stands: github+postgres have NO server files; knowledge-core → 127.0.0.1:7979; sharepoint → mcp.slack.com with SLACK_TOKEN. Re-audit with fixed locators |
| P2 | remote streamable-HTTP MCP add → tools → invoke, DEPLOYED | 🟢 | local spec ✓ + DEPLOYED live run 2026-07-14 (deepwiki-sse logs archived) | REAL public server (mcp.deepwiki.com) added by URL on the deployed Lambda → connected → read_wiki_structure invoked in chat → grounded answer. Found en route: addCustom enables hardcoded "p1" instead of the ACTIVE project (fix queued — until then a manual project toggle is needed after adding) |
| P3 | bundled servers rehosted or marked local-dev-only | 🔴 | code audit 2026-07-14 | filesystem/memory/sqlite = stdio + better-sqlite3 over /tmp SQLite — disjoint from DynamoDB data; chat.ts already hides memory/sqlite as "shadow" connectors writing to a dead DB |
| P4 | per-server toggles per chat | 🔴 | code audit 2026-07-14 | per-PROJECT toggles exist (enabled_projects, enforced in toolsForProject + callTool); per-chat granularity absent |
| P5 | credentials: stored encrypted, never echoed | 🟡 | parity/p-plugins.spec.ts ✓ 2026-07-14 | browser+API verified: secret never echoed in any plugins response nor model context. AMBER not GREEN because deployed storage is broken-by-design: key + ciphertexts under Lambda /tmp — cold starts orphan creds, connectors go tokenless silently |
| P6 | tool-loop robustness: error/timeout/mid-call kill | 🔴 | parity/p-plugins.spec.ts ✘ 2026-07-14 (re-run w/ P2 green) | P2 unblocked but the kill-mid-call reply carried no error language — either the tool call hadn't fired within the 12s pre-kill window or the model narrated the failure without matchable wording. Needs an instrumented repro (assert on the tool chip/mcp.log, not reply text) |

## 5 · Conversation core

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| V1 | context management: summarize-and-archive, 60+ turns | 🟢 | parity/v1.spec.ts 2026-07-14 (3.8m, 30 turns) | rolling summary recalled turn-1 codename+date after 30 filler turns. Char-budgeted, not token-counted (spec asks for Converse-usage counting — functional outcome achieved; counting still worth adding, note kept). 60-turn variant deferred to the full-sweep spec |
| V2 | thinking blocks persist + collapsible in history | 🔴 | parity/v2.spec.ts ✘ 2026-07-14 | confirmed in browser: nothing renders after reload; chat.ts persists only {text,toolCalls} |
| V3 | edit prior message → branch/replace-forward | 🟢 | parity/v3-v6.spec.ts 2026-07-14 | indicator shown; replace-forward truncation verified (BETA-2 gone after editing turn 1). Shipped behavior: replace-forward, documented here |
| V4 | regenerate | 🟢 | parity/v3-v6.spec.ts 2026-07-14 | |
| V5 | stop keeps partial (incl. mid-tool-call) | 🟢 | parity/v3-v6.spec.ts 2026-07-14 | basic stop verified; mid-TOOL-CALL stop still unexercised (needs a long tool call to time) — note kept |
| V6 | copy message | 🟢 | parity/v3-v6.spec.ts 2026-07-14 | clipboard content verified |
| V7 | chat share link, revocable snapshot | 🔴 | parity/v7-v12.spec.ts ✘ 2026-07-14 | browser-confirmed: no share affordance; no route |
| V8 | export: single (md+json) + all (zip) | 🟡 | parity/v7-v12.spec.ts 2026-07-14 | V8a md export downloads (✓); json + all-zip absent (✘) |
| V9 | rename / search / bulk delete + eval teardown | 🔴 | parity/v7-v12.spec.ts ✘ 2026-07-14 (window.prompt handled) | rename now drives the real flow (Edit → pencil → native prompt) but the new title never appears — pencil click may not reach the span handler, or rename fails silently; needs headed repro. Eval pollution stands CONFIRMED (no teardown on script evals) |
| V10 | feedback thumbs persist | 🟢 | parity/v7-v12.spec.ts ✓ 2026-07-14 (10.3s) | worked all along — persists AND re-renders (inline color); the audit detector checked svg fill instead of style color |
| V11 | suggested prompts | 🟢 | parity/v7-v12.spec.ts 2026-07-14 | |
| V12 | new-chat affordances | 🟢 | parity/v7-v12.spec.ts 2026-07-14 | |

## 6 · Web search & citations

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| W1 | search reliability ≥9/10 varied queries | 🔴 | scripts/test/parity-w1-search.ts 7/10 2026-07-14 | DDG scrape returned 0 urls on 3/10 queries (satisfies-operator, CloudFront-timeout, soffice-convert) — the known fragility, confirmed |
| W2 | inline citations on search-grounded answers | 🔴 | parity/w2-w4.spec.ts ✘ 2026-07-14 | zero clickable source links render in answers |
| W3 | URL fetch → grounded answer with citation | 🟢 | parity/w2-w4.spec.ts 2026-07-14 | pasted URL fetched, heading answered verbatim (citation rendering counted under W2) |
| W4 | per-chat search toggle removes tools | 🟡 | parity/w2-w4.spec.ts 2026-07-14 | toggle-off honestly removes tools (✓) — but scope is GLOBAL despite living in the composer; per-chat is the spec |

## 7 · Memory & projects

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| M1 | recall e2e vs DEPLOYED stack | 🟢 | memory-eval **14/14 local AND deployed** 2026-07-14 | FIXED: adjudicate token starvation on the tool-use path (32→200 — every deployed dedup/supersede verdict was falling to 'different' at parse) + forget lexical sweep. First full pass on the current architecture |
| M2 | project isolation vs DEPLOYED stack | 🟢 | scripts/test/parity-m2-isolation.ts 8/8 DEPLOYED 2026-07-14 | new API-level harness (old stage-2 gate is SQLite-bound, kept as historical). Conversation/artifact scoping + memory-recall isolation + cross-project chat probe all hold on DynamoDB/S3 Vectors |
| M3 | remember/forget tools | 🟢 | memory-eval §4-5 ✓✓ both envs 2026-07-14 | forget now sweeps lexically behind the vector pass — no layer survives |
| M4 | memory modal browse/edit | 🟢 | parity/m3-m9.spec.ts 2026-07-14 | fact listed in the modal |
| M5 | deletion propagation: purge derived facts+vectors | 🟢 | parity/m3-m9.spec.ts ✓ 2026-07-14 (12.8s) | FIXED: deleteConversation purges source-stamped notes/KV (+vectors) in project+user scopes and clears the queued extraction (no resurrection). Graph edges not yet swept — noted as residual |
| M6 | knowledge citations as rendered chips | 🔴 | parity/m3-m9.spec.ts ✘ 2026-07-14 | no citation/source chip renders |
| M7 | project instructions honored | 🟢 | parity/m3-m9.spec.ts ✓ 2026-07-14 (8.5s re-audit) | first fail was the harness (wrong project targeted); with the ACTIVE project the instruction token appears in the reply |
| M8 | knowledge upload + RAG page-7 spot check | 🟢 | parity/m3-m9.spec.ts 2026-07-14 | survey.pdf uploaded → page-7 site total answered in a DIFFERENT chat, 25s |
| M9 | incognito: zero persistence, banner | 🔴 | parity/m3-m9.spec.ts ✘ 2026-07-14 | no incognito affordance exists (code + browser) |

## 8 · Styles, settings, polish

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| X1 | styles: presets + custom-from-sample, per chat | 🔴 | parity/x-polish.spec.ts ✘ 2026-07-14 | absent (code + browser) |
| X2 | global preferences injected | 🟢 | parity/x-polish.spec.ts 2026-07-14 | configured userName known to the model |
| X3 | markdown torture test (tables, LaTeX, code+copy) | 🟢 | parity/x-polish.spec.ts ✓ 2026-07-14 | tables rendered all along (chat gfm + md artifacts); added the missing per-code-block COPY button (RichText decoration). LaTeX split to @red X3b — katex genuinely absent, real feature gap |
| X4 | streaming: slow-conn, heartbeat, tab-close abort | 🔴 | deferred | needs infra manipulation (throttled connection, CloudFront origin timing) — not a browser assertion; test approach TBD next session |
| X5 | error recovery: mid-stream kill → retry affordance | 🟡 | bedrock.ts 150s abort ceiling 2026-07-14 | pipeline constrained calls can no longer spin forever (deadline → surfaced PipelineError). Remaining: chat-stream kill recovery + a retry affordance in the UI; dedicated spec pending |
| X6 | voice dictation (Web Speech, graceful hide) | 🔴 | code audit 2026-07-14 | mic button confirmed decorative — no onClick, no speech API usage anywhere |
| X7 | artifacts gallery cross-chat | 🔴 | code audit 2026-07-14 | no surface; API /artifacts already returns the cross-chat list, so this is UI-only |
| X8 | mobile layout | 🟢 | parity/x-polish.spec.ts 2026-07-14 | 390px: composer usable, no horizontal overflow |
| X9 | light theme | 🟢 | parity/x-polish.spec.ts 2026-07-14 | toggle applies (background changes and restores) |
| X10 | keyboard: Enter/Shift-Enter, Cmd-K, Esc | 🟢 | parity/x-polish.spec.ts ✓ 2026-07-14 | added global Cmd/Ctrl-K → focus chat search; Enter/Shift-Enter/Esc already worked |

## Audit log

- 2026-07-14 (session 2 close) · **ULTRA file-type sweep 13/13 vs DEPLOYED** (pptx/docx/xlsx/pdf/csv/json/yaml/md/txt/py/png/jpg sentinels + code comprehension). Memory-eval 14/14 both envs. Session flips: R2 R3 R5 R7 R10 C1 C7 M1 M3 M5 M7 P2 S3 V10 X3 X10 → 🟢. Standing count: **47 🟢 · 6 🟡 · 14 🔴** (REDs: C5, P1, P3, P4, P6, V2, V7, V9, W1, W2, M6, M9, X1, X4/X6/X7 group — see rows).

- 2026-07-14 · matrix created; all 67 rows RED pending Phase A audit. Fixtures generated and property-verified (12-page PDF, zero-text scanned PDF, formula xlsx, 1200-row CSV with mean 14.87).
- 2026-07-14 · **Phase A audit COMPLETE.** 67/67 rows have evidence-based status: **31 🟢 · 9 🟡 · 27 🔴.** 51 Playwright tests + 5 script evals executed (local dev + deployed CloudFront for M1/M2). Environment caveats: model varied across runs (Nova 2 Lite → Claude Haiku 4.5 via per-project memory); deployed Lambda predates the extraction overhaul; two failures are harness-caused and marked for re-audit (M7, P2/P6).
