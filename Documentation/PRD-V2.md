# Atlas V2 — Product Requirements Document (v2, current state)

**Status:** Authoritative. Supersedes `PRD.md` (the original on-device build contract) and
`PRD-AMENDMENT-1.md` where they conflict. Doubles as the Business Requirements Document:
every capability carries a requirement ID (FR-x.y), its behavior in granular detail, and
its verification status.
**Owner:** Adam Fisher · **Last updated:** 2026-07-07
**Companion docs:** `MEMORY_DESIGN.md` (memory architecture), `PARITY_REPORT.md` (test log).

---

## 0. Product definition

Atlas is a Claude.ai-class AI workspace. The client (Vite/React) and API server
(Express/TypeScript) currently run on the user's machine; **all inference and all durable
memory/file storage run in AWS** (Amazon Bedrock, DynamoDB, S3, S3 Vectors) with a
scale-to-zero cost profile — $0 when idle, pay-per-use under load. The declared direction
(§12) is full serverless deployment modeled on Atlas v1's Lambda architecture.

Five surfaces off a persistent sidebar: **Chat**, **Projects**, **Plugins (MCP)**,
**Skills**, plus per-chat **Artifacts** panels. Feature target: parity with claude.ai web,
verified by Playwright-driven end-to-end tests (`PARITY_REPORT.md`).

---

## 1. Models & inference

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-1.1 | Bedrock is the sole inference backend | All model calls (router, chat, document pipeline, memory extraction, adjudication, consolidation, embeddings) go through AWS Bedrock. The local llama.cpp sidecar is retired; its modules remain dormant. | ✅ live |
| FR-1.2 | Exactly two selectable chat models | **Claude Haiku 4.5** (`us.anthropic.claude-haiku-4-5-20251001-v1:0`, "Fast") and **Claude Sonnet** (see FR-1.3). The user's menu pick drives *everything* — router, chat, documents. No hidden model routing. | ✅ |
| FR-1.3 | Self-healing Sonnet slot | `probeSonnet()` (boot/connect/refresh) issues a 1-token invoke of Sonnet 5. Refused → the slot binds to Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`) with the honest label "Sonnet 5 pending AWS activation"; cleared → auto-upgrades. Setting key `sonnetResolved`. | ✅ (Sonnet 5 agreement ACTIVE, runtime still AWS-gated) |
| FR-1.4 | Connection = verified round-trip | "Connect Bedrock" runs a real `ListFoundationModels`; failures surface the raw AWS error. Credentials: named AWS profile via `fromIni` (default `default`), region default `us-east-1`. Auto-connect at boot, non-fatal. | ✅ |
| FR-1.5 | Structured outputs | Claude 4.5+ uses Converse `json_schema` response format. Sanitizer strips unsupported keys (`maxItems/minItems/maxLength/minLength/pattern/maximum/minimum`). Map-type schemas route to forced tool-use with deterministic wrapper-key healing. **3-tier fallback** (FR-1.9): json_schema → (grammar/complexity error, or schema >2.2KB) forced tool-use → (still too complex) plain free-form JSON. ajv re-validates + repairs downstream. Complex schemas (product) generate in ~8–15s instead of timing out. | ✅ |
| FR-1.6 | Vision | Image attachments become Converse image blocks (`data:` URL → bytes; jpg→jpeg normalization). | ✅ |
| FR-1.7 | Extended thinking | Opt-in per message (composer toggle). Converse `additionalModelRequestFields: {thinking: {type:'enabled', budget_tokens:4000}}`, temperature forced to 1, maxTokens ≥6000. Reasoning deltas stream as SSE `thinking` events; in tool loops thinking applies to the first pass only. | ✅ |
| FR-1.8 | Streaming tool loop | `bedrockStreamWithTools`: ConverseStream; text deltas stream through; on `stopReason=tool_use` the requested tools execute, `toolResult` blocks append, loop continues (cap 3 iterations). | ✅ |

## 2. Chat

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-2.1 | Streaming SSE chat | POST `/api/conversations/:id/messages` streams `step/route/token/thinking/tool/gen/artifact/pipeline/error/done` events; 15s keep-alives. | ✅ |
| FR-2.2 | Router | Every message is classified (chat / create_doc / edit_doc + skill) by the selected Claude model with constrained JSON; 2 attempts then chat fallback. Memory verbs (remember/forget/memorize/note) always route to chat. | ✅ |
| FR-2.3 | Stop generating | Stop aborts the SSE fetch client-side (AbortController passed to `postSse`); the server persists the **partial response** (claude.ai behavior) and the composer recovers immediately. | ✅ |
| FR-2.4 | Composer never dead-ends | No conversation → sending auto-creates one. Errors clear the live exchange on close (server persists an honest error message) so `busy` can never wedge. | ✅ |
| FR-2.5 | Message ergonomics | Copy button on every assistant message; **Regenerate** on the last assistant message (server-side truncate-after + `retry:true` resend that skips re-persisting the user message); **Edit** pencil on user messages (inclusive truncate, edited text resent; amber "editing" indicator with cancel). | ✅ |
| FR-2.6 | Persona | System prompt declares the active model + Bedrock honestly; project instructions and memory recall append. | ✅ |
| FR-2.7 | Suggestion chips | Empty state offers six seeded prompts that fill the composer. | ✅ |
| FR-2.8 | Attachments in chat | See §7. Document text injects into the last user message (24k cap per doc); images go multimodal. Multiple files per message supported (verified: image + doc answered in one turn). | ✅ |
| FR-2.9 | Context management | Long conversations never fall off a cliff: model context = rolling summary of everything older + uncovered stragglers raw + recent window (last 12 text messages, 24k-char budget). Compaction folds ≥6 uncovered older messages into the persisted summary (`convsum:<conv>`, ≤2k chars, coverage watermark — nothing summarized twice or dropped) via one Claude call amortized over ~6 turns; the summary injects into the system prompt. Verified: a fact 20 messages back recalled from the summary. | ✅ |
| FR-2.10 | Message feedback | Thumbs up/down on assistant messages, persisted (`feedback:<msgId>`), toggleable, returned with the conversation. | ✅ |

## 3. Tools in chat (Converse tool loop)

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-3.1 | Memory tools | `remember {fact, scope:user\|project}` (stores a note in the chosen scope; model picks scope — verified choosing `user` for personal prefs) and `forget {query}` (deletes **all** ≥0.5-similarity matches across KV+notes — extractor siblings included). System prompt instructs tool use over mere acknowledgement. | ✅ |
| FR-3.2 | Web tools | `web_search` (DuckDuckGo HTML endpoint, no API key; top-5 title/URL/snippet) and `web_fetch` (http(s) page → tag-stripped readable text, 8k cap, 12s timeout). Verified: model chains search→fetch and cites. | ✅ |
| FR-3.3 | MCP connector tools | Retired SQLite peers (atlas-memory, sqlite) are excluded from the tool loop so they can't shadow native memory. Every OTHER connector enabled for the project surfaces its tools (name mangled `connector__tool`, ≤64 chars) with the connector name in the description; execution via the MCP manager (`callTool`, 30s timeout). Verified live: `fs_list · Filesystem`. | ✅ |
| FR-3.4 | Tool chips | Each execution emits an SSE `tool` event; the UI renders `tool · connector` chips on the live exchange and persists them with the message. | ✅ |

## 4. Memory (the differentiating subsystem — see MEMORY_DESIGN.md)

Storage: DynamoDB single table `atlasv2-memory` (on-demand, gsi1 reverse-edge index, TTL,
PITR) + S3 Vectors bucket `atlasv2-memory-vectors` (Titan v2 embeddings, 1024-dim cosine;
indexes `user-mem`, `proj-<id>-mem`). Everything degrades gracefully — memory failures
never block chat.

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-4.1 | Two scopes | `user` (cross-project facts about the person) and per-project. Hard isolation verified: project facts never leak across projects; user facts intentionally span. | ✅ |
| FR-4.2 | Three layers | KV profile facts (always injected), semantic notes (vector-recalled), entity graph (subject—relation→object; forward edge on PK, mirrored reverse edge on gsi1 → true two-way adjacency queries). | ✅ |
| FR-4.3 | Automatic capture | Idle-debounced extraction ~75s after the last exchange, **durable**: pending rows in SQLite `mem_pending`, 15s sweeper, 3 retries with backoff, boot recovery. Extraction prompt: constrained JSON, category whitelist (`user_preference/user_fact/project_context/decision/learned_fact`), graph facts, sensitive-category denylist (health, politics, religion, sexuality, precise location, financial account details). | ✅ |
| FR-4.4 | Dedup-at-write (measured bands) | Every KV/note write embeds and probes: ≥0.90 + adjudication, 0.50–0.90 same-category → Haiku adjudication (`same/different/contradicts`). Bands calibrated on real Titan measurements (restatements ≥0.96, paraphrases 0.69–0.72, reworded contradiction 0.587, hardest negative 0.44). Probes merge an in-process recent-writes buffer (last 20 vectors, exact cosine — covers S3 Vectors' seconds-long indexing lag) with the index query. | ✅ |
| FR-4.5 | Contradiction supersede | `contradicts` verdict → newest value wins + `TOMB#` audit item (old value, new value, timestamp). Adjudication always runs when a neighbor exists because contradictions embed at ≥0.9 similarity. | ✅ |
| FR-4.6 | Reinforcement & decay | Merges bump `mention_count` and refresh wording. Notes carry a 90-day DynamoDB TTL extended on every recall hit (`bumpRecalled`); KV facts never decay. | ✅ |
| FR-4.7 | Recall composition | Per message: synthesized profile summary (+ only KV facts newer than it) for both scopes → top-4 semantic hits ranked by composite score (0.6·similarity + 0.25·recency e^(−age/90d) + 0.15·log-mentions, floor 0.35) → 1-hop graph expansion for entities named in the message (both directions). Enforced budgets: KV 1800 / semantic 1500 / graph 600 chars. | ✅ |
| FR-4.8 | Consolidation | `consolidate(scope)` synthesizes a ≤120-word profile ("What Atlas knows about you" / project summary), stored as `PROFILE#current`; refreshed when >24h stale (boot + 6h sweep) or on demand (modal Refresh). | ✅ |
| FR-4.9 | User controls | Memory modal with **This project / You** tabs: profile card, KV facts (add/edit/delete), notes, graph facts — all deletable; per-chat remember toggle (brain icon → `memoff:<conv>`). | ✅ |
| FR-4.10 | Ops & observability | `recall-preview` (exact injected block + per-hit similarity/rank/scope + matched entities), `export` (snapshot incl. tombstones), `wipe` (items + vector index + queued extractions), `extract-now`. | ✅ |
| FR-4.11 | Eval harness | `pnpm test:memory-eval` — 14 asserts: store→paraphrase recall, dedup (no dup growth), contradiction→tombstone, remember/forget via real chat SSE, reverse-edge recall, queue durability, wipe teardown. Green twice consecutively required. | ✅ 14/14 |

## 5. Projects

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-5.1 | Isolated workspaces | Conversations, artifacts, memory, knowledge, and plugin enablement scope to a project. Active project drives new chats. | ✅ |
| FR-5.2 | Instructions | Per-project instructions inject into every chat and the document pipeline. | ✅ |
| FR-5.3 | Creation UI | New-project modal (name + instructions); card grid shows chats/templates/plugins counts, Active/isolation badges. | ✅ |
| FR-5.3b | Delete project | `DELETE /projects/:id` cascades conversations+messages, memory (items+vectors+queue), and knowledge; refuses the last project. Card trash button with confirm. | ✅ |
| FR-5.4 | **Knowledge files** | Documents uploaded to a project persist and inform every chat in it: file → local + S3 (`knowledge/<project>/<id>`) → markitdown/direct extraction → paragraph-aware ~1000-char chunks (≤200/file) → embedded into the project vector index as `KN#` items (no dedup probing; excluded from the notes list). Recall surfaces relevant passages automatically, labeled `[filename]`. Registry in SQLite (status indexing/ready/error, chunk count). Modal: upload, list with live status, download original, delete (removes chunks + vectors + S3 object). Verified: fresh chat answered two facts from an uploaded plan. | ✅ |
| FR-5.5 | Knowledge citations | Recall separates knowledge passages from memories and instructs citing sources inline as `[source: filename]`; the client renders citations as accent badges (BookOpen chip, hover shows provenance) in live and persisted messages. Verified on a document-only fact. Note: facts already absorbed into project memory answer from memory without a citation — expected precedence. | ✅ |

## 6. Artifacts & the document pipeline

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-6.1 | Nine generation skills | `pptx` (python-pptx + 16-style DFS slide system), `docx`, `xlsx`, `pdf` (weasyprint), `md`, `mermaid`, `svg`, `react`, `site` — each a skill playbook (schema + guidance) driving constrained JSON on the selected Claude model. | ✅ all verified live |
| FR-6.2 | Validation chain | ajv schema validation → one repair retry with the error → per-format checks (OOXML zip sanity, round-trip, placeholder grep, mermaid syntax, SVG parse, file-map validation). Honest failure surfaces when validation can't be met. | ✅ |
| FR-6.3 | Office build helpers | Local: bundled Python venv. **Cloud: separate `atlasv2-office` Python zip Lambda** (arm64, pure/manylinux wheels) invoked by the app Lambda — scale-to-zero, no containers. PDF uses pure-python xhtml2pdf in cloud (weasyprint locally). | ✅ live in cloud |
| FR-6.2b | Non-blocking validation | soffice thumbnail/convert + openxml-audit checks degrade to amber skips when the tool/lib is absent or broken — only genuine structural failures (round-trip, zip sanity) block. Documents never fail on a missing LibreOffice. | ✅ |
| FR-6.4 | Versioning | Every generation/edit creates a numbered version; `edit_doc` intent targets the conversation's latest artifact; versions restorable; per-version download (single file, or zip for multi-file kinds). | ✅ |
| FR-6.5 | Inline previews | mermaid/svg/react/site/md render inline in the thread and in the artifact panel; office kinds show meta + download. | ✅ |
| FR-6.6 | **Share links** | Artifact version → S3 `shares/` + presigned GET URL (7 days); Share button copies the link. Anyone with the link can download. | ✅ |
| FR-6.7 | Product artifacts | `product` skill maintains a stateful product definition per conversation (field-scoped edits, state machine to 'specified', projections: PRD/pitch/prototype, bundle zip). | ✅ (pre-existing) |
| FR-6.8 | Artifact list | Per-chat artifact panel (box icon, count badge). | ✅ |

## 7. Uploads & attachments

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-7.1 | Accepted types (claude.ai set) | Images png/jpg/jpeg/gif/webp; office pdf/docx/doc/pptx/ppt/xlsx/xls/rtf/odt/epub; data/text csv/tsv/md/txt/json/html/xml/yaml/yml/log/ipynb; code py/js/ts/tsx/jsx/java/c/cpp/h/cs/go/rb/rs/php/swift/kt/sql/sh/css. | ✅ |
| FR-7.2 | Size | Up to 40MB (uploads router mounts before the global 2MB JSON limit — regression-guarded). | ✅ |
| FR-7.3 | Extraction | Office kinds extract via markitdown at upload (async); text/code read directly. Chat **waits up to 15s** for in-flight extraction so ask-immediately works. | ✅ |
| FR-7.4 | **S3 durability + retrieval** | Every upload mirrors to S3 (`atlasv2-uploads-<acct>/uploads/<id>`); file chips in the thread reveal a **hover download** that streams the original back (S3 first, local fallback). | ✅ |
| FR-7.5 | Vision path | Images attach as multimodal content on the last user message. | ✅ |

## 8. Conversations & management

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-8.1 | Auto-title | First message becomes the title (42-char ellipsis). | ✅ |
| FR-8.2 | Rename | PATCH endpoint + hover pencil in recents. | ✅ |
| FR-8.3 | Search | Sidebar search box: instant title filter + server-side content search (LIKE over message payloads, 2+ chars, top 30 by recency). | ✅ |
| FR-8.4 | Bulk delete | Edit mode: select-all/clear, multi-delete. | ✅ |
| FR-8.5 | Truncate | `POST /:id/truncate {messageId, inclusive}` — the primitive behind edit & regenerate. | ✅ |
| FR-8.6 | Chat export | `GET /:id/export` → Markdown download (title, speakers, artifact markers); FileDown button in the chat header (direct navigation). | ✅ |

## 8b. Client shell

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-8b.1 | Light/dark theme | Claude.ai-style warm palettes; toggle in the sidebar footer (Sun/Moon), persisted in localStorage, palette swaps synchronously before re-render (post-paint swap bug fixed and regression-noted). | ✅ |
| FR-8b.2 | Mobile layout | Under 768px the sidebar becomes a hamburger-toggled drawer with backdrop; navigation closes it. | ✅ |

## 9. Plugins (MCP)

| ID | Requirement | Detail | Status |
|---|---|---|---|
| FR-9.1 | Connector directory | Bundled (filesystem, atlas-memory, sqlite) + directory + custom connectors; install/enable per project; stdio MCP processes managed by the server. | ✅ (pre-existing) |
| FR-9.2 | Tools reach chat | See FR-3.3 — enabled connectors' tools execute inside the Bedrock tool loop. | ✅ |
| FR-9.3 | Knowledge Core slot | Reserved directory entry probing a local KC endpoint. | ✅ (pre-existing) |

## 10. Infrastructure (all scale-to-zero, Terraform in `infra/`)

| Resource | Purpose |
|---|---|
| `atlasv2-app` (DynamoDB, on-demand) | **ALL app data** (FR-10.1, was SQLite): settings (write-through cache, sync reads), projects, conversations, messages (sk-ordered), artifacts+versions, skills, plugin installs, product states, projections, knowledge registry, extraction queue. ConsistentRead everywhere (read-after-write correctness). One-time migration script moved 373 items. |
| `atlasv2-artifacts-<acct>` (S3) | Generated document files (pending cutover FR-10.2) |
| ECR `atlasv2-app` + Lambda exec role | Container deployment (Lambda Web Adapter + streaming Function URL; pending) |
| `atlasv2-memory` (DynamoDB, on-demand) | Memory items: KV/NOTE/KN/ENT/EDGE/TOMB/PROFILE; gsi1 reverse edges; TTL; PITR |
| `atlasv2-memory-vectors` (S3 Vectors) | Semantic indexes `user-mem`, `proj-<id>-mem` (Titan v2, 1024-dim cosine) |
| `atlasv2-uploads-<acct>` (S3, private, SSE) | Attachment mirrors (`uploads/`), knowledge originals (`knowledge/`), share objects (`shares/`) |
| Bedrock | Claude inference + Titan embeddings; model agreements managed per account |

Rules: create-only plans reviewed before apply; `.tfstate`/plans gitignored; `atlasv2` prefix
on everything; no idle cost anywhere.

## 11. Operations

- **Logs**: `app/pipeline/memory/mcp` channels under `<dataDir>/logs/`.
- **Health**: `/api/health` (legacy llama block retained for the dormant local path).
- **E2E regression suite** (FR-11.1): `pnpm test:e2e` — 21 Playwright tests in `tests/e2e/`
  (chat core incl. stop/partial/thinking/export, ergonomics incl. regenerate/edit/feedback,
  shell incl. theme/mobile/rename/search/bulk-delete, memory remember/forget round-trip,
  knowledge upload→citation→delete, uploads incl. multi-file + S3 chip download, artifacts
  incl. mermaid create→edit→v2→share-link-fetch + pptx build-chain smoke, web + MCP tool
  chips). Serial worker against the running dev stack; self-cleaning via the `[e2e]` title
  marker; artifact/knowledge teardown included. Status: 21/21 green in a single pass.
- **Memory eval**: `pnpm test:memory-eval` (needs running server) — 14 asserts, deep memory
  correctness. Legacy stage tests retained.
- **Config**: `atlas.config.json` (dataDir, ports, retired llama block, bedrock region/profile).
- **Data root**: `~/Library/Application Support/AtlasLocal/` — `data/` (SQLite: conversations,
  messages, artifacts, plugins, settings, knowledge registry, pending extractions),
  `artifacts/`, `uploads/`, `knowledge/`, `logs/`.

## 12. Roadmap (agreed direction, not yet built)

1. **Full serverless migration** — v1-modeled API Gateway + Lambda + DynamoDB (prefix
   `atlasv2`), client on S3+CloudFront; moves conversations/artifacts to AWS and unlocks
   Lambda-side extraction/consolidation (EventBridge) — closing the last local dependency.
2. **Sonnet 5 activation** — agreement is ACTIVE; runtime access pending AWS. Slot
   auto-upgrades (FR-1.3). Escalation path: AWS Sales.
3. Remaining parity niceties: chat share links, persisted thinking blocks, global
   artifacts gallery, response Styles presets, voice dictation, artifact version-history
   browser.
4. Memory eval in CI + conversation-hygiene teardown for eval runs.

## 13. Verification log

See `PARITY_REPORT.md` for the full sweep. Highlights: memory eval 14/14 twice; all nine
artifact skills live; stop/partial/recover verified; knowledge QA verified; S3
upload/download round-trip verified; web search→fetch chain verified; thinking stream
(145 deltas) verified; share link presigned+expiring verified; MCP `fs_list` verified. Overnight scenario harness (`scripts/test/scenarios*.ts`): 57/58 real-user checks — projects/isolation, knowledge, memory lifecycle, all 9 skills, product, versioning, contradiction/tombstone, 30-turn context, uploads, ergonomics, adversarial edge cases. See OVERNIGHT_REPORT.md.
