# HANDOFF 3 — Router, skills, office pipeline, artifacts + product masters

Status: COMPLETE
Date: 2026-06-10
llama.cpp version: `version: 8680 (15f786e65)` — unchanged from the HANDOFF-1 pin.
Python toolchain: venv on **python 3.13.7** (`/opt/homebrew/opt/python@3.13`) — brew's python@3.14 has a broken pyexpat (dlopen symbol error) and the office wheel ecosystem lags 3.14. Pinned wheels: python-pptx 1.0.2 · python-docx 1.2.0 · openpyxl 3.1.5 · docxtpl 0.20.2 · weasyprint 69.0 · pdfplumber 0.11.9 · markitdown 0.1.6 · **openxml-audit 0.7.5 (installed — check b0 active)**. Brew installed for weasyprint: pango, gdk-pixbuf, libffi (cairo was present).
**soffice is present on this machine** (`/opt/homebrew/bin/soffice`) — recalc/convert checks run for real and are green; the amber skip strings remain the degradation path on machines without it.

## What shipped

- `scripts/dev/bootstrap-python.sh` (idempotent) + `scripts/office/make_default_templates.py` → `axiom_default.potx/.dotx/.xlsx` (Axiom coral theme stamped into the pptx theme part; .potx/.dotx are structurally pptx/docx — python-pptx/docx can't write template content-types; transparent to the helpers).
- `scripts/office/{validate_common,build_pptx,build_docx,build_xlsx,build_pdf}.py` — the §4.3.4 CLI contract (single-line JSON: ok/file/meta/checks). Chains per §4.5: openxml-audit (non-strict), zip sanity, library round-trip, placeholder grep, formula tokenizer (xlsx), soffice convert/recalc with error-marker scan, pdfplumber text grep + page count.
- `skills/` — 10 playbooks + schemas (all llama.cpp-grammar-safe; product schema verbatim §A3; md/mermaid/svg are direct emissions with `{"emit":"text"}` markers).
- Server pipeline: `pipeline/{skills,router,validate,artifacts,orchestrator,product,projections}.ts`, `llama/json.ts` (constrained + plain non-streaming calls, thinking disabled). Real router (§4.1 + product enum + site/react discriminator), full SSE pipeline with live step events, §4.3.3 repair loop (one repair, then escalate-if-available, else honest error), helper spawn, artifact versioning + downloads (zip for multi-file) + restore + markitdown text preview, targeted edits for all kinds (office whole-payload + §4.4 diff; react/site file-map diff; md/mermaid/svg re-emission; product field-scoped per §A4.2 with server merge + merge assertion), product validation chain with exact KC skip-amber strings, A5 state machine (forward-only, ambers stamped verbatim into notes), projection engine (6 local kinds; prototype_react is the one model-assisted projection), A7 bundle (zip via /usr/bin/zip, .mcp.json omitted until KC connects).
- Client: vendored `marked/mermaid/esbuild-wasm(+wasm)/react+react-dom UMD` under `public/vendor/`; esbuild warmed at app load; sandboxed previews (CSP `default-src 'none'`, fetch/XHR/WS shim reporting blocked attempts); mermaid preview runs the authoritative `mermaid.parse` and reports a Parse check chip (failure renders an honest fix-hint, not a fake success); react preview bundles in-browser with react externals mapped to the vendored UMDs; office kinds get extraction-based "text preview"; live pipeline card (steps upsert by label, pending spinner rows); artifact panel with version pills + Restore + product sections (state badge/timeline/Promote with unmet rules, PROJECTIONS rows with deterministic/generated tags + stale chips + regenerate/download, Export bundle gated at `specified`); tenth Skills row (product); sixth suggestion chip (A58).
- `scripts/demo/stage3-demo.md` + `stage3-product-demo.md`; gate runners `pnpm test:pipeline-validity` + `pnpm test:stage3-e2e`.

Mid-stage additions from Adam's live feedback:
- **Artifact drawer** — chat header gets a box icon with a count badge (artifacts in the open conversation); clicking opens a drawer listing this chat's artifacts plus all project artifacts; selecting one opens the detail panel.
- **Claude.ai-style document viewer** — the artifact panel widened to ~52vw; office artifacts render as real paginated pages (server converts pptx/docx/xlsx → PDF via soffice, cached per version, streamed chromeless; pdf streams natively); markitdown text extraction remains the fallback when soffice is absent. Download button reads "Download as PPTX/DOCX/…".
- **Seed artifact backfill** (PRD §7 compliance, deferred from Stage 1): boot generates real Q3-Business-Review.pptx files (v1 + targeted-edit v2) from deterministic payloads when missing; `scripts/dev/backfill-seed-artifact.ts`.
- **Sandbox hash-navigation fix** — preview documents serve from blob URLs, not srcdoc (a generated landing page setting `location.hash` was navigating the sandbox to the Axiom app itself).
- **Mermaid honesty chain** — tightened server lexical check (unquoted parens in flowchart labels — the dominant real failure), authoritative `mermaid.parse` in the sandbox surfaces a Parse check chip, parse failures render a fix-hint; text-skill targeted edits added so "fix the diagram" re-emits through validation+repair.
- **react/site targeted edits fixed** (were falling into the Python-helper path); file-map diff by key.
- **Error boundary** at the app root — UI crashes degrade to an inline error with Retry, never a white screen.

## Gate results

- **Constrained-JSON first-pass validity (E4B)** — PASS. Office 20-prompt set: **19/20 = 95%** (logged per-prompt in `logs/pipeline.log`; the single miss was `fetch failed` — a dev-loop tsx reload killed llama mid-request, an infrastructure casualty counted against the number, not a model validity failure). Product 10-prompt set: **10/10 = 100%**.
- **Nine skills end-to-end** — PASS (final run, see `STAGE3 E2E` below): every skill produced a validated artifact through the real API with zero blocking warns; pptx/docx/xlsx ran the full helper chain incl. openxml-audit and real soffice convert/recalc.
- **Targeted edit byte-identity** — PASS: deck edit changed only the targeted slide(s); all untouched slides extracted-text-identical (asserted per slide).
- **Product lifecycle** — PASS: define (KC skip-ambers present) → promote endorsed → 3 field-scoped edits with **all untouched fields byte-identical via API assertion** (and server-side merge assertion) → promote specified → 5 deterministic projections → bundle zip export.
- **Deterministic projection idempotence** — PASS: concept_docx (extracted text) and concept_md byte-identical across regenerations from an unchanged payload.
- **React/site previews offline** — PASS: CSP-locked iframes; the fetch shim chip shows "No external requests"; bundling via local esbuild-wasm; react/react-dom from vendored UMDs.
- **Opens in Keynote/PowerPoint, docx in Word/Pages** — soffice headless convert green on every generated office file (the executable proxy); the literal Keynote/Word open is a manual step in `stage3-demo.md` #11 for Adam.
- **Skill-disabled refusal** — exact wording wired (`stage3-demo.md` #13 demonstrates).
- **e2e history, honestly:** run 1 failed at the site prompt (router sent it to react — discriminator line + explicit prompt fixed it). Run 2 failed the product define (create_doc description didn't mention products — fixed) AND revealed that product edits routed create_doc, silently creating new masters — fixed with a router hint plus a deterministic rule (one product master per conversation: create_doc/product with an existing in-conversation product ⇒ edit_doc on it), and the e2e now asserts edited fields actually grew. Run 3 (final code): **15/16 checks green** — all nine skills (13/13 checks each for office kinds incl. openxml-audit + real soffice), targeted-edit byte-identity (slides[3] changed, 4 untouched identical), product lifecycle (define with KC skip-ambers → endorsed → three field-scoped edits with untouched fields byte-identical → specified → five deterministic projections). The single failure was the TEST's extraction helper: bare `markitdown` lacks the docx converter — `markitdown[all]==0.1.6` installed + pinned in bootstrap, then gate 4 verified standalone: **projection idempotence PASS** (concept_docx extracted text + concept_md byte-identical across regenerations) and **bundle export PASS**.
- **DFS-branded output (Adam mid-stage requirement, verified visually page-by-page):** `Documentation/DFS Slide Library - 2026.pptx` stripped of its 286 slides into `skills/pptx/templates/dfs_default.potx` (1.5 MB, masters/layouts/theme intact; preferred over axiom_default when present). Generated decks carry the full Ally brand (title slide, header bands, footer, theme chart colors); chart slides place the chart into the content placeholder's geometry (the 'Title Only' overlap bug is fixed). DFS palette (#371447/#650360/#26A697) extracted from the theme and applied across docx (Title/Heading styles + purple table headers with white bold text), xlsx (header fills), and pdf (heading rule + table headers). All four office types rendered to PDF and reviewed visually.
- **Web-kind output quality:** site/react sandboxes get a Claude-artifact-style base stylesheet (generated CSS still wins); a validation gate catches literal backslash-n sequences and JSON fragments in emitted file contents and feeds the repair loop (the "meaning of life" failure mode).

## Decisions made

1. **Router/field-router max_tokens 192, not the PRD's 64** — Gemma sometimes emits reasoning despite `enable_thinking:false`; 64 hit finish=length before constrained output began.
2. **Mermaid server-side check is lexical** (diagram-type line, balanced quotes, unquoted-parens-in-flowchart-labels — the empirically dominant failure); the authoritative parse is the client's vendored `mermaid.parse`, surfaced as a chip. Both feed the repair loop (server at generation, user-visible hint at render).
3. **Helper checks with "skip" in the label are non-blocking ambers** (the soffice/KC pattern); any other failed check blocks and triggers repair/honest error.
4. **Bundle zips via `/usr/bin/zip`** (macOS built-in) rather than an npm zip dep.
5. **`.potx/.dotx` are content-type-plain pptx/docx packages** (python-pptx/docx limitation) — helpers open them by path; outputs are unaffected.
6. **site vs react routing**: the v2 mockup merges them; the router got a one-line discriminator (static HTML → site, interactive → react). Ambiguous prompts may still land on react — both paths produce a validated offline sandbox artifact.
7. **Bundle/No-external chips for react/site are computed live at render** (real esbuild result + fetch-shim count), not persisted server-side — the sandbox re-proves them on every view.
8. **Office helper meta** drives the artifact meta string (e.g. "5 slides"); mockup's richer strings return when templates carry names (post-v1).

## Known issues / deferred items

- Office artifact names derive from the model's title and can be long (slug-capped at 48 chars); xlsx/pdf fall back to generic names when payloads lack titles.
- `prototype_react` projection is model-assisted and not idempotent by design (labeled `generated` in the UI per §A6).
- Escalation chips (A14) remain dormant until a 12B GGUF lands (Stage 5 gate); office runs honestly chip `Gemma 4 E4B · constrained JSON`.
- Plain-chat markdown still renders raw in the serif bubble (artifact md renders properly via marked); polish candidate for Stage 5.
- Validity sweep should be re-run without concurrent dev-loop reloads if Adam wants a clean 20/20 number.
- `confluence_page`/`jira_epics` projections 501 until Stage 4 connectors.

## Exact entry point for the next session

- Branch: `main` (stage-3 merged + tagged `stage-3`).
- Stage 4 first task: the three built-in MCP servers (`servers/{filesystem,memory,sqlite-or-per-directory-decision}`) with `@modelcontextprotocol/sdk` — note HANDOFF-1 decision 5: the v2 directory has filesystem + axiom-memory built-ins (sqlite was dropped from the directory; confirm with Adam whether to build it anyway per PRD §6.2).
- Then: install/remove/restart/credentials/custom-add lifecycle, per-project tool injector + chat tool-use loop with the 10-prompt reliability gate (/tools fallback decision), memory layers (FTS5-only — no EmbeddingGemma GGUF on disk; semantic recall stays off until one lands), KC probe on 7979 + mock-KC test flipping product checks from skip-amber to live, mock-connector push tests for the two push projections, chat writeback path proof.
