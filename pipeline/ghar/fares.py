"""Official fare tables from Trains at a Glance 2026 (Fares.pdf), for fare estimates.

Basic fares are published per distance slab and class for each train category. The
app adds the published charges and the December 2025 revision, then shows a range
because a train's rail distance is itself an estimate.

Sources:
- Basic fares: TAG 2026, Fares.pdf, tables w.e.f. 01.07.2025.
- Charges (minimum distance, reservation fee, superfast charge): TAG 2026 charges table.
- Revision of +2 paise/km on reserved classes: Railway Board Commercial Circular 24/2025
  (25.12.2025), effective for tickets issued from 26.12.2025.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# Pages (zero-based) and column order for each category, read from the table headers.
CATEGORIES = {
    "mail_express_nonac": {"pages": range(7, 10), "columns": ["2S", "SL", "FC"]},
    "mail_express_ac": {
        "pages": range(10, 16),
        "columns": ["CC", "3E", "3A", "2A", "2A_lean", "1A", "1A_lean"],
    },
    "rajdhani": {"pages": range(16, 20), "columns": ["3A", "2A", "2A_lean", "1A", "1A_lean"]},
    "duronto": {
        "pages": range(20, 25),
        "columns": ["2S", "SL", "3E", "3A", "2A", "2A_lean", "1A", "1A_lean"],
    },
    "shatabdi": {"pages": range(25, 29), "columns": ["CC", "EC"]},
    "humsafar": {"pages": range(33, 36), "columns": ["SL", "3A"]},
    "garib_rath": {"pages": range(46, 47), "columns": ["CC", "3A"]},
}

# TAG 2026 charges table: minimum chargeable km, reservation fee, superfast charge (Rs).
CHARGES = {
    "2S": {"min_km": 50, "reservation": 15, "superfast": 15},
    "SL": {"min_km": 200, "reservation": 20, "superfast": 30},
    "CC": {"min_km": 150, "reservation": 40, "superfast": 45},
    "3E": {"min_km": 300, "reservation": 40, "superfast": 45},
    "3A": {"min_km": 300, "reservation": 40, "superfast": 45},
    "FC": {"min_km": 100, "reservation": 50, "superfast": 45},
    "2A": {"min_km": 300, "reservation": 50, "superfast": 45},
    "1A": {"min_km": 300, "reservation": 60, "superfast": 75},
    "EC": {"min_km": 0, "reservation": 60, "superfast": 75},
}
REVISION_PAISE_PER_KM = 2  # Commercial Circular 24/2025
AC_CLASSES = {"CC", "3E", "3A", "2A", "1A", "EC", "FC"}
GST = 0.05
VANDE_BHARAT_MULTIPLIER = {"CC": 1.4, "EC": 1.3}  # on Shatabdi fares, TAG 2026 notes

INT = re.compile(r"^\d+$")


def _rows(table: list[list]) -> list[list[int]]:
    """[upper km, fare per column...] for every slab in one extracted table. A row can hold
    two slab blocks side by side."""
    out = []
    for row in table:
        cells = [(c or "").strip() for c in row]
        starts = [
            i
            for i in range(len(cells) - 2)
            if INT.match(cells[i]) and cells[i + 1] in {"–", "-"} and INT.match(cells[i + 2])
        ]
        for n, start in enumerate(starts):
            end = starts[n + 1] if n + 1 < len(starts) else len(cells)
            values = [int(c) for c in cells[start + 3 : end] if INT.match(c)]
            out.append([int(cells[start]), int(cells[start + 2]), *values])
    return out


def parse(pdf_path: Path) -> dict:
    import pdfplumber

    tables = {}
    with pdfplumber.open(pdf_path) as pdf:
        for name, spec in CATEGORIES.items():
            slabs: dict[int, list[int]] = {}
            lowest = None
            width = len(spec["columns"])
            for page in spec["pages"]:
                found = pdf.pages[page].find_tables()
                if not found:
                    continue
                for row in _rows(found[0].extract()):
                    if len(row) - 2 >= width:
                        slabs[row[1]] = row[2 : width + 2]
                        lowest = row[0] if lowest is None else min(lowest, row[0])
            ordered = sorted(slabs.items())
            # Fares never fall as distance rises; a drop means a misread cell.
            for (_, a), (_, b) in zip(ordered, ordered[1:], strict=False):
                assert all(x <= y for x, y in zip(a, b, strict=True)), f"{name}: fares fall"
            # Below the first slab that was read, there is no estimate rather than a guess.
            tables[name] = {
                "columns": spec["columns"],
                "from_km": lowest,
                "slabs": [[hi, *v] for hi, v in ordered],
            }
    return tables


def basic_fare(tables: dict, category: str, cls: str, km: float) -> int | None:
    table = tables[category]
    if cls not in table["columns"]:
        return None
    if km < table["from_km"]:
        return None
    col = table["columns"].index(cls) + 1
    for row in table["slabs"]:
        if km <= row[0]:
            return row[col]
    return None  # beyond the table


def fare(
    tables: dict, category: str, cls: str, km: float, superfast: bool, multiplier: float = 1.0
) -> int | None:
    """Published fare for one adult, rounded up to the next Rs 5. Catering, Tatkal, flexi
    pricing and concessions are not included."""
    charges = CHARGES.get(cls)
    if not charges:
        return None
    charged_km = max(km, charges["min_km"])
    base = basic_fare(tables, category, cls, charged_km)
    if base is None:
        return None
    amount = base * multiplier + round(REVISION_PAISE_PER_KM * charged_km / 100)
    amount += charges["reservation"] + (charges["superfast"] if superfast else 0)
    premium = category in {"rajdhani", "duronto", "shatabdi"}
    if cls in AC_CLASSES or premium:
        amount *= 1 + GST
    return int(-(-amount // 5) * 5)


def write(tables: dict, path: Path) -> dict:
    data = {
        "source": "Trains at a Glance 2026 fare tables (w.e.f. 01.07.2025) and charges; "
        "Commercial Circular 24/2025 (+2 paise/km from 26.12.2025)",
        "tables": tables,
        "charges": CHARGES,
        "revision_paise_per_km": REVISION_PAISE_PER_KM,
        "ac_classes": sorted(AC_CLASSES),
        "gst": GST,
        "vande_bharat_multiplier": VANDE_BHARAT_MULTIPLIER,
    }
    path.write_bytes(json.dumps(data, separators=(",", ":")).encode("utf-8"))
    return {"file": path.name, "bytes": path.stat().st_size, "categories": len(tables)}
