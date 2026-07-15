"""PPTX design system: palette (theme-slot roles), 12-column grid math, and
deterministic text measurement.

THE PALETTE MODULE RULE: this file is the only place an RGB value may exist in
the pptx build path. Everything downstream styles through semantic roles that
resolve to MSO theme-color slots (+brightness); the hex values here are READ
FROM THE TEMPLATE for contrast math and never written into the deck.
build_pptx.py asserts this at runtime by scanning its own source.
"""
import re
import zipfile
from pathlib import Path

from pptx.enum.dml import MSO_THEME_COLOR

import pptx_textmetrics as tm

EMU_IN = 914400
SLIDE_W = 13.333
SLIDE_H = 7.5
MARGIN = 0.5
GRID_COLS = 12
GUTTER = 0.15
BLOCK_GAP = 0.4  # the one consistent gap between content blocks (0.3–0.5")
_USABLE = SLIDE_W - 2 * MARGIN
_COL_W = (_USABLE - (GRID_COLS - 1) * GUTTER) / GRID_COLS

# ── semantic roles → theme slots ───────────────────────────────────────────
# dfs_default.potx: dk1 #371447 · lt1 #FFFFFF · dk2 #650360 · accent1 #300942
# accent2 #26A697 (teal — large text/graphics only, 3.01:1 on white)
ROLES = {
    "text": MSO_THEME_COLOR.TEXT_1,          # dk1 on light fields
    "text_inverse": MSO_THEME_COLOR.BACKGROUND_1,  # lt1 on dark fields
    "background": MSO_THEME_COLOR.BACKGROUND_1,
    "dominant_dark": MSO_THEME_COLOR.ACCENT_1,     # full-bleed dark fields
    "supporting": MSO_THEME_COLOR.TEXT_2,          # dk2 structure
    "accent": MSO_THEME_COLOR.ACCENT_2,            # the one highlight (graphics)
}
CHART_SERIES_SLOTS = [
    MSO_THEME_COLOR.ACCENT_2,
    MSO_THEME_COLOR.TEXT_2,
    MSO_THEME_COLOR.ACCENT_3,
    MSO_THEME_COLOR.ACCENT_4,
    MSO_THEME_COLOR.ACCENT_6,
]
# brightness offsets for derived fills (panels, hairlines) — still theme slots
PANEL_BRIGHTNESS = 0.90       # supporting slot lightened → soft panel
BAND_BRIGHTNESS = 0.94        # table banding
DISPLAY = "Poppins"
BODY = "Poppins"

_THEME_TAGS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]


def read_theme_hex(template_path: str | Path) -> dict:
    """Extract the template's theme palette (hex per slot) for contrast math.
    Values are read, never invented — the deck itself only carries slot refs."""
    with zipfile.ZipFile(template_path) as z:
        theme = z.read("ppt/theme/theme1.xml").decode()
    out = {}
    for tag in _THEME_TAGS:
        m = re.search(rf'<a:{tag}>.*?(?:val="([0-9A-Fa-f]{{6}})"|lastClr="([0-9A-Fa-f]{{6}})")', theme, re.S)
        if m:
            out[tag] = (m.group(1) or m.group(2)).upper()
    return out


# ── WCAG contrast (relative luminance, unrounded) ──────────────────────────
def _linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.03928 else ((channel + 0.055) / 1.055) ** 2.4


def luminance(hex6: str) -> float:
    r, g, b = (int(hex6[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * _linear(r) + 0.7152 * _linear(g) + 0.0722 * _linear(b)


def contrast(hex_a: str, hex_b: str) -> float:
    la, lb = sorted((luminance(hex_a), luminance(hex_b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def brightness_hex(hex6: str, brightness: float) -> str:
    """Approximate PowerPoint's lumMod/lumOff brightness for contrast math."""
    r, g, b = (int(hex6[i:i + 2], 16) for i in (0, 2, 4))
    if brightness >= 0:
        r, g, b = (round(c + (255 - c) * brightness) for c in (r, g, b))
    else:
        r, g, b = (round(c * (1 + brightness)) for c in (r, g, b))
    return f"{r:02X}{g:02X}{b:02X}"


# ── 12-column grid (EMU-exact) ─────────────────────────────────────────────
def grid_x(col: int) -> float:
    """Left edge (inches) of grid column `col` (0-based)."""
    return MARGIN + col * (_COL_W + GUTTER)


def grid_w(cols: int) -> float:
    """Width (inches) spanning `cols` columns including internal gutters."""
    return cols * _COL_W + (cols - 1) * GUTTER


def emu(inches: float) -> int:
    return int(round(inches * EMU_IN))


def snap(inches: float) -> float:
    """Snap a horizontal position to the nearest grid column edge."""
    col = round((inches - MARGIN) / (_COL_W + GUTTER))
    return grid_x(max(0, min(GRID_COLS - 1, col)))


# ── deterministic text measurement (embedded Poppins metrics) ──────────────
def _metrics(bold: bool):
    return tm.BOLD if bold else tm.REGULAR


def text_width_in(text: str, size_pt: float, bold: bool = False) -> float:
    adv = _metrics(bold)["advance"]
    em = sum(adv.get(ch, tm.DEFAULT_ADVANCE) for ch in str(text))
    return em * size_pt / 72.0


def wrap_lines(text: str, width_in: float, size_pt: float, bold: bool = False) -> list:
    """Greedy word wrap by measured advance width — one entry per rendered line.
    Measures PER LINE (explicit newlines respected)."""
    lines = []
    for raw_line in str(text).split("\n"):
        words = raw_line.split()
        if not words:
            lines.append("")
            continue
        cur = words[0]
        for word in words[1:]:
            if text_width_in(cur + " " + word, size_pt, bold) <= width_in:
                cur += " " + word
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return lines


def line_height_in(size_pt: float, bold: bool = False, spacing: float = 1.15) -> float:
    m = _metrics(bold)
    return (m["ascent"] + m["descent"]) * size_pt / 72.0 * spacing


def required_height_in(text: str, width_in: float, size_pt: float, bold: bool = False,
                       spacing: float = 1.15) -> float:
    return len(wrap_lines(text, width_in, size_pt, bold)) * line_height_in(size_pt, bold, spacing)


def fit_text(text: str, width_in: float, height_in: float, max_pt: float, min_pt: float,
             bold: bool = False, spacing: float = 1.15, floor_pt: float = 14.0) -> dict:
    """Step the size down from max_pt until the wrapped text fits the frame.
    Below min_pt the doctrine range is broken; below floor_pt is OVERFLOW —
    never silently accepted (the caller records the flag; the validator fails)."""
    size = max_pt
    while size >= floor_pt:
        if required_height_in(text, width_in, size, bold, spacing) <= height_in:
            return {
                "size": size,
                "lines": len(wrap_lines(text, width_in, size, bold)),
                "overflow": False,
                "below_range": size < min_pt,
            }
        size -= 1
    return {"size": floor_pt, "lines": len(wrap_lines(text, width_in, floor_pt, bold)),
            "overflow": True, "below_range": True}
