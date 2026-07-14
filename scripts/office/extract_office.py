"""Local counterpart to the office Lambda's `extract` op. Same extract_preview
code path, so a deck reads identically on a laptop and in the cloud — the only
difference is who runs it (this CLI via the bundled venv, or atlasv2-office).

usage: python extract_office.py <pptx|docx|xlsx|pdf> <file>  →  JSON on stdout
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from lambda_handler import extract_preview  # noqa: E402


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "usage: extract_office.py <kind> <file>"}))
        raise SystemExit(2)
    kind, src = sys.argv[1], Path(sys.argv[2])
    if kind not in {"pptx", "docx", "xlsx", "pdf"}:
        print(json.dumps({"ok": False, "error": f"cannot extract kind: {kind}"}))
        raise SystemExit(2)
    try:
        print(json.dumps(extract_preview(kind, src.read_bytes())))
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
