# HANDOFF 1 — Shell, full UI, model online

Status: COMPLETE
Date: 2026-06-10
llama.cpp version (PINNED — do not upgrade mid-build): `version: 8680 (15f786e65)`, binary `/opt/homebrew/bin/llama-server` (Homebrew)
Model files present: `gemma-4-e4b-it-q4_k_m.gguf` (4.6 GB, classified e4b), plus `mmproj-F16.gguf` and `nomic-embed-text-v1.5-q4_k_m.gguf` (neither classifies — `nomic-embed` is NOT `embeddinggemma*`, so semantic memory will stay off in Stage 4 unless an EmbeddingGemma GGUF is added)

**Mid-session change:** Adam replaced the visual contract — `reference/axiom-v2-ui.jsx` supersedes `reference/axiom-ui.jsx`. The client was built against the old reference first, then fully re-ported to v2. All gate evidence below is from the final v2 code. CLAUDE-CODE-PROMPT.md still names `axiom-ui.jsx` as the contract; Adam should update it (left untouched — it's his doc).

## What shipped

- `axiom.config.json` — PRD §0.2 verbatim
- `package.json` + `pnpm-workspace.yaml` + `tsconfig.base.json` — pnpm workspace, TS strict, all deps exact-pinned; `pnpm dev` is the single dev entry (concurrently: server + client)
- `server/src/config.ts, log.ts` — config loader; logger with 5 MB rotation into `dataDir/logs/`
- `server/src/db/{schema.sql,db.ts,seed.ts}` — PRD §2 schema verbatim; first-boot fixtures matching axiom-v2-ui (3 projects, 7 conversations, Q3 deck conversation with 2 pipeline messages, artifact a1 v1+v2, 9 skill states, 3 plugin installs)
- `server/src/llama/{models.ts,spawn.ts,client.ts}` — GGUF discovery + filename classification; supervised spawn (`--jinja -c 8192 -np 2`), health wait, chat-shaped warmup, crash→restart-once→error, SIGTERM teardown; streaming OpenAI-compat client (temp 1.0 / top_p 0.95 / top_k 64, max_tokens 1024, thinking disabled for chat)
- `server/src/routes/` — health, projects (live stats), settings, conversations, chat (SSE + 42-char title rule + abort-on-disconnect), skills (registry ⨯ state), plugins (directory ⨯ installs ⨯ enablement; lifecycle endpoints 501 "Stage 4"), models (registry, auto, select, refresh; bedrock 501 "Stage 5"), artifacts (detail + versions; download/restore 501 "Stage 3")
- `server/src/skills/registry.ts` — metadata tier per v2 mockup (8 display rows)
- `directory/connectors.json` — the 8 v2-mockup connectors (knowledge-core featured, filesystem, axiom-memory, jira, confluence, github, slack, postgres)
- `client/` — Vite 8 + React 18.3.1 + Tailwind 3.4.19; `theme/tokens.ts` exact v2 palette/fonts; `lib/{api,sse,store}`; components per v2 reference boundaries: Badge, Toggle, NavItem, Sidebar (with live llama-server RAM panel), StepRow, ArtifactCard, ModelMenu (Auto/E2B/E4B/12B/Bedrock-locked), MiniSlide, ArtifactPanel, NewProjectModal; views Chat (streaming + PipelineCard + crash banner + empty state), Plugins (search/filters/cards/modal), Skills (accordion), Projects (cards + create modal)

## Gate results

- **`pnpm dev` cold-starts everything** — PASS. One command from repo root; 10 s from invocation to llama-ready; client HTTP 200. (One transient flake observed when a previous llama-server still held :8080 during rapid restart cycles — see Known issues.)
- **`/health` shows the E4B file name** — PASS. `{"ok":true, "llama":{"status":"ready","modelFile":"gemma-4-e4b-it-q4_k_m.gguf",...}, "llamaVersion":"version: 8680 (15f786e65)"}`
- **Fresh question streams a real E4B answer <2 s to first token** — PASS. Server-measured first delta after cold start: **240 ms** (and 230–282 ms across repeated runs); end-to-end curl incl. HTTP: 0.27 s. Verified in the browser: "what can you do?" streamed a real answer that cited the active project's instructions.
- **Every view renders, zero console errors, zero non-localhost requests** — PASS. All four views exercised via Playwright in a fresh session: 0 console errors; full network audit: 120/120 requests to 127.0.0.1 (vite assets + /api only).
- **kill -9 llama-server → UI banner + recovery** — PASS. Single kill -9: manager respawned, ready again in 2.1 s (faster than the 4 s health poll, so the transient banner isn't normally visible). Banner verified by forcing the crash-twice path (kill the respawn mid-restart): persistent amber "Local model offline — llama-server crashed twice…" banner rendered in chat, and cleared on recovery. Toggles persisted through the crash.

Also verified by execution: skill toggle persists (PATCH /skills/mermaid → DB), plugin per-project toggle persists (github → ['p1']), project create/activate persists, conversation title rule, recents reorder live, model select (Auto default) persists.

## Decisions made (PRD/mockup left open — flag if wrong)

1. **Gemma thinking disabled for chat** (`chat_template_kwargs: {enable_thinking:false}`). Gemma 4 thinks before answering (`reasoning_content` frames); open-ended prompts thought for 7–15 s with the answer's first token only after. The <2 s gate and the snappy-chat UX argue for off; office/pipeline calls can re-enable per-call in Stage 3 (`thinking: true` option already plumbed).
2. **v2 mockup has no Artifacts nav view** — the in-chat ArtifactPanel replaces the old gallery. The artifacts API (list/detail/versions) is kept for the panel and Stage 3.
3. **Skills view shows 8 rows** (react+site merged, per v2 mockup); `skills_state` still seeds all 9 PRD ids — 'site' remains routable for Stage 3.
4. **Skill enable/disable** = clicking the Enabled/Disabled badge (v2 mockup has no toggle control; PRD requires persistent toggles — badge-as-toggle keeps both).
5. **Plugin directory = the 8 v2-mockup connectors**, superseding PRD §6.1's nine (sqlite & sharepoint dropped, slack added, memory→axiom-memory). §6.1 should be considered amended by the new mockup; Stage 4 builds the built-ins that exist in the directory (filesystem, axiom-memory). If the sqlite built-in is still wanted, say so before Stage 4.
6. **Knowledge Core** ships as `available` + Featured (per v2 mockup) rather than `planned`/7979-probe (old mockup). The 7979 probe semantics move to Stage 4 install time.
7. **Active project** shown with accent border + "Active" badge on project cards (v2 mockup defines no active state; activation semantics are PRD §7 and needed from Stage 2).
8. **Project card stats**: chats live, templates = artifact count (template libraries are post-v1, per PRD A47), plugins = live count of installs enabled in that project.
9. **Sidebar llama panel** shows real values: process RSS / total RAM (`ps -o rss`), bar only for the resident model; absent tiers render dimmed at 0%.
10. **User initials derived from `userName`** ("Adam" → "A"; mockup hardcodes "AF"). Set `userName: "Adam Fisher"` in axiom.config.json if AF is wanted.
11. Repo root is `/Users/adamfisher/DEVELOP/AtlasV2`, not the PRD's `…/AGENTS/AXIOM/axiom-local-v2`.

## Known issues / deferred items

- **Client disconnect mid-stream** now aborts the upstream llama generation (`res.on('close')` + AbortController) — without this, abandoned generations hogged a slot for up to max_tokens. Detection uses `res` 'close', not `req` (req 'close' fires when the body is consumed — that bug aborted every request when first introduced; fixed and verified).
- tsx watch restarts respawn llama-server (model reloads ~2–10 s per server-file edit in dev). Acceptable; a probe-for-healthy-orphan optimization is possible later.
- ArtifactPanel slide thumbnails are the mockup's static sketches; real previews are Stage 3. Panel opens on artifact-card click (mockup default-opens it; minor deviation).
- Add-custom-server and Bedrock connect surface honest "Stage 4/5" notices (v2 mockup defines no modals for either; old-mockup AddServerModal was dropped in the re-port).
- `mmproj-F16.gguf` and `nomic-embed-*.gguf` in the models dir are ignored by classification (by design). No EmbeddingGemma file present — Stage 4 semantic memory will be FTS5-only unless one is added.
- The Q3 seed artifact has no real file on disk yet (downloads 501 until Stage 3; PRD §7's "real generated file at seed time" requires the Stage 3 pipeline helpers).
- Stray `.png` screenshots and `.playwright-mcp/` are gitignored.

## Exact entry point for the next session

- Branch: `main` (stage-1 merged + tagged `stage-1`).
- Stage 2 first task: replace the always-`chat` router stub context wiring with full CRUD persistence semantics — new-chat flow already works; build `scripts/test/isolation.test.ts` (two projects, assert zero cross-reads across conversations/artifacts/mem tables/files dirs), verify instructions injection (already observably working — ask "what are your instructions?"), restart-loses-nothing check.
- Open questions for Adam: (a) confirm decisions 1, 5, 6 above; (b) should CLAUDE-CODE-PROMPT.md/PRD be updated to name `axiom-v2-ui.jsx` as the visual contract? (c) `userName` → "Adam Fisher" for AF initials?
