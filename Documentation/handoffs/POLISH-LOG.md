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
| `sonnet` (claude-sonnet-4-6) | yes | **1024 tokens** | bisected: 1015 tok → no cache; 1055 → cache read. (First recorded as 2048 from a coarse probe — see the correction below.) |
| `haiku` (claude-haiku-4-5) | yes | **4096 tokens** | bisected: 4014 tok → no cache; 4114 → cache read. Anthropic docs claim 2048; Bedrock measured 4096 |
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

**Consequence 3 — the E gate is reachable on sonnet, not on haiku.** Atlas's stable prefix measured
**1550 tokens** in the end: over sonnet's 1024 minimum, well under haiku's 4096. Cache reads on
sonnet (0.90 hit ratio), **zero on haiku** — reported honestly rather than engineered around by
padding the prompt.

**CORRECTION (made during E).** The sonnet minimum above was first recorded as **2048** from a probe
that sampled only 1015 and 2015 tokens, and that wrong number reached `models.config.json` before the
10-turn run cached a 1463-token prefix and disproved it. Bisection put the real value at **1024**.
The lesson is cheap to state and was expensive to learn: bisect before publishing a threshold, and
treat a two-point probe as a bound, not a measurement.

### Next steps

Deliverables A–G in order; commits `A:`…`G:` per the brief.

---
## Session 1 — final matrix (2026-07-16)

`pnpm test:polish` — 210 checks, 0 failures, ~2.3 min, ~175 live Bedrock calls.
`pnpm test:polish -- A C` runs a subset.

| # | Deliverable | Checks | Gate | Result |
|---|---|---|---|---|
| A | tone & formatting (20 prompts × 3 tiers) | 45 | 100% on casual + decline-shaped | PASS |
| B | reminder / drift (30-turn conversation, small tier) | 38 | prose holds after the reminder; system prefix byte-identical | PASS |
| C | memory etiquette (15 cases × 3 tiers + 23 units) | 68 | zero forbidden phrases, zero sensitive leaks | PASS |
| D | indexed citations (4 scenarios + post-processor units) | 26 | zero invalid citation chips | PASS |
| E | cache-optimal assembly (byte-stability + 10-turn reads) | 13 | prefix byte-stable; cache reads observed | PASS |
| F | tool decisions (12 cases, small tier + units) | 20 | ≥ 10/12 | PASS (12/12) |

Cache summary from the 10-turn conversation: **sonnet — 1550-token cache write on
turn 1, cache reads on 9/10 turns (hit ratio 0.90).** 9/10 is the ceiling: turn 1
can only write.

### `<atlas_behavior>` version history

| v | Added | By |
|---|---|---|
| 1 | routing/artifact doctrine | orchestration brain |
| 2 | `<tone_and_formatting>` | polish A |
| 3 | `<memory_etiquette>` | polish C |
| 4 | `<citation_rules>` (opt-in per conversation) | polish D |
| 5 | `<tool_use>` response hygiene | polish F |

Block sizes: small 9379 chars (+cites 10318), mid 7616 (+8555), frontier 4285 (+4899).

### Config constants

| Constant | Value | Where | Why |
|---|---|---|---|
| `REMINDER_TURNS` | 12 (mid/frontier) | `pipeline/reminder.ts` | brief default |
| `REMINDER_TURNS_BY_TIER.small` | **3** | `pipeline/reminder.ts` | measured: the reminder's effect decays by the 3rd turn after it lands on nova. At 8 it drifted from +3 onward; at 4 it still failed at exactly +3; at 3 the gap closes |
| `REMINDER_TOKENS` | 30_000 | `pipeline/reminder.ts` | brief default — see open questions, it is effectively dead code |
| `promptCache` | haiku ✓, sonnet ✓, nova ✗, nemotron ✗ | `models.config.json` | measured; unguarded caching FAILS nemotron's request outright |
| `cacheMinTokens` | sonnet 1024, haiku 4096 | `models.config.json` | measured by bisection; Anthropic's docs claim 2048 for haiku |
| `MIN_DESCRIPTION_WORDS` | 10 | `mcp/toolloop.ts` | below this an MCP description gets a generated usage hint |

### What the evidence actually says

Three results worth carrying forward, because two of them are negative:

1. **The reminder (B) does real work — but only once the block got big.** The
   first drift scenario showed NO drift at all (control passed 24/24): with a
   ~4.9k-char small-tier block, the system prompt won every turn. After C and F
   grew that block to ~9.4k chars, the formatting rules diluted and nova drifted
   hard from turn ~13 (`### Headers`, bold on every term). The control now scores
   9/25 against the reminded run's 38/38. The reminder went from unproven to
   load-bearing because the block grew — which is worth remembering the next time
   someone adds a section to `<atlas_behavior>`.
2. **The 12 tool-decision probes (F) do not discriminate.** The control with the
   old bare descriptions also scores 12/12 — nova gets the textbook cases right
   either way. Where the enrichment demonstrably pays is SCALE: on a research
   prompt the enriched small-tier description fires 1 search, the bare one fires 4.
3. **Small-tier compliance is ~97–99% per probe, not 100%.** Bedrock does not
   guarantee identical output at temperature 0, so across ~80 gated probes a run
   surfaces one or two failures that do not reproduce. Gated probes now confirm a
   failure with a SECOND sample before counting it (`confirmed()` in
   `polish/lib.ts`); both numbers are reported. This is not a softer bar — the bar
   is still 100% — it just declines to treat one sample of a stochastic process as
   evidence of a defect. It immediately proved its worth: it distinguished a real,
   reproducible drift at turn 15 from run-to-run noise.

### Bug found and fixed along the way

`buildContext()` could hand Converse a window starting with an ASSISTANT turn,
which Bedrock rejects outright ("A conversation must start with a user message",
400). Once compaction advances the watermark past every older message, the
straggler loop contributes nothing and `slice(-12)` of an alternating transcript
lands on an assistant turn — reproduced for every post-compaction conversation
from ~21 text messages up. So long chats were failing, which is precisely what
compaction exists to prevent. Fixed by `startAtUserTurn()`; the rolling summary
already covers the dropped turns. Found by B's drift test, not by looking for it.

### Open questions / next steps

1. **Haiku is the DEFAULT model and will never cache in production today.** Its
   measured 4096-token minimum is above Atlas's real ~1550-token stable prefix, so
   haiku shows zero cache reads. Sonnet (1024) hits 0.90. Options: leave it (the
   flag is honest and costs nothing), or grow the prefix past 4096 — but padding a
   prompt to win a cache is a bad trade, so this is reported rather than "fixed".
2. **`REMINDER_TOKENS = 30_000` is effectively dead code.** Atlas's context ceiling
   is ~12k tokens (24k-char/12-message window + attachments), so the token trigger
   can never fire and the turn trigger does all the work. Either lower it to
   something reachable (~8k) or drop it; it is kept at the brief's default for now.
3. **Filler closers persist at ~2/60 on the formatting eval.** Reported, not gated
   (the brief's hard gates cover lists, not closers). Worth a doctrine pass.
4. **The A/C evals do not exercise the production prompt end to end.** They build
   persona + behavior block; production also injects skills metadata, tool specs,
   and recall. The gates test the doctrine, not the whole assembly.
5. **`components/KnowledgeModal.tsx` is an orphan** — imported nowhere. D's
   knowledge chips open a small local `PassageModal` instead. Someone should decide
   whether the orphan gets deleted or wired back up.
6. **Nova's `maxOutput: 8192` is still an unverified placeholder** (pre-existing).

