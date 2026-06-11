# Stage 4 demo — MCP plugins + memory

Pre-req: `pnpm dev` running, model loaded (`/api/health` ready).

## 1. Install → enable → invoke (the marquee gate)

1. Open **Plugins**. Filesystem / Memory / SQLite show as *bundled* and connected.
2. Open a chat in the General project and ask: **"list the files in this project"**.
3. Watch: a dim `⚙ fs_list · Filesystem` chip appears above the answer, and the
   answer lists real files from `dataDir/projects/p1/files/`.
4. Every call lands in `dataDir/logs/audit.log` (tool, path, project, timestamp —
   never file contents).

## 2. Memory recall

1. Tell Atlas: **"remember this: our launch codename is Bluebird"** → `memory_upsert` chip.
2. New conversation, same project: **"what's our launch codename?"** — the answer
   carries a "Known context" recall (top-3 `memory_search` hits are injected into
   the system prompt for every chat in a memory-enabled project).

## 3. Per-project isolation

1. Plugins → Filesystem → toggle OFF for General, ON for Atlas Core only.
2. Chat in General: "list the files in this project" — no tool chip; the model
   answers without filesystem access.
3. `pnpm test:stage4-gates` proves the same at the API layer (tool invisibility +
   refused direct calls + memory scoping), plus the credentials round-trip and
   audit-shape gates.

## 4. Knowledge Core flip

1. `pnpm mock:kc` (mock KC on 127.0.0.1:7979 serving the six org_* tools).
2. Plugins → refresh: the dashed *planned* card flips to **available** live.
3. Install it — status `connected`, detail panel shows the six live org tools.
4. Define a product in a KC-enabled project: the Spine/Collision/Dependency chips
   flip from skip-ambers to live results (`Spine — {ref} not found` ambers stay
   honest for unknown refs).

## 5. Custom server + credentials

1. Plugins → Add custom server → stdio, command `servers/filesystem.ts` (any repo
   path works; host binaries outside the repo are refused).
2. Open any installed remote connector → paste a token → Save. The token lands
   AES-256-GCM-encrypted in `dataDir/credentials/`; `grep -r` of the data dir
   finds no plaintext (gate-verified).

## 6. Tool reliability decision

`pnpm test:stage4-smoke` runs the 10-prompt smoke set (§6.3). Result and the
ship/gate decision are recorded in HANDOFF-4.
