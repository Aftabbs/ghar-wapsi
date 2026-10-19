"""Download Trains at a Glance 2026 and extract every table's cells.

Trains at a Glance (TAG) is the Railway Board's official timetable, effective
1 January 2026, published as one PDF per route table. Reading the tables is slow
(about a second per page), so the cells are cached in data/raw/tag2026/tables.json
and reused until a PDF changes.

    python -m ghar.tag_extract
"""

from __future__ import annotations

import json
import sys
import urllib.request
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / "data" / "raw" / "tag2026"
BASE = "https://indianrailways.gov.in/railwayboard/uploads/directorate/coaching/TAG_2026/"
TABLES = range(1, 98)
EXTRA = ["Station_Code_Index.pdf", "Fares.pdf"]
USER_AGENT = "homeward-pipeline/0.1 (+https://github.com/Aftabbs/homeward)"


def download() -> list[Path]:
    FOLDER.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in [f"{n}.pdf" for n in TABLES] + EXTRA:
        target = FOLDER / name
        if not target.exists():
            print(f"fetch  TAG 2026 {name}")
            request = urllib.request.Request(BASE + name, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                target.write_bytes(response.read())
        # The site serves an HTML error page for a few missing tables.
        if target.read_bytes()[:4] == b"%PDF":
            paths.append(target)
        else:
            print(f"skip   {name}: not a PDF")
    return paths


def _extract(path: str) -> tuple[str, list]:
    import pdfplumber

    pages = []
    with pdfplumber.open(path) as pdf:
        for number, page in enumerate(pdf.pages):
            pages.append({"page": number, "tables": [t.extract() for t in page.find_tables()]})
    return Path(path).name, pages


def extract(paths: list[Path]) -> dict:
    cache = FOLDER / "tables.json"
    stamp = {p.name: p.stat().st_size for p in paths}
    if cache.exists():
        cached = json.loads(cache.read_text(encoding="utf-8"))
        if cached.get("stamp") == stamp:
            return cached["files"]
    with ProcessPoolExecutor() as pool:
        files = dict(pool.map(_extract, [str(p) for p in paths if p.stem.isdigit()]))
    cache.write_bytes(json.dumps({"stamp": stamp, "files": files}).encode("utf-8"))
    return files


def main() -> int:
    files = extract(download())
    pages = sum(len(p) for p in files.values())
    tables = sum(len(page["tables"]) for p in files.values() for page in p)
    print(f"{len(files)} files, {pages} pages, {tables} tables")
    return 0


if __name__ == "__main__":
    sys.exit(main())
