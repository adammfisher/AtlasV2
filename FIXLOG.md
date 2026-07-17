# FIXLOG — every defect: root cause + fix + evidence

Format per entry: symptom → evidence → root cause → why it happened → fix → files changed.
Entries are appended chronologically; IDs are `FX-<n>`.

---

## FX-1 — `users.config.json` invalid JSON silently disables every non-primary account

- **Symptom:** Playwright full suite aborts at collection (`artifacts-bulk-delete.spec.ts:26` SyntaxError); `accounts` parity spec fails (susan/demo/brynn don't exist); any login except the primary account 401s.
- **Evidence:** `node -e "JSON.parse(readFileSync('users.config.json'))"` → `SyntaxError: Expected ',' or ']' after array element in JSON at position 736 (line 7 column 81)`; baseline logs `scratchpad/baseline/playwright.log`, `playwright-parity.log` (accounts spec).
- **Root cause:** a stray token `clauds` was appended after the `brynn` array element (line 7) — an accidental keystroke committed into the working tree during the uncommitted "add brynn" edit. `server/src/lib/account.ts:27-39 accounts()` wraps the parse in try/catch and **silently** degrades to the primary-only FALLBACK list, so the runtime kept working for the primary account and the breakage was invisible until something parsed the file strictly.
- **Why it happened:** hand-edited config with no parse check at edit time, plus a catch-all fallback that hides the failure. (The fallback is correct behavior for resilience; the missing piece is any surfaced signal — noted as a Phase 6 test: broken config must surface a visible warning, and a unit test now locks config validity.)
- **Fix:** removed the stray token. Also added the sanctioned `e2etest` account (isolated DynamoDB partition `A#e2etest|`) used by the new test harness — approved at the Phase 0 gate (open question 3/4).
- **Files changed:** `users.config.json`.
- **Regression lock:** `tests/unit/config.spec.ts` (U-CONF-1) parses `users.config.json` + `models.config.json` + `atlas.config.json` strictly and asserts every account's `models` keys resolve against `models.config.json`.
