"""Merge DataMeet (2016) and OpenStreetMap stations into one gazetteer.

DataMeet is the timetable's own station list, so its codes are authoritative for
matching. OpenStreetMap supplies stations DataMeet lacks (including ones opened after
2016, such as SMVT Bengaluru) and corrects coordinates DataMeet got badly wrong.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from itertools import pairwise
from pathlib import Path

from .geo import DistrictIndex, haversine_km

# Where DataMeet and OSM disagree by more than this, one of them is a geocoding
# error. Neither source is reliably right (OSM reuses some codes for different
# stations), so the candidate closer to the station's timetable neighbours wins.
DISAGREEMENT_KM = 25.0
NON_MAINLINE = {"subway", "light_rail", "monorail", "tram"}


@dataclass
class Station:
    code: str
    name: str
    lon: float
    lat: float
    source: str  # "datameet", "osm", or "osm-corrected"
    district_code: int | None
    district: str | None
    state: str | None


def _datameet(path: Path) -> dict[str, tuple[str, float, float]]:
    out = {}
    for feature in json.loads(path.read_text(encoding="utf-8"))["features"]:
        if not feature["geometry"]:
            continue
        props = feature["properties"]
        lon, lat = feature["geometry"]["coordinates"]
        out[props["code"]] = (props["name"], lon, lat)
    return out


def _osm(path: Path) -> dict[str, tuple[str, float, float]]:
    out = {}
    for node in json.loads(path.read_text(encoding="utf-8")):
        if node.get("station") in NON_MAINLINE:
            continue
        # A ref can carry several codes ("NDLS;DLI"); index each.
        for code in str(node["ref"]).replace(",", ";").split(";"):
            code = code.strip().upper()
            if code and code not in out:
                out[code] = (node.get("name") or code, node["lon"], node["lat"])
    return out


def _neighbours(schedules_path: Path) -> dict[str, set[str]]:
    """Codes of the stops immediately before and after each station on any train."""
    rows = json.loads(schedules_path.read_text(encoding="utf-8"))
    by_train: dict[str, list[tuple[int, str]]] = {}
    for row in rows:
        by_train.setdefault(row["train_number"], []).append((row["id"], row["station_code"]))
    out: dict[str, set[str]] = {}
    for stops in by_train.values():
        codes = [code for _, code in sorted(stops)]
        for a, b in pairwise(codes):
            out.setdefault(a, set()).add(b)
            out.setdefault(b, set()).add(a)
    return out


def _neighbour_distance(lon, lat, codes, located) -> float:
    gaps = sorted(haversine_km(lon, lat, *located[c]) for c in codes if c in located)
    return gaps[len(gaps) // 2] if gaps else float("inf")


def build(raw: Path) -> tuple[list[Station], dict]:
    datameet = _datameet(raw / "stations.json")
    osm = _osm(raw / "osm-stations.json")
    districts = DistrictIndex(raw / "districts-2011.geojson")
    neighbours = _neighbours(raw / "schedules.json")
    located = {code: (lon, lat) for code, (_, lon, lat) in datameet.items()}

    stations: list[Station] = []
    corrected, kept = [], []
    for code in sorted(set(datameet) | set(osm)):
        if code in datameet:
            name, lon, lat = datameet[code]
            source = "datameet"
            if code in osm:
                _, olon, olat = osm[code]
                gap = haversine_km(lon, lat, olon, olat)
                if gap > DISAGREEMENT_KM:
                    near = neighbours.get(code, set())
                    if _neighbour_distance(olon, olat, near, located) < _neighbour_distance(
                        lon, lat, near, located
                    ):
                        corrected.append((code, round(gap)))
                        lon, lat, source = olon, olat, "osm-corrected"
                    else:
                        kept.append((code, round(gap)))
        else:
            name, lon, lat = osm[code]
            source = "osm"
        district = districts.locate(lon, lat)
        stations.append(
            Station(
                code=code,
                name=name,
                lon=round(lon, 5),
                lat=round(lat, 5),
                source=source,
                district_code=district.census_code if district else None,
                district=district.name if district else None,
                state=district.state if district else None,
            )
        )

    report = {
        "datameet_stations": len(datameet),
        "osm_mainline_stations": len(osm),
        "merged": len(stations),
        "added_from_osm": sum(s.source == "osm" for s in stations),
        "coordinates_corrected_from_osm": len(corrected),
        "corrections_km": sorted(corrected, key=lambda c: -c[1]),
        "disagreements_kept_datameet_km": sorted(kept, key=lambda c: -c[1]),
        "outside_india_districts": sum(s.district_code is None for s in stations),
    }
    return stations, report


def write(stations: list[Station], path: Path) -> None:
    path.write_text(
        json.dumps([asdict(s) for s in stations], ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
