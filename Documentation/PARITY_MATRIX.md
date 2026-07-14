# AtlasV2 ↔ claude.ai Parity Matrix

**Source of truth for the parity mission.** One row per spec item. A row is
GREEN only with a linked passing test (Playwright under `tests/e2e/parity/`,
or a captured live-API exchange where a browser can't reach it). AMBER = works
but visibly worse than claude.ai. RED = broken, missing, or **not yet audited**
(see notes). Never delete rows. `Documentation/PARITY_REPORT.md` is historical
and untrusted — this file supersedes it.

Statuses: 🔴 RED · 🟡 AMBER · 🟢 GREEN · ⬜ WAIVED (user-granted only)

**Deployment-state warning (2026-07-14):** the deployed Lambda predates commit
`b07f981` (the upload-extraction overhaul). Every local GREEN in section 1
holds only after `scripts/deploy/deploy-app.sh` ships that commit — the
deployed app still has the fire-and-forget/venv extraction bug the user hit.
GREEN rows note which environment produced the evidence.

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
| R2 | docx read: table contents verbatim | 🔴 | parity/r2.spec.ts ✘ 2026-07-14 | root cause: lambda_handler docx `text` renders tables as literal "[table]"; documents.ts render() has no blocks branch. Serials never reach the model |
| R3 | xlsx read: per-sheet + cell-level (B4 formula) | 🟡 | parity/r3.spec.ts (1/2) 2026-07-14 | all sheets extracted (sentinel ✓); B4 formula ✘ — extraction uses data_only=True, and openpyxl-written files carry no cached values → formulas invisible |
| R4 | pdf read: page-specific QA; scanned PDF honest degrade | 🟢 | parity/r4.spec.ts (2/2) 2026-07-14 | page-7 table verbatim; scanned PDF got an honest no-text statement, no hallucination |
| R5 | csv read: row count, columns, aggregate | 🔴 | parity/r5.spec.ts ✘✘ 2026-07-14 | full CSV fits context (23,034 chars); columns correct but model GUESSED "355 rows" (actual 1200) and failed the mean. No computational path — claude.ai uses analysis/code-exec. Fix direction: route aggregates to real computation |
| R6 | image read: vision accurate, multi-image | 🟢 | parity/r6.spec.ts (2/2) 2026-07-14 | single + two-image |
| R7 | code/text read verbatim | 🟢 | parity/r7.spec.ts 2026-07-14 | nested JSON sentinel + count |
| R8 | multi-file (3 mixed) in one message | 🟢 | parity/r8.spec.ts 2026-07-14 | docx+csv+image all referenced |
| R9 | large/unsupported file honesty | 🟢 | parity/r9.spec.ts 2026-07-14 | unsupported ext refuses visibly before send |
| R10 | extraction-status UI; no answer-before-read path | 🟡 | parity/r10.spec.ts ✘ 2026-07-14 | working state IS shown during a 22MB upload, and no dishonest answer occurs — but send-during-upload is a SILENT no-op (message vanishes; spec demands wait-or-warn) |

## 2 · File & artifact creation

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| C1 | pptx create + edit round-trip, template intact | 🔴 | parity/c1-c4-office.spec.ts (rerun in flight) | first run hit my 240s spec cap mid-generation — the deck itself BUILT (~4 min wall-clock: a latency AMBER even once functional). Rerun with 720s budget pending |
| C2 | docx create + edit round-trip | 🟢 | parity/c1-c4-office.spec.ts 2026-07-14 | create→headings→edit→v2, python-docx validated, 34s |
| C3 | xlsx create with WORKING formulas + edit | 🟢 | parity/c1-c4-office.spec.ts 2026-07-14 | real =formulas present (not baked values), edit→v2, 31s |
| C4 | pdf create + edit round-trip | 🟢 | parity/c1-c4-office.spec.ts 2026-07-14 | pages+text verified via pdfplumber, edit→v2, 35s |
| C5 | react artifact: renders, stateful, error surface + fix affordance | 🔴 | parity/c5-c12-artifacts.spec.ts ✘ 2026-07-14 | component iframe content never became reachable in 60s — investigate panel auto-open vs nested-frame locator before trusting; fix-affordance half untested as a result |
| C6 | html/site artifact: sandboxed, no cookie access | 🟢 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | sandbox attr present, no allow-same-origin |
| C7 | svg artifact | 🟢 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | |
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
| S3 | skills UI toggles gate the router, persist | 🔴 | parity/s3.spec.ts | spec written, not yet run (C-batch) |
| S4 | validator loop: fail → retry with feedback | 🔴 | — | code-verified loop exists (orchestrator.ts: 2 attempts, error string fed back, Bedrock escalation); live first-pass-fail observation pending |

## 4 · Plugins / MCP

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| P1 | directory honesty: AVAILABLE vs LOCAL-ONLY, live status | 🔴 | code audit 2026-07-14; spec parity/p-plugins.spec.ts pending | 5/9 connectors are stdio (dead in Lambda); `github`+`postgres` advertise servers that DON'T EXIST in servers/; `knowledge-core` → 127.0.0.1:7979; `sharepoint` → mcp.slack.com with SLACK_TOKEN cred key (copy-paste bug, connectors.json:181,190) |
| P2 | remote streamable-HTTP MCP add → tools → invoke, DEPLOYED | 🔴 | spec written (mock on :7983) | add-by-URL UI EXISTS (CustomServerModal + addCustom, urlAllowed). Local run pending; deployed test needs a public mock (urlAllowed blocks RFC1918; loopback useless in Lambda) |
| P3 | bundled servers rehosted or marked local-dev-only | 🔴 | code audit 2026-07-14 | filesystem/memory/sqlite = stdio + better-sqlite3 over /tmp SQLite — disjoint from DynamoDB data; chat.ts already hides memory/sqlite as "shadow" connectors writing to a dead DB |
| P4 | per-server toggles per chat | 🔴 | code audit 2026-07-14 | per-PROJECT toggles exist (enabled_projects, enforced in toolsForProject + callTool); per-chat granularity absent |
| P5 | credentials: stored encrypted, never echoed | 🔴 | code audit 2026-07-14; spec pending | AES-256-GCM, write-only API, never echoed (good) — but key + ciphertexts live under /tmp in Lambda: every cold start regenerates the key, orphaning stored creds; remote connectors then connect tokenless SILENTLY |
| P6 | tool-loop robustness: error/timeout/mid-call kill | 🔴 | code audit 2026-07-14; spec pending | MCP calls: 30s timeout + error-string-to-model (good). Native tools (web/read_document) have NO timeout wrapper. Mid-call kill test pending |

## 5 · Conversation core

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| V1 | context management: summarize-and-archive, 60+ turns | 🔴 | spec parity/v1.spec.ts pending | BETTER than assumed: rolling LLM summary EXISTS (context.ts — 12-msg window + 24k char budget + summary at ≥6 uncovered, persisted convsum:<id>). No token counting anywhere (char-based). 30-turn recall test pending |
| V2 | thinking blocks persist + collapsible in history | 🔴 | code audit 2026-07-14 | never persisted — chat.ts saves only {text,toolCalls}; client renders thinking for live stream only |
| V3 | edit prior message → branch/replace-forward | 🔴 | spec parity/v3-v6.spec.ts pending | shipped behavior = replace-forward truncation (documented, acceptable per spec); indicator exists |
| V4 | regenerate | 🔴 | — | not yet audited |
| V5 | stop keeps partial (incl. mid-tool-call) | 🔴 | — | not yet audited |
| V6 | copy message | 🔴 | — | not yet audited |
| V7 | chat share link, revocable snapshot | 🔴 | code audit 2026-07-14 | no conversation-share route exists (artifact share does, 7-day presigned) |
| V8 | export: single (md+json) + all (zip) | 🔴 | code audit 2026-07-14 | single-conversation MD export EXISTS (conversations.ts:120); json + all-zip absent |
| V9 | rename / search / bulk delete + eval teardown | 🔴 | — | not yet audited |
| V10 | feedback thumbs persist | 🔴 | — | not yet audited |
| V11 | suggested prompts | 🔴 | — | not yet audited |
| V12 | new-chat affordances | 🔴 | — | not yet audited |

## 6 · Web search & citations

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| W1 | search reliability ≥9/10 varied queries | 🔴 | scripts/test/parity-w1-search.ts 7/10 2026-07-14 | DDG scrape returned 0 urls on 3/10 queries (satisfies-operator, CloudFront-timeout, soffice-convert) — the known fragility, confirmed |
| W2 | inline citations on search-grounded answers | 🔴 | — | not yet audited |
| W3 | URL fetch → grounded answer with citation | 🔴 | — | not yet audited |
| W4 | per-chat search toggle removes tools | 🔴 | code audit 2026-07-14; spec pending | toggle exists but is GLOBAL (settings key webSearchEnabled) despite living in the composer — flipping it changes every chat |

## 7 · Memory & projects

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| M1 | recall e2e vs DEPLOYED stack | 🔴 | memory-eval (ported) — local 13/14, DEPLOYED 10/14, 2026-07-14 | eval ported off SQLite introspection to behavioral JIT-flush check (passes both envs). DEPLOYED failures: paraphrase dedup (two keys persist: deploy_target + deployment_platform), contradiction supersede (value stays Fargate), forget leaves a layer (fails locally too). Historical "14/14" not reproducible |
| M2 | project isolation vs DEPLOYED stack | 🟢 | scripts/test/parity-m2-isolation.ts 8/8 DEPLOYED 2026-07-14 | new API-level harness (old stage-2 gate is SQLite-bound, kept as historical). Conversation/artifact scoping + memory-recall isolation + cross-project chat probe all hold on DynamoDB/S3 Vectors |
| M3 | remember/forget tools | 🟡 | memory-eval §4-5, both envs 2026-07-14 | remember: tool fires + fact stores + recalls (✓✓ both envs). forget: tool fires but a storage layer keeps the fact (✗ both envs) — partial |
| M4 | memory modal browse/edit | 🔴 | — | not yet audited |
| M5 | deletion propagation: purge derived facts+vectors | 🔴 | — | not yet audited; suspected gap |
| M6 | knowledge citations as rendered chips | 🔴 | — | not yet audited |
| M7 | project instructions honored | 🔴 | — | not yet audited |
| M8 | knowledge upload + RAG page-7 spot check | 🔴 | — | not yet audited |
| M9 | incognito: zero persistence, banner | 🔴 | — | not yet audited |

## 8 · Styles, settings, polish

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| X1 | styles: presets + custom-from-sample, per chat | 🔴 | code audit 2026-07-14 | absent entirely; only project instructions exist |
| X2 | global preferences injected | 🔴 | spec pending | userName setting exists and is exposed; injection into the prompt unverified |
| X3 | markdown torture test (tables, LaTeX, code+copy) | 🔴 | — | not yet audited |
| X4 | streaming: slow-conn, heartbeat, tab-close abort | 🔴 | — | not yet audited |
| X5 | error recovery: mid-stream kill → retry affordance | 🔴 | — | not yet audited |
| X6 | voice dictation (Web Speech, graceful hide) | 🔴 | code audit 2026-07-14 | mic button confirmed decorative — no onClick, no speech API usage anywhere |
| X7 | artifacts gallery cross-chat | 🔴 | code audit 2026-07-14 | no surface; API /artifacts already returns the cross-chat list, so this is UI-only |
| X8 | mobile layout | 🔴 | — | not yet audited |
| X9 | light theme | 🔴 | — | not yet audited |
| X10 | keyboard: Enter/Shift-Enter, Cmd-K, Esc | 🔴 | — | not yet audited |

## Audit log

- 2026-07-14 · matrix created; all 67 rows RED pending Phase A audit. Fixtures generated and property-verified (12-page PDF, zero-text scanned PDF, formula xlsx, 1200-row CSV with mean 14.87).
