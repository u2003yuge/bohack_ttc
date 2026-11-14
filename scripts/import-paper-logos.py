"""Validate local paper logos and create safe, portable PNG assets.

Usage: python scripts/import-paper-logos.py <source-folder>
Requires Pillow for this one-time import only; the app has no Python dependency.
"""
from pathlib import Path
import hashlib
import json
import re
import sys
import warnings
from PIL import Image, UnidentifiedImageError

root = Path(__file__).resolve().parents[1]
if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/import-paper-logos.py <source-folder>")
source = Path(sys.argv[1]).resolve()
if not source.is_dir():
    raise SystemExit("Source directory does not exist")
markdown = (root / "papers.md").read_text(encoding="utf-8")
blocks = re.findall(r"```json\s*([\s\S]*?)```", markdown)
if len(blocks) != 1:
    raise SystemExit("Expected exactly one JSON array in papers.md")
records = json.loads(blocks[0])
output = root / "public/papers_logo"
output.mkdir(parents=True, exist_ok=True)
assets = {}
for record in records:
    identity = record["id"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", identity) or identity in assets:
        raise ValueError("Invalid or duplicate venue ID")
    logo = record.get("logo", {})
    relative = logo.get("path")
    entry = {"sourcePath": relative, "displayPath": None, "status": "not_found",
             "notes": "原始资料未提供可用徽标；显示默认图标。"}
    if relative:
        if not re.fullmatch(r"papers_logo/[a-z0-9][a-z0-9-]*\.(png|jpg|jpeg|ico|bin|bmp|webp|gif)", relative):
            raise ValueError("Invalid image path")
        file = (source / Path(relative).name).resolve()
        if file.parent != source:
            raise ValueError("Image path escapes source directory")
        entry["status"] = "missing"
        entry["notes"] = "原始资料记录了路径，但本次导入未找到文件。"
        if file.is_file():
            entry["sourceSha256"] = hashlib.sha256(file.read_bytes()).hexdigest()
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    with Image.open(file) as image:
                        image.load()
                        entry["detectedFormat"] = image.format
                        frame = image.convert("RGBA")
                        frame.thumbnail((256, 256), Image.Resampling.LANCZOS)
                target = output / (identity + ".png")
                frame.save(target, "PNG", optimize=True)
                entry.update(displayPath="/papers_logo/" + target.name, status="ready",
                             width=frame.width, height=frame.height,
                             displaySha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                             notes="本地文件已解码并转为 PNG；图标身份与出处沿用原始资料，未进行本次联网核验。")
            except (UnidentifiedImageError, OSError, ValueError):
                entry.update(status="invalid", notes="本地文件不是可解码的图片（可能是网页或错误响应），显示默认图标。")
    assets[identity] = entry
manifest = {"format": "bohack-paper-logo-assets", "version": 1, "sourceFile": "papers.md", "assets": assets}
(root / "db/paper-logo-assets.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
counts = {status: sum(a["status"] == status for a in assets.values()) for status in ["ready", "invalid", "missing", "not_found"]}
print(json.dumps({"records": len(assets), **counts}, ensure_ascii=False))
