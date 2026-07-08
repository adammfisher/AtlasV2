#!/usr/bin/env python3
"""
Master PPTX designer (skills/pptx/schema.json → a designed 16:9 deck).

Rather than filling a template's weak built-in layouts, this draws every slide
from scratch with a cohesive, premium theme (Anthropic-style warm palette,
strong type hierarchy, generous whitespace, accent details). Layouts: title,
section divider, bullets, two-column, stat/metrics, quote, chart, closing.
Self-contained — no template or exemplar library dependency.
"""
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt, Emu

import validate_common as vc

# ── theme (warm, premium — the Atlas/Claude palette) ──────────────────────
INK = RGBColor(0x1A, 0x19, 0x17)      # near-black warm text
MUTE = RGBColor(0x73, 0x71, 0x6B)     # warm gray
BG = RGBColor(0xFA, 0xF9, 0xF5)       # warm off-white
PANEL = RGBColor(0xF1, 0xEE, 0xE7)    # subtle panel
LINE = RGBColor(0xE3, 0xDF, 0xD5)     # hairline
ACCENT = RGBColor(0xC9, 0x62, 0x42)   # clay/coral accent
ACCENT_SOFT = RGBColor(0xE8, 0xD5, 0xCB)
DARK = RGBColor(0x26, 0x24, 0x22)     # warm dark (section / closing)
DARK_MUTE = RGBColor(0xA8, 0xA2, 0x97)
WHITE = RGBColor(0xFA, 0xF9, 0xF5)
CHART_PALETTE = [
    RGBColor(0xC9, 0x62, 0x42), RGBColor(0x37, 0x5A, 0x5A),
    RGBColor(0xD1, 0xA0, 0x54), RGBColor(0x6B, 0x7A, 0x8F),
    RGBColor(0x8A, 0x5A, 0x44),
]
HEAD = "Poppins"
BODY = "Poppins"

EMU_IN = 914400
W = 13.333
H = 7.5
MARGIN = 0.92


def _slide(prs, bg=BG):
    s = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    r.fill.solid(); r.fill.fore_color.rgb = bg
    r.line.fill.background()
    r.shadow.inherit = False
    # push background to back
    sp = r._element
    sp.getparent().remove(sp)
    s.shapes._spTree.insert(2, sp)
    return s


def _rect(slide, x, y, w, h, color, shape=MSO_SHAPE.RECTANGLE, line=None):
    sh = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = color
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line; sh.line.width = Pt(1)
    sh.shadow.inherit = False
    return sh


def _text(slide, x, y, w, h, runs, size=18, color=INK, bold=False, font=BODY,
          align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.0, italic=False):
    """runs: a string, or list of (text, {overrides}) for mixed styling."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = 0; tf.margin_right = 0; tf.margin_top = 0; tf.margin_bottom = 0
    lines = runs if isinstance(runs, list) else [runs]
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if spacing != 1.0:
            p.line_spacing = spacing
        segs = ln if isinstance(ln, list) else [(ln, {})]
        for text, ov in segs:
            r = p.add_run(); r.text = str(text)
            f = r.font
            f.size = Pt(ov.get("size", size))
            f.bold = ov.get("bold", bold)
            f.italic = ov.get("italic", italic)
            f.name = ov.get("font", font)
            f.color.rgb = ov.get("color", color)
    return tb


def _footer(slide, title, idx, total, dark=False):
    c = DARK_MUTE if dark else MUTE
    _rect(slide, MARGIN, H - 0.62, 0.28, 0.02, ACCENT)
    _text(slide, MARGIN + 0.36, H - 0.74, 8, 0.3, title, size=9.5, color=c, font=BODY)
    _text(slide, W - MARGIN - 2, H - 0.74, 2, 0.3, f"{idx} / {total}", size=9.5,
          color=c, align=PP_ALIGN.RIGHT, font=BODY)


def _title_block(slide, heading, y=0.95):
    """Section title with an accent underline — used on content slides."""
    _rect(slide, MARGIN, y, 0.5, 0.09, ACCENT)
    _text(slide, MARGIN, y + 0.22, W - 2 * MARGIN, 1.1, heading, size=30, bold=True,
          font=HEAD, color=INK, spacing=1.02)


# ── layouts ───────────────────────────────────────────────────────────────
def slide_title(prs, spec, idx, total):
    s = _slide(prs, BG)
    _rect(s, 0, 0, 0.32, H, ACCENT)                      # left accent spine
    _rect(s, MARGIN, 2.35, 0.9, 0.11, ACCENT)
    _text(s, MARGIN, 2.7, W - 2 * MARGIN, 2.4, spec["heading"], size=46, bold=True,
          font=HEAD, color=INK, spacing=1.03)
    sub = spec.get("subtitle") or (spec.get("bullets") or [None])[0]
    if sub:
        _text(s, MARGIN, 5.05, W - 2 * MARGIN, 1.0, str(sub), size=18, color=MUTE, font=BODY)
    # geometric accent, bottom-right
    _rect(s, W - 2.1, H - 1.5, 1.1, 1.1, ACCENT_SOFT, shape=MSO_SHAPE.OVAL)
    return s


def slide_section(prs, spec, idx, total):
    s = _slide(prs, DARK)
    _text(s, MARGIN - 0.05, 1.35, 4, 2.0, f"{idx:02d}", size=104, bold=True, font=HEAD,
          color=RGBColor(0x35, 0x32, 0x2E))
    _text(s, MARGIN, 3.35, W - 2 * MARGIN, 1.4, spec["heading"], size=40, bold=True,
          font=HEAD, color=WHITE, spacing=1.03)
    _rect(s, MARGIN, 4.55, 0.7, 0.1, ACCENT)
    sub = spec.get("subtitle")
    if sub:
        _text(s, MARGIN, 4.8, W - 2 * MARGIN, 1.0, str(sub), size=16, color=DARK_MUTE, font=BODY)
    return s


def slide_bullets(prs, spec, idx, total):
    s = _slide(prs, BG)
    _title_block(s, spec["heading"])
    items = [str(b) for b in (spec.get("bullets") or [])][:7]
    top = 2.35
    avail = H - top - 0.9
    row = min(0.92, avail / max(1, len(items)))
    fs = 18 if len(items) <= 5 else 15
    for i, it in enumerate(items):
        y = top + i * row
        _rect(s, MARGIN, y + 0.08, 0.16, 0.16, ACCENT, shape=MSO_SHAPE.OVAL)
        _text(s, MARGIN + 0.42, y, W - 2 * MARGIN - 0.42, row, it, size=fs,
              color=INK, font=BODY, anchor=MSO_ANCHOR.TOP, spacing=1.05)
    _footer(s, spec.get("_deck", ""), idx, total)
    return s


def slide_two_col(prs, spec, idx, total):
    s = _slide(prs, BG)
    _title_block(s, spec["heading"])
    cols = [
        (spec.get("col_left") or [], spec.get("col_left_head") or spec.get("subtitle")),
        (spec.get("col_right") or [], spec.get("col_right_head")),
    ]
    cw = (W - 2 * MARGIN - 0.5) / 2
    for c, (items, head) in enumerate(cols):
        x = MARGIN + c * (cw + 0.5)
        _rect(s, x, 2.35, cw, H - 2.35 - 0.9, PANEL, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        yy = 2.7
        if head:
            _text(s, x + 0.35, yy, cw - 0.7, 0.5, str(head), size=15, bold=True,
                  font=HEAD, color=ACCENT)
            yy += 0.6
        for it in [str(i) for i in items][:6]:
            _rect(s, x + 0.35, yy + 0.09, 0.12, 0.12, ACCENT, shape=MSO_SHAPE.OVAL)
            _text(s, x + 0.62, yy, cw - 0.95, 0.7, it, size=13.5, color=INK, font=BODY, spacing=1.03)
            yy += 0.62
    _footer(s, spec.get("_deck", ""), idx, total)
    return s


def slide_stat(prs, spec, idx, total):
    s = _slide(prs, BG)
    _title_block(s, spec["heading"])
    stats = spec.get("stats") or []
    if not stats:  # derive from bullets if the model didn't fill stats
        stats = [{"value": "•", "label": b} for b in (spec.get("bullets") or [])[:3]]
    stats = stats[:3]
    n = max(1, len(stats))
    gap = 0.5
    cw = (W - 2 * MARGIN - gap * (n - 1)) / n
    for i, st in enumerate(stats):
        x = MARGIN + i * (cw + gap)
        _rect(s, x, 2.7, cw, 3.2, PANEL, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        _rect(s, x + 0.4, 3.1, 0.5, 0.08, ACCENT)
        _text(s, x + 0.35, 3.35, cw - 0.7, 1.5, str(st.get("value", "")), size=54,
              bold=True, font=HEAD, color=ACCENT)
        _text(s, x + 0.4, 4.85, cw - 0.8, 0.9, str(st.get("label", "")), size=14,
              color=MUTE, font=BODY, spacing=1.05)
    _footer(s, spec.get("_deck", ""), idx, total)
    return s


def slide_quote(prs, spec, idx, total):
    s = _slide(prs, DARK)
    _text(s, MARGIN - 0.1, 1.4, 3, 2, "“", size=140, bold=True, font=HEAD,
          color=ACCENT)
    q = spec.get("quote") or spec["heading"]
    _text(s, MARGIN + 0.1, 2.7, W - 2 * MARGIN - 0.2, 2.6, str(q), size=30, font=HEAD,
          color=WHITE, spacing=1.12, italic=True)
    who = spec.get("attribution") or spec.get("subtitle")
    if who:
        _rect(s, MARGIN + 0.1, 5.5, 0.5, 0.06, ACCENT)
        _text(s, MARGIN + 0.75, 5.32, W - 3, 0.5, str(who), size=15, color=DARK_MUTE, font=BODY)
    return s


def slide_chart(prs, spec, idx, total):
    s = _slide(prs, BG)
    _title_block(s, spec["heading"])
    cs = spec.get("chart") or {}
    if cs.get("series"):
        data = CategoryChartData()
        data.categories = [str(c) for c in (cs.get("labels") or [])] or ["—"]
        n = len(data.categories)
        for ser in cs["series"]:
            vals = (list(ser.get("values") or []) + [0] * n)[:n]
            data.add_series(str(ser.get("name", "series")), vals)
        ctype = {"line": XL_CHART_TYPE.LINE_MARKERS, "bar": XL_CHART_TYPE.COLUMN_CLUSTERED,
                 "pie": XL_CHART_TYPE.PIE}.get(cs.get("kind", "bar"), XL_CHART_TYPE.COLUMN_CLUSTERED)
        gf = s.shapes.add_chart(ctype, Inches(MARGIN), Inches(2.45),
                                Inches(W - 2 * MARGIN), Inches(3.9), data)
        chart = gf.chart
        chart.has_title = False
        try:
            for i, plot_ser in enumerate(chart.series):
                plot_ser.format.fill.solid()
                plot_ser.format.fill.fore_color.rgb = CHART_PALETTE[i % len(CHART_PALETTE)]
        except Exception:
            pass
        if cs.get("kind") == "pie" or len(list(chart.series)) > 1:
            chart.has_legend = True
            chart.legend.position = XL_LEGEND_POSITION.BOTTOM
            chart.legend.include_in_layout = False
    _footer(s, spec.get("_deck", ""), idx, total)
    return s


def slide_closing(prs, spec, idx, total):
    s = _slide(prs, DARK)
    _rect(s, W / 2 - 0.45, 2.5, 0.9, 0.11, ACCENT)
    _text(s, MARGIN, 2.95, W - 2 * MARGIN, 1.6, spec["heading"], size=40, bold=True,
          font=HEAD, color=WHITE, align=PP_ALIGN.CENTER, spacing=1.03)
    sub = spec.get("subtitle") or (spec.get("bullets") or [None])[0]
    if sub:
        _text(s, MARGIN, 4.5, W - 2 * MARGIN, 1.0, str(sub), size=17, color=DARK_MUTE,
              font=BODY, align=PP_ALIGN.CENTER)
    return s


LAYOUTS = {
    "title": slide_title, "section": slide_section, "bullets": slide_bullets,
    "summary": slide_bullets, "two_col": slide_two_col, "stat": slide_stat,
    "quote": slide_quote, "chart": slide_chart, "closing": slide_closing,
}


def build(payload: dict, template: str, out: Path) -> dict:
    prs = Presentation()
    prs.slide_width = Emu(int(W * EMU_IN))
    prs.slide_height = Emu(int(H * EMU_IN))
    deck_title = payload.get("title", "")
    slides = payload["slides"]
    total = len(slides)
    for i, spec in enumerate(slides, start=1):
        spec = dict(spec)
        spec["_deck"] = deck_title
        fn = LAYOUTS.get(spec.get("layout"), slide_bullets)
        s = fn(prs, spec, i, total)
        notes = spec.get("notes")
        if notes:
            s.notes_slide.notes_text_frame.text = str(notes)
    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))
    return {"slides": total, "bytes": out.stat().st_size}


def extract_texts(path: Path) -> list:
    texts = []
    prs = Presentation(str(path))
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                texts.append(shape.text_frame.text)
    return texts


def main() -> None:
    args = vc.cli("pptx builder")
    payload = vc.load_payload(args.payload)
    out = Path(args.out)
    meta = build(payload, args.template or "", out)

    checks = [vc.openxml_audit(out), vc.zip_sanity(out)]
    reopened = Presentation(str(out))
    texts = extract_texts(out)
    checks.append(
        vc.check("Round-trip", len(list(reopened.slides)) == meta["slides"] and any(t.strip() for t in texts))
    )
    checks.append(vc.placeholder_grep(texts))
    checks.append(vc.soffice_convert(out, "soffice open/convert", vc.THUMBS_SKIP))
    vc.emit(out, meta, checks)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:  # helper contract: stderr + exit 1
        vc.fail(f"{type(err).__name__}: {err}")
