"""Deterministic Pillow chart renderer for docx/pdf `figure` blocks.

Real data → real PNG: no placeholder art ever ships. DFS brand palette,
minimal gridlines, data labels on, legend only when > 1 series — the same
chart doctrine the pptx native charts follow.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

INK = "#371447"        # dk1 — axis text/labels
GRID = "#E7E2EC"       # hairline gridlines
SERIES = ["#26A697", "#650360", "#8D4CAB", "#BB72DD"]
BG = "#FFFFFF"

W, H = 1400, 780
PAD_L, PAD_R, PAD_T, PAD_B = 90, 40, 40, 120


def _font(size):
    try:
        return ImageFont.load_default(size)
    except TypeError:  # very old Pillow: bitmap default only
        return ImageFont.load_default()


def _nice_max(value):
    if value <= 0:
        return 1.0
    magnitude = 10 ** len(str(int(value))) / 10
    for mult in (1, 2, 2.5, 5, 10):
        if value <= magnitude * mult:
            return magnitude * mult
    return value


def render_chart_png(chart: dict, out_path: Path) -> Path:
    cats = [str(c) for c in chart["categories"]]
    series = chart["series"][:4]
    top = _nice_max(max(max(s["values"]) for s in series))
    bottom = min(0, min(min(s["values"]) for s in series))
    span = (top - bottom) or 1.0

    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    f_label = _font(24)
    f_tick = _font(22)
    plot_w = W - PAD_L - PAD_R
    plot_h = H - PAD_T - PAD_B

    def ypix(v):
        return PAD_T + plot_h * (1 - (v - bottom) / span)

    # minimal horizontal gridlines: 4 divisions
    for i in range(5):
        gy = PAD_T + plot_h * i / 4
        draw.line([(PAD_L, gy), (W - PAD_R, gy)], fill=GRID, width=2)
        tick = bottom + span * (1 - i / 4)
        label = f"{tick:g}"
        tw = draw.textlength(label, font=f_tick)
        draw.text((PAD_L - tw - 12, gy - 12), label, fill=INK, font=f_tick)

    n = len(cats)
    slot_w = plot_w / n
    if chart["kind"] == "bar":
        group_pad = slot_w * 0.18
        bar_w = (slot_w - 2 * group_pad) / len(series)
        for si, s in enumerate(series):
            for ci, val in enumerate(s["values"][:n]):
                x0 = PAD_L + ci * slot_w + group_pad + si * bar_w
                draw.rectangle([x0, ypix(val), x0 + bar_w * 0.9, ypix(0)], fill=SERIES[si % len(SERIES)])
                label = f"{val:g}"
                tw = draw.textlength(label, font=f_tick)
                draw.text((x0 + bar_w * 0.45 - tw / 2, ypix(val) - 30), label, fill=INK, font=f_tick)
    else:  # line
        for si, s in enumerate(series):
            pts = [(PAD_L + (ci + 0.5) * slot_w, ypix(v)) for ci, v in enumerate(s["values"][:n])]
            draw.line(pts, fill=SERIES[si % len(SERIES)], width=6, joint="curve")
            for (px, py), val in zip(pts, s["values"][:n]):
                r = 9
                draw.ellipse([px - r, py - r, px + r, py + r], fill=SERIES[si % len(SERIES)])
                label = f"{val:g}"
                tw = draw.textlength(label, font=f_tick)
                draw.text((px - tw / 2, py - 42), label, fill=INK, font=f_tick)

    # category labels
    for ci, cat in enumerate(cats):
        tw = draw.textlength(cat, font=f_tick)
        draw.text((PAD_L + (ci + 0.5) * slot_w - tw / 2, PAD_T + plot_h + 16), cat, fill=INK, font=f_tick)

    # legend only when > 1 series
    if len(series) > 1:
        lx = PAD_L
        ly = H - 56
        for si, s in enumerate(series):
            draw.rectangle([lx, ly + 4, lx + 28, ly + 28], fill=SERIES[si % len(SERIES)])
            name = str(s["name"])
            draw.text((lx + 38, ly), name, fill=INK, font=f_label)
            lx += 38 + draw.textlength(name, font=f_label) + 46

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(out_path))
    return out_path
