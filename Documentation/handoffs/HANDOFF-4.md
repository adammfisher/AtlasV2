# HANDOFF-4 — Stage 4: MCP plugins + memory

Stage 4 scope (PRD §6 + §9 Stage 4, Amendment Stage-4 items) is complete on
branch `stage-4`, merged to `main`, tagged `stage-4`.

## What shipped

- **Three built-in MCP servers** (`servers/*.ts`, `@modelcontextprotocol/sdk@1.29.0`
  pinned, stdio): `filesystem` (fs_read/write/list/search, root jailed to
  `dataDir/projects/<id>/files/`, writes outside the root error), `memory`
  (memory_search/upsert, graph_query/add_fact over `mem_*` tables, always
  project-filtered; FTS5 chunk recall via `mem_chunks` + `mem_chunks_fts`),
  `sqlite` (sql_query/sql_schema, `PRAGMA query_only`, paths jailed to dataDir).
  Spawned with cwd=dataDir and env scrubbed to the three ATLAS_* vars + PATH.
- **Manager** (`server/src/mcp/manager.ts`): per-(connector, project) client
  cache, install (5s initialize timeout, allowlist blocks private ranges except
  loopback), restart/remove, custom add (stdio must resolve inside the repo),
  KC probe (1s, boot + directory fetch), audit log (`logs/audit.log` — tool,
  path, project, ts; never contents).
- **Credentials**: AES-256-GCM at `dataDir/credentials/<ref>.enc`, key in
  `.atlas-key` (0600), masked in UI, deleted with the install.
- **§6.3 chat tool loop** (`mcp/toolloop.ts`): OpenAI-format tools array on chat
  completions (Gemma function calling via `--jinja`), tool_calls executed through
  the manager, ≤4 iterations, final answer streamed; executed calls render as dim
  `⚙ tool · Connector` chips (live + persisted in the message payload).
- **Memory recall**: top-3 `memory_search` hits injected as "Known context:" into
  the chat system prompt for memory-enabled projects. Semantic recall note shows
  in the memory panel (FTS5-only until an EmbeddingGemma GGUF lands — none present).
- **Directory** rewritten to the PRD §6.1 nine (the Stage-1 manifest had drifted:
  no sqlite, `atlas-memory` id, slack instead of sharepoint, KC pre-available).
  Legacy install rows migrated at boot.
- **Plugin panels live**: install (real pending state), restart/remove with
  spinners, working credential save, custom-server modal (consent text, repo-jail
  note), live `listTools` replaces toolsPreview when connected, lastError surfaced.
- **Amendment Stage-4**: product Spine/Collision/Dependency checks go live
  through KC when connected+enabled (exact skip-amber strings preserved when not);
  `confluence_page` (storage-format XHTML) and `jira_epics` (epics from
  capabilities, stories from matching ACs) generate locally always and push when
  a connector is connected, else `local` + "connect {name} to push";
  bundle now includes `.mcp.json` when KC is connected (A7).

## Gate evidence (all executed, this session)

- **install→enable→invoke**: "list the files in this project" → `⚙ fs_list ·
  Filesystem` chip → answer from the real listing. ✓
- **`pnpm test:stage4-gates`**: 4/4 — cross-project tool invisibility + refused
  direct calls, memory project-scoping, credentials AES-GCM round-trip with
  clean `grep -r` of dataDir and DB, audit log has calls but no contents. ✓
- **KC flip**: `pnpm mock:kc` (mock 7979, six org_* tools) → directory flips
  planned→available live → installs to `connected` → live tools listed → product
  define shows real `Collision check ok` + honest `Spine — {ref} not found`. ✓
- **Push projections**: mock Confluence/Jira (`scripts/test/mock-connectors.ts`,
  zod-asserted structure) → both kinds `pushed` with target refs; disabled
  connector → `local` + "connect Confluence to push". ✓
- **Tool reliability** (`pnpm test:stage4-smoke`): **7/10 → tool-use ships on by
  default** (§6.3 threshold met exactly). Misses, honestly: `fs_write` returned
  no call once (empty answer), `graph_query` routed to KC's `org_traverse` (mock
  KC was enabled — a near-miss that returned mock data as fact; real KC absence
  removes this path), `sql_query` asked a clarifying question. If tool choice
  feels flaky in practice, the documented fallback is a "/tools" prefix gate.
- **Isolation regression**: 22/22. ✓

## Decisions

1. Bundled servers spawn per (connector, project) so project scoping lives in the
   server env, not in tool arguments the model could vary.
2. Tool names are mangled `connector__tool` for the model and unmangled at
   execution; collisions across connectors are impossible.
3. The final answer is regenerated as a stream after tool iterations (tools
   omitted) rather than streaming mid-loop — honest cap enforcement, simpler SSE.
4. Custom stdio commands must resolve inside the repo; remote URLs pass the
   loopback-permissive/private-blocked allowlist. Both are gate-tested.
5. The smoke set keeps mock KC enabled, which cost one point (org_traverse
   intercept). Recorded rather than re-run without it — the 7/10 stands.

## For Stage 5

- llama.cpp pin unchanged: `8680 (15f786e65)`.
- Tiers/Bedrock/packaging per PRD §9 Stage 5; the model menu already scans tiers.
- EmbeddingGemma slot is wired (note + FTS fallback); semantic merge needs the
  embed llama-server spawn (config has `embedPort`) and sqlite-vec.
- Mock services for dev: `pnpm mock:kc` (7979), `npx tsx scripts/test/mock-connectors.ts` (7981/7982).
