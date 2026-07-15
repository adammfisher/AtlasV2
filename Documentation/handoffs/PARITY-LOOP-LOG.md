# Parity Loop Log

## 2026-07-15 — Session 3 (overnight autonomous run) — MORNING REPORT

**Standing count: 57 🟢 · 4 🟡 · 6 🔴** (from 47/6/14 at session start; Phase A
opened at 31/9/27). All work committed, pushed, and DEPLOYED to CloudFront.

### Your bug, fixed first
Sidebar **New chat no longer inherits the active project** — unscoped chats
land in a neutral "General" project (no instructions, clean memory scope);
chats started inside a project workspace stay in that project. Spec-proven
both ways; M2 isolation re-verified 8/8 under the new default.

### Built tonight (all spec-verified, all deployed)
- **V7 chat share**: read-only HTML snapshot in S3, 7-day view link, revocable
  (anonymous fetch 200 → revoke → dead), Share button in the chat header.
- **V8 exports**: single-chat JSON (?format=json) + all-conversations zip with
  manifest; "Export all" in the sidebar.
- **X7 artifacts gallery**: cross-chat/cross-project view with kind filters,
  project select, per-row downloads.
- **X6 voice dictation**: Web Speech wiring, composer transcript append,
  hidden on unsupported browsers.
- **W1 search 10/10** (was 7/10): DDG html→lite fallback + jittered backoff.
- **W2 citations**: search answers render inline source links.
- **P1/P3 directory honesty**: sharepoint endpoint/cred copy-paste bug fixed;
  github/postgres/sharepoint labeled Planned (outranks stale installs);
  stdio bundles labeled local-only → "unavailable" on the deployed app.
- **R5 analyze_table** + **R10 queued send** (earlier tonight, deployed).

### Harness-flaw discoveries (product was fine; matrix corrected)
M6 citation chips and V9 rename both worked all along — the audit specs
clicked phantom elements (third and fourth instances of this pattern; all
audit locators now verified against real DOM).

### Remaining 🔴 (6)
- **C5 react artifacts**: two root causes fixed tonight (entry-file heal —
  payload + disk; bundle now compiles in ~92ms where it died before), but
  Nova-emitted code mounts a blank frame, and the "try fixing" affordance is
  unbuilt. Next: mount contract in react SKILL.md + retry affordance.
- **P4 per-chat MCP toggles** (per-project exists).
- **P6 tool-kill honesty**: needs chip/log-level assertions, not reply-text.
- **M9 incognito**, **X1 styles**, **X3b LaTeX** (katex): genuine feature
  builds, scoped and ready in the matrix notes.
- **X4 streaming resilience**: needs an infra-manipulation test approach.

### Remaining 🟡 (4)
S4 (repair-loop completion proof), C10 (restore affordance), C11 (share page
vs download), W4 (per-chat search scope), P5 (deployed /tmp credential key —
needs KMS/DynamoDB storage; design note in matrix), P2 addCustom→active
project (fixed tonight — verify on next deployed add).

### Exit-criteria status (Phase C)
Not yet met: 6 RED rows remain, and the 3× consecutive clean-suite runs +
full-sweep spec are still to do. Recommend: finish the 6 REDs (C5 being the
big one), then build tests/e2e/parity/full-sweep.spec.ts, then the 3×
consecutive runs against the deployed app.

### Morning verification (2 minutes)
1. Open the deployed app — sidebar New chat should say "General" in the header.
2. Artifacts nav item → gallery with filters.
3. Any chat → Share button → link opens read-only in an incognito window.
4. Ask "search the web for X" → answer carries clickable source links.


## 2026-07-14 — Session 2 (Phase B fix loop) — CLOSED

Session close: everything below shipped to AWS (app+client+office at HEAD).
Deployed evidence: R suite 12/12, ultra file sweep 13/13, memory-eval 14/14,
M2 8/8, S2 20/20, DeepWiki remote MCP live in production chat.

Next three targets:
1. C5 react-artifact repro (headed) + fix affordance; P6 instrumented repro
   (chip/log assertions); V9 headed repro of the prompt-rename flow.
2. P1/P3 directory honesty (label planned/local-only, fix sharepoint
   endpoint+cred key, drop phantom github/postgres or add servers).
3. W1 search hardening + W2 citations; then V7 chat share, M6 citation chips,
   M9 incognito, X1 styles, X6 voice, X7 gallery (feature builds).

## 2026-07-14 — Session 2 (Phase B fix loop) — running log

GREEN flips this session (each spec-verified, committed per item):
- R2 docx tables · R3 xlsx formulas · C1 pptx 28s (was 4min/∞, gate 2200→1200
  + 150s abort ceiling) · C7 extractSvg · M7 (harness) · R7 read_document
  serves text kinds · R5 analyze_table (deterministic aggregates) · R10
  queued send with banner · P2 local AND DEPLOYED (real public server:
  mcp.deepwiki.com added by URL, tool invoked in production chat).
- Deployed R suite: 11/12 → 12/12 after the R7 fix + redeploy.
- Office Lambda deployed (first time scripted); app+client deployed twice.

Root causes found by measurement, not guessing:
- Bedrock json_schema grammar compile ~188s for the pptx schema; tool-use 5-7s
  with the same shape. Gate now 1200.
- Deployed dedup/supersede: adjudicate() runs maxTokens:32 through forced
  tool-use on Nova (supportsJsonSchema matches claude-* only) — the tool
  envelope alone exceeds 32 tokens → parse throw → 'different' every time.
  Fix queued (bump budget).
- addCustom enables hardcoded "p1", not the active project — found live while
  adding DeepWiki to the deployed app.

Harness lessons: no <aside> exists (4 phantom failures); Playwright configs
resolve from CWD (one invalid regression run); archive test-results before
reruns; window.prompt needs dialog handlers, not DOM fills.

Session handoffs for the claude.ai-parity mission. Each entry: items closed,
items attempted-and-blocked, next three targets. The matrix
(`Documentation/PARITY_MATRIX.md`) is the source of truth; this is the wire
between sessions.

---

## 2026-07-14 — Session 1 (Phase A audit) — COMPLETE

**Initial counts: 31 🟢 · 9 🟡 · 27 🔴** (67 rows, all evidence-based).

Closed (audited, evidence linked in matrix): all of R, C, S; V except V9/V10
triage; W; M except M7 re-audit; X except X4's test approach. Ran 51 Playwright
tests + 5 script evals; M1/M2 ran against the DEPLOYED CloudFront stack.

Attempted-and-blocked:
- P2/P6: spec timed out clicking the Plugins nav — needs interactive repro
  (harness or app-state; mock MCP server itself came up fine).
- M7: harness bug — instructions were set on projects[0], chat ran in the
  active project. Re-audit with activeProjectId.
- X4: needs an infra-manipulation approach (throttled conn, tab-close), not a
  DOM assertion.

Highest-value findings (start Phase B here):
1. R2 docx tables → literal "[table]" (extraction) — file-reading priority #1.
2. C1 pptx first pass FAILS Bedrock schema ("required property 'title'") →
   every deck pays a repair round (~4 min) or stalls forever (no first-token
   timeout, no error surface — also X5).
3. M5 deletion propagation confirmed broken; M1 deployed 10/14 (dedup,
   supersede, forget); the historical 14/14 was unverifiable-by-construction.
4. X3: markdown TABLES render as raw pipes in chat.
5. P-section structural: /tmp credential key (cold start orphans creds
   silently), sharepoint→mcp.slack.com copy-paste bug, github/postgres
   phantom connectors.

Session hygiene notes: archive test-results before ANY rerun (Playwright wipes
it); eval runs pollute recents (V9) — add [e2e] markers or teardown to the
script evals too; per-project remembered model changes mid-audit (Nova 2 Lite
→ Haiku 4.5) — pin a model for comparable evidence.

Next three targets:
1. Deploy `b07f981` (deploy-app.sh) and re-run the R suite against CloudFront —
   converts the local R GREENs into deployed GREENs (or exposes deltas).
2. R2 + R3 extraction fixes (docx table text, xlsx formula visibility) — same
   file, one commit each, spec-verified.
3. C1 pptx schema mismatch (constrained decoding emits without 'title') + a
   first-token timeout with a surfaced error (buys X5 progress too).
