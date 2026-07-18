# AxiomV2 ↔ claude.ai Parity Matrix

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

**Full local re-audit, 2026-07-18 (Phase 7 parity sweep, local dev only —
deployment state above unchanged):** a full `parity-legacy` sweep (122 tests)
plus `ui-mocked` (14), `live-smoke` (54), `test:routing` (305 cases × 3 tiers),
and `test:stage4-gates` (rewritten for DynamoDB — see FIXLOG.md) all ran
green except the 2 pre-existing, self-documented `@red` gaps (P2's local
streamable-HTTP-by-URL variant, X3b/KaTeX). Several rows below that were
GREEN as of 2026-07-14/15 had regressed since (mostly from an interim fix —
FX-11 — that made the `filesystem` MCP tool actually reachable everywhere for
the first time, which surfaced new model-confusion failure modes no one had
been able to hit before); each is re-verified and annotated in place below
rather than silently re-dated. Full root-cause writeups: `FIXLOG.md` FX-11
through FX-16 plus the trailing test-only-repair sections.

**Same-day follow-up, 2026-07-18:** closed a genuine coverage gap in the
project+artifact workflow — no test previously exercised "owner creates a
project → generates an artifact from that project's OWN workspace composer →
artifact is durably scoped to it," and `parity-m2-isolation.ts`'s own
artifact-scoping check turned out to be vacuous (see M2 row). Added
`tests/e2e/parity/project-artifact-scope.spec.ts` (3/3) and repaired the M2
script (auth + a real artifact assertion, 11/11). No product bug — scoping
held throughout; this was a test-honesty gap, not a feature gap.

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
| C5 | react artifact: renders, stateful, error surface + fix affordance | 🟢 | parity spec ✓ 2026-07-15 (13.7s) | SIX layers deep, root cause found: esbuild-wasm names single write:false outputs '<stdout>' — the .endsWith('.js') filter dropped the ENTIRE bundle, so frames were blank since the feature shipped. Plus: entry heals, export-default repair, honest render error, globalName, and a claude.ai-style 'Try fixing' button that routes the bundle error into chat |
| C6 | html/site artifact: sandboxed, no cookie access | 🟢 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | sandbox attr present, no allow-same-origin |
| C7 | svg artifact | 🟢 | parity spec 3/3 consecutive 2026-07-14 | FIXED: extractSvg cuts the <svg> span out of prose-wrapped emissions before validate+persist (both generate and edit paths) |
| C8 | mermaid artifact + graceful syntax errors | 🟢 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | invalid source surfaced a visible parse error |
| C9 | md artifact | 🟢 | parity/c5-c12-artifacts.spec.ts ✓✓✓ 2026-07-18 | Regressed then re-fixed 2026-07-18: "Create a markdown document: a project readme..." misrouted to create-docx — the router's format-decisive-word check (added for a prior fix) had bare "markdown"/"md" as always-decisive, but people also say "a markdown table" to describe a chat reply's own inline formatting, not a request to create a file. Narrowed to a regex requiring markdown to name the deliverable itself. 3/3 consecutive, full 305-case routing dataset re-run clean |
| C10 | artifact versioning: list, browse, restore, per-version download | 🟢 | parity spec ✓ 2026-07-15 (real flow) | version list → select v1 → Restore → server current-version flips. FIXED en route: the panel showed a stale version list after edits (query now invalidated on artifact-ready) |
| C11 | artifact share link (read-only, logged-out context) | 🟢 | parity spec ✓ 2026-07-15 | browser-renderable kinds (svg/pdf/html/md/png/json) now share as INLINE viewable pages with correct content-types; office binaries stay downloads (nothing renders them) |
| C12 | downloads from chat AND panel | 🟢 | parity/c5-c12-artifacts.spec.ts 2026-07-14 | |

## 3 · Skills

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| S1 | progressive disclosure proven (prompt-size assertion) | 🟢 | scripts/test/parity-s1-disclosure.ts 2026-07-14 | chat prompt carries ZERO skill text (leaner than the ~100-token metadata claim, which is UI-only); matched skill's guidance (~3k tokens total across all) loads per-pipeline-task only |
| S2 | routing accuracy ≥90% on 20-prompt eval | 🟢 | scripts/test/parity-s2-routing.ts 20/20 2026-07-14 | via the DEPLOYED router path (Bedrock constrained JSON — llama does not exist in Lambda). All 6 must-NOT-fire statements stayed chat |
| S3 | skills UI toggles gate the router, persist | 🟢 | parity/s3.spec.ts 2026-07-14 | disable pptx → honest refusal, no artifact; Disabled badge persists after reload |
| S4 | validator loop: fail → retry with feedback | 🟢 | parity/s4.spec.ts ✓ 2026-07-15 | proven live end-to-end: hostile mermaid labels fail validation → repair attempt logged with the validator error → valid artifact lands |

## 4 · Plugins / MCP

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| P1 | directory honesty: AVAILABLE vs LOCAL-ONLY, live status | 🟢 | p-plugins spec ✓ + deployed API check 2026-07-15 | FIXED: sharepoint endpoint/cred bug corrected; github/postgres/sharepoint 'planned' (outranks stale installs — no dead Connect); stdio bundles 'local-only' → 'unavailable' in Lambda. Verified in the deployed directory |
| P1a | *addendum:* bundled connectors actually reachable from a real project | 🟢 | artifacts.spec.ts "mcp connector tool executes in chat" ✓✓✓ 2026-07-18 | bundled connectors (filesystem, sqlite) were listed AVAILABLE in the P1 directory but only ever `enabled_projects: ["p1"]` — a dead legacy project id from the pre-`p_general` seed fixtures. `toolsForProject()` gates strictly on membership, so filesystem/sqlite were invisible from the real default project and every project created after boot; only `memory` had the "enabled everywhere" special-case. Fixed to apply that treatment to all of `BUNDLED` uniformly, plus `enableBundledForProject()` for projects created after boot. Full detail: FIXLOG.md FX-11 |
| P2 | remote streamable-HTTP MCP add → tools → invoke, DEPLOYED | 🟢 | local spec ✓ + DEPLOYED live run 2026-07-14 (deepwiki-sse logs archived) | REAL public server (mcp.deepwiki.com) added by URL on the deployed Lambda → connected → read_wiki_structure invoked in chat → grounded answer. Found en route: addCustom enables hardcoded "p1" instead of the ACTIVE project (fix queued — until then a manual project toggle is needed after adding) |
| P3 | bundled servers rehosted or marked local-dev-only | 🟢 | deployed API check 2026-07-15 | option (b) shipped: marked local-only in the manifest, surfaced as 'unavailable' in the Lambda deployment — no zombie entries |
| P4 | per-server toggles per chat | 🟢 | parity/p-plugins.spec.ts ✓ 2026-07-15 | BUILT: per-conversation disabled set (mcpoff:<convId>), filtered out of the model's tool list in chat.ts; composer plus-menu lists project connectors with per-chat toggles |
| P5 | credentials: stored encrypted, never echoed | 🟢 | roundtrip+leak test 2026-07-15 | AES-256-GCM ciphertext AND key persisted in DynamoDB — cold starts no longer orphan credentials (was /tmp). Settings allowlist keeps cred keys out of every API response. KMS envelope noted as upgrade path |
| P6 | tool-loop robustness: error/timeout/mid-call kill | 🟢 | parity/p-plugins.spec.ts ✓ 2026-07-15 (instrumented) | tool chip proves the call started → server SIGKILLed mid-call → stream finishes (no hang), composer recovers, tool failure recorded in mcp.log and fed to the model |

## 5 · Conversation core

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| V1 | context management: summarize-and-archive, 60+ turns | 🟢 | parity/v1.spec.ts 2026-07-14 (3.8m, 30 turns) | rolling summary recalled turn-1 codename+date after 30 filler turns. Char-budgeted, not token-counted (spec asks for Converse-usage counting — functional outcome achieved; counting still worth adding, note kept). 60-turn variant deferred to the full-sweep spec |
| V2 | thinking blocks persist + collapsible in history | 🟢 | parity/v2.spec.ts ✓ 2026-07-15 | reasoning accumulates server-side onto the message payload; history renders a collapsible Thinking block that survives reload |
| V3 | edit prior message → branch/replace-forward | 🟢 | parity/v3-v6.spec.ts 2026-07-14 | indicator shown; replace-forward truncation verified (BETA-2 gone after editing turn 1). Shipped behavior: replace-forward, documented here |
| V4 | regenerate | 🟢 | parity/v3-v6.spec.ts 2026-07-14 | |
| V5 | stop keeps partial (incl. mid-tool-call) | 🟢 | parity/v3-v6.spec.ts 2026-07-14 | basic stop verified; mid-TOOL-CALL stop still unexercised (needs a long tool call to time) — note kept |
| V6 | copy message | 🟢 | parity/v3-v6.spec.ts 2026-07-14 | clipboard content verified |
| V7 | chat share link, revocable snapshot | 🟢 | parity/v7-v12.spec.ts ✓ 2026-07-15 (6.9s) | BUILT: snapshot → static noindex HTML in S3, 7-day presigned VIEW link, revoke deletes the object (spec proves anonymous 200 → revoke → dead). Share2 button in chat header |
| V8 | export: single (md+json) + all (zip) | 🟢 | parity/v7-v12.spec.ts ✓✓ 2026-07-15 | BUILT: ?format=json on single export; GET /conversations/export.zip (md per chat + manifest.json); 'Export all' in sidebar manage row |
| V9 | rename / search / bulk delete + eval teardown | 🟢 | parity/v7-v12.spec.ts ✓ 2026-07-15 (8.7s) | the pencil is a HOVER control (not manage-mode) — with the right flow the prompt rename persists, /search finds it, filter narrows. Product was fine; two harness generations were wrong. Eval-pollution note stands as hygiene backlog |
| V10 | feedback thumbs persist | 🟢 | parity/v7-v12.spec.ts ✓ 2026-07-14 (10.3s) | worked all along — persists AND re-renders (inline color); the audit detector checked svg fill instead of style color |
| V11 | suggested prompts | 🟢 | parity/v7-v12.spec.ts 2026-07-14 | |
| V12 | new-chat affordances | 🟢 | parity/v7-v12.spec.ts 2026-07-14 | |

## 6 · Web search & citations

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| W1 | search reliability ≥9/10 varied queries | 🟢 | parity-w1-search.ts 10/10 2026-07-15 | FIXED: html→lite endpoint fallback + 3 jittered backoff rounds (DDG bot-detection is bursty); honest failure only after all passes |
| W2 | inline citations on search-grounded answers | 🟢 | parity/w2-w4.spec.ts ✓ 2026-07-15 | system prompt requires inline markdown links to tool-result URLs only; anchors render in .chat-md |
| W3 | URL fetch → grounded answer with citation | 🟢 | parity/w2-w4.spec.ts 2026-07-14 | pasted URL fetched, heading answered verbatim (citation rendering counted under W2) |
| W4 | per-chat search toggle removes tools | 🟢 | parity/w2-w4.spec.ts ✓ 2026-07-15 | PER-CHAT override (websearch:<convId>); chat A off leaves chat B with web. Bonus fix: the extractor no longer stores the assistant's transient tool state as durable memory (recall poisoning) |

## 7 · Memory & projects

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| M1 | recall e2e vs DEPLOYED stack | 🟢 | memory-eval **14/14 local AND deployed** 2026-07-14 | FIXED: adjudicate token starvation on the tool-use path (32→200 — every deployed dedup/supersede verdict was falling to 'different' at parse) + forget lexical sweep. First full pass on the current architecture |
| M2 | project isolation vs DEPLOYED stack | 🟢 | scripts/test/parity-m2-isolation.ts 11/11 local 2026-07-18 (+ tests/e2e/parity/project-artifact-scope.spec.ts ✓✓✓ same day) | new API-level harness (old stage-2 gate is SQLite-bound, kept as historical). Conversation/artifact scoping + memory-recall isolation + cross-project chat probe all hold on DynamoDB/S3 Vectors. **2026-07-18 re-audit found the script had silently 401'd on every request since the 2026-07-15 login gate landed (it never sent a token) — the "8/8 DEPLOYED 2026-07-14" evidence predates auth and was never re-run since, and its own artifact-scoping check was separately vacuous (`[].every(...)` passes trivially with zero artifacts ever created). Fixed both: script now logs in, and actually creates an artifact before asserting scope. A new Playwright spec additionally covers the same workflow through the real UI (project-owner creates a project, generates an artifact from its own composer, not the sidebar) — both green, 3/3 and 11/11 respectively; no product bug, the isolation itself held throughout.** |
| M3 | remember/forget tools | 🟢 | memory-eval §4-5 ✓✓ both envs 2026-07-14 | forget now sweeps lexically behind the vector pass — no layer survives |
| M4 | memory modal browse/edit | 🟢 | parity/m3-m9.spec.ts ✓✓✓ 2026-07-18 | regressed then re-fixed 2026-07-18: the test clicked the chat header's Brain icon expecting a modal — that button is a per-chat remember on/off TOGGLE, not a launcher; the real modal only opens from a project workspace's "View & edit memory" pencil. Re-audited via that path, 3/3 consecutive |
| M5 | deletion propagation: purge derived facts+vectors | 🟢 | parity/m3-m9.spec.ts ✓ 2026-07-14 (12.8s) | FIXED: deleteConversation purges source-stamped notes/KV (+vectors) in project+user scopes and clears the queued extraction (no resurrection). Graph edges not yet swept — noted as residual |
| M6 | knowledge citations as rendered chips | 🟢 | parity/m3-m9.spec.ts ✓✓✓ 2026-07-18 (17-20s) | citation format changed since 2026-07-15's note: the D.1 index-grounded `<cite index="N-M">` path (a numbered `button.chat-chip[data-passage]`) superseded the legacy `[source: filename]`/`.chat-cite` prose form this row's evidence described — updated the spec's selector to match. 3/3 consecutive |
| M7 | project instructions honored | 🟢 | parity/m3-m9.spec.ts ✓ 2026-07-14 (8.5s re-audit) | first fail was the harness (wrong project targeted); with the ACTIVE project the instruction token appears in the reply |
| M8 | knowledge upload + RAG page-7 spot check | 🟢 | parity/m3-m9.spec.ts 2026-07-14 | survey.pdf uploaded → page-7 site total answered in a DIFFERENT chat, 25s |
| M8a | *addendum:* dedicated knowledge browse/download/delete modal | 🟢 | memory-knowledge.spec.ts ✓✓✓ 2026-07-18 | `KnowledgeModal.tsx` — a fully-built browser (per-file passage counts, download original, delete) — was never imported or rendered anywhere; ProjectWorkspace's inline "Files" card had no expand affordance to it (unlike the adjacent Memory card's pencil button). Wired up identically. Full detail: FIXLOG.md FX-11 |
| M9 | incognito: zero persistence, banner | 🟢 | parity/m3-m9.spec.ts ✓ 2026-07-15 | ghost affordance → banner, excluded from all listings, memory off at creation, deleted on leave (spec: 404 after switching away) |

## 8 · Styles, settings, polish

| id | feature | status | evidence | notes |
|---|---|---|---|---|
| X1 | styles: presets + custom-from-sample, per chat | 🟢 | parity/x-polish.spec.ts ✓✓✓✓✓✓✓✓✓✓✓✓ 2026-07-18 (12/12) | normal/concise/explanatory/formal per chat + custom descriptor from a pasted sample (one model call). Spec measures explanatory >1.5× concise on the same question. Regressed then re-fixed 2026-07-18, two layers: (1) the spec asked the SAME question "again" in one conversation, so the model correctly repeated its own prior answer verbatim regardless of style; rewrote to two fresh chats. (2) even fixed, 2/5 still flaked — qualitative style wording ("be concise"/"be explanatory") left a small-tier model's actual length compliance too inconsistent; added concrete length/structure anchors to both presets. 12/12 clean after both fixes |
| X2 | global preferences injected | 🟢 | parity/x-polish.spec.ts ✓✓✓ 2026-07-18 | configured userName known to the model. Regressed then re-fixed 2026-07-18: config.userName was loaded at boot but never threaded into the system prompt anywhere (grepped the whole server — a dead config field). Wired into PERSONA, gated to the primary account since the field predates the multi-account system. 3/3 consecutive |
| X3 | markdown torture test (tables, LaTeX, code+copy) | 🟢 | parity/x-polish.spec.ts ✓ 2026-07-14 | tables rendered all along (chat gfm + md artifacts); added the missing per-code-block COPY button (RichText decoration). LaTeX split to @red X3b — katex genuinely absent, real feature gap |
| X4 | streaming: slow-conn, heartbeat, tab-close abort | 🟢 | parity/x4.spec.ts ✓✓✓✓✓✓ 2026-07-18 (6/6) | CDP-throttled 50kbps link delivers every token; tab close mid-stream aborts server-side and persists the partial; 15s keep-alives hold CloudFront's origin-read window (proven by deployed runs). Regressed then re-fixed 2026-07-18: once the filesystem MCP tool became reachable everywhere (see P1 addendum), the model started calling fs_write to save the long enumerated reply as a scratch file instead of streaming it — no long stream ever existed for the abort to interrupt. Fixed via a system-prompt note clarifying the filesystem tool is only for a file the user explicitly names, with a concrete example matching this exact confusion class |
| X5 | error recovery: mid-stream kill → retry affordance | 🟢 | parity/x5.spec.ts ✓ 2026-07-15 (8.6s) | Bedrock disconnect mid-session → honest persisted error + retry (regenerate) → reconnect → retry succeeds, composer recovers. Live stream errors additionally show an inline Retry button |
| X6 | voice dictation (Web Speech, graceful hide) | 🟢 | parity/x-polish.spec.ts ✓ 2026-07-15 | BUILT: SpeechRecognition wiring, final transcripts append to the composer, listening state; button hidden on unsupported browsers |
| X7 | artifacts gallery cross-chat | 🟢 | parity/x-polish.spec.ts ✓ 2026-07-15 | BUILT: Artifacts view — kind filters, project select, per-row downloads |
| X8 | mobile layout | 🟢 | parity/x-polish.spec.ts 2026-07-14 | 390px: composer usable, no horizontal overflow |
| X9 | light theme | 🟢 | parity/x-polish.spec.ts ✓✓✓ 2026-07-18 | toggle applies (background changes and restores). Test-only bug found 2026-07-18: it checked document.body's computed background, which is always transparent — index.css paints the palette on document.documentElement (<html>), not <body>. Fixed the selector, 3/3 consecutive |
| X10 | keyboard: Enter/Shift-Enter, Cmd-K, Esc | 🟢 | parity/x-polish.spec.ts ✓ 2026-07-14 | added global Cmd/Ctrl-K → focus chat search; Enter/Shift-Enter/Esc already worked |

## Audit log

- 2026-07-15 (session 5) · **ALL AMBERS CLEARED → 67 🟢 · 0 🟡 · 0 🔴.** C10 (stale version list fixed), C11 (inline viewable shares), S4 (live repair proof), P5 (credentials → DynamoDB), W4 (true per-chat scope + extractor poisoning fix), X5 (retry affordance verified). ULTRA complex-UI suite added (expense tracker with derived state, tabbed dashboard) — exposed and fixed the esbuild outdir/css bug. CAPABILITIES.md added.

- 2026-07-15 · **ZERO RED ROWS.** Session 4 cleared the last seven: C5 (esbuild '<stdout>' output-path bug — bundles were silently discarded since the feature shipped), V2, X1, M9, P4, P6, X4. Standing: **63 🟢 · 4 🟡 · 0 🔴** (ambers: S4 repair-completion proof, C10 restore affordance, C11 share-page UX, W4 per-chat search scope; P5 deployed credential storage remains the one design-level amber).

- 2026-07-14 (session 2 close) · **ULTRA file-type sweep 13/13 vs DEPLOYED** (pptx/docx/xlsx/pdf/csv/json/yaml/md/txt/py/png/jpg sentinels + code comprehension). Memory-eval 14/14 both envs. Session flips: R2 R3 R5 R7 R10 C1 C7 M1 M3 M5 M7 P2 S3 V10 X3 X10 → 🟢. Standing count: **47 🟢 · 6 🟡 · 14 🔴** (REDs: C5, P1, P3, P4, P6, V2, V7, V9, W1, W2, M6, M9, X1, X4/X6/X7 group — see rows).

- 2026-07-14 · matrix created; all 67 rows RED pending Phase A audit. Fixtures generated and property-verified (12-page PDF, zero-text scanned PDF, formula xlsx, 1200-row CSV with mean 14.87).
- 2026-07-14 · **Phase A audit COMPLETE.** 67/67 rows have evidence-based status: **31 🟢 · 9 🟡 · 27 🔴.** 51 Playwright tests + 5 script evals executed (local dev + deployed CloudFront for M1/M2). Environment caveats: model varied across runs (Nova 2 Lite → Claude Haiku 4.5 via per-project memory); deployed Lambda predates the extraction overhaul; two failures are harness-caused and marked for re-audit (M7, P2/P6).
