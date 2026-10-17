"""Census 2011 table D-02: migrants by place of last residence.

Rows are destination area (state or district) x origin state. We keep persons of
all durations and all reasons (work, marriage, family, study...), because that is
what the table reports; the app's wording says so.
"""

from __future__ import annotations

import json
from pathlib import Path

import openpyxl

# Column positions in the D-02 sheets (data starts on row 6).
COL_DISTRICT, COL_AREA, COL_ORIGIN, COL_ORIGIN_KIND, COL_PLACE, COL_PERSONS = 2, 3, 4, 5, 6, 7
INTERSTATE = "States in India beyond the state of enumeration"
NOT_A_STATE = {
    "Total",
    "Last residence within India",
    "Within the state of enumeration but outside the place of enumeration",
    "Elsewhere in the district of enumeration",
    "In other districts of the state of enumeration",
    INTERSTATE,
    "Last residence outside India",
    "Countries in Asia beyond India",
    "Countries in Europe",
    "Countries in Africa",
    "Countries in the Americas",
    "Countries in Oceania",
    "Unclassifiable",
}

# Display boundaries (post-2014) -> Census 2011 state names.
DISPLAY_TO_CENSUS = {
    "Andaman & Nicobar Island": "Andaman & Nicobar Islands",
    "Arunanchal Pradesh": "Arunachal Pradesh",
    "Dadara & Nagar Havelli": "Dadra & Nagar Haveli",
    "Telangana": "Andhra Pradesh",  # part of Andhra Pradesh in 2011
}


def _state_name(area: str) -> str:
    """'State - NCT OF DELHI' -> the origin-style name used in the same table."""
    return area.split(" - ", 1)[1]


def _read_rows(folder: Path) -> dict[str, list[list]]:
    """Rows of each sheet that we use. Reading the 48 MB of xlsx takes minutes, so the
    result is cached next to the downloads and reused while the files are unchanged."""
    files = sorted(folder.glob("d02-*.xlsx"))
    stamp = [[f.name, f.stat().st_size] for f in files]
    cache = folder / "rows-cache.json"
    if cache.exists():
        cached = json.loads(cache.read_text(encoding="utf-8"))
        if cached["stamp"] == stamp:
            return cached["rows"]
    rows = {}
    for path in files:
        sheet = openpyxl.load_workbook(path, read_only=True).active
        rows[path.name] = [
            list(row[: COL_PERSONS + 1])
            for row in sheet.iter_rows(min_row=6, values_only=True)
            if row[0] is not None and row[COL_ORIGIN_KIND] == "Total" and row[COL_PLACE] == "Total"
        ]
    cache.write_text(json.dumps({"stamp": stamp, "rows": rows}), encoding="utf-8")
    return rows


def parse(folder: Path) -> dict:
    states: dict[str, dict[str, int]] = {}
    state_interstate: dict[str, int] = {}
    districts: dict[str, dict] = {}
    india_interstate = None

    for rows in _read_rows(folder).values():
        if rows[0][COL_AREA] == "INDIA":
            # The all-India file repeats every state's figures; only its national
            # total is used, as the check below.
            for row in rows:
                if row[COL_AREA] == "INDIA" and row[COL_ORIGIN] == INTERSTATE:
                    india_interstate = int(row[COL_PERSONS])
            continue
        dest_state = None
        for row in rows:
            area, origin, persons = row[COL_AREA], row[COL_ORIGIN], int(row[COL_PERSONS])
            if row[COL_DISTRICT] == "000":
                dest_state = area
                if origin == INTERSTATE:
                    state_interstate[area] = persons
                elif origin not in NOT_A_STATE:
                    states.setdefault(area, {})[origin] = persons
                continue
            code = str(int(row[COL_DISTRICT]))
            entry = districts.setdefault(
                code, {"name": area, "state": dest_state, "from": {}, "interstate": 0}
            )
            if origin == INTERSTATE:
                entry["interstate"] = persons
            elif origin not in NOT_A_STATE and persons:
                entry["from"][origin] = persons

    # Canonical names: the origin spelling, which is consistent across files.
    origin_names = {name for flows in states.values() for name in flows}
    by_upper = {name.upper(): name for name in origin_names}

    def canonical(area: str) -> str:
        return by_upper.get(_state_name(area).upper().replace(" AND ", " & "), _state_name(area))

    matrix = {canonical(dest): flows for dest, flows in states.items()}
    totals = {canonical(dest): n for dest, n in state_interstate.items()}
    for district in districts.values():
        district["state"] = canonical(district["state"])

    # Every state's origin rows must add up to its interstate total, and the states
    # must add up to the all-India table. A mismatch means a parsing mistake.
    for dest, flows in matrix.items():
        assert sum(flows.values()) == totals[dest], f"{dest}: origins do not sum to total"
    assert india_interstate == sum(totals.values()), "states do not sum to all-India"

    return {
        "source": "Census of India 2011, Table D-02 (migrants by last residence, all reasons)",
        "interstate_total": india_interstate,
        "states": matrix,
        "districts": districts,
    }


def write(data: dict, path: Path) -> dict:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "states": len(data["states"]),
        "districts": len(data["districts"]),
        "interstate_total": data["interstate_total"],
    }
