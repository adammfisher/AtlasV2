# ATLAS V2 — MASTER TEST PLAN

Status: **Phase 0 draft — awaiting user GO at the Phase 0 gate.**
Author: automated test-engineering session, 2026-07-17.
Companion docs: `FIXLOG.md` (created in Phase 1, one entry per defect), `PARITY-COVERAGE.md` (Phase 7).

---

## 1. What exists today (survey results)

### 1.1 System shape (verified, not assumed)

- **Backend** `server/src` (~14k LOC TS): Express on **:5175** locally, Lambda (`atlasv2-app`, nodejs20 arm64, timeout **900s**, LWA `RESPONSE_STREAM`) behind CloudFront (**`origin_read_timeout=120s`** — see P0 hypotheses). Storage is **DynamoDB everywhere** (single table `atlasv2-app`, account-prefixed partitions) + S3 (`atlasv2-artifacts-*`, `atlasv2-uploads-*`) + S3 Vectors — **there is no local SQLite**; local dev uses the `default` AWS profile against real AWS. `better-sqlite3` is a dead dependency.
- **Inference**: Bedrock Converse/ConverseStream only. `models.config.json`: small=**Nova 2 Lite**, mid=**Haiku 4.5** (default), frontier=**Sonnet 4.6** — **not Sonnet 5** (AWS quota-blocked; config comment says swap when cleared). Office/product generation always substitutes Claude (Haiku, or Sonnet if explicitly selected) via `officeGenerationModel()`.
- **SSE protocol** (server → client, `routes/chat.ts`): named events `step`, `route`, `token`, `thinking`, `tool`, `citations`, `error`, **`done {messageId}`**, `pipeline {phase:start|end}`, `gen {reset|delta,label}`, `artifact {artifactId,name,kind,meta,ver}`, `assistant_text`; `: keep-alive` comment every 15s. **The client (`client/src/lib/sse.ts`) ignores `done` and treats reader-close as completion** — load-bearing for Priority Zero.
- **Router**: 3 stages in `pipeline/router.ts` (deterministic pre-router → constrained-JSON LLM classify over ≤6 candidates → tier escalation ≥0.75 conf, clarify <0.5). 35 workflows in `pipeline/workflows.ts`. Decisions logged to `dataDir/logs/pipeline.log` (`route stage=… chosen=…`) — tests can assert routing from logs without inference.
- **Edit-state reinjection**: `pipeline/artifactContext.ts` — `<current_artifact>` wrapper + edit contract; `requireEditState()` throws typed `OrchestrationError` when state is unavailable (chat turns it into a clarifying question, never a description).
- **Design gate**: deterministic Python (`scripts/office/validate_common.py: visual_gate_pptx` — WCAG contrast 4.5/3.0 unrounded, metric-based overflow, collisions, margins, placeholder scan, ≤2 fonts, word caps) wired into a fix-and-rebuild loop in `orchestrator.ts` (deterministic trim → rebuild ≤4 passes → slide-drop salvage → hard `PipelineError`).
- **Memory**: `memory/engine.ts` — user + project scopes, remember/forget tools, S3 Vectors recall, relevance gate, debounced extraction with a durable queue; forbidden-phrase scanner in `memory/narration.ts` (13 regexes, `findNarration` for evals / `scanForNarration` advisory in prod).
- **Citations**: grounded by construction — `tools/sources.ts` SourceRegistry assigns doc/sentence indices at tool-execution time; `tools/citations.ts parseCitations()` drops any `<cite>` whose index doesn't resolve (logs `CITE_INVALID`).
- **Artifacts**: DynamoDB rows + files under `dataDir/artifacts/<project>/<artifact>/v<N>/`, mirrored to S3, hydrate-on-read; version = max+1; restore = pointer move. Client renders react/site/svg/mermaid/md in a **blob-URL iframe** `sandbox="allow-scripts"` (Playwright `frameLocator` applies); office kinds via soffice-rendered PDF iframe or structured extraction fallback.

### 1.2 Existing tests & evals (full inventory)

Deterministic (no model, no server): `test:behavior-block`, `orchestration/det-check.ts`, `stage1-smoke.ts`, `heal-check.ts`, `salvage-check.ts`, `parity-s1-disclosure.ts`, `test:design` (python venv + git archive).
Live model, no server: `test:pipeline-validity`, `test:routing` (305-case dataset × 3 tiers), `test:e2e-brain` (31 checks), `test:polish` (~175 Bedrock calls, deliverables A–F), plus one-off orchestration checks (`ceiling-check`, `truncation-check`, `pptx-e2e`, `react-plain-check`, `office-model-check`, untracked `gen15.ts`).
Live + dev server: `test:memory-eval` (8 scenarios, sandbox project p3), `test:stage4-gates` (deterministic, DynamoDB), `test:stage4-smoke` (10 tool prompts), `test:stage3-e2e` (9-skill artifact e2e), `test:isolation` (**stale — SQLite-bound, cannot pass against DynamoDB; superseded by `parity-m2-isolation.ts`**), `scenarios.ts`/`scenarios2.ts` (58 checks, not npm-wired).
Playwright: `tests/e2e/` — **~111 tests / 39 files** (33 parity spec files ≈89 tests + 6 top-level files = 22 tests, of which the 6 top-level are flagged stale by PARITY-LOOP-LOG). Config: workers=1, retries=0, 240s timeout, global-setup logs in as the primary account, `ATLAS_BASE` switches local/deployed. **Selectors are text/DOM-based — no `data-testid` anywhere** (documented "phantom locator" flakes).
Mock servers: `mock:kc` (:7979), `mock-connectors.ts` (:7981/2), `parity-mock-mcp.ts` (:7983).

### 1.3 Historical gates (rediscovered, exact)

| Area | Gate | Last recorded result |
|---|---|---|
| Routing (all 3 tiers) | edit-vs-describe **=100%**; unambiguous **≥95%**; overall **≥85%** | small 98.0/100/100 · mid 99.3/100/100 · frontier 99.3/100/100 |
| Edit-contract e2e | G1–G4 = 100% | 31/31 |
| Constrained-JSON validity | office ≥90%, product ≥90% | pass |
| Design eval (18 specs) | every AFTER output passes deterministic gates | BEFORE 2/18 & 85 findings → AFTER 18/18 & 0 |
| Polish A–F | A: 100% casual+decline · B: byte-identical prefix · C: zero forbidden phrases/leaks · D: zero invalid chips · E: cache reads from turn 2 · F: ≥10/12 | 210 checks, 0 failures |
| Memory eval | all scenarios pass (exit 1 otherwise) | pass (matrix cites "14/14"; script has 8 scenarios — see Discrepancies) |
| Parity matrix | row GREEN only with linked passing test | 67🟢 / 0🟡 / 0🔴 (session 5, 2026-07-15) |
| Scenario harness | triage report | 57/58 |

### 1.4 Discrepancies between the command brief and repo reality (flagged per instructions)

1. **The parity matrix has 67 items, not 85.** `Documentation/PARITY_MATRIX.md` — sections R1–R10, C1–C12, S1–S4, P1–P6, V1–V12, W1–W4, M1–M9, X1–X10 = 67 rows, declared "one row per spec item," all currently GREEN. "85" matches the design-eval finding count (DESIGN-LOG "85 → 0"), the likely source of the confusion. **Plan: Phase 7 maps all 67 rows** (plus the A1–A60 visual-contract appendix in `handoffs/PARITY.md` as a secondary checklist). Not reconstructing a phantom 18 extra items.
2. **The ceiling model is Sonnet 4.6, not Sonnet 5.** Bedrock Sonnet 5 quotas are denied for this account (re-probe periodically). All `@ceiling` runs use the frontier tier as configured (`sonnet` = 4.6). When AWS clears Sonnet 5, only `models.config.json` changes.
3. **"14/14 memory eval"**: `memory-eval.ts` runs 8 scenarios with multiple checks each; the historical "14/14" is the parity-matrix M1 citation. The baseline run below records the script's actual output; that number becomes the locked gate.
4. **No `pipeline/{router,orchestrator,...}` mismatches otherwise** — module list in the brief matches reality except `mcp/toolloop.ts` is legacy (only `describeTool` reused) and `site` is not in `skills/registry.ts` (merged with react visually; still a router target and a `skills/site/` contract — tests treat it as a first-class ninth kind).
5. **Nine skills**: registry lists pptx, docx, xlsx, pdf, md, mermaid, svg, react, product; `site` rides the react runtime. The command's nine (with site, without product) and the registry's nine (with product, without site) differ — **the test suite covers all ten kinds**.

### 1.5 Uncommitted work in flight (must not be clobbered; informs P0)

- `server/src/index.ts` + `client/src/lib/api.ts`: coordinated fix — bare 401s no longer tear down the session; only `401 {code:'unauthenticated'}` does. Direct evidence the "reset to login/home" class was already being chased.
- `server/src/providers/bedrock.ts` + `anthropic.ts`: final tool-loop synthesis round made legal (flattened tool blocks / `tool_choice:none`), `MAX_TOOL_ROUNDS=6`.
- `users.config.json`: **invalid JSON right now** (stray `clauds` token, line 7) — verified with `JSON.parse`. Runtime falls back to primary-account-only. Baseline defect #1.
- Untracked `scripts/test/orchestration/gen15.ts`: manual 15-slide generation harness.

---

## 2. Baseline results (run verbatim, Phase 0 — nothing fixed yet)

Deterministic suite (all exit 0, logs in session scratchpad `baseline/`):

| Suite | Result |
|---|---|
| `test:behavior-block` | **PASS** — block v5; small 9379 chars (+cites 10318, examples=true), mid 7616 (+8555), frontier 4285 (+4899) |
| `det-check` | **273/305 Stage-1 deterministic · edit-vs-describe 58/58 · 0 false matches** |
| `stage1-smoke` | **18/18** |
| `heal-check` | **PASS** (3 fixes, col=4, title≤90, stray key dropped, 30 slides) |
| `salvage-check` | **PASS** (dropped 2 broken slides, kept 28) |
| `parity-s1-disclosure` | **GREEN** (chat prompt: zero skill text; per-skill embed only; no bulk load) |
| `users.config.json` parse | **FAIL — SyntaxError line 7 col 81 (`}clauds`)** → baseline defect #1 |

Live/deployed-adjacent suites (all run 2026-07-17 09:21–09:26 against the local dev server + real Bedrock; logs in session scratchpad `baseline/`):

| Suite | Exit | Result (verbatim) | Classification |
|---|---|---|---|
| `test:design` | 0 | **18/18 AFTER outputs pass the deterministic gates** | PASS |
| `test:pipeline-validity` | 1 | office 0/20, product 0/30 — every call `ERROR fetch failed` in <1s | **Harness rot**: never calls `runAsAccount`/`ensureBedrockConnected` (all other live harnesses do) — predates per-account Bedrock; repair in Phase 5 (setup only, assertions untouched) |
| `test:routing` (3 tiers) | 0 | **ALL GATES PASS** — small 98.0% / mid 99.3% / frontier 99.3% overall; **edit-vs-describe 100.0% all tiers**; unambiguous 100.0% all tiers; frontier misses (2): both `[ambiguous]` "help me with this file" / "take care of this file" → `read-summarize-file` instead of clarify | PASS (matches historical) |
| `test:e2e-brain` | 0 | **31/31 ALL PASS** (G1–G4; live G4 md edits differ & version). Noise: `[artifacts] s3 mirror failed: ENOENT … p-brain-e2e/…` on each live case — S3 mirror errors for eval-created artifacts, worth a look in Phase 5 | PASS (with S3-mirror warning) |
| `test:polish` | 1 | **209/210 — GATE B RED**: `FAIL turn 13: what's the difference between HTTP and H: drifted to bullets — confirmed on a second sample`; reminders fired [3,6,…,30]; A 45/0, C 68/0 (0 forbidden phrases, 0 leaks), D 26/0, E 13/0 (cache write 1550 tok turn 1, reads 9/10), F 20/0 | **Real live red** (small-tier drift at margin; historically 38/38) → Phase 5 target |
| `test:stage4-gates` | 1 | `SyntaxError: … does not provide an export named 'getDb'` | **Harness rot** (SQLite retirement) |
| `test:memory-eval` | 1 | `POST /projects/p3/memory/wipe → 401 {"error":"not signed in","code":"unauthenticated"}` | **Harness rot** (predates auth middleware; never logs in) — repair in Phase 4, then lock its scenario count as the legacy gate |
| `test:stage4-smoke` | 0 | **0/10** — every probe 0s, `called [none]`, empty answer (same unauthenticated class; failures swallowed, exit still 0) | **Harness rot** (auth) + harness bug (swallows errors, exits 0) |
| `test:isolation` | 1 | same `getDb` SyntaxError | **Stale by design** — superseded by `parity-m2-isolation.ts` (per PARITY_MATRIX M2) |
| `test:e2e` (Playwright, full) | 1 | **Suite cannot collect** — `artifacts-bulk-delete.spec.ts:26` parses `users.config.json` at module load → SyntaxError aborts the entire run | **Blocked by defect #1** |
| Playwright `tests/e2e/parity` (100 tests) | 1 | **89 passed / 11 failed** (20.8m). Failed: `accounts` (model limits per account — direct consequence of defect #1), `c1-c4-office C4` (pdf create→edit→v2), `c5-c12 C9` (md artifact renders), `m3-m9 M4` (memory modal delete), `m3-m9 M6` (knowledge citation chip), `x-polish X1/X2/X9`, `x4` (**tab close mid-stream: server aborts and persists the partial** — streaming-resilience, P0-adjacent), plus 2 `@red` known gaps (P2 remote MCP, X3b LaTeX) | **9 unexpected reds** vs the 67-GREEN claim of 2026-07-15 |
| Playwright top-level 5 loadable files (21 tests) | 1 | **13 passed / 8 failed** (19.6m). Failed: `artifacts` mermaid create→edit→share, **pptx office build chain produces a downloadable deck (4.0m timeout)**, mcp connector tool in chat; `memory-knowledge` all 3 (remember/forget, modal scopes, knowledge upload+citation); `shell` model menu, theme toggle (4.0m timeout) | Mix of the stale-selector class flagged in PARITY-LOOP-LOG and real breakage; the pptx build-chain and mermaid failures corroborate the user-reported artifact-creation breakage |

**Baseline defect tally:** 1 live product-config defect (`users.config.json` invalid JSON — breaks non-primary accounts, the accounts spec, and full-suite Playwright collection), 1 live eval red (polish B drift, small tier), **17 Playwright reds** (9 unexpected parity + 8 top-level; excludes the 2 `@red` known gaps), 4 rotted harnesses (pipeline-validity, stage4-gates, memory-eval auth, stage4-smoke auth+swallow), 1 deliberately stale suite (isolation), 1 warning (S3 mirror ENOENT during e2e-brain). Core behavior gates — routing, edit-vs-describe, design, citations, cache, memory etiquette — are green at baseline; the breakage concentrates in the **UI/streaming/artifact surface**, consistent with the Priority-Zero report.

Environment at baseline: dev server already running on :5175, healthy, Bedrock connected; AWS identity `adammfisher` @ 683032473658; python venv present (3.13.7).

---

## 3. PRIORITY ZERO — the artifact navigation-reset bug: paper trace & hypotheses

**Symptom (user report):** artifact creation is clunky, and the app returns to the start/home screen before artifact generation completes.

**Traced path:** composer `send()` (`ChatView.tsx:600`) → `postSse('/conversations/:id/messages')` (`lib/sse.ts`) → named-event switch in `ChatView` → `gen` events feed the LivePanel via `App.onGenStream` → `artifact` event opens `ArtifactPanel` → reader close fires `onClose` → invalidate conversation query → `setLive(null)`.

**Two distinct "home screens" exist**, and both are reachable mid-stream:
- (a) ChatView's empty state "What are we building?" — shown when `messages.length === 0 && live === null` (`ChatView.tsx:737`);
- (b) the LoginView — the whole app unmounts when `atlas-unauth` fires (`App.tsx:28-33`).

**Hypotheses, ranked (each becomes a Phase 2 experiment):**

- **H1 — any stream close is treated as success.** `sse.ts` calls `onClose()` on reader-done regardless of whether `done {messageId}` ever arrived; `onClose` clears the live exchange. Any mid-generation connection drop (Lambda/LWA hiccup, CloudFront cut, proxy restart, laptop sleep) silently discards the in-progress exchange; in a new chat nothing is persisted yet, so the view collapses to home state (a). *The client must key completion on the `done` event, and treat close-without-done as an in-place error.*
- **H2 — the 120s CloudFront read-timeout vs long silent phases.** Deployed: CloudFront `origin_read_timeout=120s` vs office builds up to 180s and first-token buffering measured at ~83–93s for large decks. Verified: the 15s keep-alive (`chat.ts:157`) is a `setInterval` from header-flush to socket close, so it spans the whole request **locally**. Remaining deployed-only risk: LWA/Lambda response streaming may buffer or coalesce the `: keep-alive` comment frames so no bytes actually reach CloudFront during a silent phase — Phase 2 verifies against the deployed stack. Either way, any drop is turned into a silent reset by H1.
- **H3 — token TTL / 401 teardown to LoginView.** Sessions expire (12h cookie); health polls every 4s. Pre-fix, ANY 401 (including unhandled route errors mapped to 401) nuked the session mid-generation — this is exactly what the uncommitted `index.ts`/`api.ts` diff addresses. Phase 2 verifies the fix actually covers the streaming path too (`postSse` sends no Authorization header at all — it works only because of the cookie; needs a regression test).
- **H4 — stream lifetime is tied to ChatView's component lifetime.** Switching view (Projects/Artifacts/gallery) unmounts ChatView; the closure keeps consuming but all state updates are no-ops on an unmounted component; returning shows nothing until the persisted refetch. Fix direction per the command: move stream consumption out of the component (module-level stream manager keyed by convId).
- **H5 — new-chat race: conversation created inside `send()` is never promoted to `App.activeConv`.** With `convId===null`, `send()` creates the conversation locally (`ChatView.tsx:617-625`); App still has `activeConv=null`, the messages query stays disabled, and on stream end the view falls back to the empty home state even on success. Also `autoSend` / `newChat` paths race the conv-change effect in `App.tsx:87-96` which force-closes the live panel (`setLiveGen(null)`, `setRightPanel(null)`) on any `effectiveConv` change mid-stream.
- **H6 — mid-stream `error` events are swallowed.** `error` sets `live.error`, but reader close then runs `onClose` → `setLive(null)`, deleting the visible error (the comment at `ChatView.tsx:700-704` documents choosing this to avoid a stuck composer). A0-4 asserts an in-place, persistent error surface.
- **Jank ("clunky")**: every `token`/`gen` delta triggers a React state update + `marked.parse` re-render of the whole growing text + `scrollIntoView` per delta; `gen` deltas additionally re-render the LivePanel. No batching/throttling. A0-5 measures long tasks; fix likely = rAF-batched delta application.

**Fix direction (per command §Phase 2.3):** make stream lifetime independent of component lifetime and key completion on the `done` event — a conversation-keyed stream store outside React, with ChatView subscribing; close-without-done → in-place error + retry affordance, never a state reset.

---

## 4. Test architecture (to build in Phase 1)

Exactly per the command's §4 layout (`tests/unit`, `tests/integration`, `tests/e2e/ui-mocked`, `tests/e2e/live-smoke`, `tests/evals`, `tests/validators`, `tests/fixtures/{sse,files}`, `tests/helpers`), integrated with — not forking — the existing `tests/e2e` parity suite and `scripts/test` eval harnesses. Adjustments grounded in the survey:

- **Playwright projects**: extend the existing root `playwright.config.ts` to three projects — `ui-mocked` (chromium, parallel-safe, all network via recorded fixtures), `live-smoke` (chromium, workers=1, real server+Bedrock Nova 2 Lite structural assertions), `parity-legacy` (the existing 39 spec files, workers=1) — `retries: 0`, `trace/video: retain-on-failure`, reporters `list`+`html`+`junit`. Existing `ATLAS_BASE` convention kept (the command's `ATLAS_BASE_URL` name is NOT introduced; the repo standard is `ATLAS_BASE`).
- **Stream recorder/replayer** (`tests/helpers/sse-record.ts` / `sse-replay.ts`): record one real transcript per skill from the live server (Nova 2 Lite for chat, Haiku for office JSON — the real pipeline), store under `tests/fixtures/sse/<skill>.sse.jsonl` (event, data, dt-ms); replay via `page.route` on `POST */conversations/*/messages` with realistic pacing, `slow=Nx` stretch mode (90s+), `cut@<event|ms>` mode (terminate without `done` — reproduces H1/H2), and `error@` injection (A0-4).
- **Seeding/teardown**: no local DB exists, so per-file DB-prefix isolation is done at the **account layer**: a dedicated `e2etest` account in `users.config.json` gives an isolated DynamoDB partition (`A#e2etest|`) with its own seeded p1/p2/p3; `ui-mocked` needs no backend at all (fixtures include the REST reads); live-smoke conversations are `[e2e]`-marked and swept via the existing `cleanupMarked()` pattern + artifact bulk delete. (Adding the account requires fixing defect #1 first — Phase 1.)
- **`data-testid`**: added across Sidebar/ChatView/composer/ArtifactPanel/LivePanel/ModelMenu/Projects (inert product change, sanctioned by command §2.4); new POMs (`ChatPage`, `ArtifactPanel` via `frameLocator`, `ProjectsPage`, `MemoryPanel`, `ModelPicker`) use them; existing parity helpers keep working untouched.
- **Python validity harness** `tests/validators/validate.py`: one CLI, `validate.py <kind> <file> [--spec spec.json]` → JSON verdict; reuses `scripts/office/validate_common.py` + the installed venv libs (python-pptx/docx/openpyxl/pdfplumber); mermaid via the client's bundled mermaid `parse` in a Node one-shot; react via esbuild + iframe mount in a Playwright scratch page; svg via XML parse + rendered bbox probe. Corrupt-file negative fixtures for each kind gate the harness itself (Phase 1 acceptance).
- **Console/pageerror sentinels**: auto-fixture failing any e2e test on `pageerror` or `console.error` (allowlist: none known yet; any addition must be justified here).
- **Unit runner**: `vitest` for `tests/unit` + `tests/integration` (new devDependency; the repo has no unit runner today — tsx scripts only).

## 5. Test inventory (IDs → phases)

- `A0-1..A0-5` — Priority-Zero regressions (Phase 2; A0-1 spans all nine artifact kinds).
- `A{pptx|docx|xlsx|pdf|md|mermaid|svg|react|site}-{create,edit,version,export,render,update-vs-rewrite}` ≥54 (Phase 3), plus `AX-upload-edit` (docx/xlsx/pdf), `AX-multi`, `AX-design`, and `Aproduct-*` for the tenth kind.
- `M-1..M-20+` memory (Phase 4) + legacy `test:memory-eval` locked at its baseline count; `P-scan` (forbidden-phrase scanner) runs over **every** live response suite-wide.
- `O-*` routing/orchestration units + `E-routing`/`E-e2e-brain`/`E-validity` eval reruns at their historical gates; `P-cache` (byte-identical prefix hash, 10 turns), `P-cite`, `P-format` (Phase 5).
- `S-*` platform surfaces (Phase 6): projects CRUD/scoping, MCP stub lifecycle + failure surfacing, web-search triggering, send/stop/regenerate/edit-message/model-switch/persistence/sidebar, backend-kill error surface (shares the A0-4 sentinel).
- `PAR-<row>` — Phase 7 mapping of all 67 matrix rows to test IDs in `PARITY-COVERAGE.md`.

## 6. Phase schedule & gates

0. **Survey & plan (this doc) — GATE: user approval.**
1. Infrastructure — gate: recorder replays a real pptx transcript deterministically 3×; validators reject corrupted files of every kind; seed/teardown clean; commit.
2. Priority Zero — gate: bug reproduced (live + mocked slow/cut stream), root-caused in FIXLOG, fixed, A0-1..A0-5 pass 3×; commit.
3. Artifact suite — gate: 100% incl. validity harness + edit-vs-describe (zero tolerance, includes the historical "modify my PowerPoint" case).
4. Memory — gate: 100% incl. legacy eval + scanner clean suite-wide.
5. Orchestration/polish — gate: per-tier eval gates (§1.3) green; cache-prefix hash stable; citations index-grounded.
6. Platform surfaces — gate: 100%; no reset-to-home path anywhere.
7. Parity + certification — gate: 67/67 mapped, 2× consecutive clean full runs (incl. `@ceiling` = frontier tier), flake audit, final report.

Cost discipline: bulk live tests on Nova 2 Lite; office generation inherently uses Haiku (pipeline policy); `@ceiling` (Sonnet 4.6) only in the final sweep; token spend printed per live run.

## 7. Open questions for the user (answers wanted with GO, but defaults chosen so work can proceed)

1. **Parity scope**: proceed with the real 67-row matrix (default), or also fold in the A1–A60 visual-contract appendix as automated checks where feasible?
2. **Sonnet ceiling**: `@ceiling` = Sonnet 4.6 today (Sonnet 5 quota-blocked). OK? (Default: yes; swap via config when AWS clears it.)
3. **`users.config.json` defect #1**: fixing invalid JSON is technically a product fix before Phase 2 — planned as the first FIXLOG entry during Phase 1 (it also unblocks the isolated `e2etest` account). Objection?
4. **Live-data blast radius**: live suites run against the shared dev DynamoDB/S3 under the `default` profile as the repo's own tests always have (isolated to the `e2etest` account partition where possible). OK?
5. **`test:isolation`** is retired in place (stale SQLite harness, superseded by `parity-m2-isolation.ts`) — it stays wired but the suite treats `parity-m2` as the real gate. Objection?
