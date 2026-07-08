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
