#!/bin/bash
# Axiom office-helper toolchain bootstrap (PRD §0.1, Stage 3). Idempotent.
# Creates runtimes/python/venv and installs exact-pinned wheels.
set -euo pipefail
cd "$(dirname "$0")/../.."

VENV=runtimes/python/venv
# python@3.13 pinned: brew python@3.14 has a broken pyexpat (dlopen symbol error)
# and the office wheel ecosystem lags 3.14. Recorded in HANDOFF-3.
PYTHON=${AXIOM_PYTHON:-/opt/homebrew/opt/python@3.13/bin/python3.13}

if [ ! -x "$VENV/bin/python" ]; then
  echo "creating venv at $VENV"
  "$PYTHON" -m venv "$VENV"
fi

PIP="$VENV/bin/pip"
"$PIP" install --quiet --upgrade pip

# Exact pins (PRD Stage 3 list; weasyprint/pdfplumber/markitdown pinned at bootstrap time)
"$PIP" install --quiet \
  python-pptx==1.0.2 \
  python-docx==1.2.0 \
  openpyxl==3.1.5 \
  docxtpl==0.20.2 \
  weasyprint==69.0 \
  pdfplumber==0.11.9 \
  "markitdown[all]==0.1.6"

# PRD §4.5: try openxml-audit; proceed without if unavailable (record in handoff)
if "$PIP" install --quiet openxml-audit 2>/dev/null; then
  echo "openxml-audit installed"
else
  echo "openxml-audit unavailable — validation proceeds without check (b0)"
fi

# default office templates (idempotent — skips if present)
"$VENV/bin/python" scripts/office/make_default_templates.py

echo "bootstrap complete: $("$VENV/bin/python" --version)"
"$PIP" freeze | grep -Ei "pptx|docx|openpyxl|docxtpl|weasyprint|pdfplumber|markitdown|openxml" || true
