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

## Remaining holes vs claude.ai (ranked)

1. **Project knowledge files** — claude.ai projects hold persistent uploaded
   documents that inform every chat in the project. Atlas uploads are
   per-message only. Biggest structural gap. (Natural build: uploads attach to
   a project → extracted text indexed into project memory/S3 Vectors.)
2. **MCP connector tools in chat** — plugins (filesystem, github, …) exist but
   only memory's remember/forget are wired to the Bedrock tool loop. The
   generic connector→toolConfig bridge needs porting.
3. **Message ergonomics** — no edit-message, no retry/regenerate response, no
   copy button on messages.
4. **Chat management** — no rename (auto-title only), no search over chats.
5. **Web search** — no live web tool.
6. **Extended thinking** — no toggle (Bedrock supports it via
   additionalModelRequestFields; v1 had it).
7. **Share/publish** — no public links for artifacts or chats.
8. **Voice dictation** — mic button is decorative.
9. **Artifact version picker** — versions exist server-side (restore/download)
   but the panel lacks a version-history browser.
10. Minor: eval-harness conversations pollute recents (cleanup in teardown);
    deck thumbnails unverified since LibreOffice install (soffice now present).

## Infra state (all scale-to-zero)
- `atlasv2-memory` (DynamoDB), `atlasv2-memory-vectors` (S3 Vectors),
  `atlasv2-uploads` (S3) — Terraform in `infra/`.
- Sonnet 5: agreement ACTIVE, runtime still AWS-gated; slot auto-upgrades.
