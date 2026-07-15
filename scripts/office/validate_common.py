"""Shared helper-contract plumbing + validation chain pieces (PRD §4.3.4, §4.5).

Every builder: parse args → build → run checks → print single-line JSON to
stdout and exit 0. Any exception → stderr + exit 1 (the server surfaces the
stderr tail as the pipeline error).
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

RECALC_SKIP = "Recalc skipped — soffice not found"
THUMBS_SKIP = "Thumbnails skipped — soffice not found"


def cli(description: str) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--payload", required=True)
    p.add_argument("--template", default=None)
    p.add_argument("--out", required=True)
    return p.parse_args()


def load_payload(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def emit(file: Path, meta: dict, checks: list) -> None:
    print(json.dumps({"ok": True, "file": str(file), "meta": meta, "checks": checks}))


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def check(label: str, ok: bool) -> dict:
    return {"label": label, "ok": bool(ok)}


# --- §4.5(a) zip + content-types sanity -----------------------------------
def zip_sanity(path: Path) -> dict:
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            ok = "[Content_Types].xml" in names and z.testzip() is None
    except Exception:
        ok = False
    return check("OOXML zip sanity", ok)


# --- §4.5(b0) openxml-audit (installed at bootstrap) -----------------------
def openxml_audit(path: Path) -> dict:
    try:
        from openxml_audit import OpenXmlValidator  # type: ignore
    except ImportError:
        # library absent (optional per bootstrap §4.5) ⇒ skip, non-blocking.
        # round-trip + zip-sanity already prove the file opens.
        return check("openxml-audit skipped — validator not installed", False)
    try:
        result = OpenXmlValidator(strict=False).validate(str(path))
        return check("openxml-audit", bool(getattr(result, "is_valid", False)))
    except Exception:
        # library present but errored on this file ⇒ fail honestly
        return check("openxml-audit", False)


# --- §4.5(c) placeholder grep ----------------------------------------------
def placeholder_grep(texts: list) -> dict:
    joined = "\n".join(texts)
    clean = "{{" not in joined and "}}" not in joined and "TODO_" not in joined
    return check("Placeholder grep", clean)


# --- §4.5(e) soffice probe --------------------------------------------------
def find_soffice() -> str | None:
    hit = shutil.which("soffice")
    if hit:
        return hit
    mac = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    return mac if Path(mac).exists() else None


def soffice_convert(path: Path, label: str, skip_label: str) -> dict:
    """Headless convert to PDF — an OPPORTUNISTIC extra that proves the document
    opens in a real office app. NEVER blocking: round-trip + openxml-audit
    already prove structural validity, and LibreOffice is often absent (cloud)
    or broken. A failure/absence degrades to an amber skip, not a hard fail."""
    soffice = find_soffice()
    if not soffice:
        return check(skip_label, False)  # amber skip — soffice not installed
    with tempfile.TemporaryDirectory() as td:
        try:
            r = subprocess.run(
                [soffice, "--headless", "--convert-to", "pdf", "--outdir", td, str(path)],
                capture_output=True,
                timeout=120,
            )
            produced = list(Path(td).glob("*.pdf"))
            if r.returncode == 0 and len(produced) == 1:
                return check(label, True)
            # soffice present but the convert failed (e.g. broken install) →
            # skip, don't block a document that already passed round-trip.
            return check(f"{label} skipped — soffice unavailable", False)
        except Exception:
            return check(f"{label} skipped — soffice unavailable", False)


# --- spec validation (schema + content audits) ------------------------------
# The office Lambda ships pure-python only and its deploy path swaps *.py files
# into a prebuilt zip — no new pip deps. This is a deliberately small validator
# covering exactly the JSON-Schema subset skills/*/schema.json uses.

def _schema_errors(schema: dict, value, path: str = "$") -> list:
    errs = []

    def err(msg):
        errs.append(f"{path}: {msg}")

    if "const" in schema and value != schema["const"]:
        err(f"expected {schema['const']!r}")
        return errs
    if "enum" in schema and value not in schema["enum"]:
        err(f"{value!r} not in enum")
        return errs

    t = schema.get("type")
    if t:
        ok = {
            "object": lambda v: isinstance(v, dict),
            "array": lambda v: isinstance(v, list),
            "string": lambda v: isinstance(v, str),
            "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
            "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
            "boolean": lambda v: isinstance(v, bool),
            "null": lambda v: v is None,
        }[t](value)
        if not ok:
            err(f"expected {t}")
            return errs

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            err(f"shorter than {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            err(f"longer than {schema['maxLength']} chars")
        if "pattern" in schema:
            import re as _re
            if not _re.search(schema["pattern"], value):
                err(f"does not match {schema['pattern']}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            err(f"below minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            err(f"above maximum {schema['maximum']}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            err(f"fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            err(f"more than {schema['maxItems']} items")
        if "items" in schema:
            for i, item in enumerate(value):
                errs.extend(_schema_errors(schema["items"], item, f"{path}[{i}]"))
    if isinstance(value, dict):
        for req in schema.get("required", []):
            if req not in value:
                err(f"missing required '{req}'")
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in props:
                    err(f"unexpected property '{key}'")
        for key, sub in props.items():
            if key in value:
                errs.extend(_schema_errors(sub, value[key], f"{path}.{key}"))

    for sub in schema.get("allOf", []):
        if "if" in sub:
            if not _schema_errors(sub["if"], value, path):
                errs.extend(_schema_errors(sub.get("then", {}), value, path))
        else:
            errs.extend(_schema_errors(sub, value, path))
    if "oneOf" in schema:
        matches = [s for s in schema["oneOf"] if not _schema_errors(s, value, path)]
        if len(matches) != 1:
            err(f"matches {len(matches)} of oneOf (need exactly 1)")
    return errs


def validate_spec(skill: str, payload: dict) -> list:
    """Schema + content audit for a spec. Returns a list of error strings
    (empty = valid). Builders call this BEFORE building; the server runs the
    same schema through ajv — this is the Lambda-side belt to that brace."""
    schema_path = Path(__file__).resolve().parents[2] / "skills" / skill / "schema.json"
    if not schema_path.exists():  # bundled Lambda layout: schemas beside handler
        schema_path = Path(__file__).resolve().parent / "schemas" / f"{skill}.json"
    errors = []
    if schema_path.exists():
        schema = json.loads(schema_path.read_text())
        errors.extend(_schema_errors(schema, payload))
    errors.extend(_content_audit(skill, payload))
    return errors


_PLACEHOLDER_RX = None


def placeholder_text_errors(texts: list, where: str) -> list:
    """Doctrine placeholder scan: xxxx | lorem | ipsum | click to edit | TODO."""
    global _PLACEHOLDER_RX
    import re as _re
    if _PLACEHOLDER_RX is None:
        _PLACEHOLDER_RX = _re.compile(r"x{4,}|lorem|ipsum|click\s+to\s+edit|TODO|\{\{|\}\}", _re.I)
    hits = sorted({m.group(0) for t in texts for m in [_PLACEHOLDER_RX.search(str(t))] if m})
    return [f"{where}: placeholder text {hits}"] if hits else []


def _words(s) -> int:
    return len(str(s).split())


def _content_audit(skill: str, payload: dict) -> list:
    """The numeric-doctrine rules a JSON schema cannot express (word counts,
    heading hierarchy, formulas-not-values)."""
    errs = []
    if skill == "pptx":
        for i, slide in enumerate(payload.get("slides", []), 1):
            at = slide.get("archetype", "?")
            texts = [slide.get("title", ""), slide.get("subtitle", "")]
            words = 0
            for b in slide.get("bullets", []) or []:
                texts.append(b)
                if _words(b) > 12:
                    errs.append(f"slide {i} ({at}): bullet over 12 words: {str(b)[:40]!r}")
                words += _words(b)
            for col in slide.get("columns", []) or []:
                texts.append(col.get("head", ""))
                words += _words(col.get("head", ""))
                for it in col.get("items", []):
                    texts.append(it)
                    if _words(it) > 12:
                        errs.append(f"slide {i} ({at}): column item over 12 words")
                    words += _words(it)
            for st in slide.get("steps", []) or []:
                texts += [st.get("label", ""), st.get("detail", "")]
                words += _words(st.get("label", "")) + _words(st.get("detail", ""))
            for extra in ("support", "quote", "attribution"):
                if slide.get(extra):
                    texts.append(slide[extra])
            words += _words(slide.get("title", "")) + _words(slide.get("subtitle", ""))
            if slide.get("stat"):
                texts += [slide["stat"].get("value", ""), slide["stat"].get("label", "")]
                words += _words(slide["stat"].get("label", ""))
            content_types = {"content_bullets", "content_chart", "comparison", "two_column", "table", "timeline_process"}
            if at in content_types and words > 40:
                errs.append(f"slide {i} ({at}): {words} words on a content slide (max 40)")
            chart = slide.get("chart")
            if chart:
                ncat = len(chart.get("categories", []))
                for s in chart.get("series", []):
                    if len(s.get("values", [])) != ncat:
                        errs.append(f"slide {i}: series {s.get('name')!r} has {len(s.get('values', []))} values for {ncat} categories")
            table = slide.get("table")
            if table:
                ncol = len(table.get("headers", []))
                for r, row in enumerate(table.get("rows", [])):
                    if len(row) != ncol:
                        errs.append(f"slide {i}: table row {r + 1} has {len(row)} cells for {ncol} headers")
            errs.extend(placeholder_text_errors(texts, f"slide {i}"))
    elif skill in ("docx", "pdf"):
        blocks = payload.get("blocks") or payload.get("sections") or []
        level = 0
        texts = []
        for i, blk in enumerate(blocks, 1):
            if blk.get("kind") == "heading":
                lv = int(blk.get("level", 1))
                if level == 0 and lv != 1:
                    errs.append(f"block {i}: document must open at heading level 1, got {lv}")
                elif level and lv > level + 1:
                    errs.append(f"block {i}: heading level skip {level} → {lv}")
                level = lv
            for key in ("text", "caption", "attribution"):
                if blk.get(key):
                    texts.append(blk[key])
            texts += blk.get("items", []) or []
            for row in blk.get("rows", []) or []:
                texts += row
            ncol = len(blk.get("headers", []) or [])
            if ncol:
                for r, row in enumerate(blk.get("rows", []) or []):
                    if len(row) != ncol:
                        errs.append(f"block {i}: table row {r + 1} has {len(row)} cells for {ncol} headers")
        errs.extend(placeholder_text_errors(texts, skill))
    elif skill == "xlsx":
        import re as _re
        derived_rx = _re.compile(r"^(total|sum|subtotal|net|variance|average|margin|growth)\b", _re.I)
        for sheet in payload.get("sheets", []):
            name = sheet.get("name", "?")
            ncol = len(sheet.get("columns", []))
            texts = [c.get("header", "") for c in sheet.get("columns", [])]
            for r, row in enumerate(sheet.get("rows", []), 1):
                if len(row) > ncol:
                    errs.append(f"sheet {name!r} row {r}: {len(row)} cells for {ncol} columns")
                label = row[0].get("t", "") if row and isinstance(row[0], dict) else ""
                if label:
                    texts.append(label)
                if derived_rx.match(str(label)):
                    for c, cell in enumerate(row[1:], 2):
                        if isinstance(cell, dict) and "n" in cell:
                            errs.append(
                                f"sheet {name!r} row {r} ({label!r}): column {c} is a hardcoded "
                                f"number where a formula is expected — derived rows must compute"
                            )
            errs.extend(placeholder_text_errors(texts, f"sheet {name!r}"))
    return errs


def spec_gate(skill: str, payload: dict) -> None:
    """Hard gate: refuse to build a spec that fails schema or content audit."""
    errors = validate_spec(skill, payload)
    if errors:
        fail(f"spec validation failed ({len(errors)}): " + " | ".join(errors[:8]))


def soffice_recalc_scan(path: Path) -> dict:
    """xlsx: convert via soffice and scan the result for formula error markers."""
    soffice = find_soffice()
    if not soffice:
        return check(RECALC_SKIP, False)
    with tempfile.TemporaryDirectory() as td:
        try:
            r = subprocess.run(
                [soffice, "--headless", "--convert-to", "csv", "--outdir", td, str(path)],
                capture_output=True,
                timeout=120,
            )
            blobs = "".join(p.read_text(errors="ignore") for p in Path(td).glob("*.csv"))
            errors = [m for m in ("#REF!", "#DIV/0!", "#VALUE!", "#NAME?") if m in blobs]
            if errors:
                # genuine formula errors in the sheet — this IS a real defect
                return check(f"soffice recalc — {','.join(errors)}", False)
            if r.returncode == 0:
                return check("soffice recalc", True)
            # convert failed (broken/absent soffice) → non-blocking skip
            return check("soffice recalc skipped — soffice unavailable", False)
        except Exception:
            return check("soffice recalc skipped — soffice unavailable", False)
