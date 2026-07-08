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


def _slide_to_svg(slide, w_emu, h_emu):
    """Render a slide's shapes to an SVG (scale-to-zero visual preview — no
    LibreOffice). EMU→px at 96dpi (EMU/9525); pt→px ×(96/72)."""
    import html as _html
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

    U = 9525.0
    VW, VH = w_emu / U, h_emu / U
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VW:.0f} {VH:.0f}" preserveAspectRatio="xMidYMid meet">']
    parts.append(f'<rect x="0" y="0" width="{VW:.0f}" height="{VH:.0f}" fill="#FAF9F5"/>')

    def hexof(color, default=None):
        try:
            return "#" + str(color.rgb)
        except Exception:
            return default

    for sh in slide.shapes:
        try:
            x, y = sh.left / U, sh.top / U
            w, h = sh.width / U, sh.height / U
        except Exception:
            continue
        # fill
        fill = None
        try:
            if sh.fill.type is not None and sh.fill.type == 1:  # solid
                fill = hexof(sh.fill.fore_color)
        except Exception:
            fill = None
        if sh.shape_type == MSO_SHAPE_TYPE.PICTURE:
            parts.append(f'<rect x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}" fill="#E3DFD5"/>')
        elif sh.shape_type == MSO_SHAPE_TYPE.CHART:
            parts.append(f'<rect x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}" fill="#F1EEE7"/>')
            parts.append(f'<text x="{x+w/2:.0f}" y="{y+h/2:.0f}" font-family="Poppins,Arial" font-size="16" fill="#73716B" text-anchor="middle">chart</text>')
        elif fill:
            shp = "ellipse" if getattr(sh, "auto_shape_type", None) is not None and str(sh.auto_shape_type) == "OVAL (9)" else "rect"
            try:
                is_oval = sh.auto_shape_type == 9  # MSO_SHAPE.OVAL
            except Exception:
                is_oval = False
            if is_oval:
                parts.append(f'<ellipse cx="{x+w/2:.0f}" cy="{y+h/2:.0f}" rx="{w/2:.0f}" ry="{h/2:.0f}" fill="{fill}"/>')
            else:
                rx = 8 if (getattr(sh, "auto_shape_type", None) == 5) else 0
                parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}"/>')
        # text
        if getattr(sh, "has_text_frame", False):
            tf = sh.text_frame
            anchor = tf.vertical_anchor
            paras = [p for p in tf.paragraphs if "".join(r.text for r in p.runs).strip()]
            # crude vertical layout: stack lines from the top (or centered)
            line_hs, styles, texts = [], [], []
            for p in paras:
                runs = p.runs or []
                sz = next((r.font.size.pt for r in runs if r.font.size), 18)
                bold = any(r.font.bold for r in runs)
                ital = any(r.font.italic for r in runs)
                col = next((hexof(r.font.color) for r in runs if hexof(r.font.color)), "#1A1917")
                fam = next((r.font.name for r in runs if r.font.name), "Poppins")
                txt = "".join(r.text for r in runs)
                px = sz * 96 / 72
                line_hs.append(px * 1.25); styles.append((px, bold, ital, col, fam, p.alignment)); texts.append(txt)
            total_h = sum(line_hs)
            if anchor == MSO_ANCHOR.MIDDLE:
                cy = y + (h - total_h) / 2
            elif anchor == MSO_ANCHOR.BOTTOM:
                cy = y + h - total_h
            else:
                cy = y
            for (px, bold, ital, col, fam, align), txt, lh in zip(styles, texts, line_hs):
                cy += lh
                if align == PP_ALIGN.CENTER:
                    tx, anc = x + w / 2, "middle"
                elif align == PP_ALIGN.RIGHT:
                    tx, anc = x + w, "end"
                else:
                    tx, anc = x, "start"
                weight = "700" if bold else "400"
                style = ' font-style="italic"' if ital else ""
                fam = (fam or "Poppins").split(",")[0]
                parts.append(
                    f'<text x="{tx:.0f}" y="{cy - lh*0.28:.0f}" font-family="{_html.escape(fam)},Arial,sans-serif" '
                    f'font-size="{px:.0f}" font-weight="{weight}" fill="{col}" text-anchor="{anc}"{style}>{_html.escape(txt)}</text>'
                )
    parts.append("</svg>")
    return "".join(parts)


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
        slides, svgs = [], []
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
            try:
                svgs.append(_slide_to_svg(s, prs.slide_width, prs.slide_height))
            except Exception:
                svgs.append(None)
        out["slides"] = slides
        out["svgs"] = svgs  # visual preview (rendered from shapes, no LibreOffice)
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
