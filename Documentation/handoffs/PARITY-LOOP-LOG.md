# Parity Loop Log

Session handoffs for the claude.ai-parity mission. Each entry: items closed,
items attempted-and-blocked, next three targets. The matrix
(`Documentation/PARITY_MATRIX.md`) is the source of truth; this is the wire
between sessions.

---

## 2026-07-14 — Session 1 (Phase A audit) — IN PROGRESS

Entry finalized at session end; running notes:

- Playwright wipes `test-results/` on every run — ARCHIVE failure screenshots
  before rerunning anything, or the evidence is gone (lost C5's screenshot).
- The audit runs against **Nova 2 Lite** (per-project remembered model) —
  tool-use-dependent rows (R5 aggregates, read_document behaviors) are
  model-sensitive; re-judge if the default model changes.
- Deployed Lambda predates `b07f981` (extraction overhaul): local R-section
  GREENs do not hold deployed until deploy-app.sh ships.
- Eval harnesses from the SQLite era: memory-eval PORTED (behavioral JIT-flush
  check), isolation gate REPLACED by parity-m2-isolation.ts (API-level).
