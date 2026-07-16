# POLISH-LOG

Character & polish layer (tone/formatting, reminder reinjection, memory etiquette, citations,
cache-optimal assembly, tool-description enrichment). Runs AFTER the orchestration brain, which owns
routing and the `<atlas_behavior>` block. This log is append-per-session.

Sibling logs: `BRAIN-LOG.md` (routing/behavior block), `DESIGN-LOG.md` (visual/office).

---

## Session 1 — 2026-07-16

### Precondition check

The orchestration brain's `<atlas_behavior>` block **exists** (`server/src/pipeline/context.ts:104`,
`ATLAS_BEHAVIOR_VERSION = 1`). This command is unblocked and extends it.

### Starting state of the files this command owns

**`server/src/pipeline/context.ts` (222 lines).** Two unrelated concerns share the file: the versioned
behavior block and conversation-history compaction.
- `ATLAS_BEHAVIOR_VERSION = 1`; `tierForModel()` maps `nova`→`small`, `sonnet`→`frontier`, everything
  else (`haiku`, `nemotron`)→`mid`.
- `buildBehaviorBlock(tier)` emits `<atlas_behavior version tier>` wrapping one of three bodies:
  `RULES_FULL` (small+mid), `RULES_FULL + RULES_EXAMPLES` (small only), `RULES_LEAN` (frontier).
- Existing sections: `create_edit_describe`, `artifact_vs_inline`, `update_vs_rewrite`,
  `read_before_write`, `when_to_search`, `honesty`, `output_format`, `tool_use`.
- **No tone/formatting, memory-etiquette, or citation rules yet** — those are Deliverables A/C/D.
- `buildContext()` returns `{history, summary}`: last 12 text messages, 24k char budget, plus a
  rolling summary compacted every ~6 uncovered messages into setting `convsum:<conv>`.

**`server/src/memory/engine.ts` (591 lines).** Extraction and recall are healthy; **application is
not governed at all**.
- `recallContext(projectId, query)` injects USER KV + PROJECT KV (1800 char budget, profile-summary +
  delta), then **unconditionally** runs semantic recall (8 hits/scope, `MIN_SIMILARITY = 0.35`,
  knowledge floor 0.25) and 1-hop graph expansion on every turn with a non-empty query.
- Returns one `Known context (memory):` blob. **No relevance gate** — a purely technical question
  still pulls personal KV + semantic hits. That is Deliverable C.3.
- Sensitive categories are denied at *extraction* (`EXTRACT_SYSTEM` denylist) but nothing governs how
  a recalled fact is *applied* or narrated. That is Deliverable C.1/C.2.

**`server/src/tools/web.ts` (109 lines).** `webSearch` (DDG html→lite, 3 attempts, honest failure
string) and `webFetch` (24k cap, `__NEXT_DATA__`/ld+json extraction). Returns **flat text blobs** —
title/url/snippet joined by newlines. **No sentence indexing, no document indices, no stable source
map**, so citations today cannot be index-grounded (Deliverable D.1).

**`server/src/mcp/toolloop.ts` (127 lines).** Gemma/llama.cpp OpenAI-format loop, capped at 4
iterations. `openAiTools()` passes `${t.description} (${t.connectorName})` through **verbatim** —
a bare or empty MCP description reaches the model unimproved (Deliverable F.3). Note: this file is
the *local llama* path; the Bedrock chat path builds its own tool array in `routes/chat.ts`.

**`server/src/providers/dispatch.ts` (124 lines).** Thin provider router (`bedrock`|`openai`|
`anthropic`) over `streamWithTools` / `completeJson` / `completeJsonOffice` / `completeText` /
`classifyJson`. Enforces the account allowlist in `resolveModel()`. **No cache plumbing and no usage
surfacing** — `bedrockStreamWithTools` discards the Converse `usage` event entirely, so there is
currently no cache metric to log (Deliverable E).

**`server/src/routes/chat.ts` (546 lines)** — not named in the brief but it is the real turn path and
where most of this work lands. System prompt is assembled at `chat.ts:310-327` as a single joined
string, ordered: PERSONA → `buildBehaviorBlock()` → convStyle → CITATIONS line → MEMORY line →
project instructions → conversation summary → memory recall. Because everything is `join('\n\n')`ed
into **one** system message, `toConverse()` emits **one** system block — there is no seam to place a
`cachePoint` at. Existing citation instruction (`chat.ts:317`) is after-the-fact markdown-link
mapping, which Deliverable D replaces.

### Measured Bedrock prompt-cache facts (probed live, 2026-07-16)

These were measured against real Converse calls because the design of Deliverable E depends on them
and **the vendor documentation is wrong about Haiku**. Probe scripts were scratch-only, not committed.

| model | `cachePoint` accepted | minimum cacheable prefix | notes |
|---|---|---|---|
| `sonnet` (claude-sonnet-4-6) | yes | **2048 tokens** | 1015 tok → no cache; 2015 tok → cache read |
| `haiku` (claude-haiku-4-5) | yes | **4096 tokens** | 3014 tok → no cache; 4114 tok → cache read. Anthropic docs claim 2048; Bedrock measured 4096 |
| `nova` (nova-2-lite) | accepted, **broken** | n/a | reports `cacheWrite` on *every* pass and `cacheRead: 0` always — writes are billed, reads never happen |
| `nemotron` (nemotron-super-3-120b) | **hard error** | n/a | `ValidationException: You invoked an unsupported model or your request did not allow prompt caching` |

**Consequence 1 — the capability flag is mandatory, not optional.** Sending a `cachePoint` to
Nemotron does not degrade, it *fails the call*. Enabling caching unguarded would break Nemotron chat
outright.

**Consequence 2 — prefix ordering is `toolConfig` → `system` → `messages`.** Proven on sonnet: a
system-terminal `cachePoint` with a ~210-token system and ~1945 tokens of tools cached **2148**
tokens (tools + system); the same tools with a `toolConfig`-terminal `cachePoint` cached **1945**
(tools only). So a `cachePoint` after section 5 does capture the tool definitions, as the brief's
ordering intends.

**Consequence 3 — the E gate is reachable on sonnet, likely not on haiku.** Atlas's realistic stable
prefix (persona ~60 + behavior block ~400–600 + tools ~1000–1500 + 10 skills × ~100) lands around
2.5–3.1k tokens: over sonnet's 2048 minimum, under haiku's 4096. Expect cache reads on sonnet and
**zero on haiku** until the prefix grows. This will be reported honestly rather than engineered
around by padding the prompt.

### Next steps

Deliverables A–G in order; commits `A:`…`G:` per the brief.

---
