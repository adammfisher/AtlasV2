# Atlas V2 Memory — Evaluation & AWS Architecture

**Goal (Adam, 2026-07-07):** memory is the most robust part of Atlas. Remember things about the
user, things about projects, cross-chat within a project ("heavily remember"). Runs in AWS,
scale-to-zero. Semantic via S3 Vectors; graph via DynamoDB adjacency + GSIs if warranted.

---

## 1. What we have today (v2 local, SQLite)

Three layers, all hard-scoped per project (`server/src/memory/engine.ts`, `servers/memory.ts`):

| Layer | Store | Written by | Recalled how |
|---|---|---|---|
| KV facts | `mem_kv` (project_id, key, value) | idle extractor (75s debounce, constrained JSON, 4 categories) + MCP tool | ALL project KV injected every chat (1400-char cap) |
| Notes | `mem_chunks` + FTS5 | MCP `memory_upsert` | top-3 keyword (FTS5) hits for current message |
| Graph | `mem_graph_nodes` / `mem_graph_edges` (SPO) | extractor `graph_facts` + MCP tool | browse/`graph_query` only — **never recalled in chat** |

Controls: per-chat remember toggle, MemoryModal (view/add/edit/delete all layers).

**Strengths:** idle-debounced extraction (off the chat path — better than v1's per-turn),
category whitelist, KV-upsert dedupe, real per-project isolation, editable UI, opt-out.

**Gaps:**
1. **No user-level tier** — nothing persists about Adam across projects (claude.ai's core feature).
2. **No semantic recall** — FTS5 keyword only; paraphrases miss. Embedding path dormant.
3. Recall = inject-all-KV — fine at 40 facts, degrades as memory grows; no relevance ranking.
4. No provenance, no timestamps on KV, no confidence, no conflict handling beyond exact-key overwrite.
5. Graph exists but is write-only in practice (not consulted during chat).
6. MCP memory tools unreachable in chat since the Bedrock migration retired the local tool-loop.

## 2. What v1 (AWS) got right and wrong — measured, not assumed

v1 runs S3 Vectors in this account today (`atlas-memory-vectors`, Titan v2, 1024-dim cosine,
global + per-project indexes). Full mechanics audited from code (not the aspirational docs).

**Adopt from v1:** two scopes (global/user + project); S3 Vectors + Titan embeddings;
dedup-at-write via 0.92-cosine probe → merge with `mention_count++` (global scope only);
synthesized per-project memory document (6 sections, versioned) — claude.ai-summary analog.

**v1's confirmed failures (each becomes a v2 requirement):**
- Ingestion trigger per doc (DynamoDB Streams) **doesn't exist**; live path is per-turn
  fire-and-forget → silent fact loss, no retry. → *v2: durable idle-debounced extraction.*
- Project-scope dedup **entirely missing** → unbounded near-duplicates. → *v2: dedup in all scopes.*
- `minConfidence`/`minScore` thresholds **dead code**; global search runs at 0.01 ≈ unfiltered.
  → *v2: real thresholds + composite ranking.*
- `confidence`/`mention_count` stored, **never used in ranking**. → *v2: composite score.*
- Token budgets declared, **not enforced**. → *v2: enforced budgets.*
- No opt-out, no global-memory UI, cleanup stubs are no-ops. → *v2: keep v2's controls, add user tab.*
- Single-turn extraction window (no cross-turn view). → *v2: rolling conversation window.*

## 3. claude.ai memory parity checklist

| claude.ai behavior | v2 plan |
|---|---|
| "What Claude knows about you" — editable user profile | USER-scope KV + synthesized profile summary, MemoryModal user tab |
| Project memories stay in project | PROJECT scope (existing), enforced by key prefix + index isolation |
| Memory applied silently in responses | recall injection (existing pattern, upgraded ranking) |
| View / edit / delete | MemoryModal (existing) + user scope |
| Incognito / don't-remember | per-chat toggle (existing) |
| Synthesized, refreshed summary | consolidation pass (EventBridge Scheduler → Lambda) |
| Sensitive-category avoidance | extraction prompt denylist (health, politics, religion, precise location…) |

## 4. Target architecture (AWS, scale-to-zero)

Everything on-demand: zero idle cost. Region us-east-1, same account.

```
chat turn ──────────────► recall(query, projectId)
                            ├─ DynamoDB: USER KV + PROJECT KV        (always, capped)
                            ├─ S3 Vectors: user-mem + proj-<id>-mem  (top-5 after ranking)
                            └─ DynamoDB GSI: 1-hop graph expansion   (entities in message, both directions)
conversation idle ──────► extract Lambda (Haiku 4.5, constrained JSON)
                            ├─ dedup probe (S3 Vectors ≥0.90 → merge, mention_count++)
                            ├─ DynamoDB writes (KV / NOTE / ENT / EDGE)
                            └─ S3 Vectors put (Titan v2 embed)
weekly / on-demand ─────► consolidate Lambda (merge dupes, resolve contradictions,
                            refresh profile summaries, TTL-decay stale low-importance notes)
```

### 4.1 DynamoDB — single table `atlasv2-memory` (on-demand)

| Item | PK | SK | Notes |
|---|---|---|---|
| Profile fact | `S#u#<userId>` \| `S#p#<projectId>` | `KV#<category>.<key>` | value, confidence, provenance[], created_at, updated_at |
| Note metadata | `S#…` | `NOTE#<factId>` | content, category, confidence, mention_count, source convs, ttl? |
| Entity | `S#…` | `ENT#<name>` | kind, props |
| Edge (forward) | `S#…#E#<src>` | `EDGE#<rel>#<dst>` | props, provenance |

**GSI1** (edge reverse): GSI1PK=`S#…#E#<dst>`, GSI1SK=`EDGE#<rel>#<src>` →
**true two-way entity search**: query PK for outbound, GSI1 for inbound. One table, one GSI,
zero idle cost — this is the adjacency-list pattern.

### 4.2 S3 Vectors — bucket `atlasv2-memory-vectors`

- Indexes: `user-mem`, `proj-<projectId>-mem` (v1 naming precedent, ≤63 chars sanitized)
- 1024-dim float32 cosine, Titan `amazon.titan-embed-text-v2:0` (Bedrock, pay-per-call)
- Metadata per vector: scope, category, factId, created_at, mention_count, content (≤1500)
- Vector key = factId (DynamoDB NOTE item is source of truth; vector is the recall index)

### 4.3 Ranking (fixes v1's dead thresholds)

```
score = 0.55·cosineSim + 0.20·recency(e^-age/90d) + 0.15·log1p(mention_count)/log(10) + 0.10·confidence
```
Hard floor `cosineSim ≥ 0.35`; top-5 across user+project indexes; enforced injection budget
(~1800 chars profile KV + ~1500 chars semantic + ~600 chars graph).

### 4.4 Graph — keep it, lean

S3 Vectors alone cannot answer "everything we know about Client Alpha" (similarity ≠
aggregation). The adjacency items live in the same table (no extra infra); extraction already
emits SPO triples locally today. Recall uses 1-hop expansion for entities named in the message;
2-hop reserved for an explicit "memory: deep lookup" tool.

### 4.5 Extraction & consolidation

- **Extract** (per conversation idle, ~75s debounce like today): rolling window of last N
  exchanges since previous pass; Haiku 4.5 constrained JSON; emits `user_facts[]`,
  `project_facts[]`, `graph_facts[]` + confidence; sensitive-category denylist in prompt.
- **Dedup-at-write** (all scopes): embed → probe index; ≥0.90 merge (newer text wins,
  mention_count++, provenance appended); 0.75–0.90 + contradiction-flag → supersede (tombstone).
- **Consolidate** (EventBridge Scheduler → Lambda, scale-to-zero): merge residual dupes,
  refresh the per-scope synthesized profile summary (claude.ai parity), decay: TTL on
  low-importance notes not recalled in 90d (recall bumps `last_recalled_at`).

### 4.6 Rollout

1. **Phase 1 (now):** provision table + vector bucket/indexes; implement `MemoryStore` adapter
   in the v2 server (DynamoDB + S3 Vectors + Bedrock embeddings via existing `[default]`
   profile) behind the existing engine interface (`recallContext`, `extract`, `memorySnapshot`,
   `upsertKv`, `deleteMemory`). Local SQLite mem_* retired; MemoryModal gains a User tab.
   Server still runs locally; **memory is the first AWS-native subsystem.**
2. **Phase 2:** extraction + consolidation move into Lambda when the whole backend goes
   serverless (v1-style API GW + Lambda, prefix `atlasv2`); recall stays in the chat path.
3. Cost profile: DynamoDB on-demand + S3 Vectors storage/query + Titan embed + Haiku extraction
   — all pay-per-use, $0 idle.
