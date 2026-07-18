# BRAIN-LOG — Model-Agnostic Orchestration Brain

Session handoff log for the orchestration-brain build (model-agnostic workflow layer).
Source of truth = the eval matrix (Deliverable E). Evidence over claims.

Tier mapping: small = `nova` (Amazon Nova 2 Lite), mid = `haiku` (Claude Haiku 4.5),
frontier = `sonnet` (Claude Sonnet slot).

---

## PHASE 0 — Assumptions verified (2026-07-15)

Read: router.ts, orchestrator.ts, context.ts, skills.ts, artifacts.ts, projections.ts,
product.ts, validate.ts, skills/registry.ts, mcp/toolloop.ts, memory/engine.ts,
providers/dispatch.ts, providers/bedrock.ts, llama/json.ts, routes/chat.ts, db/appdb.ts,
models.config.json.

### Current routing/edit behaviour (baseline)

- **Router** (`pipeline/router.ts`): single-stage LLM classifier. `route(history, text,
  hasEditableArtifact)` → `{ intent: 'chat'|'create_doc'|'edit_doc', skill: SkillId|null }`.
  Calls `completeJson` (llama/json.ts), which delegates to `dispatch.completeJson` →
  `bedrockCompleteJson` when `cloudReady()`. So the router **already runs on the active
  Bedrock model** in production; the classification *logic* is what's frontier-dependent.
  `edit_doc` downgrades to `create_doc` when `hasEditableArtifact` is false.
- **Edit path** (`orchestrator.ts` `runEditDoc`, live-dispatched from `chat.ts:453`):
  loads prior state via `latestPayload(artifactId)` at `orchestrator.ts:531`, throws
  `PipelineError('no editable payload found…')` if null, and **reinjects the full prior
  JSON payload** into the edit prompt (office: `JSON.stringify(current.payload)`; text
  skills: `current.payload.source`; product: `mergeProductEdit`). It never regenerates
  from scratch and never "describes".
- **Therefore the "modify-my-PPTX-returned-a-description" bug is a ROUTING failure, not an
  edit-execution failure.** It occurs when the classifier labels a modify request as
  `chat`/`create_doc`, or when the edit target (`lastPipelineArtifact`) resolves to null so
  `edit_doc` silently downgrades to `create_doc`. The brain fixes this at the routing layer
  (deterministic Stage 1) + makes the edit path fail LOUDLY (Deliverable D).
- **System prompt** is assembled ad-hoc in `chat.ts:278-300` (a `PERSONA` string + plain-text
  rule lines). `context.ts` `buildContext` only builds history+running-summary; **no XML
  rules block exists today** (Deliverable C adds it).
- `mcp/toolloop.ts` is **dead** (zero importers); the live tool loop is
  `bedrockStreamWithTools` (`MAX_TOOL_ROUNDS = 6`) via `dispatch.streamWithTools`.
- Memory entry points: `rememberFact`, `forgetFact`, `recallContext` (engine.ts), wired in
  chat.ts as the `remember`/`forget` Bedrock tools + recall injection.

### A. Every artifact version stores a retrievable JSON projection/state — **PASS**

`ArtifactVersionRow.payload` (appdb.ts) stores `JSON.stringify(input.payload)` for every
version (`artifacts.ts:60`, `addVersion`). `latestPayload(artifactId)` (`artifacts.ts:73`)
loads + parses the current version's payload. Confirmed per kind:
- office (pptx/docx/xlsx/pdf): payload = the full JSON spec that fed the template.
- md/mermaid/svg: payload = `{ source }` (orchestrator.ts:498,618).
- react/site: payload = `{ files }` file map (orchestrator.ts:99-100, edit reads
  `current.payload.files` at :704-706).
- product: payload = product JSON (merged via `mergeProductEdit`).
No artifact type persists only a rendered binary. **No projection-write fix needed.**

### B. Per-model `structuredOutputs` capability flag — **FIXED (additive)**

Today capability is implicit: `supportsJsonSchema(modelId)` (bedrock.ts:197, regex →
true for Claude ≥4.5, false for Nova/Nemotron) + runtime schema-shape/size gates inside
`bedrockCompleteJson`. There is no declarative per-model flag and no way to pin a specific
model per call (every call uses `activeModelId()`), which the router needs for tier testing
and small→mid→frontier escalation. Fix applied in Deliverable B:
- `bedrock.ts`: export `structuredOutputs(def)` capability; add optional `modelId` override
  to `BedrockCallOptions` (honoured in `bedrockCompleteJson`; defaults to active model —
  production paths unchanged).
- `dispatch.ts`: export `structuredOutputs(modelKey?)` + `classifyJson(modelKey, …)` that
  pins the model for router classification/escalation.

### C. Test convention `pnpm test:*` → `tsx scripts/test/*` — **PASS**

Confirmed (package.json): test:isolation, test:pipeline-validity, test:stage3-e2e,
test:stage4-gates, test:stage4-smoke, test:memory-eval → `tsx scripts/test/*`; test:e2e →
playwright. New scripts hook in as `test:routing` → `scripts/test/orchestration/run-routing.ts`
and `test:e2e-brain` → `scripts/test/orchestration/run-e2e.ts`.

---

## Build status — COMPLETE ✅

| Deliverable | Status | Artifact |
|---|---|---|
| Phase 0 — verify A/B/C | ✅ | this log |
| A — workflow registry | ✅ | `server/src/pipeline/workflows.ts` (35 workflows) |
| D — edit-state reinjection | ✅ | `server/src/pipeline/artifactContext.ts` + orchestrator/chat wiring |
| B — three-stage router | ✅ | `router.ts` + `router.types.ts` + dispatch/bedrock capability |
| C — rules block | ✅ | `context.ts` `buildBehaviorBlock` (versioned, tiered) |
| E — eval harness + gates | ✅ | `scripts/test/orchestration/*` — ALL GATES PASS |

## FINAL GATE RESULTS (all tiers, real router against Bedrock)

### Routing (`pnpm test:routing`, 305 cases × 3 tiers)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small (nova) | 98.0% | **100%** | **100%** | 1.0% | 1.0% |
| mid (haiku) | 99.3% | **100%** | **100%** | 1.0% | 2.3% |
| frontier (sonnet) | 99.3% | **100%** | **100%** | 0.0% | 2.3% |

Hard gates — edit-vs-describe = 100% (all tiers), unambiguous ≥ 95% (100% all tiers),
overall ≥ 85% (98–99.3% all tiers): **ALL PASS**. Confusion matrices in
`docs/orchestration/confusion-<tier>.md`; misses in `docs/orchestration/last-run.md`.

- **273/305 cases resolve in Stage 1 (deterministic, no LLM)** — including 58/58 edit-vs-describe.
  So the modify-bug fix is tier-independent: nova and sonnet both hit 100% on it with no model call.
- The ONLY residual misses are in the *ambiguous* class ("help me with this file" → read-summarize),
  which is not hard-gated. Pushing these toward clarify was deliberately NOT done — it would trade
  away the 100% unambiguous score. The clarify rate stays 1–2.3% (no over-clarifying).
- **Escalation rate 0–1%** — far below the ~40% that would justify defaulting small→mid. The small
  tier stands on its own; no tier-default change needed.

### E2E edit-contract (`pnpm test:e2e-brain`) — 31/31 PASS

- G1 state missing → `OrchestrationError`/`EDIT_STATE_UNAVAILABLE` thrown **100%** (13/13). Never describes.
- G2 present state reinjected under `<current_artifact>` with a non-describe contract (5/5).
- G3 every modify request routes to an edit-* workflow, deterministically (7/7).
- G4 **live md edits (real Bedrock) produce a MODIFIED artifact whose source differs from the prior
  version — an artifact, never a text description** (6/6).

## How the modify-bug is permanently fixed (defense in depth)

1. **Routing** — Stage-1 deterministic rule: edit-verb (or a produce-verb on the artifact's own type)
   + an artifact/upload in context ⇒ the matching `edit-*` workflow at confidence 1.0, no LLM. 100%
   on every tier.
2. **Reinjection** — `runEditDoc` loads `latestPayload` and injects it via `injectEditContext`
   (`<current_artifact>` + "output the full corrected state, never a description").
3. **Loud failure** — if state can't load, `OrchestrationError('EDIT_STATE_UNAVAILABLE')` is thrown
   before any model dispatch; the chat route surfaces a clarifying question. It can NEVER fall back to
   describing.

## Open questions / follow-ups
- **Uploaded-file editing**: editing an office file the user just uploaded (vs a generated artifact)
  needs the upload extracted to a JSON projection first. The router already classifies it as an edit,
  and `loadLatestState` correctly returns null → `EDIT_STATE_UNAVAILABLE` (honest clarify) until the
  projection-on-upload path is built. Follow-up, not a regression.
- **Real-office-lambda e2e**: G4 proves the contract for text artifacts (md, no lambda). The office
  (pptx/docx/xlsx/pdf) full round-trip is covered at the reinjection boundary (G1/G2) + existing
  pipeline tests; a live office-lambda edit e2e is a nice-to-have, deliberately not gated on external
  lambda availability (would be flaky).
- **Ambiguous class**: 2–6 "vague verb + a file" cases per tier route to read/analyze instead of
  clarify. Acceptable (not hard-gated); tightening risks the unambiguous gate.

### Commands
`pnpm test:routing` · `pnpm test:e2e-brain` · `pnpm test:behavior-block`
`tsx scripts/test/orchestration/build-dataset.ts` (regenerate dataset) ·
`tsx scripts/test/orchestration/det-check.ts` (offline Stage-1 coverage, no Bedrock)

### Routing gate run (baseline)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 86.2% | 94.8% | 88.8% | 1.6% | 1.0% |
| mid | 89.5% | 94.8% | 91.7% | 1.3% | 2.6% |
| frontier | 88.5% | 94.8% | 90.3% | 0.0% | 3.9% |

Gates: FAILURES ✗ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)

### Routing gate run (iter1)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 98.0% | 100.0% | 100.0% | 1.0% | 1.0% |
| mid | 99.3% | 100.0% | 100.0% | 1.0% | 2.3% |
| frontier | 99.3% | 100.0% | 100.0% | 0.0% | 2.3% |

Gates: ALL PASS ✅ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)

### Routing gate run (post-integration c04db85)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 98.0% | 100.0% | 100.0% | 1.0% | 1.0% |
| mid | 99.3% | 100.0% | 100.0% | 1.0% | 2.3% |
| frontier | 99.3% | 100.0% | 100.0% | 0.0% | 2.3% |

Gates: ALL PASS ✅ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)

### Routing gate run (local)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 98.0% | 100.0% | 100.0% | 1.0% | 1.0% |
| mid | 99.3% | 100.0% | 100.0% | 1.0% | 2.3% |
| frontier | 99.3% | 100.0% | 100.0% | 0.0% | 2.3% |

Gates: ALL PASS ✅ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)

### Routing gate run (local)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 97.7% | 100.0% | 99.5% | 1.0% | 1.0% |
| mid | 99.0% | 100.0% | 99.5% | 1.0% | 2.3% |
| frontier | 99.0% | 100.0% | 99.5% | 0.0% | 2.3% |

Gates: ALL PASS ✅ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)

### Routing gate run (local)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 98.0% | 100.0% | 100.0% | 1.0% | 1.0% |
| mid | 99.3% | 100.0% | 100.0% | 1.0% | 2.3% |
| frontier | 99.3% | 100.0% | 100.0% | 0.0% | 2.3% |

Gates: ALL PASS ✅ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)

### Routing gate run (local)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 98.4% | 100.0% | 100.0% | 1.3% | 1.3% |
| mid | 99.3% | 100.0% | 100.0% | 0.7% | 3.0% |
| frontier | 99.7% | 100.0% | 100.0% | 0.0% | 2.6% |

Gates: ALL PASS ✅ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)

### Routing gate run (local)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 98.0% | 100.0% | 99.5% | 1.3% | 1.3% |
| mid | 99.0% | 100.0% | 99.5% | 0.7% | 3.0% |
| frontier | 99.3% | 100.0% | 99.5% | 0.0% | 2.6% |

Gates: ALL PASS ✅ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)

### Routing gate run (local)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 98.4% | 100.0% | 100.0% | 1.3% | 1.3% |
| mid | 99.3% | 100.0% | 100.0% | 0.7% | 3.0% |
| frontier | 99.7% | 100.0% | 100.0% | 0.0% | 2.6% |

Gates: ALL PASS ✅ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)

### Routing gate run (local)

| tier | overall | edit-vs-describe | unambiguous | escalation | clarify |
|---|---|---|---|---|---|
| small | 98.4% | 100.0% | 100.0% | 1.3% | 1.3% |
| mid | 99.3% | 100.0% | 100.0% | 0.7% | 3.0% |
| frontier | 99.7% | 100.0% | 100.0% | 0.0% | 2.6% |

Gates: ALL PASS ✅ (edit-vs-describe=100%, unambiguous>=95%, overall>=85% on all tiers)
