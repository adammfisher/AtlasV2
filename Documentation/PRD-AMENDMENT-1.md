# PRD Amendment 1 — Product Masters & Projections

**Applies to:** `Documentation/PRD.md` as of tag `stage-1` · **Owner:** Adam Fisher
**Audience:** Claude Code (executing agent). Read `CLAUDE-CODE-PROMPT.md` first; this amendment is part of the PRD from Stage 2 onward.
**Discipline:** this document is a targeted edit of the PRD. Sections not named here are unchanged. Where a section is modified, the replacement or addition text is given in full.

---

## A1. Concept (new §0.3 in the PRD)

Atlas Local is also the authoring surface for **product masters**: a product definition is a versioned, schema-constrained JSON object (artifact kind `product`) registered to the Business Architecture spine. Every downstream artifact of the product lifecycle — concept page, BRD, gate deck, system-context diagram, clickable prototype, Claude Code context bundle, Confluence page, Jira epics — is a **projection**: a deterministic transform of the master payload into an existing skill's schema, compiled by the existing helpers. Nothing about a product is hand-authored twice.

Three rules govern everything in this amendment:

1. **One object, many projections.** The master payload is the source of truth. Documents are renders. A projection records the master version it was generated from; `projection.at_version < artifact.current_version` ⇒ stale, and the fix is Regenerate, never hand-editing the render.
2. **Checks replace reviews.** A product definition runs a validation chain like any office artifact. Checks that require Knowledge Core degrade to amber with exact skip strings (the soffice pattern), so the product skill works fully offline today and gets smarter the moment KC connects on 7979.
3. **The build writes back.** Build outcomes (decisions, as-built facts) append to the master via field-scoped edits. The bundle hands off to the agentic build workflow (EPCC) — referenced as a concept only; agent internals are out of scope for this product.

Lifecycle states on the master: `proposed → endorsed → specified → built → operating`. Gate approvals are state transitions stamped onto the artifact, not meetings about documents.

---

## A2. Data model (additions to §2 `schema.sql`)

```sql
CREATE TABLE product_states (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  state TEXT CHECK(state IN ('proposed','endorsed','specified','built','operating')),
  note TEXT DEFAULT '', stamped_by TEXT, at_version INTEGER, created_at INTEGER
);
CREATE TABLE projections (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  kind TEXT CHECK(kind IN ('concept_md','concept_docx','brd_docx','gate_pptx',
                           'context_mermaid','prototype_react','bundle',
                           'confluence_page','jira_epics')),
  at_version INTEGER NOT NULL, output_ref TEXT, target_ref TEXT,
  status TEXT DEFAULT 'local' CHECK(status IN ('local','pushed','stale','error')),
  created_at INTEGER
);
```

`artifacts.kind` gains the value `product`. The master payload lives where every payload already lives: `artifact_versions.payload`. Current state = latest `product_states` row; a product with no row is `proposed`. Both tables are project-scoped through their artifact and are covered by the Stage 2 isolation test.

---

## A3. The tenth skill — `skills/product/`

Registry id `product`, name "Product definition", ext `json`, helper label `projection engine`, tier per §8 routing (`office_json` class). It appears in the Skills view as row 10, fully registry-driven like the other nine (A42/A43 mechanics unchanged).

`schema.json` (authoritative; flat, bounded, no `anyOf`/`oneOf`/`$ref`, llama.cpp-safe):

```json
{"type":"object","additionalProperties":false,
 "required":["name","spine","problem","value_prop","scope_in","scope_out"],
 "properties":{
  "name":{"type":"string"},
  "spine":{"type":"object","additionalProperties":false,"required":["lob","domain"],
    "properties":{"lob":{"type":"string"},"domain":{"type":"string"},
      "capability_code":{"type":"string"},"capability_name":{"type":"string"}}},
  "problem":{"type":"string"},
  "value_prop":{"type":"string"},
  "strategy_refs":{"type":"array","maxItems":5,"items":{"type":"string"}},
  "scope_in":{"type":"array","minItems":1,"maxItems":12,"items":{"type":"string"}},
  "scope_out":{"type":"array","maxItems":12,"items":{"type":"string"}},
  "benefit_hypothesis":{"type":"string"},
  "kpis":{"type":"array","maxItems":8,"items":{"type":"object","additionalProperties":false,
    "required":["name","target"],
    "properties":{"name":{"type":"string"},"target":{"type":"string"},"measure":{"type":"string"}}}},
  "swag":{"type":"string","enum":["S","M","L","XL"]},
  "use_cases":{"type":"array","maxItems":10,"items":{"type":"object","additionalProperties":false,
    "required":["title","actor","flow"],
    "properties":{"title":{"type":"string"},"actor":{"type":"string"},"flow":{"type":"string"}}}},
  "capabilities":{"type":"array","maxItems":10,"items":{"type":"object","additionalProperties":false,
    "required":["name","value"],
    "properties":{"name":{"type":"string"},"value":{"type":"string"},
                  "swag":{"type":"string","enum":["S","M","L","XL"]}}}},
  "acceptance_criteria":{"type":"array","maxItems":24,"items":{"type":"object","additionalProperties":false,
    "required":["capability","given","when","then"],
    "properties":{"capability":{"type":"string"},"given":{"type":"string"},
                  "when":{"type":"string"},"then":{"type":"string"}}}},
  "dependencies":{"type":"array","maxItems":12,"items":{"type":"object","additionalProperties":false,
    "required":["system","nature"],
    "properties":{"system":{"type":"string"},"nature":{"type":"string"}}}},
  "risks":{"type":"array","maxItems":10,"items":{"type":"object","additionalProperties":false,
    "required":["desc"],"properties":{"desc":{"type":"string"},"mitigation":{"type":"string"}}}},
  "decisions":{"type":"array","maxItems":30,"items":{"type":"object","additionalProperties":false,
    "required":["title","choice"],
    "properties":{"title":{"type":"string"},"choice":{"type":"string"},
                  "rationale":{"type":"string"},"date":{"type":"string"}}}},
  "as_built":{"type":"array","maxItems":40,"items":{"type":"object","additionalProperties":false,
    "required":["fact"],"properties":{"fact":{"type":"string"},"source":{"type":"string"}}}}
}}
```

`SKILL.md` guidance: concept-tier generation populates only concept fields (name, spine, problem, value_prop, strategy_refs, scope_in/out, benefit_hypothesis, swag, kpis if stated); spec-tier fields (use_cases, capabilities, acceptance_criteria, dependencies, risks) are populated through targeted edits, never invented at concept time. `decisions` and `as_built` are writeback fields — the model must never fabricate entries; they are appended only when the user supplies them. `max_tokens` for product calls: 4096 (PRD §10 table gains this row).

---

## A4. Pipeline changes (§4)

### A4.1 Router (§4.1)
Skills enum gains `"product"`. Prompt gains one line under skills: `product: define a new product/concept, or evolve an existing product definition`. `edit_doc` targeting an artifact of kind `product` follows the field-scoped path below.

### A4.2 Field-scoped edits for products (extends §4.4)
Whole-payload regeneration of a mature product definition will not fit the 8k context and violates the untouched-sections gate the hard way. Product edits therefore run in two small calls:

1. **Field router** — constrained call, schema `{"fields":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"string","enum":[<top-level property names>]}}}`, prompt: the edit instruction + the property-name list. Names which top-level fields the edit touches.
2. **Per-field edit** — for each named field, a constrained call whose schema is that property sliced from `schema.json`, given the field's current value and the instruction. Output replaces (or, for `decisions`/`as_built`, appends to) that field only.

The server merges results into the payload and bumps the version. Untouched fields are byte-identical **by construction** (server merge, not model restraint) — the §4.4 gate becomes an assertion on the merge, not on model behavior. Chips: `Targeted edit · {field list}`.

### A4.3 Product validation chain (extends §4.5)
Runs on every product generation and edit; chips appear in the pipeline message and persist on the artifact detail:

- `Schema` — constrained decoding + ajv re-validation.
- `Completeness — next gate` — deterministic check of the *next* state's requirements (A5); amber lists missing fields, e.g. `Completeness — specified needs acceptance_criteria, kpis`.
- `Spine — {lob}/{domain}` — requires Knowledge Core. KC absent: amber, exact string `Spine check skipped — Knowledge Core not connected`. KC present (Stage 4): resolve refs via org_* tools; unresolved ⇒ amber `Spine — {ref} not found`.
- `Collision` — KC search for overlapping capabilities. Absent: `Collision check skipped — Knowledge Core not connected`. Hit: amber `Overlaps {name} ({code})`.
- `Dependencies — {n} resolved` — KC graph lookup per `dependencies[]`; absent: skip string as above.

The skip-string mechanic is the soffice pattern (§4.5e) applied to KC: the product skill is fully usable offline today and the checks light up the moment the 7979 probe flips.

---

## A5. Lifecycle states and gates

`POST /api/artifacts/:id/state` body `{to, note}`; server enforces forward-only transitions and these rules (deterministic, computed from the current payload):

| Transition | Requires |
|---|---|
| → `endorsed` | schema-required fields (always true) + `benefit_hypothesis` non-empty |
| → `specified` | `capabilities` ≥1 · `acceptance_criteria` ≥1 · `kpis` ≥1 |
| → `built` | `decisions` ≥1 or `as_built` ≥1 · a `bundle` projection row exists |
| → `operating` | manual stamp; `note` required |

Each transition writes a `product_states` row stamped with `userName` and `at_version` — the gate approval *is* the stamp. Outstanding amber checks do not block a transition, but the stamp row records them in `note` (prefix `ambers:`) so the approval is honest about what was skipped. UI: Promote button on the product detail; disabled state shows the unmet rules as a tooltip list.

ATOM mapping for the demo script (concept-level, not enforced): Discover/Ideate gate = `→ endorsed`; Elaborate exit = `→ specified`; Execute = bundle → build → writeback → `→ built`; post-launch = `→ operating`.

---

## A6. Projection engine — `server/src/pipeline/projections.ts`

A projection is a **pure function from the master payload to an existing skill's payload**, then compiled by the existing helper and validated by the existing chain. Zero new compilers. Same payload ⇒ identical output at the extracted-text level (office zips embed timestamps; the gate is text-level, mirroring §4.4).

| kind | Transform | Compiler |
|---|---|---|
| `concept_md` | TS template → markdown | direct file (md path) |
| `concept_docx` | payload → docx schema (title/meta, problem, value prop, scope, benefit, KPIs) | `build_docx.py` |
| `brd_docx` | payload → docx schema (adds use cases, capabilities, acceptance criteria table, dependencies, risks) | `build_docx.py` |
| `gate_pptx` | payload → pptx schema (title; problem/value; scope two_col; capabilities+swag; KPIs; risks; state & checks summary) | `build_pptx.py` |
| `context_mermaid` | `spine` + `dependencies[]` → mermaid flowchart source, deterministic string build | mermaid path (sandbox render) |
| `prototype_react` | **the one model-assisted projection** — react skill generation seeded with the payload; UI labels it `generated`, all others labeled `deterministic` | react path (§4.3.6 sandbox) |
| `bundle` | TS zip (A7) | — |
| `confluence_page` | payload → page storage format, pushed via Confluence MCP connector | Stage 4 |
| `jira_epics` | `capabilities[]` → epics, `acceptance_criteria[]` → stories under them, pushed via Jira MCP connector | Stage 4 |

API: `GET /api/artifacts/:id/projections` (rows + computed staleness) · `POST /api/artifacts/:id/projections` body `{kind}` (generate/regenerate; for push kinds, generates locally then pushes if the connector is connected, else stores `local` with a "connect {name} to push" note) · `POST /api/projections/:id/push` (Stage 4).

Staleness is arithmetic: `at_version < current_version` ⇒ status `stale`, amber chip, Regenerate button. Renders are never hand-edited; the regenerate path is the only fix offered.

Pushed projections record `target_ref` (page id / epic keys). Push failures set status `error` with the real message (no fake success — §11 rule applies).

---

## A7. Context bundle — `GET /api/artifacts/:id/bundle`

Deterministic zip, exportable from state `specified` onward:

```
<slug>-bundle-v<n>/
├── CLAUDE.md                  # generated: product context, spine refs, scope in/out,
│                              # decision log, pointers to acceptance criteria; closes with
│                              # "consume via your agentic build workflow (EPCC or equivalent)"
├── definition.json            # the master payload at current version
├── acceptance/criteria.json   # machine-readable given/when/then
├── acceptance/criteria.md
├── context/dependencies.md
├── context/decisions.md
└── .mcp.json                  # knowledge-core server entry iff KC is connected, with
                               # env ATLAS_CAPABILITY=<capability_code>; omitted otherwise
```

The bundle is how a definition becomes a Claude Code project's starting context. EPCC appears in generated text as a named concept only; nothing in Atlas implements or depends on agent workflow internals. Bundle export writes a `projections` row (`kind='bundle'`) — which is what the `→ built` rule checks.

---

## A8. Writeback (v1 scope)

Writeback is chat-driven: "log a decision on {product}: we went client-side calc, rate API for personalization" routes as `edit_doc` → field router resolves to `decisions` → append-mode field edit. Same for `as_built`. That is the whole v1 mechanism — no listeners, no automation.

**Stage 5 stretch (build only if green with time remaining, decision recorded in the handoff):** `servers/product/index.ts`, a fourth built-in MCP server exposing `product_get` and `product_append_fact` (append-only, `decisions`/`as_built` fields only, project-scoped via `ATLAS_PROJECT_ID`), so an external Claude Code session can write back through the bundle's `.mcp.json`. If skipped, the bundle's CLAUDE.md tells the agent to report outcomes for manual logging.

---

## A9. UI parity additions (Appendix A rows A53–A60; same contract — every row ships)

| # | Element / interaction | Stage | Note |
|---|---|---|---|
| A53 | Product artifact card variant: state badge (`proposed`…`operating`) beside the v-chip | 3 | gallery + chat card |
| A54 | Product detail: state timeline rows (state · stamped_by · at_version · note) + Promote button with unmet-rules tooltip | 3 | forward-only |
| A55 | Product detail PROJECTIONS section: rows (kind · `deterministic`/`generated` tag · v-chip · stale amber chip · Regenerate · Download/Push) | 3 / 4 (push) | staleness computed |
| A56 | Export bundle button (enabled from `specified`) | 3 | streams zip |
| A57 | Product validation chips incl. exact KC skip strings | 3 / 4 (live KC) | soffice pattern |
| A58 | Sixth empty-state suggestion chip: `Define a product — auto loan payment calculator` | 3 | fills input |
| A59 | Skills view row 10 (`product`), expandable schema box from real schema.json | 2 (row) / 3 (real) | registry-driven |
| A60 | Pushed-projection rows show target ref (`PAY-1234`, page link-out) | 4 | real refs only |

---

## A10. Stage rebinding (additions only; existing scopes and gates unchanged)

**Stage 2 +** the two tables in `schema.sql`; isolation test extended to `product_states` and `projections`.
*Gate +:* extended isolation test green.

**Stage 3 +** the product skill (schema + SKILL.md), router enum, product pipeline path with field-scoped edits, product validation chain with skip-ambers, projection engine for the six local kinds, bundle export, state machine + API, A53–A59 UI. Demo script `scripts/demo/stage3-product-demo.md`: the auto loan payment calculator — define (chip A58) → checks render → promote `endorsed` → three targeted edits add capabilities/acceptance criteria/KPIs → promote `specified` → regenerate all local projections → export bundle → open the bundle in a Claude Code project and confirm the agent's first exploration answer cites bundle content.
*Gates +:* (a) the demo runs end-to-end; (b) product first-pass constrained-JSON validity ≥90% over a 10-prompt definition set on E4B — the §9 decision point applies (below 90%: stop, record, consider trimming maxItems or splitting concept/spec schemas before proceeding); (c) field-scoped edit leaves all other fields byte-identical (merge assertion); (d) regenerating any deterministic projection from an unchanged payload yields identical extracted text.

**Stage 4 +** KC-backed spine/collision/dependency checks live (the existing mock-7979 test extends to serve canned org_* responses and assert the chips flip from skip-amber to real results); `confluence_page` and `jira_epics` projections pushed against mock MCP connectors asserting received structure (corp URLs are placeholders — mocks are the test surface, same as KC); chat writeback path proven.
*Gate +:* mock-connector push test green; a definition edited after a push shows the projection `stale` and re-push updates `target_ref` handling correctly.

**Stage 5 +** staleness/parity polish; portable build includes the projection engine; parity audit covers A53–A60; the §A8 stretch decision recorded either way.
*Gate +:* PARITY.md includes the new rows.

---

## A11. Risks (additions to §11)

The product schema is the largest grammar Atlas compiles — E4B constrained-decoding quality is now load-bearing for two skills, and the Stage 3 90% gate covers both; do not soften it, and the recorded fallback order is: trim `maxItems` → split concept/spec into two schemas → escalate tier per §8. Context pressure on mature definitions is mitigated by field-scoping; if a single field's value plus instruction exceeds budget, raise `ctx` to 16384 and record the RAM tradeoff in the handoff. Projections must never be hand-edited renders — the UI offers Regenerate only; any "let me just fix the docx" path violates the model and is out. Writeback fields are append-only and never model-fabricated. And the standing rule applies with extra force here: a stamped gate transition is a governance record — no fake stamps, no auto-promotion, ambers carried into the stamp note verbatim.

— End of Amendment 1 —
