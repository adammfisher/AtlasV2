#!/usr/bin/env python3
"""Compile slides-JSON (skills/pptx/schema.json) onto a .potx template."""
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import PP_PLACEHOLDER
from pptx.util import Inches, Pt

import validate_common as vc
from exemplar_engine import ExemplarDeck

CHART_TYPES = {
    "line": XL_CHART_TYPE.LINE_MARKERS,
    "bar": XL_CHART_TYPE.COLUMN_CLUSTERED,
    "pie": XL_CHART_TYPE.PIE,
}


def pick_layout(prs, names, fallback_idx):
    for layout in prs.slide_layouts:
        if layout.name in names:
            return layout
    return prs.slide_layouts[fallback_idx]


def fill_bullets(body, items):
    tf = body.text_frame
    tf.clear()
    for i, item in enumerate(items):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.text = str(item)
        para.level = 0


def build(payload: dict, template: str, out: Path) -> dict:
    prs = Presentation(template)
    title_layout = pick_layout(prs, ("Title Slide",), 0)
    bullets_layout = pick_layout(prs, ("Title and Content",), 1)
    two_col_layout = pick_layout(prs, ("Two Content",), 3)
    blank_layout = pick_layout(prs, ("Title Only",), 5)

    # DFS exemplar engine: designed library slides are copied + filled when the
    # curated manifest is present; layout-based building is the fallback.
    exemplars = None
    try:
        exemplars = ExemplarDeck(prs)
    except Exception:
        exemplars = None

    for slide_spec in payload["slides"]:
        layout_kind = slide_spec["layout"]

        if exemplars is not None and layout_kind in ("title", "section", "closing", "bullets", "two_col", "summary", "chart"):
            heading = slide_spec["heading"]
            if layout_kind == "title":
                items = [str(b) for b in (slide_spec.get("bullets") or [])][:1]
                category = "title"
            elif layout_kind in ("section", "closing"):
                items = []
                category = layout_kind
            elif layout_kind in ("bullets", "summary"):
                items = [str(b) for b in (slide_spec.get("bullets") or [])]
                category = "bullets"
            elif layout_kind == "two_col":
                items = [str(x) for x in (slide_spec.get("col_left") or [])] + [
                    str(x) for x in (slide_spec.get("col_right") or [])
                ]
                category = "two_col"
            else:
                category = "chart"
                items = [str(b) for b in (slide_spec.get("bullets") or [])]
            chart_kind = (slide_spec.get("chart") or {}).get("kind") if layout_kind == "chart" else None
            name = exemplars.pick(category, len(items), chart_kind=chart_kind) if exemplars.has(category) else None
            if name is not None:
                exemplars.build_slide(
                    name,
                    heading,
                    items,
                    chart_spec=slide_spec.get("chart"),
                    notes=slide_spec.get("notes"),
                )
                continue

        if layout_kind == "title":
            slide = prs.slides.add_slide(title_layout)
            slide.shapes.title.text = slide_spec["heading"]
            # long deck titles shrink so they never clip the title band
            heading_len = len(slide_spec["heading"])
            if heading_len > 38:
                title_size = Pt(28) if heading_len > 60 else Pt(36)
                for para in slide.shapes.title.text_frame.paragraphs:
                    for run in para.runs:
                        run.font.size = title_size
            subtitle = slide_spec.get("bullets") or []
            placeholders = [p for p in slide.placeholders if p.placeholder_format.idx != 0]
            if subtitle and placeholders:
                placeholders[0].text = str(subtitle[0])
        elif layout_kind in ("bullets", "summary"):
            slide = prs.slides.add_slide(bullets_layout)
            slide.shapes.title.text = slide_spec["heading"]
            bodies = [p for p in slide.placeholders if p.placeholder_format.idx != 0]
            if bodies:
                fill_bullets(bodies[0], slide_spec.get("bullets") or [])
        elif layout_kind == "two_col":
            slide = prs.slides.add_slide(two_col_layout)
            slide.shapes.title.text = slide_spec["heading"]
            bodies = [p for p in slide.placeholders if p.placeholder_format.idx != 0]
            cols = [slide_spec.get("col_left") or [], slide_spec.get("col_right") or []]
            for body, col in zip(bodies[:2], cols):
                fill_bullets(body, col)
        elif layout_kind == "chart":
            # chart goes INTO the content placeholder of Title-and-Content so it
            # lands where the branded layout intends (no title overlap)
            slide = prs.slides.add_slide(bullets_layout)
            if slide.shapes.title is not None:
                slide.shapes.title.text = slide_spec["heading"]
            chart_spec = slide_spec.get("chart")
            if chart_spec and chart_spec.get("series"):
                data = CategoryChartData()
                data.categories = [str(c) for c in chart_spec.get("labels") or []] or ["—"]
                for series in chart_spec["series"]:
                    values = list(series.get("values") or [])
                    # pad/trim to category count so python-pptx accepts it
                    n = len(data.categories)
                    values = (values + [0] * n)[:n]
                    data.add_series(series.get("name", "series"), values)
                chart_type = CHART_TYPES.get(chart_spec.get("kind", "bar"), XL_CHART_TYPE.COLUMN_CLUSTERED)
                body = next(
                    (p for p in slide.placeholders if p.placeholder_format.idx != 0
                     and p.placeholder_format.type in (PP_PLACEHOLDER.OBJECT, PP_PLACEHOLDER.BODY)),
                    None,
                )
                if body is not None:
                    # take the placeholder's box, then replace it with the chart
                    left, top, width, height = body.left, body.top, body.width, body.height
                    body._element.getparent().remove(body._element)
                    slide.shapes.add_chart(chart_type, left, top, width, height, data)
                else:
                    # safe region below a standard title band on 13.33x7.5 widescreen
                    slide.shapes.add_chart(chart_type, Inches(0.9), Inches(1.9), Inches(11.5), Inches(4.9), data)
        else:  # defensive: unknown layout renders as bullets
            slide = prs.slides.add_slide(bullets_layout)
            slide.shapes.title.text = slide_spec["heading"]
        notes = slide_spec.get("notes")
        if notes:
            slide.notes_slide.notes_text_frame.text = str(notes)

    # brand font: every run renders in Poppins (the DFS standard)
    for slide in prs.slides:
        _apply_font(slide.shapes)

    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))
    return {"slides": len(payload["slides"]), "bytes": out.stat().st_size}


def _apply_font(shapes):
    for shape in shapes:
        if shape.shape_type == 6 and hasattr(shape, "shapes"):
            _apply_font(shape.shapes)
            continue
        if getattr(shape, "has_text_frame", False):
            for para in shape.text_frame.paragraphs:
                for run in para.runs:
                    if not run.font.name or not run.font.name.startswith("Poppins"):
                        run.font.name = "Poppins"


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
    template = args.template or "skills/pptx/templates/atlas_default.potx"
    meta = build(payload, template, out)

    checks = [vc.openxml_audit(out), vc.zip_sanity(out)]
    reopened = Presentation(str(out))
    texts = extract_texts(out)
    checks.append(
        vc.check(
            "Round-trip",
            len(list(reopened.slides)) == meta["slides"] and any(t.strip() for t in texts),
        )
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
