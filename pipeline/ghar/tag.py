"""Parse Trains at a Glance 2026 tables into train schedules.

Each TAG route table is a grid: one column per train, one row per station. Pages come
in two layouts:

* station block on the left, trains to the right, read top to bottom;
* station block in the middle ("a d | Bikaner | d a"), trains on both sides, where the
  right-hand trains run the other way.

Rather than trust the layout, each train's reading direction is chosen by which order
keeps its times moving forward. Station names are matched to codes through TAG's own
Station Code Index first, then the DataMeet/OpenStreetMap gazetteer, choosing among
same-named stations the one nearest the train's neighbouring stops.

Every train that cannot be read cleanly is dropped and counted in the report.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from itertools import pairwise
from pathlib import Path

from .geo import haversine_km

TRAIN_NUMBER = re.compile(r"(?<!\d)(\d{5})(?!\d)")
TIME = re.compile(r"(?<![\d.])([0-2]?\d)\.([0-5]\d)(?![\d.])")
FLAG = re.compile(r"^(?:[ad](?:\s+|$))+|(?:(?:^|\s+)[ad])+$")
HEADER_LABELS = ("train name", "train number", "class of", "from table", "days of")
FOOTER_LABELS = ("days of arrival", "to table", "days of departure at destination")
MIDNIGHT_GAP_MIN = 12 * 60
SMALL_STEP_MIN = 120  # backward steps shorter than this are errors, not midnight
# Straight-line speed limits between consecutive listed stops. Track is longer than the
# straight line, so real trains stay well under these; a faster figure means a time was
# read from the wrong column.
MAX_SPEED_KMH = 130
MAX_SUSTAINED_KMH = 100  # over legs longer than LONG_LEG_KM
LONG_LEG_KM = 300
SLOW_GAP_H = 6
MIN_SPEED_KMH = 20
MAX_JOURNEY_H = 90  # the longest Indian Railways journeys take about 80 hours
NEAR_KM = 250  # a fuzzy name match must lie this close to the train's neighbouring stops
FUZZY_RATIO = 0.84

# Stations renamed since the 2016 gazetteer, or written differently in TAG 2026.
# Keys are normalised TAG names; values are station codes, first one present wins.
ALIASES = {
    "PT DEEN DAYAL UPADHYAYA": ["DDU"],
    "NIZAMUDDIN": ["NZM"],
    "HAZRAT NIZAMUDDIN": ["NZM"],
    "MGR CHENNAI CENTRAL": ["MAS"],
    "KSR BENGALURU": ["SBC"],
    "SSS HUBBALLI": ["UBL"],
    "THIRUVANANTHAPURAM CENTRAL": ["TVC"],
    "BATHINDA": ["BTI"],
    "BELAGAVI": ["BGM"],
    "VIRANGANA LAXMIBAI JHANSI": ["VGLJ", "JHS"],
    "VIRNGANA LAXMIBAI JHANSI": ["VGLJ", "JHS"],
    "CHHATRAPATI SAMBHAJI NAGAR": ["CPSN", "AWB"],
    "SIR M VISHVESVARAYA TERMINAL": ["SMVB"],
    "SIR M VISVESVARAYA TERMINAL": ["SMVB"],
    "BENGALURU CANTONMENT": ["BNC"],
    "NSCB GOMOH": ["GMO"],
    "NETAJI SUBHASH CHANDRA BOSE GOMOH": ["GMO"],
    "DADAR": ["DR"],
    "KANPUR": ["CNB"],
    "PRAYAGRAJ": ["PRYJ", "ALD"],
    "PARYAGRAJ": ["PRYJ", "ALD"],
    "PRAYAGRAJ CHEOKI": ["PCOI"],
    "DHARASHIV": ["UMD"],
    "NARMADAPURAM": ["NDPM", "HBD"],
    "BALLARI": ["BAY"],
    "CUDDAPPAH": ["HX"],
    "VIJAY AWADA": ["BZA"],
    "MANGALORE CENTRAL": ["MAQ"],
    "HISSAR": ["HSR"],
    "MIDNAPUR": ["MDN"],
    "KURNOOL CITY": ["KRNT"],
    "LUCKNOW": ["LKO", "LJN"],
}


# ---- station names --------------------------------------------------------


def normalise(name: str) -> str:
    """Upper-case, drop punctuation and common suffix noise, so spellings line up."""
    name = name.upper().replace("\n", " ")
    name = re.sub(r"\(.*?\)", " ", name)
    name = re.sub(r"[^A-Z ]", " ", name)
    # Single A/D letters are arrival/departure markers that leak into the name cell.
    noise = {"JN", "JUNCTION", "RLY", "STN", "STATION", "A", "D"}
    words = [w for w in name.split() if w not in noise]
    replace = {"CANTT": "CANTONMENT", "RD": "ROAD", "TERM": "TERMINUS", "T": "TERMINUS"}
    return " ".join(replace.get(w, w) for w in words)


def station_index(pdf_path: Path, display: dict[str, str] | None = None) -> dict[str, str]:
    """TAG's Station Code Index: about 900 principal stations, four columns per page.
    If `display` is given, it is filled with code -> the station's printed 2026 name."""
    import pdfplumber

    out: dict[str, str] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(keep_blank_chars=False)
            starts = sorted(w["x0"] for w in words if w["text"] == "Station")
            codes = sorted(w["x0"] for w in words if w["text"] == "Code")
            if len(starts) < 4 or len(codes) < 4:
                continue
            for col, (x_name, x_code) in enumerate(zip(starts[:4], codes[:4], strict=True)):
                x_end = starts[col + 1] if col + 1 < 4 else page.width
                lines: dict[int, list] = defaultdict(list)
                for w in words:
                    if x_name - 2 <= w["x0"] < x_end - 2 and w["top"] > 60:
                        lines[round(w["top"])].append(w)
                pending = ""
                for top in sorted(lines):
                    row = sorted(lines[top], key=lambda w: w["x0"])
                    name = " ".join(w["text"] for w in row if w["x0"] < x_code - 4)
                    code = " ".join(w["text"] for w in row if w["x0"] >= x_code - 4)
                    if name in {"Station Name"}:
                        continue
                    if code and re.fullmatch(r"[A-Z]{1,5}", code):
                        full = f"{pending} {name}".strip()
                        out[normalise(full)] = code
                        if display is not None and len(full) > 2:
                            display.setdefault(code, full)
                        pending = ""
                    elif name and not code:
                        # A name that wraps: the code sits on the first line, so this
                        # line continues the previous entry.
                        last = next(reversed(out), None)
                        if last is not None:
                            out[normalise(f"{last} {name}")] = out[last]
                            if display is not None and out[last] in display:
                                display[out[last]] = f"{display[out[last]]} {name}"
    return out


@dataclass
class Gazetteer:
    """Station name lookup with coordinates, for matching TAG names to codes."""

    coords: dict[str, tuple[float, float]]
    by_name: dict[str, list[str]] = field(default_factory=dict)
    index: dict[str, str] = field(default_factory=dict)
    _fuzzy_cache: dict[str, list[str]] = field(default_factory=dict)

    @classmethod
    def build(cls, stations: list[dict], index: dict[str, str]) -> Gazetteer:
        coords = {s["code"]: (s["lon"], s["lat"]) for s in stations}
        by_name: dict[str, list[str]] = defaultdict(list)
        for s in stations:
            by_name[normalise(s["name"])].append(s["code"])
        return cls(coords=coords, by_name=dict(by_name), index=index)

    def exact(self, name: str) -> list[str]:
        key = normalise(name)
        found = [c for c in ALIASES.get(key, []) if c in self.coords][:1]
        if key in self.index and self.index[key] in self.coords:
            found.append(self.index[key])
        found += self.by_name.get(key, [])
        return list(dict.fromkeys(found))

    def candidates(self, name: str) -> list[str]:
        """Exact matches, else 'Lucknow / Lucknow Jn.' parts, else names that contain all
        the words (Bolpur -> BOLPUR SHANTINIKETAN), else close spellings and names whose
        first letters were clipped by the PDF (urat -> SURAT). Only the exact stage is
        trusted without a location check."""
        found = self.exact(name)
        if found:
            return found
        for part in re.split(r"\s*/\s*", name):
            if part != name and (found := self.exact(part)):
                return found
        key = normalise(name)
        if len(key) < 4:
            return []
        if key not in self._fuzzy_cache:
            words = set(key.split())
            scored = []
            for other, codes in self.by_name.items():
                if words <= set(other.split()) or (other.endswith(key) and len(key) >= 4):
                    scored.append((1.0 - 0.01 * len(other.split()), codes))
                else:
                    matcher = SequenceMatcher(None, key, other)
                    if matcher.quick_ratio() >= FUZZY_RATIO and matcher.ratio() >= FUZZY_RATIO:
                        scored.append((matcher.ratio() - 0.2, codes))
            scored.sort(key=lambda x: -x[0])
            self._fuzzy_cache[key] = [c for _, codes in scored[:8] for c in codes]
        return self._fuzzy_cache[key]


# ---- reading one table ----------------------------------------------------


@dataclass
class Cell:
    station: str
    times: list[tuple[str, int]]  # (flag "a"/"d", minutes past midnight)
    row: int


def _times(text: str) -> list[int]:
    return [int(h) * 60 + int(m) for h, m in TIME.findall(text or "") if int(h) < 24]


def _split_block(text: str) -> tuple[list[str], str, list[str]]:
    """'a d\\nBikaner\\nd a' -> (['a','d'], 'Bikaner', ['d','a'])."""
    tokens = (text or "").replace("\n", " ").split()
    left: list[str] = []
    right: list[str] = []
    while tokens and tokens[0] in {"a", "d"}:
        left.append(tokens.pop(0))
    while tokens and tokens[-1] in {"a", "d"}:
        right.insert(0, tokens.pop())
    while tokens and re.fullmatch(r"\d+", tokens[0]):  # km column merged into the block
        tokens.pop(0)
    return left, " ".join(tokens), right


def read_table(
    rows: list[list], report: Counter, names: dict | None = None, info: dict | None = None
):
    """Cells per train number found in one extracted table (one list per column)."""
    counts = [sum(bool(TRAIN_NUMBER.search(c or "")) for c in r) for r in rows]
    if not counts or max(counts) < 1:
        report["tables_without_trains"] += 1
        return {}
    number_row = counts.index(max(counts))
    numbers = rows[number_row]

    train_cols: dict[int, list[str]] = {}
    for col, cell in enumerate(numbers):
        found = TRAIN_NUMBER.findall(cell or "")
        if len(found) == 1 or (found and "/" in (cell or "")):
            train_cols[col] = found  # "12327#/12369@" shares one column
        elif len(found) > 1:
            report["columns_merged_by_extraction"] += 1  # unreadable; dropped
    if not train_cols:
        return {}
    block_cols = [c for c in range(len(numbers)) if c not in train_cols and _is_block(rows, c)]
    if not block_cols:
        report["tables_without_station_column"] += 1
        return {}
    # The a/d markers sometimes sit in their own column beside the station names.
    for col in (min(block_cols) - 1, max(block_cols) + 1):
        if 0 <= col < len(numbers) and col not in train_cols and _is_flag_column(rows, col):
            block_cols.append(col)
    block_cols.sort()
    block_mid = (min(block_cols) + max(block_cols)) / 2

    out: dict[str, list[list[Cell]]] = defaultdict(list)
    columns: dict[int, list[Cell]] = {c: [] for c in train_cols}
    own_rows = {
        c: [r for r, row in enumerate(rows) if r > number_row and c < len(row) and _times(row[c])]
        for c in train_cols
    }
    started = False
    for r, row in enumerate(rows):
        if r <= number_row:
            continue
        block_text = " ".join((row[c] or "") for c in block_cols if c < len(row)).strip()
        # The first station row also carries the "Km." column heading; keep the station.
        block_text = re.sub(r"^km\.?\s*", "", block_text, flags=re.IGNORECASE)
        lower = block_text.lower()
        if any(lower.startswith(label) for label in FOOTER_LABELS) and started:
            break
        if not block_text or any(lower.startswith(label) for label in HEADER_LABELS):
            continue
        left, name, right = _split_block(block_text)
        if not name or not re.search(r"[A-Za-z]{3}", name):
            continue
        started = True
        texts = {col: (row[col] if col < len(row) else "") or "" for col in train_cols}
        # A boxed time can land in a spare column beside its train. Give it to the
        # adjacent train whose own cell is empty; if both are empty, to the one whose own
        # times sit vertically closest (a train's column is continuous). A tie is
        # ambiguous, and nobody gets the time.
        for spare in range(len(row)):
            if spare in train_cols or spare in block_cols or not _times(row[spare]):
                continue
            # Only a blank cell can take a time; "..." means the train passes without stopping.
            takers = [c for c in (spare - 1, spare + 1) if c in train_cols and not texts[c].strip()]
            if len(takers) > 1:
                gaps = [min((abs(r - x) for x in own_rows[c]), default=10**6) for c in takers]
                takers = [takers[gaps.index(min(gaps))]] if gaps[0] != gaps[1] else []
                if not takers:
                    report["spare_column_times_ambiguous"] += 1
            if len(takers) == 1:
                texts[takers[0]] = row[spare]
        for col in train_cols:
            times = _times(texts[col])
            if not times:
                continue
            flags = left if col < block_mid else right
            if not flags:
                flags = ["d"] * len(times)
            if len(flags) != len(times):
                flags = (["a", "d"] if len(times) == 2 else ["d"] * len(times))[: len(times)]
            columns[col].append(Cell(name, list(zip(flags, times, strict=False)), r))
    name_row = rows[number_row - 1] if number_row > 0 else []
    header = _header_rows(rows, number_row, set(train_cols))
    for col, numbers_in_col in train_cols.items():
        if columns[col]:
            for number in numbers_in_col:
                out[number].append(columns[col])
                if names is not None and col < len(name_row) and name_row[col]:
                    names.setdefault(number, " ".join(name_row[col].split()))
                if info is not None:
                    _record_info(info, number, col, header)
    return out


def _header_rows(rows: list[list], number_row: int, train_cols: set[int]) -> dict:
    """The class, from-table and days-of-departure rows above the stations. Their labels
    can sit in any column that is not a train column."""
    found = {}
    for row in rows[number_row + 1 : number_row + 8]:
        label = " ".join((c or "") for i, c in enumerate(row) if i not in train_cols).lower()
        for key, marker in (("classes", "class of"), ("from", "from table"), ("days", "days of")):
            if marker in label and key not in found:
                found[key] = row
    return found


WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_CODES = {"M": "Mon", "TU": "Tue", "W": "Wed", "TH": "Thu", "F": "Fri", "SA": "Sat", "SU": "Sun"}
DAY_TOKEN = re.compile(r"\b(Tu|Th|Sa|Su|M|W|F)\b")
CLASS_TOKEN = re.compile(r"[0-9A-Z]{1,3}")


def _days(text: str) -> list[str] | None:
    text = " ".join((text or "").split())
    if not text:
        return None
    if "daily" in text.lower():
        return ["Daily"]
    days = [DAY_CODES[t.upper()] for t in DAY_TOKEN.findall(text)]
    if "except" in text.lower() and days:
        # "Except W": every day but those listed.
        return [d for d in WEEK if d not in days] or None
    return sorted(set(days), key=WEEK.index) or None


def _record_info(info: dict, number: str, col: int, header: dict) -> None:
    """Days and classes for a train, preferring the table where it starts: there the
    'From Table No.' cell is empty, and the days are those of its origin station."""

    def cell(key: str) -> str:
        row = header.get(key)
        return (row[col] if row and col < len(row) else "") or ""

    starts_here = "from" in header and not cell("from").strip()
    entry = info.get(number)
    if entry and entry["origin_table"] and not starts_here:
        return
    classes = [c for c in re.split(r"[,\s]+", cell("classes")) if CLASS_TOKEN.fullmatch(c)]
    info[number] = {"days": _days(cell("days")), "classes": classes, "origin_table": starts_here}


def _is_flag_column(rows: list[list], col: int) -> bool:
    texts = [(r[col] or "").strip() for r in rows if col < len(r) and (r[col] or "").strip()]
    flags = sum(bool(re.fullmatch(r"[ad](\s+[ad])*", t)) for t in texts)
    return len(texts) >= 3 and flags >= 0.8 * len(texts)


def _is_block(rows: list[list], col: int) -> bool:
    """A station column: mostly words, and the 'Train Number' label or station names."""
    texts = [(r[col] or "") for r in rows if col < len(r)]
    worded = sum(bool(re.search(r"[A-Za-z]{3}", t)) and not _times(t) for t in texts)
    return worded >= max(3, len(texts) // 3)


# ---- assembling trains ----------------------------------------------------


def _ordered(segment: list[Cell]) -> list[tuple[str, int, int]]:
    """(station, arrival, departure) in travel order, choosing the direction that keeps
    clock times moving forward."""

    def stops(cells: list[Cell], reverse: bool) -> list[tuple[str, int, int]]:
        out = []
        for cell in reversed(cells) if reverse else cells:
            arr = next((t for f, t in cell.times if f == "a"), None)
            dep = next((t for f, t in cell.times if f == "d"), None)
            arr = arr if arr is not None else dep
            dep = dep if dep is not None else arr
            out.append((cell.station, arr, dep))
        return out

    def backward_steps(seq: list[tuple[str, int, int]]) -> int:
        clock = [t for _, a, d in seq for t in (a, d)]
        return sum(1 for x, y in pairwise(clock) if y < x and x - y < MIDNIGHT_GAP_MIN)

    forward, backward = stops(segment, False), stops(segment, True)
    return forward if backward_steps(forward) <= backward_steps(backward) else backward


def _absolute(seq: list[tuple[str, int, int]], report: Counter):
    """Add whole days as the clock passes midnight.

    A step back of two hours or more is midnight passing (TAG omits minor stops, so
    gaps between listed stations can be long). A smaller step back is a misread or
    duplicated stop, which is dropped. If more than a quarter of stops have to go, the
    train is rejected rather than guessed at.
    """
    day, last, out = 0, -1, []
    for station, arr, dep in seq:
        if dep < arr and arr - dep < SMALL_STEP_MIN:
            arr, dep = dep, arr  # arrival and departure printed the wrong way round
        pair = []
        for clock in (arr, dep):
            minute = day * 1440 + clock
            if minute < last:
                if last - minute >= SMALL_STEP_MIN:
                    day += 1
                    minute += 1440
                else:
                    pair = None
                    break
            pair.append(minute)
            last = minute
        if pair is None:
            report["stops_dropped_out_of_order"] += 1
            continue
        out.append((station, float(pair[0]), float(pair[1])))
    if len(out) < 2 or len(out) < 0.75 * len(seq):
        return None
    return out


def _merge(segments: list[list[tuple[str, int, int]]]) -> list[tuple[str, int, int]] | None:
    """Join a train's per-table segments at the stations they share."""
    segments = [s for s in segments if s]
    if not segments:
        return None
    merged = max(segments, key=len)
    rest = [s for s in segments if s is not merged]
    progress = True
    while rest and progress:
        progress = False
        for seg in list(rest):
            names = [normalise(s[0]) for s in merged]
            first, last = normalise(seg[0][0]), normalise(seg[-1][0])
            if first in names:  # continues from a station on the current route
                cut = names.index(first)
                merged = merged[:cut] + _union(merged[cut:], seg)
            elif last in names:  # leads into the current route
                cut = names.index(last)
                merged = _union(seg, merged[: cut + 1]) + merged[cut + 1 :]
            else:
                continue
            rest.remove(seg)
            progress = True
    return merged if not rest else None


def _union(a, b):
    """Merge two runs of the same train that share some stations.

    a's version of a shared station wins. Each station only b has is placed straight
    after the shared station that precedes it in b, so the travel order is kept.
    """
    result = list(a)
    keys = [normalise(s[0]) for s in result]
    position = -1  # index in result of the last shared station seen in b
    for stop in b:
        key = normalise(stop[0])
        if key in keys:
            position = keys.index(key)
            continue
        position += 1
        result.insert(position, stop)
        keys.insert(position, key)
    return result


@dataclass
class TagTrain:
    number: str
    name: str
    days: list[str] | None
    classes: list[str]
    stops: list[tuple[str, float, float]]  # code, arrival minute, departure minute


def _distance(gazetteer: Gazetteer, code: str, near: list[str]) -> float:
    return min(haversine_km(*gazetteer.coords[code], *gazetteer.coords[n]) for n in near)


def _match(stops, gazetteer: Gazetteer, report: Counter) -> list[tuple[str, float, float]]:
    """Station names -> codes. Exact matches anchor the route; other names are resolved
    among candidates by distance to the nearest anchors, and dropped if none is close."""
    exact = [gazetteer.exact(name) for name, _, _ in stops]
    anchors = [opt[0] if len(opt) == 1 else None for opt in exact]
    out = []
    for i, (name, arr, dep) in enumerate(stops):
        opts = exact[i] or gazetteer.candidates(name)
        if not opts:
            report["stops_unmatched_name"] += 1
            continue
        near = [a for a in anchors[max(0, i - 3) : i] + anchors[i + 1 : i + 4] if a]
        if near and (len(opts) > 1 or not exact[i]):
            opts = sorted(opts, key=lambda code, near=near: _distance(gazetteer, code, near))
            if not exact[i] and _distance(gazetteer, opts[0], near) > NEAR_KM:
                report["stops_unmatched_far"] += 1
                continue
            report["stops_matched_by_location"] += 1
        elif not exact[i]:
            report["stops_unmatched_no_anchor"] += 1
            continue
        anchors[i] = opts[0]
        if out and out[-1][0] == opts[0]:
            out[-1] = (opts[0], out[-1][1], dep)  # same station under two spellings
            continue
        out.append((opts[0], arr, dep))
    return out


def _plausible(stops, gazetteer: Gazetteer) -> bool:
    for (a, _, dep), (b, arr, _) in pairwise(stops):
        hours = (arr - dep) / 60
        km = haversine_km(*gazetteer.coords[a], *gazetteer.coords[b])
        if hours <= 0 and km > 5:
            return False
        if hours > 0 and km / hours > MAX_SPEED_KMH:
            return False
        if hours > 0 and km > LONG_LEG_KM and km / hours > MAX_SUSTAINED_KMH:
            return False
        # A long gap must be explained by a long distance; otherwise a day was added
        # where no midnight was crossed.
        if hours > SLOW_GAP_H and km / hours < MIN_SPEED_KMH:
            return False
    span = (stops[-1][1] - stops[0][2]) / 60
    return span <= MAX_JOURNEY_H


def parse(
    tables_json: Path, index: dict[str, str], stations: list[dict]
) -> tuple[list[TagTrain], dict]:
    report: Counter = Counter()
    files = json.loads(tables_json.read_text(encoding="utf-8"))["files"]
    segments: dict[str, list[list[Cell]]] = defaultdict(list)
    names: dict[str, str] = {}
    info: dict[str, dict] = {}
    for pages in files.values():
        for page in pages:
            for rows in page["tables"]:
                report["tables"] += 1
                for number, columns in read_table(rows, report, names, info).items():
                    segments[number].extend(columns)

    gazetteer = Gazetteer.build(stations, index)
    trains: list[TagTrain] = []
    for number, columns in sorted(segments.items()):
        merged = _merge([_ordered(col) for col in columns])
        if merged is None:
            report["trains_dropped_segments_do_not_join"] += 1
            continue
        absolute = _absolute(merged, report)
        if absolute is None:
            report["trains_dropped_times_out_of_order"] += 1
            continue
        matched = _match(absolute, gazetteer, report)
        if len(matched) < 2:
            report["trains_dropped_too_few_matched_stops"] += 1
            continue
        if not _plausible(matched, gazetteer):
            report["trains_dropped_implausible_speed"] += 1
            continue
        details = info.get(number, {})
        trains.append(
            TagTrain(
                number,
                names.get(number, number),
                details.get("days"),
                details.get("classes", []),
                matched,
            )
        )
    report["trains_found"] = len(segments)
    report["trains_out"] = len(trains)
    return trains, dict(report)
