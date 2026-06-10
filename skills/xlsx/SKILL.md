---
name: Spreadsheets
ext: .xlsx
triggers: spreadsheet · model · budget · forecast
tier: office_json
helper: build_xlsx.py
---

# Spreadsheet design guidance

You emit cell/formula JSON only; openpyxl compiles it. Recalc happens on open
(and via soffice during validation) — formulas must be syntactically valid Excel.

- Model in three layers when the request is a model: an `Inputs` sheet (labeled
  assumptions), a `Calc` sheet (formulas referencing Inputs!), a `Summary` sheet
  (headline figures referencing Calc!). Simple trackers can be one sheet.
- `ref` is an A1 cell reference on that sheet. Lay data in columns with a header
  row: every header cell gets `"format":"header"`.
- Exactly one of `valueText` / `valueNumber` / `formula` per cell. Numbers must be
  `valueNumber` (never numeric strings) so formulas can consume them.
- Formulas start with `=` and may reference other sheets by name (`=SUM(Inputs!B2:B9)`).
  Only use functions Excel and LibreOffice share: SUM, AVERAGE, MIN, MAX, COUNT, IF,
  ROUND, ABS. Never reference a cell you did not populate or a range beyond your data.
- Totals/derived rows get `"format":"bold"`.
- `widths` sets the first N column widths; ~14 for label columns, ~11 for numbers.
- Never invent data the user didn't give or clearly imply; structure the model and
  leave assumption cells with the user's numbers only.

No placeholder text. Every formula is checked by a tokenizer and a real recalc.
