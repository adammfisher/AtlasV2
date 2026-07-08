#!/usr/bin/env python3
"""Compile pages-JSON (skills/pdf/schema.json) to PDF via weasyprint."""
import html
import os
from pathlib import Path

import validate_common as vc

CSS = """
@page { size: A4; margin: 22mm 18mm; }
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1b1a18; font-size: 10.5pt; }
h1 { color: #371447; font-size: 20pt; margin: 0 0 4px; border-bottom: 2.5px solid #650360; padding-bottom: 8px; }
h2 { color: #650360; font-size: 13pt; margin: 18px 0 6px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; }
th { background: #371447; color: #fff; text-align: left; padding: 6px 9px; font-size: 9.5pt; }
td { border-bottom: 1px solid #ddd; padding: 5px 8px; font-size: 9.5pt; }
.page-break { page-break-before: always; }
"""


def block_html(block: dict, first_heading: bool) -> str:
    kind = block.get("kind", "para")
    if kind == "heading":
        tag = "h1" if first_heading else "h2"
        return f"<{tag}>{html.escape(block.get('text', ''))}</{tag}>"
    if kind == "table":
        headers = block.get("headers") or []
        rows = block.get("rows") or []
        head = "".join(f"<th>{html.escape(str(h))}</th>" for h in headers)
        body = "".join(
            "<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in row) + "</tr>" for row in rows
        )
        return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"
    return f"<p>{html.escape(block.get('text', ''))}</p>"


def build(payload: dict, out: Path) -> dict:
    parts = []
    first_heading = True
    for i, page in enumerate(payload["pages"]):
        if i > 0:
            parts.append('<div class="page-break"></div>')
        for block in page.get("blocks") or []:
            parts.append(block_html(block, first_heading))
            if block.get("kind") == "heading":
                first_heading = False

    out.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(parts)
    force_pure = os.environ.get("ATLAS_PDF_ENGINE") == "xhtml2pdf"
    try:
        if force_pure:
            raise ImportError("forced pure-python engine")
        # weasyprint: highest fidelity (local dev). Needs pango/cairo native libs.
        from weasyprint import HTML, CSS as WPCSS

        HTML(string=f"<html><body>{body}</body></html>").write_pdf(
            str(out), stylesheets=[WPCSS(string=CSS)]
        )
    except Exception:
        # cloud (zip Lambda, no native libs): xhtml2pdf is pure-python. Same
        # HTML; @page/page-break/tables are supported. Engine noted for parity.
        from xhtml2pdf import pisa

        doc = f"<html><head><style>{CSS}</style></head><body>{body}</body></html>"
        with open(out, "wb") as fh:
            result = pisa.CreatePDF(doc, dest=fh)
        if result.err:
            raise RuntimeError(f"xhtml2pdf failed with {result.err} errors")
    return {"pages": len(payload["pages"]), "bytes": out.stat().st_size}


def main() -> None:
    args = vc.cli("pdf builder")
    payload = vc.load_payload(args.payload)
    out = Path(args.out)
    meta = build(payload, out)

    import pdfplumber

    headings = [
        b.get("text", "")
        for page in payload["pages"]
        for b in (page.get("blocks") or [])
        if b.get("kind") == "heading" and b.get("text")
    ]
    with pdfplumber.open(str(out)) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)
        page_count = len(pdf.pages)
    checks = [
        vc.check("Text grep", all(h.split()[0] in text for h in headings if h.split())),
        vc.check("Page count", page_count >= meta["pages"]),
    ]
    meta["pages"] = page_count
    vc.emit(out, meta, checks)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:
        vc.fail(f"{type(err).__name__}: {err}")
