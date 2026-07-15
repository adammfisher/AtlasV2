---
name: Spreadsheets
ext: .xlsx
triggers: spreadsheet · model · budget · forecast
tier: office_json
helper: build_xlsx.py
---

# Spreadsheet design doctrine

You emit sheet JSON only; openpyxl compiles it. The gate is ZERO formula
errors: the built workbook is recalculated and any #REF!, #DIV/0!, #VALUE!,
#N/A or #NAME? fails the build. Formulas must be real formulas — a cell whose
value should be computed NEVER ships as a hardcoded number.

## Model structure
- A model gets three layers: `Inputs` (labeled assumptions), `Calc` (formulas
  referencing Inputs!), `Summary` (headline figures referencing Calc!). Simple
  trackers can be one sheet.
- Every sheet declares a named `table_style`; data lives in a real table with
  a header row. The header row is FROZEN (freeze panes) so it survives scroll.
- Column widths are sized to content (the builder approximates max content
  length); the print area is set on every sheet.

## Cells and formulas
- Exactly one of text / number / formula per cell. Numbers are numbers, never
  numeric strings.
- Every numeric column carries an explicit number format (currency, percent,
  integer, decimal — declared in the spec, applied as a named style).
- Formulas start with `=`, may reference other sheets (`=SUM(Inputs!B2:B9)`),
  and use only functions Excel and LibreOffice share: SUM, AVERAGE, MIN, MAX,
  COUNT, IF, ROUND, ABS. Never reference a cell you did not populate or a
  range beyond your data.
- Derived values are formulas referencing their inputs — if B10 is the sum of
  B2:B9, it is `=SUM(B2:B9)`, not the precomputed total.

## Color code (financial-model convention, applied via named styles)
- Blue = input cells (user-editable assumptions)
- Black = formulas (calculated, don't touch)
- Green = links to other sheets in this workbook
- Red = external links / warnings

Never invent data the user didn't give or clearly imply. No placeholder text.
Every formula is checked by a tokenizer AND a real recalc.
