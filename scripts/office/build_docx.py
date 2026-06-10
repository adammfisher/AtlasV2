#!/usr/bin/env python3
"""Compile sections-JSON (skills/docx/schema.json) onto a .dotx style base."""
from pathlib import Path

from docx import Document
from docx.enum.text import WD_BREAK
from docx.oxml.ns import qn
from docx.oxml.shared import OxmlElement
from docx.shared import RGBColor

import validate_common as vc


def build(payload: dict, template: str, out: Path) -> dict:
    doc = Document(template)
    # template base may carry a stub paragraph — drop empty leading content
    for para in list(doc.paragraphs):
        if not para.text.strip():
            para._element.getparent().remove(para._element)

    metadata = payload.get("metadata") or {}
    if metadata.get("title"):
        doc.core_properties.title = metadata["title"]
        doc.add_heading(metadata["title"], level=0)
    if metadata.get("author"):
        doc.core_properties.author = metadata["author"]

    words = 0
    for section in payload["sections"]:
        if section.get("pageBreakBefore") and doc.paragraphs:
            doc.paragraphs[-1].add_run().add_break(WD_BREAK.PAGE)
        level = min(max(int(section.get("level") or 1), 1), 3)
        doc.add_heading(section["heading"], level=level)
        for para_text in section.get("paragraphs") or []:
            doc.add_paragraph(str(para_text))
            words += len(str(para_text).split())
        table_spec = section.get("table")
        if table_spec and table_spec.get("headers"):
            headers = [str(h) for h in table_spec["headers"]]
            rows = table_spec.get("rows") or []
            table = doc.add_table(rows=1 + len(rows), cols=len(headers))
            table.style = "Table Grid" if "Table Grid" in [s.name for s in doc.styles] else table.style
            for i, header in enumerate(headers):
                cell = table.rows[0].cells[i]
                cell.text = header
                shade = OxmlElement("w:shd")
                shade.set(qn("w:fill"), "371447")
                cell._tc.get_or_add_tcPr().append(shade)
                for para in cell.paragraphs:
                    for run in para.runs:
                        run.font.bold = True
                        run.font.color.rgb = RGBColor.from_string("FFFFFF")
            for r, row in enumerate(rows):
                for c in range(len(headers)):
                    table.rows[r + 1].cells[c].text = str(row[c]) if c < len(row) else ""

    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out))
    return {"sections": len(payload["sections"]), "words": words, "bytes": out.stat().st_size}


def extract_texts(path: Path) -> list:
    doc = Document(str(path))
    texts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            texts.extend(cell.text for cell in row.cells)
    return texts


def main() -> None:
    args = vc.cli("docx builder")
    payload = vc.load_payload(args.payload)
    out = Path(args.out)
    template = args.template or "skills/docx/templates/atlas_default.dotx"
    meta = build(payload, template, out)

    checks = [vc.openxml_audit(out), vc.zip_sanity(out)]
    reopened = Document(str(out))
    texts = extract_texts(out)
    heading_count = sum(1 for p in reopened.paragraphs if p.style.name.startswith("Heading"))
    checks.append(vc.check("Round-trip", heading_count >= meta["sections"] and any(texts)))
    checks.append(vc.placeholder_grep(texts))  # also catches unrendered Jinja tags
    checks.append(vc.soffice_convert(out, "soffice open/convert", vc.THUMBS_SKIP))
    vc.emit(out, meta, checks)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:
        vc.fail(f"{type(err).__name__}: {err}")
