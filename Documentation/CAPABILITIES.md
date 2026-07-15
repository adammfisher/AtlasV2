# Atlas — Current Operational Capabilities

Every capability below is **test-verified** (Playwright spec or live-API eval;
evidence links in `PARITY_MATRIX.md`) and **deployed** to the CloudFront app
unless marked otherwise. Last verified: 2026-07-15.

## 1 · Conversation

| Capability | Features |
|---|---|
| Chat with Claude on Bedrock | Streaming SSE responses; model picker (per-project remembered model); stop mid-generation keeps the partial; regenerate; edit any prior message (replace-forward with indicator); copy message; per-code-block copy buttons |
| Extended thinking | Toggle per message; reasoning streams live AND persists — collapsible "Thinking" block in history after reload |
| Response styles | Normal / Concise / Explanatory / Formal per chat (composer menu), plus a custom style generated from a pasted writing sample in one model call |
| Long conversations | Rolling summary compaction — facts from turn 1 recallable after 30+ turns (spec-proven) |
| Context surfaces | Project instructions injected; cross-chat project memory recalled; knowledge-file passages cited inline as chips |
| Voice dictation | Web Speech API — mic appends final transcripts to the composer; hidden on unsupported browsers |
| Error recovery | Honest error messages with a Retry affordance; a wedged constrained call aborts at 150s instead of spinning; streams survive tool crashes |
| Streaming resilience | Every token arrives on a 50kbps connection; tab-close aborts server-side and persists the partial; 15s keep-alives hold CloudFront's origin window |
| Keyboard | Enter sends · Shift-Enter newline · Esc closes modals · Cmd/Ctrl-K focuses chat search |
| Incognito chats | Ghost button → banner, never listed, no memory capture, destroyed on leave |
| Organization | Rename (hover pencil), content search, bulk delete, suggested prompts; **new chats land in a neutral General project** — project chats only from a project workspace |
| Sharing & export | Read-only conversation share links (7-day, revocable); export single chat as Markdown or JSON; export ALL chats as a zip with manifest |
| Feedback | Thumbs up/down persist across reloads |

## 2 · File reading (upload → ask)

| Capability | Features |
|---|---|
| PowerPoint (.pptx) | Slide-by-slide content: titles, bullets, tables, **chart series values**, speaker notes; per-slide addressing ("slide 5"); 22MB decks via presigned S3 upload |
| Word (.docx) | Headings, paragraphs, table rows verbatim |
| Excel (.xlsx) | Every sheet; formulas visible as text with cached values ("=SUM(B2:B3) → 36") |
| PDF | Page-specific questions; tables; scanned/no-text PDFs get an honest "can't read this" instead of a hallucinated summary |
| CSV/TSV | Exact row counts and aggregates via the deterministic `analyze_table` tool (mean/sum/min/max/count) — never model-guessed |
| Code & data | .py .js .ts .json .yaml .md .txt .html .xml .ipynb + more, read verbatim with comprehension (computed answers, not recall) |
| Images | PNG/JPEG vision, multiple images per message |
| Multi-file | Mixed types in one message, all referenced in one answer |
| On-demand reading | `read_document` tool opens any attachment or project knowledge file mid-conversation (slide ranges, sheet names); `list_documents` enumerates what's readable |
| Honesty guarantees | Unsupported types refuse visibly before send; extraction failures state the real reason; send-during-upload queues with a banner and fires when ready — no silent drops, no answer-before-read |

## 3 · File & artifact creation

| Capability | Features |
|---|---|
| PowerPoint decks | 6–12 slide decks from a prompt in ~30s: branded template, varied layouts (title/section/bullets/two-col/stat/quote/chart/closing), real charts; edit round-trips create new versions |
| Word documents | Headings/sections/tables; edits round-trip |
| Excel workbooks | **Working formulas** (recompute on open), multi-sheet models; edits round-trip |
| PDFs | Multi-page documents via weasyprint; edits round-trip |
| React apps | Multi-component interactive apps: forms mutate state, derived values recompute, tabs switch — bundled offline by esbuild-wasm into a CSP-locked sandbox (zero network); build errors surface with a one-click **Try fixing** that routes the error back to chat |
| Static sites | Sandboxed pages, no cookie access, external requests blocked and counted |
| SVG / Mermaid / Markdown | Icons and illustrations (prose-wrapped emissions healed automatically); diagrams with parse validation and graceful syntax-error surfaces; rendered markdown docs |
| Product definitions | Master JSON with deterministic projections (concept page, BRD, gate deck, diagram, prototype) |
| Validation pipeline | Schema validation with a repair loop (validator feedback fed back, retry, tier escalation) — proven live: hostile input fails first pass, repairs, lands valid |
| Versioning | Every edit bumps a version; version list browsable in the panel; restore any version; per-version downloads (zip for multi-file) |
| Sharing | 7-day share links; browser-renderable kinds (svg/pdf/html/md/png/json) open as **viewable pages**, office binaries download |
| Gallery | Cross-chat Artifacts view: every artifact in every project, kind filters, project select, downloads |

## 4 · Skills system

| Capability | Features |
|---|---|
| Progressive disclosure | Chat prompt carries ZERO skill text; the matched skill's playbook loads only when the router selects it |
| Routing | 20/20 on the routing eval via the deployed Bedrock path — creation verbs route to the right skill; statements/questions never trigger accidental document generation |
| Governance | Per-skill enable/disable in the Skills view; disabled skills refuse honestly; state persists |

## 5 · Plugins / MCP connectors

| Capability | Features |
|---|---|
| Remote MCP servers | Add any streamable-HTTP server by URL from the UI — verified in production against a real public server (mcp.deepwiki.com): connect → tools listed → invoked in chat with grounded answers |
| Scoping | Per-project enablement + **per-chat toggles** in the composer menu; disabled connectors never reach the model |
| Directory honesty | Planned connectors labeled "Planned — not yet available" (no dead Connect buttons); local-only stdio bundles show "unavailable" on the deployed app |
| Credentials | AES-256-GCM, persisted in DynamoDB (survives Lambda cold starts), write-only API — never echoed to the client or the model |
| Robustness | 30s tool timeout; a server killed mid-call surfaces an honest error, the stream finishes, the composer recovers |

## 6 · Web

| Capability | Features |
|---|---|
| Search | DuckDuckGo html + lite endpoints with jittered backoff — 10/10 reliability eval; honest failure text when genuinely unavailable |
| Citations | Search-grounded answers render inline links to the actual source URLs (tool-result URLs only — never invented) |
| Page fetch | Any pasted URL: readable text extraction + embedded SPA/JSON data mining |
| Scoping | Per-chat web toggle (global default), off = the tools don't exist for the model |

## 7 · Memory & projects

| Capability | Features |
|---|---|
| Memory engine | 14/14 eval on BOTH local and deployed stacks: semantic recall, paraphrase dedup, contradiction supersede with tombstones, remember/forget tools, knowledge-graph facts with two-way entity recall |
| Cross-chat recall | Facts from one chat recallable in any other chat of the project — including still-queued extractions (JIT flush) |
| Hygiene | Forget removes every storage layer (vector + lexical sweeps); deleting a conversation purges its derived facts and queued extractions; the extractor refuses transient tool-state and sensitive categories |
| Projects | Hard isolation (verified on deployed DynamoDB/S3 Vectors — 8/8); per-project instructions; per-project model memory |
| Knowledge files | Uploads index into project knowledge (chunked + embedded); page-level RAG answers in other chats; answers cite the source file as a chip |
| Memory UI | Modal browse/edit of both scopes; per-chat remember toggle |

## 8 · Accounts (added 2026-07-15)

| Capability | Features |
|---|---|
| Sign-in | Simple username/password login (users.config.json — no Cognito by design); stateless HMAC tokens; 30-day cookie + header auth; server-side 401 gate on every API |
| Workspace separation | COMPLETE per-account partitioning: chats, projects, artifacts, memory (including vector indexes), settings, model selection — verified by spec (cross-account access is a 404, not a leak) |
| Model limits | Per-account model allowlist enforced at the picker, the select API (403) AND the inference path (out-of-list selections clamp) — adammfisher: all models; susan: Haiku + Nova; demo: Nova only |
| Zero migration | The primary account owns all pre-accounts data (empty partition prefix); other accounts start clean |

## 8b · Platform

| Capability | Features |
|---|---|
| Deployment | Scale-to-zero AWS: Lambda (streaming Function URL) + CloudFront + DynamoDB single-table + S3 Vectors + a separate Python office Lambda; deploy scripts for app, client and office |
| File durability | Uploads and artifacts mirror to S3; any Lambda instance hydrates on demand; extraction results cached beside the upload |
| Theming & layout | Dark/light theme toggle; mobile layout (390px) without horizontal overflow |
| Gallery & navigation | Sidebar: Chats / Projects / Plugins / Skills / Artifacts; deep links (/c/<id>) restore chats |

## Known limitations (tracked, not hidden)

- **LaTeX in chat** renders as raw text — katex is not vendored (matrix X3b, @red).
- **Legacy Office** (.doc/.ppt/.xls) reads locally via markitdown only; the deployed app asks for the modern format.
- **Graph-edge purge** on conversation delete covers notes/KV; edges are swept only by scope wipe.
- **Credential encryption** key shares the DynamoDB table with ciphertexts (single-account deployment; KMS envelope is the upgrade path).
- Model-quality variance: audits ran on Nova 2 Lite and Claude Haiku 4.5 — tool-use-heavy flows are strongest on Claude models.
