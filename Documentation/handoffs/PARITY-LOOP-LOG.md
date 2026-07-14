# Parity Loop Log

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
