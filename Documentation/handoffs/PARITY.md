# Appendix A parity audit — Stage 5 close

Visual contract: `Documentation/reference/atlas-v2-ui.jsx` (per Adam's mid-Stage-1
correction; the PRD header still names the older atlas-ui.jsx). Every row below
was verified against the running app this session. ☑ = shipped and exercised.
Three rows carry deviations explicitly flagged for Adam's waiver.

| # | Element | Status | Evidence / note |
|---|---|---|---|
| A1 | Sidebar brand block | ☑ | tokens.ts, Stage 1 |
| A2 | New chat button | ☑ | creates conversation in active project |
| A3 | Nav with active accent | ☑ | |
| A4 | Recents list live | ☑ | updated_at order; flex-shrink overlap bug fixed Stage-3 polish; empty state added Stage 5 |
| A5 | Sidebar model footer | ☑ | llama-server line, real RSS/RAM, tier rows |
| A6 | User row | ☑ | settings.userName |
| A7 | Breadcrumb `{project} › {title}` | ☑ | |
| A8 | Lock badge ↔ Bedrock badge swap | ☑ | blue `Bedrock connected` badge when selected (Stage 5) |
| A9 | Empty-state greeting + suggestion chips | ☑ | 6 chips (product chip added Stage 3), all trigger real runs |
| A10 | User bubbles | ☑ | + attachment chips (Stage 5 addition) |
| A11 | Serif stream + Thinking… | ☑ | |
| A12 | Routing stage row | ☑ | real router event with model + ms |
| A13 | Skill/template/model chip row | ☑ | incl. `Template — dfs_default.potx` |
| A14 | Escalated to 12B chip | ☑ | honest rule §8; gate exercised via drop-in (E4B weights under 12B name — mechanics only, no real 12B on this box) |
| A15 | Generating spinner | ☑ | + live source streaming panel (Stage 3 polish addition) |
| A16 | Steps box w/ trailing spinner | ☑ | animated pending rows |
| A17 | Validation chips incl. soffice skip string | ☑ | exact strings in validate_common.py |
| A18 | Inline mermaid preview | ☑ | sandboxed real render, parse-check chip |
| A19 | Inline site preview + caption | ☑ | blob-URL sandbox, csp locked · offline |
| A20 | Artifact card | ☑ | |
| A21 | Card → detail cross-view | ☑ | |
| A22 | Input row + paperclip | ☑* | *upgraded beyond spec at Adam's request: real uploads (images via mmproj vision, office/pdf/md via markitdown) instead of the disabled tooltip |
| A23 | Model pill | ☑ | |
| A24 | Footer disclaimer | ☑ | verbatim |
| A25 | Model menu rows + absent states | ☑ | place-a-GGUF rows reveal the models folder in Finder; manifest download path implemented + offline-gated |
| A26 | Cloud upgrade section states | ☑ | Add model ↔ Connected · region · structured output |
| A27 | Menu hardware footer | ☑ | real values incl. config ctx |
| A28 | Bedrock modal | ☑ | real ListFoundationModels; both gate paths tested live |
| A29 | Plugins header + custom add | ☑ | |
| A30 | Filter pills w/ counts + SSRF chip | ☑ | counts live (Stage 5) |
| A31 | Plugin card states | ☑ | Installing = real pending connect |
| A32 | Card toggle scoped to active project | ☑ | |
| A33 | Detail panel header/status | ☑ | + lastError surface |
| A34 | KC dashed card + reserved notice | ☑ | live 7979 probe flips it (mock-gated) |
| A35 | CONNECTION mono block | ☑ | |
| A36 | TOOLS list | ☑ | live listTools after connect (`· live` tag) |
| A37 | Credentials masked + note | ☑ | AES-256-GCM store, grep-gated |
| A38 | Project toggles + caption | ☑ | |
| A39 | Restart/Remove/Install buttons | ☑ | real lifecycle w/ spinners |
| A40 | Add-server modal | ☑* | *deviation: 2 transport pills (stdio, streamable-http) — the two the backend actually supports; the mockup's extra pills would be dead UI. Waiver requested. |
| A41 | Skills header + explainer | ☑ | |
| A42 | 10 skill rows (A59 added product) | ☑ | gating real, refusal exact |
| A43 | Skill expand schema + chain | ☑ | real schema.json |
| A44 | † soffice footnote | ☑ | verbatim |
| A45 | Skill-disabled refusal | ☑ | exact wording, e2e-gated |
| A46 | Projects header + modal | ☑ | |
| A47 | Project cards + stats | ☑ | live counts |
| A48 | Shared library card | ☑* | *card ships; the `__shared__` memory partition is NOT functional — memory tools are strictly project-scoped (isolation gate enforces it). Waiver requested: cross-project shared memory contradicts the hard-isolation gates as specced. |
| A49 | Artifacts header + sub | ☑ | |
| A50 | Artifact cards | ☑ | |
| A51 | Detail w/ versions + Restore | ☑ | byte-exact restore e2e-gated |
| A52 | Cross-cutting scoping | ☑ | isolation suites green (Stages 2–4) |
| — | Error toast + crash banner | ☑ | toasts on every failed API call (Stage 5); llama crash → restart-once → banner |
| — | Absent-model menu rows | ☑ | |
| — | Plugin error badge | ☑ | status `error` + lastError in panel |

## Amendment 1 rows (A53–A60 product surface)

| # | Element | Status |
|---|---|---|
| A53 | Product artifact kind + master schema | ☑ verbatim §A3 |
| A54 | State timeline + Promote w/ unmet tooltip | ☑ |
| A55 | Field-scoped edits, untouched fields byte-identical | ☑ e2e-gated |
| A56 | Projections rows (deterministic/generated/stale/regenerate) | ☑ |
| A57 | Bundle export gated at specified | ☑ + .mcp.json when KC connected |
| A58 | KC-backed checks w/ exact skip-ambers | ☑ both modes gated |
| A59 | Tenth skill row (product) | ☑ landed Stage 3 per erratum |
| A60 | Push projections (confluence/jira) | ☑ vs structure-asserting mocks; `connect {name} to push` note path gated |

**Waivers requested from Adam:** A40 (2 transport pills not 4), A48 (`__shared__`
memory partition unimplemented — conflicts with hard isolation), A22 (exceeded:
real attachments replace the disabled-tooltip spec).
