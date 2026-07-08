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


def extract_preview(kind, file_bytes):
    """Structured preview extraction (pure-python, no LibreOffice). Returns
    {text, slides?, sheets?} so the client can render a readable preview in the
    scale-to-zero cloud where soffice/markitdown aren't available."""
    tmp = Path(tempfile.mkdtemp(prefix="preview-"))
    fp = tmp / f"in.{kind}"
    fp.write_bytes(file_bytes)
    out = {"kind": kind}
    if kind == "pptx":
        from pptx import Presentation

        prs = Presentation(str(fp))
        slides = []
        for s in prs.slides:
            title, bullets = None, []
            for shape in s.shapes:
                if not shape.has_text_frame:
                    continue
                for i, para in enumerate(shape.text_frame.paragraphs):
                    txt = "".join(r.text for r in para.runs).strip()
                    if not txt:
                        continue
                    if title is None and shape == s.shapes.title:
                        title = txt
                    else:
                        bullets.append(txt)
            slides.append({"title": title or "", "bullets": bullets[:12]})
        out["slides"] = slides
        out["text"] = "\n\n".join(
            f"# {sl['title']}\n" + "\n".join(f"- {b}" for b in sl["bullets"]) for sl in slides
        )
    elif kind == "docx":
        from docx import Document

        doc = Document(str(fp))
        blocks = []
        for p in doc.paragraphs:
            if p.text.strip():
                blocks.append({"style": p.style.name if p.style else "Normal", "text": p.text.strip()})
        for t in doc.tables:
            rows = [[c.text.strip() for c in r.cells] for r in t.rows]
            blocks.append({"style": "Table", "rows": rows[:20]})
        out["blocks"] = blocks[:200]
        out["text"] = "\n".join(b.get("text", "[table]") for b in blocks)
    elif kind == "xlsx":
        from openpyxl import load_workbook

        wb = load_workbook(str(fp), data_only=True, read_only=True)
        sheets = []
        for ws in wb.worksheets:
            rows = []
            for r in ws.iter_rows(values_only=True):
                rows.append(["" if c is None else str(c) for c in r])
                if len(rows) >= 50:
                    break
            sheets.append({"name": ws.title, "rows": rows})
        out["sheets"] = sheets
        out["text"] = "\n\n".join(
            f"[{sh['name']}]\n" + "\n".join(" | ".join(r) for r in sh["rows"][:20]) for sh in sheets
        )
    elif kind == "pdf":
        import pdfplumber

        with pdfplumber.open(str(fp)) as pdf:
            out["text"] = "\n\n".join((pg.extract_text() or "") for pg in pdf.pages[:30])
    else:
        out["text"] = ""
    return {"ok": True, **out}


def handler(event, _context):
    # preview extraction path (no build)
    if event.get("op") == "extract":
        kind = event.get("kind")
        b64 = event.get("file_b64")
        if kind not in {"pptx", "docx", "xlsx", "pdf"} or not b64:
            return {"ok": False, "error": f"cannot preview kind: {kind}"}
        try:
            return extract_preview(kind, base64.b64decode(b64))
        except Exception as err:  # noqa: BLE001
            return {"ok": False, "error": f"{type(err).__name__}: {err}"}

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
