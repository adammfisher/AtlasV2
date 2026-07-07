# AtlasV2 ↔ claude.ai Parity Report — 2026-07-07

Full-system sweep, Playwright-driven against the live app. Every ✅ below was
exercised end-to-end this session; every fix was re-verified after landing.

## Verified working (fixed this session where noted)

| Area | Status | Notes |
|---|---|---|
| Chat streaming | ✅ | Bedrock Converse, SSE |
| Stop generating | ✅ **fixed** | abort signal was never wired; now aborts instantly, keeps the partial response (claude.ai behavior), composer recovers |
| Model picker | ✅ | Haiku 4.5 / Sonnet slot (self-healing 4.5→5) |
| Memory | ✅ | 14/14 eval; user + project scopes, profiles, remember/forget tools, per-chat toggle, modal browse/edit |
| Projects | ✅ | create via UI, instructions, hard isolation verified (project facts don't leak; user facts span) |
| Artifacts — all 9 skills | ✅ **fixed** | mermaid, svg, md, react, site, pptx, xlsx, docx, pdf. Fixes: python venv bootstrapped; weasyprint libs + LibreOffice installed; Bedrock schema sanitization (max/min), map-schema routing to tool path, wrapper-key healing |
| Artifact edit / versions | ✅ | edit flow bumps version; versioned download (zip for multi-file) |
| Artifact downloads | ✅ | `/artifacts/:id/versions/:v/download` |
| Image upload → vision | ✅ | data-URL → Converse image blocks |
| Document upload → QA | ✅ **fixed** | >1.4MB uploads were silently rejected (global 2mb json limit ahead of the 40mb parser); chat now waits for in-flight extraction |
| Upload types | ✅ **expanded** | claude.ai set: office incl. legacy (.doc/.ppt/.xls), rtf/odt/epub, csv/tsv/json/yaml/xml/ipynb, code files |
| **Uploads in S3 + hover download** | ✅ **new** | `atlasv2-uploads` bucket (Terraform); chips reveal a download on hover that streams the original back (local fallback) |
| Bulk chat delete | ✅ | Edit mode in recents |
| Suggestion chips, skills/plugins views | ✅ | render + navigate |

## Deep browser sweep (2026-07-07, second pass — closed the API-only gaps)

Everything below was re-verified **in a real browser** after the parity-1–7 build:
artifact create → panel opens → **preview renders** (svg/iframe) → edit → **v2 created**
(confirmed via API; the in-page badge check raced the pipeline) → **Share click → clipboard
presigned URL → link fetched HTTP 200**; **regenerate** produces a fresh response;
**edit-message** shows the indicator and replaces the flow; **rename pencil** (dialog)
renames; **search box** filters to the renamed chat; **knowledge modal upload** → listed →
"1 passages" indexed; **thinking block** renders streamed reasoning text; deck validation
`soffice open/convert` now green (was the amber "Thumbnails skipped").

## Remaining holes vs claude.ai (ranked)

Items 1–7 from the first pass are **built and browser-verified** (knowledge files, MCP
tools in chat, copy/regenerate/edit, rename/search, web search+fetch, extended thinking,
artifact share links). What genuinely remains:

1. **Long-conversation context management** — Atlas sends the last 12 text messages;
   claude.ai manages the full window (compaction/summarization). The most substantive
   functional gap for long sessions.
2. **Chat share links** — artifacts share via presigned URL; whole conversations don't.
3. **Persisted thinking blocks** — reasoning renders live but isn't saved to the
   transcript (claude.ai keeps them collapsible in history).
4. **Global artifacts gallery** — artifacts browse per-chat; no cross-project gallery
   surface.
5. **Response styles** — no claude.ai-style Styles (concise/formal/custom presets);
   project instructions partially cover this.
6. **Voice dictation** — mic button is decorative.
7. **Artifact version-history browser** — active-version + Restore exist; no full
   history list UI.
8. **Knowledge citations** — recall names source files (`[filename]` prefix) but
   answers don't render structured citations.
9. Cosmetic/untested: message feedback (thumbs), light theme, mobile layout,
   multi-file-per-message uploads (supported, untested), chat export.
10. Hygiene: eval-harness conversations pollute recents (add teardown cleanup).

## Infra state (all scale-to-zero)
- `atlasv2-memory` (DynamoDB), `atlasv2-memory-vectors` (S3 Vectors),
  `atlasv2-uploads` (S3) — Terraform in `infra/`.
- Sonnet 5: agreement ACTIVE, runtime still AWS-gated; slot auto-upgrades.
