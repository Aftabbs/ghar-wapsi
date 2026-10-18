"""Animation-ready trips from the parsed 2026 timetable.

Each trip is a list of (lon, lat, minute) points, where minute counts from 00:00 on
the train's first day, plus the station code behind every point.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from .geo import haversine_km

DAY = 1440
LONG_DISTANCE_KM = 500

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


# Abbreviations that stay in capitals when a name is converted from ALL CAPS.
KEEP_CAPS = {
    "SF", "AC", "LTT", "CST", "CSMT", "DMU", "MEMU", "DEMU", "EMU", "MMTS", "SMVT", "NG",
    "KSR", "MGR", "SSS", "NSCB", "MMCT",
}  # fmt: skip
TWO_LETTER_WORDS = {"DA", "KI", "RD", "JN", "KA", "KE", "PT"}


def tidy_name(name: str) -> str:
    """'MYSORE - DARBHANGA BAGMATI SF Exp' -> 'Mysore - Darbhanga Bagmati SF Exp'."""

    def word(match: re.Match) -> str:
        w = match.group(0)
        if w in KEEP_CAPS or (len(w) < 3 and w not in TWO_LETTER_WORDS):
            return w
        return w.capitalize()

    # Re-join words the PDF hyphenated across lines ("Kan- pur" -> "Kanpur").
    name = re.sub(r"(\w)- (?=[a-z])", r"\1", name)
    return re.sub(r"\b[A-Z]{2,}\b", word, name)


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


def from_tag(tag_trains, coords: dict[str, tuple[float, float]]) -> tuple[list[Trip], dict]:
    """Trips from parsed Trains at a Glance 2026 schedules (see ghar.tag)."""
    report: Counter = Counter()
    trips: list[Trip] = []
    for train in tag_trains:
        points: list[list] = []
        for code, arrival, departure in train.stops:
            lon, lat = coords[code]
            for minute in (arrival, departure):
                if not (points and points[-1][2] == minute and points[-1][3] == code):
                    points.append([lon, lat, minute, code])
        _strictly_increasing(points, report)
        distance = sum(
            haversine_km(a[0], a[1], b[0], b[1]) for a, b in zip(points, points[1:], strict=False)
        )
        trips.append(
            Trip(
                number=train.number,
                name=tidy_name(train.name),
                origin=train.stops[0][0],
                destination=train.stops[-1][0],
                kind="",
                distance_km=round(distance),  # straight lines between listed stops
                points=[(p[0], p[1], p[2]) for p in points],
                stops=[(p[3], p[2]) for p in points],
            )
        )
    report["trains_out"] = len(trips)
    report["long_distance_trains"] = sum(t.distance_km >= LONG_DISTANCE_KM for t in trips)
    report["points_out"] = sum(len(t.points) for t in trips)
    return trips, dict(report)
