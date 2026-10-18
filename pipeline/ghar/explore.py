"""Data for explore mode: tap a train, station, district or state to learn about it.

Everything here comes from the parsed 2026 timetable and the station gazetteer. Rail
distance is estimated from the straight lines between a train's listed stops, scaled by
a factor fitted against official rail distances (see calibrate_distance); the app shows
it as "about N km".
"""

from __future__ import annotations

import json
from pathlib import Path

from .geo import haversine_km
from .tag import ALIASES
from .trains import tidy_name


def calibrate_distance(trips, datameet_trains: Path) -> dict:
    """Rail km / straight-line km through listed stops, fitted on trains whose 2016 record
    gives an official end-to-end distance with the same endpoints."""
    features = json.loads(datameet_trains.read_text(encoding="utf-8"))["features"]
    old = {f["properties"]["number"]: f["properties"] for f in features}
    ratios = []
    for trip in trips:
        o = old.get(trip.number)
        if (
            o
            and o.get("distance")
            and (o["from_station_code"], o["to_station_code"]) == (trip.origin, trip.destination)
            and trip.distance_km >= 50
        ):
            ratios.append(o["distance"] / trip.distance_km)
    ratios.sort()
    n = len(ratios)
    factor = ratios[n // 2]
    errors = sorted(abs(r / factor - 1) for r in ratios)
    return {
        "factor": round(factor, 4),
        "trains": n,
        "abs_error_p50": round(errors[n // 2], 3),
        "abs_error_p80": round(errors[int(0.8 * n)], 3),
    }


def build(
    tag_trains, trips, stations, factor: float, official_names: dict[str, str] | None = None
) -> tuple[dict, dict]:
    """Compact train details and the stations they use."""
    by_number = {t.number: t for t in trips}
    used: set[str] = set()
    trains = []
    for train in tag_trains:
        trip = by_number.get(train.number)
        if not trip:
            continue
        stops = [[code, round(arr), round(dep)] for code, arr, dep in train.stops]
        used.update(s[0] for s in stops)
        trains.append(
            {
                "n": train.number,
                "name": trip.name,
                "days": train.days or [],
                "classes": [c for c in train.classes if c in KNOWN_CLASSES],
                "km": round(trip.distance_km * factor, -1),
                "stops": stops,
            }
        )
    # Prefer the 2026 printed name, then the renamed form the parser recognises
    # (KSR Bengaluru for SBC), then the gazetteer name; all tidied.
    names = dict(renamed_stations())
    names.update(official_names or {})
    station_rows = {
        s.code: [
            tidy_name(names.get(s.code) or s.name),
            round(s.lon, 4),
            round(s.lat, 4),
            s.district_code,
            s.district,
            s.state,
        ]
        for s in stations
        if s.code in used
    }
    return {"trains": trains, "stations": station_rows}, {
        "explore_trains": len(trains),
        "explore_stations": len(station_rows),
    }


def renamed_stations() -> dict[str, str]:
    """code -> new name, from the parser's table of stations renamed since 2016."""
    out: dict[str, str] = {}
    for name, codes in ALIASES.items():
        if len(name) > 6 and codes:
            out.setdefault(codes[0], name)
    return out


# Class codes printed in Trains at a Glance; anything else is a footnote mark.
KNOWN_CLASSES = {"1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "II", "FC", "EV", "P"}


def write(data: dict, path: Path) -> dict:
    path.write_bytes(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    return {"file": path.name, "bytes": path.stat().st_size}


__all__ = ["build", "calibrate_distance", "haversine_km", "write"]
