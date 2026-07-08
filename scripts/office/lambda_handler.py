"""
atlasv2-office Lambda (PRD §12.1): scale-to-zero Python office builder. The
main app Lambda invokes this with {skill, payload, template_b64?}; it runs the
same build_<skill>.py used locally and returns {ok, meta, checks, file_b64}.
Single-file kinds only (pptx/docx/xlsx/pdf); react/site/mermaid/svg/md never
touch Python. Pure-python deps in a layer — no containers, no native libs.
"""
import base64
import importlib
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SKILLS = {"pptx", "docx", "xlsx", "pdf"}
# template filename per skill (bundled beside the handler under templates/)
TEMPLATES = {"pptx": "dfs_default.potx", "docx": "atlas_default.dotx"}


def handler(event, _context):
    skill = event.get("skill")
    payload = event.get("payload")
    if skill not in SKILLS or payload is None:
        return {"ok": False, "error": f"unsupported skill: {skill}"}

    tmp = Path(tempfile.mkdtemp(prefix="office-"))
    payload_file = tmp / "payload.json"
    payload_file.write_text(json.dumps(payload))
    ext = "pptx" if skill == "pptx" else skill
    out_file = tmp / f"out.{ext}"

    argv = ["build", "--payload", str(payload_file), "--out", str(out_file)]
    tmpl = HERE / "templates" / TEMPLATES.get(skill, "")
    if skill in TEMPLATES and tmpl.exists():
        argv += ["--template", str(tmpl)]

    mod = importlib.import_module(f"build_{skill}")
    old_argv, old_stdout = sys.argv, sys.stdout
    sys.argv = argv
    captured = tempfile.SpooledTemporaryFile(mode="w+")
    sys.stdout = captured
    result = {"ok": False, "error": "builder produced no output"}
    try:
        try:
            mod.main()
        except SystemExit:
            pass
        captured.seek(0)
        last = [ln for ln in captured.read().strip().splitlines() if ln.strip()]
        if last:
            result = json.loads(last[-1])
    except Exception as err:  # noqa: BLE001
        result = {"ok": False, "error": f"{type(err).__name__}: {err}"}
    finally:
        sys.argv, sys.stdout = old_argv, old_stdout

    if out_file.exists():
        result["file_b64"] = base64.b64encode(out_file.read_bytes()).decode()
    return result


# local smoke: python lambda_handler.py '{"skill":"xlsx","payload":{...}}'
if __name__ == "__main__":
    print(json.dumps(handler(json.loads(sys.argv[1]), None))[:200])
