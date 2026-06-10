#!/usr/bin/env python3
"""Compile slides-JSON (skills/pptx/schema.json) onto a .potx template."""
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches, Pt

import validate_common as vc

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

    for slide_spec in payload["slides"]:
        layout_kind = slide_spec["layout"]
        if layout_kind == "title":
            slide = prs.slides.add_slide(title_layout)
            slide.shapes.title.text = slide_spec["heading"]
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
            slide = prs.slides.add_slide(blank_layout)
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
                slide.shapes.add_chart(
                    CHART_TYPES.get(chart_spec.get("kind", "bar"), XL_CHART_TYPE.COLUMN_CLUSTERED),
                    Inches(0.8), Inches(1.6), Inches(8.4), Inches(4.8), data,
                )
        else:  # defensive: unknown layout renders as bullets
            slide = prs.slides.add_slide(bullets_layout)
            slide.shapes.title.text = slide_spec["heading"]
        notes = slide_spec.get("notes")
        if notes:
            slide.notes_slide.notes_text_frame.text = str(notes)

    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))
    return {"slides": len(payload["slides"]), "bytes": out.stat().st_size}


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
