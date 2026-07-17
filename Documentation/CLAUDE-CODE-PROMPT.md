# Claude Code Operating Prompt — Axiom Local v2

You are building Axiom Local v2 for Adam Fisher. This document is your standing instructions; `Documentation/PRD.md` is the requirements contract; `Documentation/reference/axiom-ui.jsx` is the visual contract. Read all three fully before writing any code. When this document and the PRD conflict, the PRD wins. When the PRD and the reference JSX conflict on visuals, the JSX wins.

## Who you're building for

Adam communicates directionally and expects intent to be interpreted and executed. He phases work sequentially with acceptance criteria, stops on failures rather than papering over them, and expects honest reporting. If an output is missing or a gate fails, say so plainly in the handoff — never simulate success, never soften a gate, never fake a validation result. Every spinner, chip, and check in the UI must be backed by a real event.

## Hard rules

1. **One stage per session.** Execute exactly one PRD stage, finish with gates green (or a documented hard stop), write the handoff, commit, tag `stage-<n>`, and end. Never begin the next stage in the same session.
2. **Stop on gate failure.** A failed gate means: stop work, write `HANDOFF-<n>.md` with status FAILED, the exact failure, what you tried, and your recommended decision for Adam. Do not work around a gate.
3. **Pin everything.** llama.cpp version (record `llama-server --version`), every npm and pip dependency exact-versioned. Never upgrade a pinned dependency mid-build.
4. **No CDN, no telemetry, no Docker, no sudo.** All client assets vendored. The only permitted network: localhost services, `brew install llama.cpp` / `brew install pango cairo gdk-pixbuf libffi` during dev bootstrap, npm/pip installs during dev, Bedrock when the user connects it.
5. **The model path is fixed:** `/Users/adamfisher/Library/Application Support/AtlasLocal/models`. Discover GGUFs there; never move or rename them; E4B is the only guaranteed file — the app must be fully functional with E4B alone.
6. **Honest model chips.** The UI names the model that actually ran (router chip, generation chip, escalation chip per PRD §8). No aspirational labels.
7. **Isolation is sacred.** Any code path that could read across `project_id` boundaries (other than the explicit `__shared__` partition) is a defect, even if no test catches it.
8. **Verify, don't assume.** After building each feature, run it: start the dev servers, hit the endpoint, generate the document, open the file. Stage gates are checked by execution, not by reading your own code.

## Conventions

TypeScript strict; ESM throughout; pnpm workspaces; Prettier defaults; server runs via `tsx watch`. Client state: React Query for server state, plain useState/context for UI state — no Redux. Styling: Tailwind for layout/spacing, the `theme/tokens.ts` constants (exact hex values from the reference JSX) via inline style for all colors, serif/mono font constants as in the reference. Component structure mirrors the reference JSX's component boundaries (Sidebar, ChatView, PipelineMessage, ModelMenu, PluginsView, PluginCard, PluginDetail, AddServerModal, SkillsView, ProjectsView, NewProjectModal, ArtifactsView, ArtifactDetail, BedrockModal, Toggle, Chip, StatusBadge) — split into files, keep the names.

Commits: small, imperative, scoped (`stage1: spawn llama-server with discovered E4B`). Branch `stage-<n>`, merge to main at stage completion, tag.

Tests: gate-critical behaviors get scripts under `scripts/test/` runnable with `pnpm test:<name>` — at minimum `isolation` (Stage 2), `pipeline-validity` (Stage 3, logs the 20-prompt first-pass percentage), `plugin-isolation` and `credentials-at-rest` (Stage 4). Tests hit the real running server and real model; no mocked inference in gate tests.

## Handoff template (`Documentation/handoffs/HANDOFF-<n>.md`)

```
# HANDOFF <n> — <stage name>
Status: COMPLETE | FAILED
Date / llama.cpp version / model files present:
## What shipped (files created/modified, one line each)
## Gate results (each gate: PASS/FAIL + evidence — command run, output, numbers)
## Decisions made (anything the PRD left open, with rationale)
## Known issues / deferred items
## Exact entry point for the next session (branch, first task, open questions for Adam)
```

## Stage entry checklist (every session)

1. Read this file, the PRD in full, and the latest handoff.
2. `git status` clean, on main, previous stage tag present.
3. State your file plan for the stage in one short message, then execute without waiting.
4. Bootstrap check: `pnpm install` clean, `bash scripts/dev/bootstrap-python.sh` idempotent (Stage 3+), `llama-server --version` matches the pin (Stage 1 sets it).

## What not to do

Do not fork or vendor LibreChat code. Do not use Sandpack or any CodeSandbox service. Do not use MongoDB — better-sqlite3 only. Do not add an ORM. Do not introduce Electron/Tauri in stages 1–5 (the app is browser + local server; shell packaging is `start.command` in Stage 5). Do not store credentials in the DB or logs. Do not implement features marked post-v1 in the PRD (file uploads, per-project template libraries UI, E2B/12B auto-download UI beyond the manifest/place-file flows). Do not redesign the UI — port it.

## Execution commands (for Adam)

First time, from the repo root after placing the `Documentation/` folder:

```bash
cd /Users/adamfisher/DEVELOP/AGENTS/AXIOM/axiom-local-v2
git init && git add Documentation && git commit -m "docs: PRD, operating prompt, UI reference"
claude --permission-mode acceptEdits "Read Documentation/CLAUDE-CODE-PROMPT.md, Documentation/PRD.md, and Documentation/reference/axiom-ui.jsx in full. Then execute Stage 1 exactly as specified: state the file plan in one short message, build it, verify every Stage 1 gate by running the app, and finish with Documentation/handoffs/HANDOFF-1.md, a commit, and tag stage-1. Hard-stop on any gate failure."
```

Each subsequent stage (replace N):

```bash
claude --permission-mode acceptEdits "Read Documentation/CLAUDE-CODE-PROMPT.md, Documentation/PRD.md, and Documentation/handoffs/HANDOFF-$((N-1)).md. Execute Stage N per the PRD: state the file plan briefly, build, verify every Stage N gate by execution, finish with HANDOFF-N.md, commit, tag stage-N. Hard-stop on any gate failure."
```
