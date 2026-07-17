# Axiom Local v2 — Product Requirements Document

> **SUPERSEDED (2026-07-07):** the product has migrated to AWS Bedrock inference,
> AWS-native memory, and claude.ai feature parity. The authoritative current-state
> PRD/BRD is **`PRD-V2.md`**. This file remains as the original build contract
> (stage gates, local-model era) that code comments reference (PRD §…).

**Audience:** Claude Code (executing agent) · **Owner:** Adam Fisher
**Visual contract:** `Documentation/reference/axiom-ui.jsx` — the interactive mockup. Every element and interaction in that file ships for real. Appendix A maps each one to a stage.
**Companion:** `Documentation/CLAUDE-CODE-PROMPT.md` — operating instructions for the executing agent. Read it first.

---

## 0. Product definition

Axiom Local is a fully on-device AI workspace — a Claude.ai-class product running against local Gemma models — for corporate machines where cloud AI is blocked. It ships as a folder, requires no admin rights and no Docker, and never sends data off the machine unless the user explicitly connects Amazon Bedrock.

The product is the mockup. Five surfaces off a persistent sidebar: **Chat** (streaming conversation plus a staged document-generation pipeline with validation and versioned artifacts), **Projects** (hard-isolated workspaces), **Artifacts** (versioned output gallery), **Plugins** (an MCP connector directory with per-project enablement and a reserved Knowledge Core slot), and **Skills** (the document playbook registry that drives generation).

**Architecture decision (final, do not revisit):** purpose-built app — Vite/React client, Express/TypeScript server, llama.cpp `llama-server` sidecar, better-sqlite3 persistence, bundled-Python office helpers, MCP SDK plugin layer. LibreChat is a pattern reference only; none of its code is used. Rationale: the mockup UI shares nothing with LibreChat's client, and the validated Axiom architecture decisions (sqlite-vec, constrained decoding, skill playbooks, MCP-first) carry over directly.

### 0.1 Environment facts

- Dev machine: Adam's macOS (Apple Silicon, 24 GB unified).
- **E4B GGUF is already on disk in: `/Users/adamfisher/Library/Application Support/AtlasLocal/models`**. The app must discover any `*.gguf` in that directory and classify it by filename (`e2b`, `e4b`, `12b`, `embeddinggemma` substrings, case-insensitive). E4B is the only model guaranteed present; everything must work with E4B alone.
- App data root: `/Users/adamfisher/Library/Application Support/AtlasLocal/` with subdirectories `models/` (exists), `data/`, `artifacts/`, `credentials/`, `logs/` (create on boot).
- Repo root: `/Users/adamfisher/DEVELOP/AGENTS/AXIOM/axiom-local-v2/`.
- `llama-server` acquisition for dev: probe PATH; if absent, run `brew install llama.cpp` (documented, allowed). Pin the installed version in `HANDOFF-1.md`.
- Python for office helpers (dev): `python3 -m venv runtimes/python/venv` + `scripts/dev/bootstrap-python.sh` installing pinned wheels. The portable python-build-standalone swap is Stage 5.
- No CDN at runtime, ever. All client dependencies bundled by Vite; mermaid, marked, esbuild-wasm, and React UMD assets vendored into `client/public/vendor/`.

### 0.2 Configuration file (repo root, created in Stage 1)

```json
// axiom.config.json
{
  "userName": "Adam",
  "dataDir": "/Users/adamfisher/Library/Application Support/AtlasLocal",
  "models": {
    "dir": "/Users/adamfisher/Library/Application Support/AtlasLocal/models",
    "manifestUrl": null
  },
  "llamaServer": {
    "binary": "auto",
    "chatPort": 8080,
    "embedPort": 8081,
    "ctx": 8192,
    "parallel": 2,
    "extraFlags": ["--jinja"]
  },
  "server": { "port": 5175 },
  "bedrock": { "enabled": false, "region": "us-east-1", "profile": "corp-bedrock" }
}
```

`--jinja` is mandatory — Gemma's chat template misbehaves without it (thinking-token leakage). Sampling defaults for all Gemma calls: `temperature 1.0, top_p 0.95, top_k 64`; router and office-JSON calls override to `temperature 0.2`.

---

## 1. Repository layout

```
axiom-local-v2/
├── axiom.config.json
├── package.json                 # pnpm workspaces: client, server, servers/*
├── client/                      # Vite + React 18 + Tailwind 3
│   ├── public/vendor/           # react UMD, mermaid.min.js, marked.min.js, esbuild.wasm
│   └── src/
│       ├── theme/tokens.ts      # palette + font constants from the mockup
│       ├── lib/{api.ts,sse.ts,store.ts}
│       ├── components/          # Toggle, Chip, StatusBadge, Dot, modals…
│       └── views/{Chat,Plugins,Skills,Projects,Artifacts}/
├── server/
│   └── src/
│       ├── index.ts             # boot: config, dirs, db, llama spawn, routes
│       ├── db/{schema.sql,db.ts}
│       ├── llama/{spawn.ts,client.ts,models.ts}
│       ├── routes/{chat,projects,conversations,artifacts,skills,plugins,models,settings}.ts
│       ├── pipeline/{router.ts,orchestrator.ts,validate.ts,artifacts.ts,events.ts}
│       ├── mcp/{manager.ts,directory.ts,installs.ts,credentials.ts}
│       └── providers/{types.ts,llamacpp.ts,bedrock.ts,registry.ts}
├── servers/                     # built-in MCP servers (Node, MCP SDK)
│   ├── filesystem/index.ts
│   ├── memory/index.ts
│   └── sqlite/index.ts
├── skills/<id>/{SKILL.md,schema.json}        # 9 skills
├── scripts/
│   ├── dev/bootstrap-python.sh
│   ├── office/{build_pptx.py,build_docx.py,build_xlsx.py,build_pdf.py,
│   │           make_default_templates.py,validate_common.py}
│   └── demo/stage{3,4}-demo.md
├── directory/connectors.json
├── packaging/build-portable.sh
└── Documentation/{PRD.md,CLAUDE-CODE-PROMPT.md,reference/axiom-ui.jsx,handoffs/}
```

---

## 2. Data model (better-sqlite3, `dataDir/data/atlas.db`)

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT DEFAULT '',
  created_at INTEGER, settings TEXT DEFAULT '{}'
);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  title TEXT DEFAULT 'New chat', created_at INTEGER, updated_at INTEGER
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT CHECK(role IN ('user','assistant')), kind TEXT DEFAULT 'text',
  payload TEXT NOT NULL,          -- JSON: {text} or full pipeline message object
  created_at INTEGER
);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL, kind TEXT NOT NULL, current_version INTEGER DEFAULT 1, created_at INTEGER
);
CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY, artifact_id TEXT REFERENCES artifacts(id),
  version INTEGER, file_path TEXT, meta TEXT, validation TEXT, payload TEXT, created_at INTEGER
);                                 -- payload = the model JSON that produced this version (edit loop input)
CREATE TABLE skills_state (skill_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1);
CREATE TABLE plugin_installs (
  id TEXT PRIMARY KEY, connector_id TEXT NOT NULL, source TEXT DEFAULT 'directory',
  custom_config TEXT, status TEXT DEFAULT 'installed', enabled_projects TEXT DEFAULT '[]',
  credentials_ref TEXT, last_error TEXT, created_at INTEGER
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
-- memory (owned by servers/memory but same db file, prefix mem_)
CREATE TABLE mem_kv (project_id TEXT, key TEXT, value TEXT, PRIMARY KEY(project_id, key));
CREATE TABLE mem_graph_nodes (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, name TEXT, props TEXT);
CREATE TABLE mem_graph_edges (src TEXT, dst TEXT, project_id TEXT, rel TEXT, props TEXT);
-- mem_chunks becomes a sqlite-vec virtual table when an embedding model is present (Stage 4)
```

Hard isolation invariant (enforced in every query helper, tested in Stage 2): no read path returns rows where `project_id` differs from the request's project context. There is no cross-project query anywhere except the explicit shared-library partition (`project_id = '__shared__'`), which is opt-in per call.

---

## 3. API surface (Express, all under `/api`)

| Method · Path | Purpose |
|---|---|
| GET `/health` | llama-server status, model inventory, dirs, version |
| GET/POST `/projects` · PATCH `/projects/:id` | CRUD; POST body `{name, instructions}` |
| GET/PATCH `/settings` | incl. `activeProjectId`, `selectedModel`, `userName` |
| GET `/conversations?projectId=` · POST `/conversations` · GET `/conversations/:id` | sidebar + load |
| POST `/conversations/:id/messages` | **SSE response** (§4); body `{text}` |
| GET `/skills` · PATCH `/skills/:id` | registry + enable toggle |
| GET `/artifacts?projectId=` · GET `/artifacts/:id` | gallery + detail (versions inline) |
| GET `/artifacts/:id/versions/:v/download` · POST `/artifacts/:id/restore` | file stream; restore sets current_version |
| GET `/models` · POST `/models/refresh` · POST `/models/select` | registry, re-scan models dir, pick chat model |
| POST `/models/bedrock/connect` | body `{region, profile}`; verifies creds (§8) |
| GET `/plugins/directory` | manifest ⨯ install state ⨯ enablement |
| POST `/plugins/installs` · DELETE `/plugins/installs/:id` | install / remove |
| POST `/plugins/installs/:id/restart` · PUT `/plugins/installs/:id/credentials` | lifecycle |
| POST `/plugins/installs/:id/projects` | body `{projectId, enabled}` |
| POST `/plugins/custom` | body `{name, transport, commandOrUrl}` |

---

## 4. Chat pipeline — the heart of the product

`POST /conversations/:id/messages` streams `text/event-stream`. The client renders exactly the staged UI from the mockup; the stages are now driven by real events:

```
event: stage     data: {"stage":"routing"}
event: stage     data: {"stage":"generating","skill":"pptx",
                        "skillChip":"Presentations skill · 4.2k tokens",
                        "extraChip":"axiom_default.potx",
                        "modelChip":"Gemma 4 E4B · constrained JSON",
                        "escalated":false,"edit":false}
event: token     data: {"delta":"…"}            # plain-chat answers only, serif bubble
event: step      data: {"text":"slides JSON emitted — 8 slides, schema-valid first pass"}
event: stage     data: {"stage":"validating"}
event: check     data: {"label":"OOXML schema","ok":true}
event: check     data: {"label":"Recalc skipped — soffice not found","ok":false}
event: artifact  data: {"artifactId":"…","name":"Pipeline_Review.pptx","kind":"pptx",
                        "meta":"8 slides · 1.4 MB","ver":1}
event: assistant_text data: {"text":"Drafted an eight-slide deck…"}
event: done      data: {"messageId":"…"}
event: error     data: {"message":"…","retryable":true}
```

Client stage mapping (identical visuals to mockup): `routing` → stage 0 spinner "Routing — E2B classifying the task…" (label shows the actual router model); `generating` → chips appear + stage 1 spinner "Generating constrained JSON…"; first `step` → stage 2 steps box with trailing "validating…" spinner while in `validating`; `check`s → green/amber chips; `artifact` + `assistant_text` → stage 3 complete. The complete pipeline message object is persisted to `messages.payload` so reloads render identically.

### 4.1 Router

Every user message first hits the router — a constrained-JSON call to the resident Gemma model (E2B if present, else E4B; the UI chip names whichever ran):

System prompt (verbatim):
```
You are a routing classifier inside Axiom. Output ONLY a raw JSON object, no markdown.
Decide what the user's latest message asks for.
intents: chat (conversation/questions), create_doc (make a document/deck/sheet/pdf/diagram/site/component), edit_doc (modify the most recent generated artifact).
skills: pptx docx xlsx pdf md mermaid svg react site, or null when intent is chat.
If intent is edit_doc, skill is the skill of the artifact being edited.
```
Request uses llama.cpp `response_format: {type:"json_schema", json_schema:{schema}}` with:
```json
{"type":"object","additionalProperties":false,"required":["intent","skill"],
 "properties":{"intent":{"type":"string","enum":["chat","create_doc","edit_doc"]},
               "skill":{"type":"string","enum":["pptx","docx","xlsx","pdf","md","mermaid","svg","react","site","null"]}}}
```
The last 3 turns plus the new message are the user content. `edit_doc` additionally requires a prior pipeline message with an artifact in this conversation; otherwise downgrade to `create_doc`. Schema-invalid router output (should be impossible under constrained decoding, but guard anyway): one retry, then fall through to `chat`.

If the routed skill is disabled in `skills_state`, stream a plain assistant message: *"The {Skill name} skill is turned off, so I can't generate that right now. Flip it back on in Skills and ask again — the router will pick it up immediately."* (exact mockup behavior).

### 4.2 Plain chat

`intent: chat` → streamed completion on the selected chat model. System prompt assembled from: base persona ("You are Axiom, a fully on-device assistant…runs entirely on this machine"), the active project's `instructions`, and (Stage 4+) memory recall. Tokens stream via `token` events into the serif bubble; "Thinking…" spinner until first token.

### 4.3 Document generation (`create_doc`)

1. Load `skills/<skill>/SKILL.md` (full playbook, ≤5k tokens) and `schema.json`.
2. Office-JSON call on the best available model for `office_json` (§8 routing): system prompt =
```
You are a document-generation backend. You produce ONLY a raw JSON object conforming exactly
to the schema described below. No markdown, no code fences, no prose, no extra keys.
SCHEMA (described): {schema_description}
DESIGN GUIDANCE: {skill_excerpt}
PROJECT INSTRUCTIONS: {project_instructions}
USER REQUEST: {text}
```
with `response_format json_schema` from `schema.json`. Emit `step` "…JSON emitted — N {units}, schema-valid first pass" on success.
3. **Repair loop:** even constrained decoding can truncate mid-JSON (token limit). On parse/validate failure: retry once with the repair prompt (*"Your previous output failed validation: {error}. Output ONLY corrected raw JSON matching the schema."*); second failure → escalate one tier (E4B→12B→Bedrock) if available, else `error` event with the honest message. Log every repair to `logs/pipeline.log`.
4. Helper execution (office formats): write payload to a temp file, spawn the venv Python:
```
runtimes/python/venv/bin/python scripts/office/build_pptx.py \
  --payload /tmp/axiom-xxxx.json --template skills/pptx/templates/axiom_default.potx \
  --out "<dataDir>/artifacts/<projectId>/<artifactId>/v1/<name>"
```
Helper contract: exit 0 + single-line JSON on stdout `{"ok":true,"file":"…","meta":{"slides":8,"bytes":1471234},"checks":[{"label":"OOXML schema","ok":true},…]}`. Each emitted check becomes a `check` event. Non-zero exit → `error` event with stderr tail.
5. md/mermaid/svg: no Python. md = direct text emit saved as file, rendered client-side with vendored marked. mermaid = model emits mermaid source (plain completion with strict "output only mermaid source" instruction), server saves it, client renders with vendored mermaid in a sandboxed iframe; parse failure triggers the same repair loop. svg = model emits raw SVG, server validates XML well-formedness + `viewBox` presence.
6. react/site: model emits the files payload (`schema.json`: `{"files":{"/App.jsx":"…"},"entry":"/App.jsx"}` — file contents as strings). Server persists files under the version dir. Client bundles in a Web Worker with vendored `esbuild.wasm` (react/react-dom external → importmap to `vendor/` UMD builds), injects into `<iframe sandbox="allow-scripts">` with CSP `default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'`. Checks: "Bundle" (esbuild success), "No external requests" (CSP + a fetch/XHR shim that records attempts; any attempt = amber). Chat shows the mockup's framed mini preview (real iframe, not the placeholder art).
7. Artifact registration: insert/version rows, store the producing JSON in `artifact_versions.payload`, emit `artifact` + `assistant_text` (the model is asked for a one-paragraph summary in the same generation pass via a final plain call on the chat model — keep it under 60 words, serif-rendered).

### 4.4 Targeted edits (`edit_doc`)

Load the latest version's `payload` JSON. Edit call (constrained to the same schema): *"Here is the current document JSON: {json}. Apply this change: \"{text}\". Output ONLY the full corrected JSON object."* Diff old vs new payload at the top-level-array-item granularity (slides / sections / sheets). Rebuild the document (full rebuild is fine — helpers are deterministic), bump version, chips = `Targeted edit · {n} section(s) changed`, steps include "{changed} regenerated — rest unchanged from v{prev}". Artifact card shows the new `v{n}`; Artifacts detail gains the "targeted edit" history row. Gate: editing must never change untouched sections' content (assert by re-rendering old payload sections and comparing extracted text).

### 4.5 Validation chain (per format)

- **pptx/docx/xlsx:** (a) zip + content-types sanity; (b) library round-trip (re-open with python-pptx/docx/openpyxl, assert counts and non-empty text); (c) placeholder grep — extract all text, fail on `{{`, `}}`, or `TODO_`; (d) xlsx formula syntax check (openpyxl tokenizer); (e) **soffice probe**: if `soffice` binary found (`which soffice` + common macOS path `/Applications/LibreOffice.app/Contents/MacOS/soffice`), run headless convert/recalc and scan for `#REF! #DIV/0! #VALUE! #NAME?`; if absent emit the amber check `Recalc skipped — soffice not found` (exact mockup string) for xlsx and pptx-thumbnail equivalents. Try `pip install openxml-audit` in bootstrap; if it installs, add it as check (b0); if not, proceed without (record in handoff).
- **pdf:** pdfplumber text grep for required headings + page-count assertion.
- **md/mermaid/svg/react/site:** as in §4.3.

---

## 5. Skills (registry + playbooks)

Nine skills, ids exactly: `pptx docx xlsx pdf md mermaid svg react site`. For each, `skills/<id>/SKILL.md` (frontmatter: name, ext, triggers, tier, helper; body: design guidance the office-JSON prompt excerpts, ≤4.5k tokens) and `schema.json`. Registry metadata (the ~100-token always-visible tier) is what `GET /api/skills` returns and what the Skills view renders — name, ext label, trigger string, meta/full token counts, helper label, validation chips, tier badge, enabled flag. The mockup's per-skill rows, expandable "MODEL EMITS" schema box, validation-chain chips, and the repair/escalation caption render from this endpoint, not hardcoded.

`schema.json` for pptx (authoritative; docx/xlsx/pdf analogous, all avoiding `anyOf`/`oneOf`/`$ref` per llama.cpp grammar-conversion limits):

```json
{"type":"object","additionalProperties":false,"required":["title","slides"],
 "properties":{
  "title":{"type":"string"},
  "slides":{"type":"array","minItems":1,"maxItems":20,"items":{
    "type":"object","additionalProperties":false,"required":["layout","heading"],
    "properties":{
      "layout":{"type":"string","enum":["title","bullets","two_col","chart","summary"]},
      "heading":{"type":"string"},
      "bullets":{"type":"array","maxItems":8,"items":{"type":"string"}},
      "col_left":{"type":"array","items":{"type":"string"}},
      "col_right":{"type":"array","items":{"type":"string"}},
      "chart":{"type":"object","additionalProperties":false,
        "properties":{"kind":{"type":"string","enum":["line","bar","pie"]},
          "labels":{"type":"array","items":{"type":"string"}},
          "series":{"type":"array","items":{"type":"object","additionalProperties":false,
            "required":["name","values"],
            "properties":{"name":{"type":"string"},"values":{"type":"array","items":{"type":"number"}}}}}},
        "required":["kind","labels","series"]},
      "notes":{"type":"string"}}}}}}
```

docx: `{metadata{title,author}, sections[]{heading, level(1-3), paragraphs[], table{headers[],rows[][]} optional, pageBreakBefore}`. xlsx: `{sheets[]{name, cells[]{ref,value(string|number via two optional typed fields valueText/valueNumber — no anyOf),formula,format}, widths[]}}`. pdf: `{pages[]{blocks[]{kind enum(heading,para,table), text, headers[], rows[][]}}}`.

`make_default_templates.py` (run once in bootstrap) programmatically builds `axiom_default.potx` (title + bullets + two-content + chart + summary layouts, Axiom coral/charcoal theme matching `tokens.ts`), `axiom_default.dotx` (Heading 1–3 + body styles), and a starter xlsx theme — so generation works with zero user templates. Helpers accept `--template`; per-project template libraries are post-v1 (the chip still shows the template filename used).

---

## 6. MCP plugin system

### 6.1 Directory manifest — `directory/connectors.json`

Exactly the nine mockup connectors with the mockup's names, vendors, descriptions, transports, runtimes, and tool lists: `filesystem`, `memory`, `sqlite` (status `bundled`, auto-installed on first boot, connected); `knowledge-core` (status `planned`, url `http://127.0.0.1:7979/mcp`, the six org_* tools in toolsPreview, the AOI-parser warning text); `github`, `jira`, `confluence`, `sharepoint` (status `available`, streamable-http, corp placeholder URLs, token auth); `postgres` (available, stdio via the venv Python, connection-string auth). Schema fields per the design spec already delivered (id, name, vendor, description, icon, category, transport, launch/url, auth, toolsPreview, projectScopable, status, healthCheck, minAxiomVersion).

### 6.2 Lifecycle (server `mcp/`)

- **Built-ins** (Stage 4): three Node MCP servers in `servers/`, built with `@modelcontextprotocol/sdk` (`McpServer` + stdio transport), spawned by the manager with cwd jailed to `dataDir` scopes and env scrubbed to `{AXIOM_PROJECT_ID, AXIOM_DB_PATH, AXIOM_DATA_DIR}`.
  - `filesystem`: tools `fs_read fs_write fs_list fs_search`, root = `dataDir/projects/<projectId>/files/` (created per project); `fs_write` outside root → error; every call appended to `logs/audit.log` (tool, path, project, ts — no contents).
  - `memory`: `memory_search memory_upsert graph_query graph_add_fact` over the `mem_*` tables, always filtered by `AXIOM_PROJECT_ID`. `memory_search`: if an `embeddinggemma*.gguf` exists in the models dir, a second llama-server (`--embeddings`, embedPort) powers sqlite-vec semantic search merged with FTS5; otherwise FTS5-only and the plugin detail panel shows "Semantic recall off — add an EmbeddingGemma GGUF to the models folder" (small dim note under tools).
  - `sqlite`: `sql_query sql_schema`, read-only (`PRAGMA query_only`), file path must resolve inside `dataDir`.
- **Install** (directory remote): create install row, validate URL against allowlist (block private ranges except loopback; loopback explicitly allowed for 7979), attempt MCP initialize with 5 s timeout. Success → `connected`, auto-enable in active project (mockup behavior). Failure → status `error`, `last_error` stored, detail panel shows it. The mockup's animated "Installing…" state is the real pending connect.
- **Custom add**: modal fields → `POST /plugins/custom`; stdio commands must resolve inside the repo/runtimes (no arbitrary host binaries); one-time consent is the modal itself in v1.
- **Per-project enablement**: `enabled_projects` JSON array; the chat tool injector (§6.3) only exposes tools whose connector is enabled in the active project. Card toggle = toggle in active project; detail panel rows = per-project. Captions exactly per mockup.
- **Restart/Remove**: restart tears down and respawns/reconnects (button spinner = real). Remove deletes install + credentials and strips the id from all projects.
- **Knowledge Core probe**: on boot and on `/plugins/directory` fetch, try MCP initialize on `127.0.0.1:7979` (1 s timeout). Respond → flip the entry to `available` live (the reserved card becomes installable with zero code changes). No response → stays `planned` with the dashed card, amber notice, and disabled "Reserved — port 7979" button.
- **Credentials**: AES-256-GCM file store `dataDir/credentials/<ref>.enc`, key in `dataDir/.axiom-key` (chmod 600, generated on first boot). Values never logged, never in the DB, masked in UI exactly as mocked.

### 6.3 Tool use in chat (Stage 4)

When the router says `chat` and the active project has enabled connectors, the completion request includes the OpenAI-format `tools` array (llama.cpp `--jinja` supports Gemma function calling). On `tool_calls` in the response: execute via the MCP client, append tool results, loop (max 4 iterations), then stream the final answer. Render each executed call as a dim chip above the answer: `⚙ fs_list · Filesystem`. **Reliability gate:** run the 10-prompt smoke set in `scripts/demo/stage4-demo.md`; if E4B triggers the correct tool in <7/10, ship tool-use behind a per-message "/tools" prefix instead and record the decision in the handoff — do not silently ship flaky tool calling.

---

## 7. Projects, conversations, artifacts (product behaviors)

- **Active project** is server state (`settings.activeProjectId`). It drives: chat header breadcrumb, where new conversations/artifacts file, plugin toggle context, filesystem server root. Clicking a project card activates it (accent border + "Active" chip per mockup).
- **New chat** creates a conversation in the active project; title = first user message truncated at 42 chars + "…"; sidebar recents = conversations across all projects ordered by `updated_at` (switching to a conversation in another project switches the active project — record this rule in the UI with the breadcrumb).
- Seed data on first boot (mockup parity): the three projects (Lightspeed Axiom active, Client Redline, Org Intel Dev with their exact instruction strings) and the Q3 QBR demo conversation with its two pipeline messages — inserted as fixture rows (`scripts/dev` seed), with the four seed artifacts. The QBR pptx seed artifact gets a real generated file at seed time (run the pipeline helpers during seeding so downloads work).
- **Artifacts on disk:** `dataDir/artifacts/<projectId>/<artifactId>/v<n>/<filename>` (site/react = directory of files). Download streams the file (or a zip for multi-file). Restore sets `current_version` (history rows labeled exactly: current / targeted edit / initial generation, with Restore buttons). "Open preview" renders: office files → extraction-based preview (markitdown text for v1, labeled "text preview"); md/mermaid/svg/react/site → real rendered preview in the sandbox.
- Empty chat state: `What are we building, {userName}?`, subtitle, and the five exact suggestion chips from the mockup; clicking fills the input.
- The footer line, the Local lock badge, the disclaimer string — all verbatim from the mockup.

---

## 8. Model tiers, routing, Bedrock

- **Registry** (`providers/registry.ts`): scan models dir → entries {id, file, sizeGB, present, roles}. E2B row: badge "router", lock icon, never user-selectable (mockup). E4B/12B selectable. Selected chat model persists in settings. Sidebar footer shows `{Model} · resident · 24 GB` (RAM from `os.totalmem()`).
- **Task routing:** `route(task)` returns provider+model: `router` → E2B else E4B; `chat` → user-selected; `office_json`/`code` → 12B if present, else Bedrock if connected **and** user-selected model is Bedrock or escalation triggers, else E4B. **Escalation chip rule (real):** show `Escalated to 12B — office JSON` only when the office call actually ran on a higher tier than the user's selected chat model. When 12B is absent and generation ran on E4B, no fake chip — the model chip just reads `Gemma 4 E4B · constrained JSON`.
- **llama-server management:** one process for the selected chat model (E2B router shares it when E2B file absent). If both E2B and a larger model are present and RAM ≥ 16 GB, run two processes (router pinned). Idle larger models are not unloaded in v1. Health-check loop; crash → restart once → surface error banner in chat.
- **Bedrock provider:** `@aws-sdk/client-bedrock-runtime` Converse/ConverseStream, credentials from the default provider chain (profile from modal). Connect = `ListFoundationModels` (via `@aws-sdk/client-bedrock`) success; failure → modal error state with the real message (no fake success). Structured outputs: use Converse `outputConfig.textFormat json_schema` **only for Claude 4.5+ model ids**; otherwise forced tool-use fallback; never combine with citations. Model menu connected row: `Connected · {region} · structured output`. Office/code tasks route to Bedrock when it's the selected model or when local repair-escalation exhausts tiers.
- **Model downloads (Stage 5):** if `models.manifestUrl` set, `GET manifest.json` (`{models:[{name,tier,quant,url,sha256,sizeBytes}]}`), download with resume + SHA256 verify into models dir, progress in the model menu rows; else rows for absent models show "Place a {tier} GGUF in the models folder" with a Reveal-in-Finder button. Both paths refresh the registry live.

---

## 9. The five stages — each ends in a deliverable

Every stage: work on a branch, finish with all gates green, write `Documentation/handoffs/HANDOFF-<n>.md` (template in CLAUDE-CODE-PROMPT.md), commit, tag `stage-<n>`. A gate failure = hard stop + handoff documenting the failure. Do not start stage n+1 in the same session.

### Stage 1 — Shell, full UI, model online
**Scope:** repo scaffold (pnpm workspaces, TS strict, ESLint); `tokens.ts` with the exact mockup palette/fonts; port `reference/axiom-ui.jsx` into split components under `views/` — **all five views, every component, pixel-faithful**, running on seed fixtures served from the real API (`/projects /conversations /skills /plugins/directory /artifacts /models /settings` returning seeded data); server boot creates dataDir subfolders, opens the DB, applies `schema.sql`, seeds fixtures, **spawns llama-server with the E4B GGUF discovered in the models dir**, `/health` green; **real streaming chat**: plain messages run §4.2 end-to-end (router stubbed to always-`chat` this stage), tokens stream into the serif bubble; pipeline messages render from the seeded QBR fixture; model menu reads the real registry (E4B present; E2B/12B rows show absent state; Bedrock "Add model" opens the modal which returns a clear "Stage 5" notice); all other interactions work against the API with optimistic UI (project create/activate, skill toggles persist, plugin toggles persist, artifact gallery/detail from fixtures).
**Gates:** `pnpm dev` cold-starts everything with one command; `/health` shows the E4B file name; a fresh question gets a real streamed E4B answer in <2 s to first token on the dev machine; every view renders with zero console errors and zero network requests leaving localhost; kill -9 the llama-server process → UI banner appears and recovery works.
**Deliverable 1:** running app — the complete mockup UI live against real APIs, with genuine on-device E4B chat. Demo: open app, ask "what can you do?", watch it stream.

### Stage 2 — Persistence, projects, conversations
**Scope:** full CRUD wired (no fixtures except first-boot seed); recents live-ordered; new chat + title rule; project create modal real; activation semantics (§7); instructions injected into chat system prompt (verify by asking "what are your instructions?"); isolation enforcement helpers + `scripts/test/isolation.test.ts` (create data in two projects, assert zero cross-reads across conversations, artifacts, memory tables, files dirs); conversation reload renders persisted pipeline messages identically; settings persistence (selected model, active project, userName drives the empty-state greeting).
**Gates:** isolation test green; app restart loses nothing; creating a project then chatting files everything under it.
**Deliverable 2:** restart-safe multi-project workspace with proven hard isolation. Demo: two projects, parallel conversations, restart, everything intact.

### Stage 3 — Router, skills, office pipeline, artifacts (the centerpiece)
**Scope:** real router (§4.1) with constrained decoding; 9 skill playbooks + schemas authored; `bootstrap-python.sh` (venv, pinned: python-pptx 1.0.2, python-docx 1.2.0, openpyxl 3.1.5, docxtpl 0.20.2, weasyprint, pdfplumber, markitdown; try openxml-audit); `make_default_templates.py`; the four office helpers with the CLI contract; md/mermaid/svg paths; react/site esbuild-wasm worker + sandbox + vendored assets; full SSE pipeline (§4) with persistence; validation chain (§4.5) incl. soffice probe; artifact registration/versioning/download/restore; targeted-edit flow (§4.4); skill-disabled refusal; suggestion chips trigger real generations; Artifacts view fully live incl. the chat-card → artifact-detail cross-view jump.
**Gates:** for **each of the nine skills**, one prompt produces a real validated artifact end-to-end (scripted in `scripts/demo/stage3-demo.md`); generated pptx opens in Keynote/PowerPoint and docx in Word/Pages without repair prompts; constrained-JSON first-pass validity ≥90% over a 20-prompt office set on E4B (log it) — below 90%, stop and record (decision point: hand-written GBNF or tighter schemas before proceeding); targeted edit leaves untouched sections byte-identical at the extracted-text level; react preview makes zero external requests (assert via the fetch shim).
**Deliverable 3:** the full document factory — "Build a QBR deck" through validated, versioned, downloadable .pptx, and the same for all eight other skills. Demo script included.

### Stage 4 — MCP plugins + memory
**Scope:** everything in §6 — three built-in servers, directory endpoint, install/remove/restart/credentials/custom-add, per-project enablement with the injector, Knowledge Core probe, audit log, chat tool-use loop with the reliability gate, memory layers (KV + graph mandatory; semantic when EmbeddingGemma present) feeding chat system prompts (top-3 `memory_search` hits injected with a "Known context:" prefix), plugin detail panels fully live (real `listTools` results replace toolsPreview after connect).
**Gates:** install→enable→invoke demo passes ("list the files in this project" triggers `fs_list` and answers from the result); cross-project tool isolation test green (connector enabled only in B is invisible to chat in A); credentials round-trip encrypted, `grep -r` of dataDir shows no plaintext; mock MCP server on 7979 flips Knowledge Core to available live and installs cleanly; tool-reliability smoke set decision recorded.
**Deliverable 4:** working plugin platform — directory, lifecycle, per-project tools live in chat, memory recall on, Knowledge Core slot proven activatable. Demo script included.

### Stage 5 — Tiers, Bedrock, packaging, polish
**Scope:** model registry UI complete (download-or-place flows, progress, live refresh); tier routing + honest escalation chips (§8); Bedrock connect for real (verify, persist, route office/code, structured outputs for 4.5+); hardware line real; second-llama-server topology when E2B/12B appear; `packaging/build-portable.sh` → `dist/AtlasLocal/` folder with `start.command` (bundles node runtime via pkg or a vendored node, the venv swapped for python-build-standalone, vendored llama-server binary, client build served by Express; config rewritten to relative `dataDir` fallback when the macOS path is absent); polish pass: keyboard nav + visible focus, `prefers-reduced-motion` (spinners → static, no stage animations), empty states for every view (no conversations / no artifacts / no plugins filtered), error toasts, log rotation; final parity audit against Appendix A with a checked checkbox per row committed as `Documentation/handoffs/PARITY.md`.
**Gates:** dropping a 12B GGUF into the models folder + refresh → registry shows it, office tasks route to it, escalation chip appears when chat model is E4B; Bedrock connect fails gracefully without creds and succeeds with them (test both); portable folder runs on a clean macOS account with no Homebrew on PATH; every Appendix A row checked or explicitly waived by Adam.
**Deliverable 5:** the finished product — tiered models, Bedrock upgrade path, portable distributable, signed parity matrix.

---

## 10. Non-functional requirements

TypeScript strict everywhere; no `any` in exported signatures. No telemetry, no external calls except: llama-server localhost, Bedrock when connected, model downloads when manifestUrl set, corp connector URLs the user installs. Logs in `dataDir/logs/` (app, pipeline, audit), 5 MB rotation, never containing message contents beyond the pipeline log's payload hashes. SSE keep-alives every 15 s. All llama.cpp calls set explicit `max_tokens` (router 64, office 3072, chat 1024 default). Repo conventions, commit discipline, and handoff format live in CLAUDE-CODE-PROMPT.md.

## 11. Risks the executing agent must respect

E4B constrained-JSON quality is the central bet — the Stage 3 90% gate exists to surface it early; do not soften the gate, do not fake validation results. Gemma chat-template drift across llama.cpp versions — pin the version in HANDOFF-1 and never upgrade mid-build. weasyprint has native deps (pango/cairo) — bootstrap installs via `brew install pango cairo gdk-pixbuf libffi` (document in handoff; if blocked, pdf helper falls back to reportlab and the handoff says so). esbuild-wasm first-bundle latency — warm the worker at app load. Tool-calling reliability — gated, with the /tools fallback. Never ship a fake success state: every chip, spinner, and check in the UI must reflect a real event.

---

## Appendix A — UI parity matrix (every element in `reference/axiom-ui.jsx`)

Every row ships. "Stage" = when it becomes real (UI itself exists from Stage 1).

| # | Element / interaction | Stage | Implementation note |
|---|---|---|---|
| A1 | Sidebar brand block (gradient A, "Axiom", "Local · on-device") | 1 | static, tokens.ts |
| A2 | New chat button | 2 | creates conversation in active project |
| A3 | Nav: Projects/Artifacts/Plugins/Skills with active accent state | 1 | client router |
| A4 | Recents list, active highlight, click-to-open | 2 | live query, updated_at order |
| A5 | Sidebar model footer `{model} · resident · {RAM} GB` | 1 (model) / 5 (tier label) | registry + os.totalmem |
| A6 | User row "AF · Adam" | 1 | settings.userName |
| A7 | Chat breadcrumb `{project} › {title}` | 2 | active project + conv title rule |
| A8 | "Local — nothing leaves this machine" lock badge | 1 | static; hidden when Bedrock selected, replaced by `Bedrock connected` blue badge (new, required) |
| A9 | Empty state: greeting w/ userName, subtitle, 5 suggestion chips filling input | 1 (UI) / 3 (chips trigger real runs) | exact strings |
| A10 | User message bubbles | 1 | persisted Stage 2 |
| A11 | Plain assistant serif text + "Thinking…" spinner | 1 | real stream |
| A12 | Pipeline stage 0 "Routing — {router model} classifying…" | 3 | router event |
| A13 | Skill chip / template chip / model chip row | 3 | from `generating` event |
| A14 | "Escalated to 12B — office JSON" amber chip | 5 | honest rule §8 |
| A15 | Stage 1 "Generating constrained JSON…" spinner | 3 | |
| A16 | Steps box with mono check lines + trailing "validating…" spinner | 3 | step/stage events |
| A17 | Validation chips green/amber incl. exact "Recalc skipped — soffice not found" | 3 | check events |
| A18 | Inline mermaid preview | 3 | real mermaid render in sandbox (replaces placeholder art) |
| A19 | Inline site preview frame w/ traffic dots + "sandbox · csp locked · offline" caption | 3 | real iframe; caption kept |
| A20 | Artifact card (icon/name mono/meta/v-chip/eye/download/history) | 3 | download real; eye→preview; history→artifact detail |
| A21 | Card click → Artifacts view with detail open | 3 | cross-view jump kept |
| A22 | Input: textarea Enter-send/Shift-Enter, plus + paperclip icons, busy spinner on send | 1 | paperclip = disabled tooltip "File uploads post-v1" (new, required) |
| A23 | Model pill (cpu/cloud icon, label, chevron) | 1 / 5 | |
| A24 | Footer disclaimer line | 1 | verbatim |
| A25 | Model menu: ON-DEVICE header, E2B locked "router" row, E4B, 12B rows w/ sizes, check on selected | 1 (real inventory) / 5 (selection routing) | absent models show place/download state |
| A26 | Model menu CLOUD UPGRADE section, Add model ↔ Connected states | 5 | real Bedrock verify |
| A27 | Model menu hardware footer line | 1 | real values |
| A28 | Bedrock modal (region, profile, provider-chain note, Connecting state) | 5 | real connect, real errors |
| A29 | Plugins header + sub + "Add custom server" | 1 / 4 | |
| A30 | Filter pills with live counts + SSRF allowlist chip | 4 | counts from directory endpoint |
| A31 | Plugin cards: icon, status badges (Connected/Installing spinner/Available/Planned), vendor, desc, transport `stdio · bundled` badge, tools count, projects count, toggle | 4 | installing = real pending connect |
| A32 | Card toggle = enable in active project | 4 | |
| A33 | Detail panel header/status/desc | 4 | |
| A34 | Knowledge Core dashed card + amber reserved notice w/ AOI-parser text + disabled "Reserved — port 7979" | 4 | live probe flips it |
| A35 | CONNECTION mono block | 4 | real command/url |
| A36 | TOOLS list | 4 | live listTools after connect; toolsPreview before |
| A37 | CREDENTIALS masked rows + "Stored encrypted…" note | 4 | encrypted store |
| A38 | ENABLED IN PROJECTS toggles + caption | 4 | |
| A39 | Restart (spinner) / Remove / Install / Installing buttons | 4 | all real |
| A40 | Add-server modal: name, 4 transport pills, command/url, bundled-runtimes hint, disabled-until-named Install | 4 | |
| A41 | Skills header + progressive-disclosure explainer | 1 | |
| A42 | 9 skill rows: icon, name, ext, triggers, tok counts, helper, tier badge, toggle, dim-when-off | 1 (from API) / 3 (gating real) | |
| A43 | Skill expand: MODEL EMITS schema box, VALIDATION CHAIN chips, repair/escalation caption | 1 / 3 | schema box shows real schema.json |
| A44 | † footnote box (soffice degradation) | 1 | verbatim |
| A45 | Skill-disabled refusal message in chat | 3 | exact wording |
| A46 | Projects header, New project button + modal (name, instructions, isolation caption, disabled-until-named) | 2 | |
| A47 | Project cards: active accent border + Active chip, Isolated badge, instructions, stats, click-to-activate | 2 | stats live (chats/templates count = artifacts of template kind post-v1 → show artifacts count; memory = mem table bytes) |
| A48 | Shared library dashed card | 2 (card) / 4 (`__shared__` partition functional via memory tools) | |
| A49 | Artifacts header + "no CDN, ever" sub | 1 | |
| A50 | Artifact cards: icon/name mono/project/v-chip/meta, selected state | 3 | |
| A51 | Artifact detail: Open preview / Download, validation chips, version history rows (current/targeted edit/initial) with Restore, byte-exact caption | 3 | restore real |
| A52 | Cross-cutting: new artifacts file to active project; toggles scoped to active project; Bedrock selection reflected in pill + sidebar footer | 2–5 | |

*New required elements not in the mockup (additions, minimal):* A8 Bedrock badge variant, A22 paperclip tooltip, error toast + llama-crash banner, absent-model rows in the model menu, plugin `error` status badge (red dot) for failed remote connects.

— End of PRD —
