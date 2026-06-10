#!/usr/bin/env python3
"""Compile sheets-JSON (skills/xlsx/schema.json) via openpyxl."""
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.formula.tokenizer import Tokenizer
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import column_index_from_string, coordinate_to_tuple

import validate_common as vc

ACCENT = "D97757"


def build(payload: dict, template: str | None, out: Path) -> dict:
    wb = Workbook()
    wb.remove(wb.active)
    cells = 0
    formulas = 0
    for sheet_spec in payload["sheets"]:
        ws = wb.create_sheet(title=str(sheet_spec["name"])[:31])
        for cell_spec in sheet_spec.get("cells") or []:
            ref = cell_spec["ref"]
            target = ws[ref]
            if cell_spec.get("formula"):
                formula = str(cell_spec["formula"])
                target.value = formula if formula.startswith("=") else f"={formula}"
                formulas += 1
            elif cell_spec.get("valueNumber") is not None:
                target.value = cell_spec["valueNumber"]
            else:
                target.value = cell_spec.get("valueText", "")
            fmt = cell_spec.get("format")
            if fmt == "header":
                target.font = Font(bold=True, color="FFFFFF", name="Helvetica Neue")
                target.fill = PatternFill("solid", fgColor=ACCENT)
            elif fmt == "bold":
                target.font = Font(bold=True)
            cells += 1
        for i, width in enumerate(sheet_spec.get("widths") or []):
            ws.column_dimensions[ws.cell(row=1, column=i + 1).column_letter].width = width

    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(out))
    return {"sheets": len(payload["sheets"]), "cells": cells, "formulas": formulas, "bytes": out.stat().st_size}


def main() -> None:
    args = vc.cli("xlsx builder")
    payload = vc.load_payload(args.payload)
    out = Path(args.out)
    meta = build(payload, args.template, out)

    checks = [vc.openxml_audit(out), vc.zip_sanity(out)]

    reopened = load_workbook(str(out))
    checks.append(vc.check("Round-trip", len(reopened.sheetnames) == meta["sheets"]))

    # §4.5(d) formula syntax via openpyxl tokenizer
    syntax_ok = True
    texts = []
    for ws in reopened.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str):
                    texts.append(cell.value)
                    if cell.value.startswith("="):
                        try:
                            Tokenizer(cell.value)
                        except Exception:
                            syntax_ok = False
    checks.append(vc.check("Formula syntax", syntax_ok))
    checks.append(vc.placeholder_grep(texts))
    checks.append(vc.soffice_recalc_scan(out))
    vc.emit(out, meta, checks)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:
        vc.fail(f"{type(err).__name__}: {err}")
