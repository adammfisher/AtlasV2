#!/usr/bin/env python3
"""Compile sections-JSON (skills/pdf/schema.json) to PDF via WeasyPrint paged
media (skills/pdf/templates/paged.css): running header (document title) +
"page N of M" footer, orphans/widows 3, no tables/figures broken across pages,
single-column, <= 2 font families. Figures render real chart PNGs (Pillow).

Engine fallback: the zip Lambda has no pango/cairo; xhtml2pdf renders the same
HTML but cannot evaluate counter(pages) — its footer degrades to "Page N" and
the run reports engine=xhtml2pdf so parity is visible, never silent.
"""
import base64
import html
import os
import tempfile
from pathlib import Path

import office_chart
import validate_common as vc


def _css() -> str:
    repo = Path(__file__).resolve().parents[2] / "skills/pdf/templates/paged.css"
    bundled = Path(__file__).resolve().parent / "templates/paged.css"
    for candidate in (repo, bundled):
        if candidate.exists():
            return candidate.read_text()
    raise FileNotFoundError("paged.css not found (repo or bundle)")


def _page_rule(meta: dict) -> str:
    size = {"A4": "A4", "Letter": "letter"}[meta["page_size"]]
    m = meta["margins_in"]
    return (f'@page {{ size: {size}; margin: {m["top"]}in {m["right"]}in '
            f'{m["bottom"]}in {m["left"]}in; }}\n')


def _section_html(block: dict, fig_index: int, tmp: Path) -> str:
    kind = block["kind"]
    if kind == "heading":
        tag = f"h{min(3, max(1, int(block['level'])))}"
        return f"<{tag}>{html.escape(block['text'])}</{tag}>"
    if kind == "paragraph":
        return f"<p>{html.escape(block['text'])}</p>"
    if kind in ("bulleted_list", "numbered_list"):
        tag = "ul" if kind == "bulleted_list" else "ol"
        items = "".join(f"<li>{html.escape(str(i))}</li>" for i in block["items"])
        return f"<{tag}>{items}</{tag}>"
    if kind == "table":
        head = "".join(f"<th>{html.escape(str(h))}</th>" for h in block["headers"])
        body = "".join(
            "<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in row) + "</tr>"
            for row in block["rows"])
        return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"
    if kind == "figure":
        png = office_chart.render_chart_png(block["chart"], tmp / f"fig{fig_index}.png")
        data = base64.b64encode(png.read_bytes()).decode()
        return (f'<figure><img src="data:image/png;base64,{data}" alt=""/>'
                f"<figcaption>Figure {fig_index}: {html.escape(block['caption'])}</figcaption></figure>")
    if kind == "quote":
        attribution = f"<br/>— {html.escape(block['attribution'])}" if block.get("attribution") else ""
        return f"<blockquote>{html.escape(block['text'])}{attribution}</blockquote>"
    if kind == "page_break":
        return '<div class="page-break"></div>'
    return ""


def build(payload: dict, out: Path) -> dict:
    meta = payload["meta"]
    css = _page_rule(meta) + _css()
    tmp = Path(tempfile.mkdtemp(prefix="pdffig-"))
    parts = []
    figures = 0
    for block in payload["sections"]:
        if block["kind"] == "figure":
            figures += 1
        parts.append(_section_html(block, figures, tmp))
    body = "".join(parts)

    out.parent.mkdir(parents=True, exist_ok=True)
    engine = "weasyprint"
    force_pure = os.environ.get("ATLAS_PDF_ENGINE") == "xhtml2pdf"
    try:
        if force_pure:
            raise ImportError("forced pure-python engine")
        from weasyprint import CSS as WPCSS
        from weasyprint import HTML

        HTML(string=f"<html><body>{body}</body></html>").write_pdf(
            str(out), stylesheets=[WPCSS(string=css)])
    except Exception:
        # zip Lambda: no pango/cairo. Same HTML through xhtml2pdf; the paged
        # counters degrade (no counter(pages)) — reported, not hidden.
        from xhtml2pdf import pisa

        engine = "xhtml2pdf"
        doc = f"<html><head><style>{css}</style></head><body>{body}</body></html>"
        with open(out, "wb") as fh:
            result = pisa.CreatePDF(doc, dest=fh)
        if result.err:
            raise RuntimeError(f"xhtml2pdf failed with {result.err} errors")
    return {"sections": len(payload["sections"]), "figures": figures,
            "engine": engine, "bytes": out.stat().st_size}


def main() -> None:
    args = vc.cli("pdf builder")
    payload = vc.load_payload(args.payload)
    vc.spec_gate("pdf", payload)
    out = Path(args.out)
    meta = build(payload, out)

    import pdfplumber

    headings = [b["text"] for b in payload["sections"] if b["kind"] == "heading"]
    with pdfplumber.open(str(out)) as pdf:
        page_texts = [p.extract_text() or "" for p in pdf.pages]
        text = "\n".join(page_texts)
        page_count = len(pdf.pages)
    checks = [
        vc.check("Text grep", all(h.split()[0] in text for h in headings if h.split())),
        vc.check("Page count", page_count >= 1),
        vc.pdf_table_break_check(payload, out),
    ]
    if meta["engine"] == "weasyprint":
        # running footer must carry the page counter on every page
        footer_ok = all(f"of {page_count}" in t for t in page_texts)
        checks.append(vc.check("Running footer (page N of M)", footer_ok))
        # running header carries the doc title on pages 2+ (first page exempt)
        title_word = payload["sections"][0]["text"].split()[0] if headings else ""
        header_ok = all(title_word in t for t in page_texts[1:]) if title_word else True
        checks.append(vc.check("Running header (doc title)", header_ok))
    else:
        checks.append(vc.check("Paged counters skipped — xhtml2pdf engine", False))
    meta["pages"] = page_count
    vc.emit(out, meta, checks)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:
        vc.fail(f"{type(err).__name__}: {err}")
