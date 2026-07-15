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


def _slide_text(i, sl):
    """One slide as readable markdown — numbered so a reader can cite 'slide 4'."""
    head = f"## Slide {i + 1}" + (f": {sl['title']}" if sl["title"] else "")
    parts = [head]
    parts += [f"- {b}" for b in sl["bullets"]]
    for tbl in sl.get("tables", []):
        parts += [" | ".join(row) for row in tbl]
    for ch in sl.get("charts", []):
        parts.append(f"[{ch['type']} chart] categories: {', '.join(ch['categories'])}")
        for sr in ch["series"]:
            vals = ", ".join("—" if v is None else f"{v:g}" for v in sr["values"])
            parts.append(f"  {sr['name'] or 'series'}: {vals}")
    if sl.get("notes"):
        parts.append(f"Speaker notes: {sl['notes']}")
    return "\n".join(parts)


def _deck_design(prs):
    """Analyze the deck's LOOK & FEEL so the model can discuss design, not just
    text: dominant colors, fonts, slide size/aspect, and the layout mix. Pure
    python-pptx — no rendering."""
    from collections import Counter

    colors, fonts, sizes = Counter(), Counter(), Counter()
    pics = tables = charts = 0
    for slide in prs.slides:
        for sh in slide.shapes:
            if sh.shape_type == 13:  # PICTURE
                pics += 1
            if getattr(sh, "has_table", False):
                tables += 1
            if getattr(sh, "has_chart", False):
                charts += 1
            try:
                if sh.fill.type == 1:
                    colors[f"#{sh.fill.fore_color.rgb}"] += 1
            except Exception:
                pass
            if getattr(sh, "has_text_frame", False):
                for p in sh.text_frame.paragraphs:
                    for r in p.runs:
                        # skip theme-token font refs (+mj-lt, +mn-lt) — not real names
                        if r.font.name and not r.font.name.startswith("+"):
                            fonts[r.font.name] += 1
                        try:
                            if r.font.color and r.font.color.type is not None:
                                colors[f"#{r.font.color.rgb}"] += 1
                        except Exception:
                            pass
                        if r.font.size:
                            sizes[round(r.font.size.pt)] += 1
    emu = 914400.0
    w, h = prs.slide_width / emu, prs.slide_height / emu
    aspect = "16:9" if abs(w / h - 16 / 9) < 0.05 else ("4:3" if abs(w / h - 4 / 3) < 0.05 else f"{w:.1f}x{h:.1f}in")
    return {
        "slide_count": len(prs.slides._sldIdLst),
        "aspect": aspect,
        "size_in": [round(w, 1), round(h, 1)],
        "palette": [c for c, _ in colors.most_common(6)],
        "fonts": [f for f, _ in fonts.most_common(4)],
        "font_sizes_pt": sorted({s for s, _ in sizes.most_common(6)}),
        "images": pics,
        "tables": tables,
        "charts": charts,
    }


def _design_text(d):
    lines = ["## Visual design (look & feel)"]
    lines.append(f"- Format: {d['aspect']} ({d['size_in'][0]}×{d['size_in'][1]} in), {d['slide_count']} slides")
    if d["palette"]:
        lines.append(f"- Color palette: {', '.join(d['palette'])}")
    if d["fonts"]:
        lines.append(f"- Fonts: {', '.join(d['fonts'])}")
    if d["font_sizes_pt"]:
        lines.append(f"- Type sizes: {', '.join(str(s) + 'pt' for s in d['font_sizes_pt'])}")
    visuals = []
    if d["images"]:
        visuals.append(f"{d['images']} images")
    if d["charts"]:
        visuals.append(f"{d['charts']} charts")
    if d["tables"]:
        visuals.append(f"{d['tables']} tables")
    if visuals:
        lines.append(f"- Visual elements: {', '.join(visuals)}")
    return "\n".join(lines)


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
            # tables and charts carry the substance on data slides — a deck read
            # without them comes back empty exactly where it matters most
            tables, charts = [], []
            for shape in s.shapes:
                if getattr(shape, "has_table", False):
                    tables.append([[c.text.strip() for c in row.cells] for row in shape.table.rows][:20])
                if getattr(shape, "has_chart", False):
                    try:
                        ch = shape.chart
                        cats = [str(c) for c in ch.plots[0].categories]
                        charts.append({
                            "type": str(ch.chart_type).split(" ")[0].lower(),
                            "categories": cats,
                            "series": [
                                {"name": sr.name or "", "values": [None if v is None else float(v) for v in sr.values]}
                                for sr in ch.series
                            ],
                        })
                    except Exception:
                        pass
            notes = ""
            try:
                if s.has_notes_slide:
                    notes = s.notes_slide.notes_text_frame.text.strip()
            except Exception:
                notes = ""
            slide = {"title": title or "", "bullets": bullets[:12]}
            if tables:
                slide["tables"] = tables
            if charts:
                slide["charts"] = charts
            if notes:
                slide["notes"] = notes
            slides.append(slide)
            try:
                svgs.append(_slide_to_svg(s, prs.slide_width, prs.slide_height))
            except Exception:
                svgs.append(None)
        out["slides"] = slides
        out["svgs"] = svgs  # visual preview (rendered from shapes, no LibreOffice)
        design = _deck_design(prs)
        out["design"] = design
        text = "\n\n".join(_slide_text(i, sl) for i, sl in enumerate(slides))
        if design:
            text = f"{_design_text(design)}\n\n{text}"
        out["text"] = text
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
        # tables carry their rows into the text — a "[table]" placeholder reads
        # to the model as an empty table and it says so to the user
        out["text"] = "\n".join(
            b["text"] if "text" in b else "\n".join(" | ".join(r) for r in b.get("rows", []))
            for b in blocks
        )
    elif kind == "xlsx":
        from openpyxl import load_workbook

        # two passes: data_only gives cached values (present when Excel saved
        # the file), the raw pass gives formula text. A formula cell renders as
        # "=SUM(B2:B3) → 36" with the value, or just the formula without it —
        # data_only alone made formulas literally invisible (empty cells).
        wb = load_workbook(str(fp), data_only=True, read_only=True)
        wb_raw = load_workbook(str(fp), read_only=True)
        sheets = []
        for ws, ws_raw in zip(wb.worksheets, wb_raw.worksheets):
            rows = []
            for r, r_raw in zip(ws.iter_rows(values_only=True), ws_raw.iter_rows(values_only=True)):
                cells = []
                for val, raw in zip(r, r_raw):
                    if isinstance(raw, str) and raw.startswith("="):
                        cells.append(f"{raw} → {val}" if val is not None else raw)
                    else:
                        cells.append("" if val is None else str(val))
                rows.append(cells)
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


def _source_bytes(event):
    """Extract source: inline base64, or an S3 object. A synchronous invoke caps
    the request at 6MB and base64 inflates by 4/3, so callers hand anything
    larger over as a key — this function shares the app's role and can read the
    uploads bucket itself."""
    if event.get("file_b64"):
        return base64.b64decode(event["file_b64"])
    src = event.get("s3")
    if src and src.get("bucket") and src.get("key"):
        import boto3

        return boto3.client("s3").get_object(Bucket=src["bucket"], Key=src["key"])["Body"].read()
    return None


def handler(event, _context):
    # preview extraction path (no build)
    if event.get("op") == "extract":
        kind = event.get("kind")
        if kind not in {"pptx", "docx", "xlsx", "pdf"}:
            return {"ok": False, "error": f"cannot preview kind: {kind}"}
        try:
            data = _source_bytes(event)
        except Exception as err:  # noqa: BLE001
            return {"ok": False, "error": f"source unreadable: {type(err).__name__}: {err}"}
        if not data:
            return {"ok": False, "error": "no file_b64 or s3 source given"}
        try:
            return extract_preview(kind, data)
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
