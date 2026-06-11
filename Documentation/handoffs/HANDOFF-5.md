# HANDOFF-5 — Stage 5: tiers, Bedrock, packaging, polish (final stage)

Complete on branch `stage-5`, merged to `main`, tagged `stage-5`. Atlas Local v2
is feature-complete per PRD + Amendment 1; PARITY.md carries the signed matrix
(3 waivers pending Adam's ack).

## What shipped

- **Tier routing + aux topology (§8)**: a second llama-server process spawns when
  a 12B (office) or E2B (router-pinned) GGUF appears alongside the selected chat
  model and RAM ≥ 16 GB. `/models/refresh` re-evaluates live. Office JSON routes
  `portForTask('office')`; the router uses `portForTask('router')`. The
  "Escalated to 12B — office JSON" chip fires only when office genuinely ran on
  a higher tier than the selected chat model.
- **Bedrock (§8)**: real `ListFoundationModels` connect (both gate paths tested
  against live AWS creds), Converse `json_schema` structured outputs for Claude
  4.5+ ids (with a schema-subset sanitizer — Bedrock rejects maxItems et al.;
  ajv re-validates the full schema locally), forced tool-use fallback for older
  ids, ConverseStream chat when selected, §4.3.3 repair-loop escalation to
  Bedrock when connected. Verified end-to-end: a deck generated valid-first-pass
  through Claude Sonnet 4.5 structured output. Disconnected afterward — the box
  runs pure E4B per Adam's instruction.
- **Model registry UI**: absent rows reveal the models folder; manifest
  downloads (resume + SHA256) implemented and gated offline against a loopback
  manifest server; registry exposes aux + download state.
- **Attachments (Adam mid-stage request, exceeds A22)**: paperclip uploads
  images/office/pdf/md; images run through the Gemma mmproj vision projector
  (verified: described a real screenshot), documents are markitdown-extracted
  and injected into chat and pipeline context (verified: summarized a real
  docx); chips in composer + persisted messages.
- **Packaging**: `packaging/build-portable.sh` → `dist/AtlasLocal/` (~845 MB +
  model): esbuild-bundled server + MCP servers, vendored node binary, uv
  python-build-standalone 3.13 venv with all office wheels, vendored
  llama-server pin 8680 with re-pointed dylibs AND vendored ggml compute
  backends (they dlopen from a baked Cellar path — caught by hiding the Cellar),
  client served by Express with SPA fallback, `repoRoot` probe for the flatter
  layout, relative `./data` fallback, `start.command` with model-placement
  prompt. **Gate**: booted with `env -i PATH=/usr/bin:/bin`, llama ready,
  client served, chat round trip green.
- **Polish**: focus-visible outline, `prefers-reduced-motion` kills all
  animation, error toasts on every failed API call, empty states
  (recents/drawer/plugins-filtered), log rotation (pre-existing, 5 MB / keep 1).

## Honest notes

1. The 12B drop-in gate ran with E4B weights copied under a 12B filename —
   Adam has no real 12B. Registry/aux/routing/chip mechanics are fully
   exercised; 12B output *quality* is obviously not. File removed after the gate.
2. Bedrock chat does not run MCP tools (local-only tool loop); office on
   Bedrock skips the live-stream panel (Converse structured output is
   non-streaming).
3. The portable gate ran on this machine with a scrubbed PATH and the ggml
   Cellar hidden — a true clean-account run on other hardware (Intel, no Metal)
   remains untested.
4. Smoke/test conversations were cleaned from the DB after each gate.

## Operating state

E4B resident with mmproj (vision on), Bedrock disconnected, selected=auto,
aux stopped, 10 mock-free connectors (KC planned until 7979 answers).
