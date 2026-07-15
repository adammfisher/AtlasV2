#!/usr/bin/env python3
"""Regenerate pptx_textmetrics.py from local Poppins OTFs (dev machine only).

The office Lambda ships no font files, so text measurement uses an embedded
advance-width table extracted here once per font change. Run:
    runtimes/python/venv/bin/python scripts/office/gen_metrics.py
"""
from pathlib import Path

from PIL import ImageFont

SIZE = 1000
FONTS = {
    "regular": Path.home() / "Library/Fonts/Poppins-Regular.otf",
    "bold": Path.home() / "Library/Fonts/Poppins-Bold.otf",
}
CHARS = [chr(c) for c in range(32, 127)] + list("’‘“”–—…€£•·×°±≥≤")


def main() -> None:
    out = {}
    for weight, path in FONTS.items():
        font = ImageFont.truetype(str(path), SIZE)
        ascent, descent = font.getmetrics()
        out[weight] = {
            "ascent": round(ascent / SIZE, 4),
            "descent": round(descent / SIZE, 4),
            "advance": {ch: round(font.getlength(ch) / SIZE, 4) for ch in CHARS},
        }

    lines = [
        '"""Poppins advance-width metrics (em units), generated from the local OTFs by',
        "Deliverable C. Deterministic text measurement without font files at runtime",
        "(the office Lambda ships no fonts). Regenerate with scripts/office/gen_metrics.py",
        'if the deck font ever changes."""',
        "",
    ]
    for weight in ("regular", "bold"):
        m = out[weight]
        lines.append(f"{weight.upper()} = {{")
        lines.append(f'    "ascent": {m["ascent"]}, "descent": {m["descent"]},')
        lines.append('    "advance": {')
        row = []
        for ch, w in m["advance"].items():
            row.append(f"{ch!r}: {w}")
            if len(row) == 6:
                lines.append("        " + ", ".join(row) + ",")
                row = []
        if row:
            lines.append("        " + ", ".join(row) + ",")
        lines.append("    },")
        lines.append("}")
        lines.append("")
    lines.append("DEFAULT_ADVANCE = 0.6  # fallback for unmapped glyphs")
    target = Path(__file__).resolve().parent / "pptx_textmetrics.py"
    target.write_text("\n".join(lines) + "\n")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
