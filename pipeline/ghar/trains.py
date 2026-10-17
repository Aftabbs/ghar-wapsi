"""Turn the 2016 timetable into animation-ready trips.

Each trip is a list of (lon, lat, minute) points, where minute counts from 00:00 on
the train's first day. The timetable has gaps and contradictions; every repair is
counted in the report rather than applied silently.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .geo import haversine_km

DAY = 1440
MAX_SPAN_MIN = 120 * 60  # nothing in India runs longer; longer spans are data errors
MAX_SPEED_KMH = 400  # faster than this between stops means a misplaced station
LONG_DISTANCE_KM = 500
# Clock time stepping back by more than this means the train crossed midnight;
# less means a duplicated or out-of-order row.
MIDNIGHT_GAP_MIN = 12 * 60

# The animation shows one day, clock time 00:00-24:00, as minutes [DAY, 2 * DAY).
WINDOW = (DAY, 2 * DAY)


@dataclass
class Trip:
    number: str
    name: str
    origin: str
    destination: str
    kind: str
    distance_km: float
    points: list[tuple[float, float, float]] = field(default_factory=list)
    # Station code and minute for every kept point (arrival and departure each count).
    stops: list[tuple[str, float]] = field(default_factory=list)

    @property
    def span(self) -> float:
        return self.points[-1][2] - self.points[0][2]


def _clock(value) -> int | None:
    if not value or value == "None":
        return None
    hours, minutes, *_ = (int(part) for part in str(value).split(":"))
    return hours * 60 + minutes


def _stop_times(rows: list[dict], report: Counter) -> list[tuple[str, int | None, int | None]]:
    """Absolute arrival/departure minutes per stop, inferring days when missing."""
    out = []
    day = 0
    last = -1
    for row in rows:
        arrival, departure = _clock(row["arrival"]), _clock(row["departure"])
        absolute: list[int | None] = []
        consistent = True
        row_day, floor = day, last  # committed only if the whole row is consistent
        for clock in (arrival, departure):
            if clock is None:
                absolute.append(None)
                continue
            minute = row_day * DAY + clock
            if minute < floor:
                if floor - minute > MIDNIGHT_GAP_MIN:
                    # A big step back in clock time is midnight passing. This is how
                    # days are inferred, since many rows leave the day blank.
                    row_day += 1
                    minute += DAY
                else:
                    # A small step back is a repeated row: the 2016 scrape copies the
                    # previous station when a train reverses out of a terminus.
                    consistent = False
                    break
            absolute.append(minute)
            floor = minute
        if not consistent:
            report["stops_dropped_out_of_order"] += 1
            continue
        day, last = row_day, floor
        if row.get("day") in (None, "None"):
            report["stops_day_inferred"] += 1
        out.append((row["station_code"], absolute[0], absolute[1]))
    return out


def _strictly_increasing(points: list[list[float]], report: Counter) -> None:
    """Spread stops that share a minute evenly across the next real gap."""
    i = 0
    while i < len(points):
        j = i
        while j + 1 < len(points) and points[j + 1][2] <= points[i][2]:
            j += 1
        if j > i:
            report["points_respaced"] += j - i
            start = points[i][2]
            end = points[j + 1][2] if j + 1 < len(points) else start + (j - i + 1)
            step = (end - start) / (j - i + 1)
            for k in range(i + 1, j + 1):
                points[k][2] = start + step * (k - i)
        i = j + 1


def build(raw: Path, stations: dict[str, tuple[float, float]]) -> tuple[list[Trip], dict]:
    report: Counter = Counter()
    meta = {
        f["properties"]["number"]: f["properties"]
        for f in json.loads((raw / "trains.json").read_text(encoding="utf-8"))["features"]
    }
    by_train: dict[str, list[dict]] = {}
    for row in json.loads((raw / "schedules.json").read_text(encoding="utf-8")):
        by_train.setdefault(row["train_number"], []).append(row)

    trips: list[Trip] = []
    for number, rows in by_train.items():
        rows.sort(key=lambda r: r["id"])
        props = meta.get(number, {})
        points: list[list] = []  # lon, lat, minute, station code
        for code, arrival, departure in _stop_times(rows, report):
            if code not in stations:
                report["stops_without_coordinates"] += 1
                continue
            lon, lat = stations[code]
            for minute in (arrival, departure):
                if minute is not None and not (points and points[-1][2] == minute):
                    points.append([lon, lat, float(minute), code])

        # Drop stops that imply impossible speed: one of the two stations is misplaced.
        kept: list[list] = []
        for point in points:
            if kept:
                prev = kept[-1]
                hours = (point[2] - prev[2]) / 60
                km = haversine_km(prev[0], prev[1], point[0], point[1])
                if hours > 0 and km / hours > MAX_SPEED_KMH:
                    report["points_dropped_too_fast"] += 1
                    continue
            kept.append(point)

        if len(kept) < 2:
            report["trains_dropped_too_few_points"] += 1
            continue
        _strictly_increasing(kept, report)
        trip = Trip(
            number=number,
            name=props.get("name") or rows[0].get("train_name") or number,
            origin=props.get("from_station_code") or rows[0]["station_code"],
            destination=props.get("to_station_code") or rows[-1]["station_code"],
            kind=props.get("type") or "",
            distance_km=float(props.get("distance") or 0),
            points=[(p[0], p[1], p[2]) for p in kept],
            stops=[(p[3], p[2]) for p in kept],
        )
        if trip.span > MAX_SPAN_MIN:
            report["trains_dropped_span_too_long"] += 1
            continue
        trips.append(trip)

    report["trains_in"] = len(by_train)
    report["trains_out"] = len(trips)
    report["long_distance_trains"] = sum(t.distance_km >= LONG_DISTANCE_KM for t in trips)
    report["points_out"] = sum(len(t.points) for t in trips)
    return trips, dict(report)


def loop_copies(trip: Trip) -> list[list[tuple[float, float, float]]]:
    """Shift a trip by whole days so every night it would be running shows up.

    The app animates minutes [DAY, 2 * DAY). A train that departs at 22:00 and runs
    for 30 hours is on the move during parts of two clock days, so it needs two
    copies; we emit every whole-day shift that overlaps the window.
    """
    start, end = trip.points[0][2], trip.points[-1][2]
    copies = []
    offset = (WINDOW[0] - end) // DAY * DAY  # earliest shift that can still overlap
    while start + offset < WINDOW[1]:
        if end + offset > WINDOW[0]:
            copies.append([(lon, lat, t + offset) for lon, lat, t in trip.points])
        offset += DAY
    return copies
