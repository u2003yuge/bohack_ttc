"""Import locally reviewed competition images without matching by file order.

Usage: python scripts/import-competition-logos.py <source-folder>
Requires Pillow only for this one-time import; runtime/build have no Python dependency.
The checked-in review binds each decision to a catalog identity and source-file hash.
"""
from collections import Counter
from pathlib import Path
import csv
import hashlib
import io
import json
import re
import sys
import warnings
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

from PIL import Image


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def sanitize_svg(data):
    # Only static, self-contained geometry; no scripts, CSS, external images or fonts.
    if re.search(rb"<!DOCTYPE|<!ENTITY", data, re.I):
        raise ValueError("SVG entities/DTDs are not supported")
    node = ET.fromstring(data)
    tags = {"svg", "g", "defs", "path", "polygon", "polyline", "rect", "circle",
            "ellipse", "line", "mask", "clipPath", "use", "linearGradient",
            "radialGradient", "stop", "title", "desc"}
    attrs = {"id", "width", "height", "viewBox", "version", "x", "y", "x1", "y1",
             "x2", "y2", "cx", "cy", "r", "rx", "ry", "points", "d", "transform",
             "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap",
             "stroke-linejoin", "stroke-opacity", "stroke-miterlimit", "opacity", "mask",
             "clip-path", "clip-rule", "href", "offset", "stop-color", "stop-opacity",
             "gradientUnits", "gradientTransform", "preserveAspectRatio"}
    if node.tag != "{http://www.w3.org/2000/svg}svg":
        raise ValueError("Not an SVG document")
    for element in node.iter():
        if element.tag.split("}")[-1] not in tags:
            raise ValueError("Unsupported SVG element")
        if element.text is not None and not element.text.strip():
            element.text = None
        if element.tail is not None and not element.tail.strip():
            element.tail = None
        for key, value in element.attrib.items():
            key = key.split("}")[-1]
            if key not in attrs or re.search(r"javascript:|data:|https?:|file:|@import|expression", value, re.I):
                raise ValueError("Unsupported SVG attribute")
            if key == "href" and not re.fullmatch(r"#[A-Za-z0-9_-]+", value):
                raise ValueError("External SVG reference")
            for reference in re.findall(r"url\(([^)]*)\)", value, re.I):
                if not re.fullmatch(r"#[A-Za-z0-9_-]+", reference):
                    raise ValueError("External SVG resource")
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    return ET.tostring(node, encoding="utf-8") + b"\n"


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/import-competition-logos.py <source-folder>")
    root = Path(__file__).resolve().parents[1]
    source = Path(sys.argv[1]).resolve()
    markdown = (root / "competitions.md").read_text(encoding="utf-8")
    blocks = re.findall(r"```json\s*([\s\S]*?)```", markdown)
    if len(blocks) != 1:
        raise ValueError("Expected one competition JSON array")
    records = json.loads(blocks[0])
    rows = list(csv.DictReader(io.StringIO((source / "manifest.csv").read_text(encoding="utf-8-sig"))))
    by_id = {row["id"]: row for row in rows}
    review = json.loads((root / "db/competition-logo-review.json").read_text(encoding="utf-8"))
    decisions = review["entries"]
    ids = {record["id"] for record in records}
    if len(by_id) != len(rows) or len(ids) != len(records) or ids != set(by_id) or ids != set(decisions):
        raise ValueError("Catalog, manifest and reviewed identities must match exactly")
    assets, outputs = {}, {}
    for record in records:
        identity = record["id"]
        row, decision = by_id[identity], decisions[identity]
        if not re.fullmatch(r"\d{4}-\d{2}", identity):
            raise ValueError("Invalid catalog ID")
        if row["name"] != record["name"] or decision["name"] != record["name"] or decision["officialWebsite"] != record["official_website"]:
            raise ValueError(f"Competition identity changed: {identity}; review required")
        if any(row[key] != decision[key] for key in ["file", "source_url", "status", "kind"]):
            raise ValueError(f"Source manifest changed: {identity}; review required")
        if row["source_url"] and urlparse(row["source_url"]).scheme not in ["http", "https"]:
            raise ValueError("Invalid source URL")
        entry = {
            "name": record["name"], "reportYear": record["report_year"],
            "officialWebsite": record["official_website"],
            "sourcePath": "competitions_logo/" + row["file"] if row["file"] else None,
            "sourceUrl": row["source_url"] or None, "sourceKind": row["kind"] or None,
            "displayKind": decision["displayKind"], "displayPath": None,
            "status": "not_found", "notes": decision["notes"],
        }
        if row["file"]:
            if not re.fullmatch(re.escape(identity) + r"(?:-site-icon|-direct)?\.(png|jpg|jpeg|ico|webp|gif|svg)", row["file"]):
                raise ValueError("Invalid filename")
            file = (source / row["file"]).resolve()
            if file.parent != source:
                raise ValueError("Image escapes source directory")
            if not file.is_file():
                raise ValueError(f"Reviewed file missing: {identity}")
            data = file.read_bytes()
            if sha256(data) != decision["sourceSha256"]:
                raise ValueError(f"Image changed: {identity}; review required")
            entry["sourceSha256"] = decision["sourceSha256"]
            if decision["decision"] == "reject":
                entry["status"] = "rejected"
            elif decision["decision"] == "accept":
                try:
                    if file.suffix.lower() == ".svg":
                        converted = sanitize_svg(data)
                        suffix, detected = ".svg", "SVG"
                    else:
                        with warnings.catch_warnings():
                            warnings.simplefilter("error", Image.DecompressionBombWarning)
                            with Image.open(io.BytesIO(data)) as image:
                                image.load()
                                detected = image.format
                                frame = image.convert("RGBA")
                                frame.thumbnail((256, 256), Image.Resampling.LANCZOS)
                        buffer = io.BytesIO()
                        frame.save(buffer, "PNG", optimize=True)
                        converted, suffix = buffer.getvalue(), ".png"
                        entry.update(width=frame.width, height=frame.height)
                    filename = identity + suffix
                    outputs[filename] = converted
                    entry.update(status="ready", displayPath="/competitions_logo/" + filename,
                                 displaySha256=sha256(converted), detectedFormat=detected)
                except (OSError, ValueError, ET.ParseError, Image.DecompressionBombError, Image.DecompressionBombWarning):
                    entry.update(status="invalid", notes=entry["notes"] + " 文件解码或静态 SVG 校验失败，显示默认图标。")
            else:
                raise ValueError("Unreviewed image")
        elif decision["decision"] != "missing":
            raise ValueError("Unexpected review decision for missing image")
        assets[identity] = entry
    # Validate every identity and input before publishing any file.
    output = root / "public/competitions_logo"
    output.mkdir(parents=True, exist_ok=True)
    for filename, data in outputs.items():
        (output / filename).write_bytes(data)
    for stale in output.iterdir():
        if stale.is_file() and re.fullmatch(r"\d{4}-\d{2}\.(png|svg)", stale.name) and stale.name not in outputs:
            stale.unlink()
    manifest = {
        "format": "bohack-competition-logo-assets", "version": 1,
        "sourceFile": "competitions_logo/manifest.csv", "reviewFile": "db/competition-logo-review.json",
        "reviewedOn": review["reviewedOn"], "assets": assets,
    }
    (root / "db/competition-logo-assets.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(assets), **Counter(entry["status"] for entry in assets.values())}))


if __name__ == "__main__":
    main()
