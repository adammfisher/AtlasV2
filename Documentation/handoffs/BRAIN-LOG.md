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

## Build status

| Deliverable | Status |
|---|---|
| Phase 0 — verify A/B/C | ✅ done |
| A — workflow registry | ⏳ next |
| D — edit-state reinjection | pending |
| B — three-stage router | pending |
| C — rules block | pending |
| E — eval harness + gates | pending |

### Next step
Deliverable A: `server/src/pipeline/workflows.ts` — 35 canonical workflows, single source of
truth for the router's Stage-1 trigger tables.

### Open questions
- Uploaded-file editing (edit an office file the user just uploaded, vs a generated artifact)
  requires extracting the upload to a JSON projection first. The gates focus on generated
  artifacts; upload-edit is a follow-up. Noted, not yet built.
