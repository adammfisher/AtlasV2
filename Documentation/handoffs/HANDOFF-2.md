# HANDOFF 2 — Persistence, projects, conversations

Status: COMPLETE
Date: 2026-06-10
llama.cpp version: `version: 8680 (15f786e65)` — matches the HANDOFF-1 pin, not upgraded.
Model files present: unchanged from HANDOFF-1 (E4B only; no EmbeddingGemma).
PRD basis: PRD §9 Stage 2 + Amendment 1 (§A2 tables, §A10 isolation extension). Erratum applied: A59 (product skill row) deferred entirely to Stage 3 — no product skill row was seeded or displayed this stage.

## What shipped

- `server/src/db/schema.sql` — `product_states` + `projections` tables verbatim from §A2; comment noting `artifacts.kind` is open TEXT and accepts `'product'` (no constraint change needed). Applied to the existing DB on boot via `CREATE TABLE IF NOT EXISTS` — no reseed required.
- `server/src/db/scoped.ts` — the isolation enforcement helpers (PRD §2 invariant): project-scoped reads for conversations, messages (joined through conversations), artifacts, artifact_versions, mem_kv, mem_graph_nodes, mem_graph_edges, and — joined through their artifact per §A2 — product_states and projections. `__shared__` partition is opt-in per call (`{includeShared:true}`), never default. `projectFilesRoot()` returns the jailed `dataDir/projects/<id>/files` path, rejecting any id that isn't `[A-Za-z0-9_-]+` and asserting containment.
- `server/src/routes/conversations.ts`, `routes/artifacts.ts` — project-scoped branches now read through the helpers (unscoped branches remain for the cross-project sidebar/gallery, which is by-design per PRD §7).
- `scripts/test/isolation.test.ts` + root script `pnpm test:isolation` — runs against the real server and real model (no mocks): creates two projects via API, runs a real E4B chat in each, seeds rows in every project-scoped table (artifacts with `kind='product'`, versions, product_states, projections, mem_kv, graph nodes/edges, plus a `__shared__` row) and per-project files, then asserts zero cross-reads in both directions via API and helpers, shared-partition opt-in behavior, and files-dir jailing. Cleans up after itself and restores the active project.

Most of PRD §9 Stage 2's CRUD scope (new chat, title rule, recents ordering, project create modal, activation semantics, settings persistence, instructions injection) shipped in Stage 1; this stage hardened it with the helpers and proved it with the gates below.

## Gate results

- **Isolation test green** — PASS. `pnpm test:isolation` → 22 checks green, including `product_states` and `projections` per §A10, both query directions (A excludes B, B excludes A), `mem_kv` shared-partition opt-in (default excludes `__shared__`; opt-in adds exactly that partition), files roots containing only their own files, and path-escape rejection (`../evil`, `a/../../b`, empty, whitespace ids all throw).
- **App restart loses nothing** — PASS. Snapshotted 7 API surfaces (`conversations`, `conversations/c1`, `skills`, `plugins/directory`, `settings`, `projects`, `artifacts/a1`), fully stopped llama-server + server + client, cold-started with `pnpm dev`, re-fetched: all 7 byte-identical (`cmp`). UI verified: the Q3 pipeline conversation renders identically after restart (full Document-pipeline card, amber soffice row, v1/v2 artifact cards, targeted-edit row), zero console errors.
- **Creating a project then chatting files everything under it** — PASS. Asserted in the isolation test: a conversation created while project A is active belongs to A (and not B), with its real model-generated messages scoped to A.
- **Instructions injection** (PRD Stage 2 scope: "verify by asking") — PASS. In project p1, "what are your instructions?" → the model recited the persona plus the project's exact instructions ("prefer the Lightspeed deck template and cite Jira keys").

## Decisions made

1. **`artifacts.kind` 'product'** required no schema change — the column is unconstrained TEXT; documented with a comment in schema.sql and exercised in the isolation test (the seeded test artifacts use `kind='product'`).
2. **Scoping mechanism for the amendment tables** is the JOIN through `artifacts.project_id` (per §A2 "project-scoped through their artifact") rather than denormalizing a project_id column onto them.
3. **Unscoped reads kept for two endpoints only**: sidebar recents (all conversations) and the artifact gallery (all artifacts with project labels) — both are explicit product behaviors (PRD §7 / mockup), not isolation leaks; everything scoped goes through `scoped.ts`.
4. The isolation test **seeds non-API tables directly in SQLite** (product_states, projections, mem_*, versions) since no write API for them exists until Stages 3–4; API-writable surfaces (projects, conversations, messages, settings) are exercised through the real API with real inference.

## Known issues / deferred items

- The files-dir jail (`projectFilesRoot`) has no consumer route yet — the filesystem MCP server adopts it in Stage 4; the helper + tests exist now so the contract is pinned.
- `scopedMessages`/`mem_*` helpers are likewise ahead of their consumers (chat memory recall is Stage 4); they're covered by the test so regressions surface early.
- Chat answers still render raw markdown asterisks in the serif bubble (noted post-Stage-1; rendering lands with the vendored `marked` in Stage 3).
- HANDOFF-1 open questions remain open (CLAUDE-CODE-PROMPT.md still references `atlas-ui.jsx`; userName "AF" initials; sqlite built-in dropped from the v2 directory).

## Exact entry point for the next session

- Branch: `main` (stage-2 merged + tagged `stage-2`).
- Stage 3 is the centerpiece: real router (§4.1 + amendment skills enum incl. `product`), 9+1 skill playbooks/schemas, `bootstrap-python.sh` (pinned wheels; record the `brew install pango cairo gdk-pixbuf libffi` outcome), `make_default_templates.py`, four office helpers, md/mermaid/svg paths, react/site esbuild-wasm sandbox, full SSE pipeline with persistence, validation chains, artifact versioning/download/restore, targeted edits, **plus the entire product scope from Amendment 1 §A10 Stage 3** (product skill, field-scoped edits, validation chain with KC skip-ambers, projection engine for the six local kinds, bundle export, state machine + API, A53–A59 UI incl. the tenth Skills row).
- Stage 3 gates to honor unsoftened: 90% first-pass constrained-JSON validity on the 20-prompt office set AND the 10-prompt product set; byte-identical untouched sections on targeted edits (merge-assertion for products); deterministic projections idempotent at extracted-text level; demo scripts `stage3-demo.md` + `stage3-product-demo.md` end-to-end.
- First task: `scripts/dev/bootstrap-python.sh` + verify the pinned wheels install, since everything office depends on it.
