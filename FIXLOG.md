# FIXLOG — every defect: root cause + fix + evidence

Format per entry: symptom → evidence → root cause → why it happened → fix → files changed.
Entries are appended chronologically; IDs are `FX-<n>`.

---

## FX-1 — `users.config.json` invalid JSON silently disables every non-primary account

- **Symptom:** Playwright full suite aborts at collection (`artifacts-bulk-delete.spec.ts:26` SyntaxError); `accounts` parity spec fails (susan/demo/brynn don't exist); any login except the primary account 401s.
- **Evidence:** `node -e "JSON.parse(readFileSync('users.config.json'))"` → `SyntaxError: Expected ',' or ']' after array element in JSON at position 736 (line 7 column 81)`; baseline logs `scratchpad/baseline/playwright.log`, `playwright-parity.log` (accounts spec).
- **Root cause:** a stray token `clauds` was appended after the `brynn` array element (line 7) — an accidental keystroke committed into the working tree during the uncommitted "add brynn" edit. `server/src/lib/account.ts:27-39 accounts()` wraps the parse in try/catch and **silently** degrades to the primary-only FALLBACK list, so the runtime kept working for the primary account and the breakage was invisible until something parsed the file strictly.
- **Why it happened:** hand-edited config with no parse check at edit time, plus a catch-all fallback that hides the failure. (The fallback is correct behavior for resilience; the missing piece is any surfaced signal — noted as a Phase 6 test: broken config must surface a visible warning, and a unit test now locks config validity.)
- **Fix:** removed the stray token. Also added the sanctioned `e2etest` account (isolated DynamoDB partition `A#e2etest|`) used by the new test harness — approved at the Phase 0 gate (open question 3/4).
- **Files changed:** `users.config.json`.
- **Regression lock:** `tests/unit/config.spec.ts` (U-CONF-1) parses `users.config.json` + `models.config.json` + `axiom.config.json` strictly and asserts every account's `models` keys resolve against `models.config.json`.

---

## FX-2 — any stream close was treated as success; stream lifetime tied to component lifetime (PRIORITY ZERO, part 1)

- **Symptom (user report):** the app returns to the start/home screen before artifact generation completes; artifact creation feels clunky.
- **Evidence:** INFRA-2 at Phase 1 (pre-fix, commit ef52d2f): a transcript cut before its `done` event ended the busy state silently with no error — captured trace in test-results. Baseline parity `x4.spec` (streaming resilience) red; top-level `artifacts.spec` pptx build chain timing out at 4m. Server protocol emits a terminal `done {messageId}` event (`server/src/routes/chat.ts`) that the client never consumed.
- **Root cause:** `client/src/lib/sse.ts` fired `onClose()` on ANY reader close and `ChatView.onClose` unconditionally cleared the live exchange (`setLive(null)`). In a conversation with no persisted messages, `empty = messages.length === 0 && live === null` re-rendered the "What are we building?" home state — mid-generation, whenever the connection dropped (network blip, sleep, proxy restart, CloudFront's 120s origin_read_timeout vs 83–93s silent first-token buffering on big decks). Compounding: the SSE consumer lived inside ChatView, so unmounting (view switch) orphaned the stream; and a mid-stream `read()` rejection left the promise unhandled — permanently stuck busy composer.
- **Why it happened:** the happy path (clean close right after `done`) behaves identically to the failure path at the socket level, so the missing `done` check was invisible in normal use; the `setLive(null)`-always was itself a deliberate patch for an earlier stuck-composer bug (comment preserved in git history) that traded one failure mode for a worse one.
- **Fix:** new `client/src/lib/stream.ts` — a module-level, conversation-keyed stream store. Completion is keyed on the `done` event; close-without-done (and mid-stream read rejection, now caught in `sse.ts`) surfaces an in-place "Connection lost" error with retry; the live exchange is cleared only after the refetched conversation actually contains the persisted `messageId`; user aborts keep the old semantics. ChatView renders store state via `useSyncExternalStore` — the stream survives unmount/nav.
- **Files changed:** `client/src/lib/stream.ts` (new), `client/src/lib/sse.ts`, `client/src/views/Chat/ChatView.tsx`, `client/src/App.tsx`.
- **Regression lock:** A0-1 (×9 kinds), A0-2 (3-minute stream), A0-4a/A0-4b (error + cut), A0-L1/A0-L2 (live, incl. genuine network drop), INFRA-1/2.

---

## FX-3 — new-chat send never promoted its conversation (PRIORITY ZERO, part 2)

- **Symptom:** sending from the fresh empty state created the conversation server-side, but on stream end the view collapsed back to the empty home state; the chat only existed in the sidebar.
- **Evidence:** paper trace TESTPLAN §3 H5: `send()` created the conversation locally (`target`) but `App.activeConv` stayed null, so ChatView's conversation query stayed disabled and `messages` stayed [].
- **Root cause:** the created conversation id never left `send()`'s closure — no promotion path to App state existed.
- **Fix:** `onConvCreated` callback: ChatView reports the created id, App adopts it (`setActiveConv`), the URL updates to `/c/<id>`, and the conv-change effect now skips its live-panel reset when the conversation being switched to is actively streaming.
- **Files changed:** `client/src/views/Chat/ChatView.tsx`, `client/src/App.tsx`.
- **Regression lock:** A0-1 runs on fresh conversations (the exchange must remain on screen with the query active); S-phase adds an explicit empty-state→send→URL test.

---

## FX-4 — mid-stream error events were erased by the close handler

- **Symptom:** a pipeline error flashed and vanished; the user saw a silent reset instead of the failure.
- **Root cause:** `error` events set `live.error`, but the unconditional `setLive(null)` on close deleted the visible error a frame later.
- **Fix:** in the store, a close after a server `error` event marks the exchange finished but KEEPS it rendered (error box + retry); the composer unlocks via `finished`, so the old stuck-composer failure cannot return.
- **Files changed:** `client/src/lib/stream.ts` (same change set as FX-2).
- **Regression lock:** A0-4a.

---

## FX-5 — per-chunk synchronous re-render jank ("clunky")

- **Symptom:** the UI stuttered during generation; typing/clicking lagged.
- **Root cause:** every SSE chunk forced a synchronous React state update (hundreds to thousands per generation — site transcript: 1409 gen deltas), each re-parsing the full markdown text and issuing a smooth-scroll `scrollIntoView`.
- **Fix:** store notifications are coalesced to animation frames (≤1 render per frame); autoscroll is bottom-sticky only and uses instant scrolling during streaming.
- **Files changed:** `client/src/lib/stream.ts`, `client/src/views/Chat/ChatView.tsx`.
- **Regression lock:** A0-5 (mid-stream click must respond <1s; long-task counts logged per run).

---

## FX-6 — network drop during create_doc/edit_doc generation silently discarded the assistant's turn forever (PRIORITY ZERO, live-stack finding)

- **Symptom:** discovered while verifying A0-L2 (the live twin of the mocked A0-4b connection-drop test) against the real stack. A0-L2 failed 3× in a row with the poll for "artifact card or persisted message" never resolving — not a slow-but-eventually-correct result, a permanent one: `GET /conversations/:id` showed only the user's message, no assistant response, indefinitely (confirmed with a direct 5-minute API poll, bypassing the browser entirely).
- **Evidence:** a minimal reproduction script (`fetch` the message POST, read two SSE chunks to confirm the router step fired, `controller.abort()` client-side, then poll the conversation API directly) showed 0 assistant messages after 300s. `pipeline.log` confirmed the router decision logged and nothing else — no `json valid`, no `pipeline error`, nothing — for that conversation, ever.
- **Root cause:** `server/src/routes/chat.ts`'s outer `catch` block is the *only* error handler for the `create_doc`/`edit_doc` pipeline (`runCreateDoc`/`runEditDoc`). It gated all persistence — even an honest "generation failed" message — behind `if (!abort.signal.aborted)`. That guard was written for the plain-chat token-stream's semantics ("a Stop click shouldn't get an ugly error appended"), but that case is handled entirely by a *different*, inner try/catch further up (which already preserves partial prose on user-stop and `return`s before ever reaching the outer catch). `res.on('close')` — the only signal available — cannot distinguish a deliberate Stop from a genuine network drop; both set the same `abort.signal.aborted`. When the client disconnects before `runCreateDoc`'s Bedrock call returns, the call rejects (AbortError), propagates out of `runCreateDoc`, lands in the outer catch, and — because the signal is aborted — every branch that would persist a message was skipped. The user's request was answered by nothing, permanently: no error, no retry affordance, nothing to recover on reload.
- **Why it happened:** the happy path (abort landing *after* the model call already returned, e.g. during the office-file build helper or the chat-summary call) doesn't hit this bug, because later pipeline steps either run in a spawned subprocess with its own independent timeout (unaffected by `ctx.signal`) or catch their own errors internally (`summarize()`) — so the pipeline finishes and persists anyway. Only an early disconnect (before the model call returns) hits the silent-discard path, which is exactly the harder-to-notice, worse-timed case: the more of the (slow, expensive) generation already in flight, the more silently it gets thrown away.
- **Fix:** the outer catch now always persists an honest record — `"Generation was interrupted before it finished (connection lost). Send the request again to retry."` on abort, the existing honest error text otherwise — regardless of `abort.signal.aborted`. Only the *live* SSE push (`sse(res, 'error', ...)`) stays conditional on the client still being connected to receive it; the durable DB write never is. The `OrchestrationError` (missing edit-state) branch got the same treatment for consistency.
- **Files changed:** `server/src/routes/chat.ts`.
- **Regression lock:** `A0-L3` (new, API-level, sub-second — reproduces the exact abort-before-model-returns race deterministically without depending on live generation timing); `A0-L2` (live, end-to-end through the real UI, at real generation speed — re-verified 3× after the fix).
- **Separate test-only defect found and fixed during verification (no product change):** `A0-L2` still failed 3× *after* the product fix above, but the evidence changed shape — trace-level network inspection showed `GET /conversations/:id` returning 200 with real content (1506 bytes, stable) within the first reload cycle every time. The test's reload-poll called `page.locator(...).count()` as an instantaneous snapshot immediately after `composer.waitFor()` resolved — but `page.reload()`'s `load` event fires once the static shell (composer included) mounts, *before* the `useQuery(['conversation', convId])` fetch resolves and re-renders. The count checks were racing that async fetch and reading the DOM before React had anything to show. Fixed in `tests/e2e/live-smoke/a0-live.spec.ts` by giving each reload's content check its own bounded `waitFor` instead of an instantaneous count. Re-verified 3× green (55s-1.6m each, down from hitting the full 400s ceiling every time).

---

## FX-7 — deterministic router: generic content-nouns (create-md) outscored decisive format-nouns by raw string length

- **Symptom:** found by Phase 3's `AX-multi` test. "Create a two-page onboarding checklist PDF for new analysts, and briefly tell me what you included" routed to `create-md` instead of `create-pdf` — `stage=deterministic conf=1.00`, so not model nondeterminism. `pipeline.log` showed the identical misroute on an unrelated, earlier "onboarding checklist PDF" prompt too (2026-07-17T13:29:32Z) — reproducible, not a one-off.
- **Root cause:** `matchCreate()` (`server/src/pipeline/router.ts`) scores each candidate workflow by `longestHit()` — the character length of its longest matched trigger noun — and picks the unique max. `create-md`'s `nounObjects` list is the deliberate generic catch-all (`doc, notes, guide, plan, outline, checklist, article, blog post, ...`), by design the broadest and last-priority entry in `CREATE_PRIORITY` ("specific → generic", per its own comment). But raw length scoring ignores that priority order entirely: `'checklist'` (9 chars) beat `'pdf'` (3 chars) from `create-pdf`'s much shorter, genuinely unambiguous noun list, even though "PDF" is the one word in the sentence that actually names a file format.
- **Fix (attempt 1, reverted):** first tried excluding `create-md` from the scoring pool whenever any more-specific workflow also had a hit. This over-corrected: re-running the 305-case dataset surfaced a NEW miss ("compose a long-form blog post about remote work" → `create-react-app` instead of `create-md`, because `hasWord()` treats `-` as a word boundary, so `"form"` — from `create-react-app`'s noun list — spuriously matches inside `"long-form"`; harmless under the original scoring since `create-md`'s longer `'blog post'` match always won regardless, but decisive once `create-md` unconditionally stepped aside for ANY competing hit). Phase 3's own `Amd-create` test then caught a second case of the same over-correction live: "Write a README for..." lost to a genuine (non-substring) `"tool"` match from `create-react-app` inside "CLI tool", even though `"readme"` is a far more decisive word for a README request than the generic `"tool"`.
- **Fix (final):** narrower and more correct — a small explicit set of unambiguous file-format words (`pdf, pptx, powerpoint, docx, xlsx, csv, svg, mmd`) is checked FIRST; if exactly one workflow's noun list claims the matched word, that workflow wins outright regardless of any other noun's length. Everything else falls through UNCHANGED to the original longest-matched-noun scoring — so `"readme"` and `"blog post"` keep winning by length exactly as before (the `hasWord()`/`"long-form"` quirk stays latent and harmless, as it always was; not touched).
- **Files changed:** `server/src/pipeline/router.ts`.
- **Regression lock:** re-ran the full 305-case `test:routing` dataset on all 3 tiers post-fix — every metric matches or exceeds the original baseline, zero new misses (small 98.0%/100%/**100%**, mid 99.3%/100%/**100%**, frontier 99.3%/100%/**100%** — unambiguous class actually improved to 100% on every tier, up from 99.5%). New Phase 3 tests `AX-multi` and `Amd-create` lock both the original bug and the over-correction that would have reintroduced a different one.

---

## FX-8 — office-JSON generation hard-failed on trailing model commentary (unconstrained plain-text path has no defense against it)

- **Symptom:** found by Phase 3's `AX-multi` test, reproduced identically on 2 separate live runs (not a one-off flake). Prompt: "Create a two-page onboarding checklist PDF for new analysts, and briefly tell me what you included." Both times: `Generation failed after repair and salvage: JSON parse failed: Unexpected non-whitespace character after JSON at position 5374 (line 195 column 1)` — the pipeline's own repair (2 attempts) and salvage passes all ran and still failed, because every one of them requires `JSON.parse` to succeed first.
- **Root cause:** office/product JSON generation (`completeJsonOffice` → `bedrockCompleteJson(..., { plain: true })`) always uses `viaPlain()` (`server/src/providers/bedrock.ts`) — raw text streaming, chosen deliberately for smooth live-panel updates, NOT Bedrock's constrained tool-use or json_schema output modes. Nothing structurally stops the model from appending prose after the JSON closes; the system prompt just *asks* for JSON-only. `viaPlain()` only stripped leading/trailing ` ```json ` fences — a trailing sentence with no fence around it (e.g. answering the user's own "...and tell me what you included" verbatim, right after the JSON object) survived straight into `JSON.parse`, which correctly rejects one extra non-whitespace character after a complete, valid value. A request that explicitly invites commentary alongside creation makes this far more likely to trigger — exactly what `AX-multi` exists to probe.
- **Fix:** added `extractJsonValue()` (`server/src/pipeline/validate.ts`) — finds the first balanced top-level JSON object/array in a string (tracking string-literal/escape state so braces inside quoted values don't confuse the depth count) and returns just that span, ignoring anything before or after. `viaPlain()` now runs this after fence-stripping. A genuinely malformed response (no balanced structure at all) still returns the original text unchanged, so `JSON.parse` still reports an honest error rather than this silently masking real breakage.
- **Files changed:** `server/src/pipeline/validate.ts` (new `extractJsonValue`), `server/src/providers/bedrock.ts` (`viaPlain`).
- **Regression lock:** `AX-multi` is the direct reproduction — the same prompt that failed twice now passes 3× consecutively (14.5-15.3s each) after the fix.
