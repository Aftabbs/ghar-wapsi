"""Fastest direct train from each big city to every Census 2011 district.

A city is a set of Census districts; any station inside them counts as the city.
For each train we take the last stop inside the city (the latest you could board)
and every later stop outside it, keeping the quickest train per destination
district. Only direct trains in the 2016 timetable are considered.
"""

from __future__ import annotations

import json
from pathlib import Path

from .geo import haversine_km
from .trains import Trip

# A home district with no direct train borrows the nearest served district within
# this distance (Kolkata -> Howrah); the card names the district it is borrowing.
NEAREST_SERVED_KM = 60

# Cities people commonly migrate to, by Census 2011 district codes.
CITIES = {
    "bengaluru": {"name": "Bengaluru", "districts": [572]},
    "delhi": {"name": "Delhi", "districts": [90, 91, 92, 93, 94, 95, 96, 97, 98]},
    "mumbai": {"name": "Mumbai", "districts": [518, 519, 517]},
    "hyderabad": {"name": "Hyderabad", "districts": [536, 537]},
    "chennai": {"name": "Chennai", "districts": [603]},
    "kolkata": {"name": "Kolkata", "districts": [342]},
    "pune": {"name": "Pune", "districts": [521]},
    "ahmedabad": {"name": "Ahmedabad", "districts": [474]},
    "surat": {"name": "Surat", "districts": [492]},
    "jaipur": {"name": "Jaipur", "districts": [110]},
    "ludhiana": {"name": "Ludhiana", "districts": [41]},
    "chandigarh": {"name": "Chandigarh", "districts": [55]},
    "gurugram": {"name": "Gurugram", "districts": [86]},
    "noida": {"name": "Noida", "districts": [141]},
    "kochi": {"name": "Kochi", "districts": [595]},
    "coimbatore": {"name": "Coimbatore", "districts": [632]},
    "nagpur": {"name": "Nagpur", "districts": [505]},
    "indore": {"name": "Indore", "districts": [439]},
    "visakhapatnam": {"name": "Visakhapatnam", "districts": [544]},
    "guwahati": {"name": "Guwahati", "districts": [322]},
}


def build(
    trips: list[Trip],
    station_district: dict[str, int | None],
    centroids: dict[int, tuple[float, float]],
) -> tuple[dict, dict]:
    routes: dict[str, dict[str, list]] = {}
    report: dict = {}
    for city_id, city in CITIES.items():
        inside = set(city["districts"])
        best: dict[int, tuple[float, str]] = {}
        for trip in trips:
            board = None
            for i, (code, _) in enumerate(trip.stops):
                if station_district.get(code) in inside:
                    board = i  # last stop inside the city so far
                elif board is not None:
                    district = station_district.get(code)
                    if district is None:
                        continue
                    hours = (trip.stops[i][1] - trip.stops[board][1]) / 60
                    if district not in best or hours < best[district][0]:
                        best[district] = (hours, trip.number)
        table = {
            str(district): [round(hours, 1), number]
            for district, (hours, number) in sorted(best.items())
        }
        borrowed = 0
        for district, (lon, lat) in centroids.items():
            if district in best or district in inside:
                continue
            near = min(
                best,
                key=lambda d: haversine_km(lon, lat, *centroids[d]) if d in centroids else 1e9,
                default=None,
            )
            if (
                near is not None
                and near in centroids
                and haversine_km(lon, lat, *centroids[near]) <= NEAREST_SERVED_KM
            ):
                hours, number = best[near]
                table[str(district)] = [round(hours, 1), number, near]
                borrowed += 1
        routes[city_id] = table
        report[city_id] = {"direct": len(best), "nearest_served": borrowed}
    report["districts"] = len(centroids)
    return {"cities": CITIES, "routes": routes}, report


def write(data: dict, path: Path) -> dict:
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return {"file": path.name, "bytes": path.stat().st_size}
