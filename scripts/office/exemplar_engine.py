"""DFS exemplar engine: copy curated, designed template slides from the slide
library into a generated deck and fill them through EXPLICIT per-exemplar maps
(shape ids) — no reading-order heuristics. Unused slots are deleted with their
icon shapes; hidden duplicate frames present in the library are always removed.
"""
import json
import re
from copy import deepcopy
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.util import Pt

HERE = Path(__file__).resolve().parents[2] / "skills/pptx/templates"


class ExemplarDeck:
    def __init__(self, out_prs):
        self.out = out_prs
        self.lib = Presentation(str(HERE / "dfs_library.pptx"))
        manifest = json.loads((HERE / "dfs_exemplars.json").read_text())
        self.exemplars = manifest["exemplars"]
        self.categories = manifest["categories"]
        self.rotation = {}
        self.used = set()

    def has(self, category):
        return bool(self.categories.get(category))

    def styles(self):
        return list(self.exemplars.keys())

    def pick(self, category, item_count, chart_kind=None):
        """Smallest exemplar whose slot capacity fits; charts match the requested
        kind and are single-use per deck (their chart part is a shared object)."""
        names = self.categories.get(category, [])
        if not names:
            return None
        if category == "chart":
            preferred = [n for n in names if self.exemplars[n].get("kind") == (chart_kind or "bar")]
            ordered = preferred + [n for n in names if n not in preferred]
            for name in ordered:
                if name not in self.used:
                    self.used.add(name)
                    return name
            return None
        fitting = sorted(
            (n for n in names),
            key=lambda n: (len(self.exemplars[n]["slots"]) < item_count, len(self.exemplars[n]["slots"])),
        )
        return fitting[0] if fitting else None

    # ---------- copy ----------

    def _blank_layout(self):
        for layout in self.out.slide_layouts:
            if layout.name == "Blank":
                return layout
        return self.out.slide_layouts[-1]

    def _copy(self, slide_idx):
        src = self.lib.slides[slide_idx]
        new = self.out.slides.add_slide(self._blank_layout())
        for shp in list(new.shapes):
            shp._element.getparent().remove(shp._element)
        rid_map = {}
        for rId, rel in src.part.rels.items():
            if rel.is_external:
                continue
            if rel.reltype.endswith(("/image", "/chart", "/media", "/package")):
                rid_map[rId] = new.part.relate_to(rel.target_part, rel.reltype)
        for shp in src.shapes:
            new.shapes._spTree.append(deepcopy(shp._element))
        for el in new.shapes._spTree.iter():
            for attr, val in list(el.attrib.items()):
                if val in rid_map and (attr.endswith("}embed") or attr.endswith("}id") or attr.endswith("}link")):
                    el.attrib[attr] = rid_map[val]
        return new

    # ---------- fill ----------

    @staticmethod
    def _by_id(slide, shape_id):
        for sh in slide.shapes:
            if sh.shape_id == shape_id:
                return sh
        return None

    @staticmethod
    def _delete(slide, shape_id):
        for sh in list(slide.shapes):
            if sh.shape_id == shape_id:
                sh._element.getparent().remove(sh._element)
                return

    @staticmethod
    def _set_text(shape, text, para_index=0, clear_rest=True):
        if shape is None or not getattr(shape, "has_text_frame", False):
            return
        paras = shape.text_frame.paragraphs
        if not paras:
            shape.text_frame.text = text
            return
        target = paras[min(para_index, len(paras) - 1)]
        runs = target.runs
        if runs:
            runs[0].text = text
            for run in runs[1:]:
                run.text = ""
        else:
            target.text = text
        if clear_rest:
            for i, para in enumerate(paras):
                if i == para_index:
                    continue
                for run in para.runs:
                    run.text = ""

    @staticmethod
    def _fill_lines(shape, lines):
        """Fill a multi-paragraph frame with up to len(paras) lines, clearing extras."""
        if shape is None or not getattr(shape, "has_text_frame", False):
            return
        paras = shape.text_frame.paragraphs
        for i, para in enumerate(paras):
            text = str(lines[i]) if i < len(lines) else ""
            runs = para.runs
            if runs:
                runs[0].text = text
                for run in runs[1:]:
                    run.text = ""
            else:
                para.text = text

    def build_slide(self, name, heading, items, chart_spec=None, notes=None):
        spec = self.exemplars[name]
        slide = self._copy(spec["slide"])

        for shape_id in spec.get("always_delete", []):
            self._delete(slide, shape_id)

        heading_shape = self._by_id(slide, spec["heading"])
        self._set_text(heading_shape, heading)
        style = spec.get("heading_style")
        if style and heading_shape is not None and getattr(heading_shape, "has_text_frame", False):
            size = style.get("size")
            if size and len(heading) > 32:  # long headings shrink so they never overlap content
                size = max(12, int(size * 0.7))
            for run in heading_shape.text_frame.paragraphs[0].runs:
                if size:
                    run.font.size = Pt(size)
                if style.get("bold"):
                    run.font.bold = True
                if style.get("color"):
                    run.font.color.rgb = RGBColor.from_string(style["color"])
        if "subtitle" in spec:
            subtitle = str(items[0]) if items else ""
            items = items[1:] if items else items
            self._set_text(self._by_id(slide, spec["subtitle"]), subtitle)

        queue = list(items)
        if "left" in spec:  # two-col: the left frame takes the first half
            left_lines = queue[: max(1, len(queue) // 2)]
            queue = queue[len(left_lines):]
            self._fill_lines(self._by_id(slide, spec["left"]), left_lines)

        for slot in spec["slots"]:
            if queue:
                self._set_text(self._by_id(slide, slot["text"]), str(queue.pop(0)))
            else:
                self._delete(slide, slot["text"])
                for icon_id in slot.get("icons", []):
                    self._delete(slide, icon_id)

        if "sidebar" in spec:
            sidebar = self._by_id(slide, spec["sidebar"])
            if queue:
                self._fill_lines(sidebar, queue)
                queue = []
            else:
                self._delete(slide, spec["sidebar"])
                if "sidebar_frame" in spec:
                    self._delete(slide, spec["sidebar_frame"])

        if spec.get("chart") and chart_spec and chart_spec.get("series"):
            for shape in slide.shapes:
                if getattr(shape, "has_chart", False):
                    data = CategoryChartData()
                    labels = [str(c) for c in chart_spec.get("labels") or []] or ["—"]
                    data.categories = labels
                    for series in chart_spec.get("series") or []:
                        values = list(series.get("values") or [])
                        values = (values + [0] * len(labels))[: len(labels)]
                        data.add_series(series.get("name", "series"), values)
                    shape.chart.replace_data(data)
                    shape.chart.has_title = False  # the slide banner carries the heading
                    break

        self._sweep_placeholders(slide)
        if notes:
            slide.notes_slide.notes_text_frame.text = str(notes)
        return slide

    _PLACEHOLDER_LINE = re.compile(
        r"^\s*(insert\b.*|placeholder|title|topic|lorem ipsum.*|presenter names?.*|#\s*minutes.*"
        r"|x{1,3}%|#{1,3}%.*|date\s*[–-]\s*date|chart title|\d?\.?\s*milestone \d.*"
        r"|bullet point \d.*|your text here|description:\s*insert.*|metric title|#{2,})\s*$",
        re.I | re.S,
    )

    def _sweep_placeholders(self, slide):
        """After mapped fills, clear ANY remaining placeholder-pattern paragraph
        anywhere on the slide (incl. inside groups) — template residue like
        'Insert description here.' must never ship."""
        def walk(shapes):
            for sh in shapes:
                if sh.shape_type == 6 and hasattr(sh, "shapes"):
                    walk(sh.shapes)
                    continue
                if not getattr(sh, "has_text_frame", False):
                    continue
                for para in sh.text_frame.paragraphs:
                    text = para.text.strip()
                    if text and self._PLACEHOLDER_LINE.match(text):
                        for run in para.runs:
                            run.text = ""
        walk(slide.shapes)
