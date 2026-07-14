# Parity Loop Log

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
