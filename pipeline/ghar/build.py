"""Run the whole pipeline: raw downloads -> web/public/data + a stats report.

python -m ghar.fetch    # once
python -m ghar.build
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from . import (
    boundaries,
    census,
    crosscheck,
    eacpm,
    explore,
    fares,
    pack,
    routes,
    specials,
    stations,
    tag,
    tag_extract,
    trains,
)
from .geo import DistrictIndex

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "public" / "data"
REPORT = ROOT / "pipeline" / "report.json"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    gazetteer, station_report = stations.build(RAW)
    # Contains OpenStreetMap coordinates, so it is published under ODbL on its own.
    stations.write(gazetteer, OUT / "stations.odbl.json")

    located = {s.code: (s.lon, s.lat) for s in gazetteer}
    # Train timings: Trains at a Glance 2026 (Railway Board), parsed from its PDFs.
    tag_files = tag_extract.extract(tag_extract.download())
    del tag_files  # extract() caches the cells; tag.parse reads the cache
    official_names: dict[str, str] = {}
    index = tag.station_index(RAW / "tag2026" / "Station_Code_Index.pdf", official_names)
    station_rows = [{"code": s.code, "name": s.name, "lon": s.lon, "lat": s.lat} for s in gazetteer]
    tag_trains, tag_report = tag.parse(RAW / "tag2026" / "tables.json", index, station_rows)
    trips, train_report = trains.from_tag(tag_trains, located)
    train_report = {
        "timetable": "Trains at a Glance 2026",
        **tag_report,
        **train_report,
        "crosscheck_vs_2016": crosscheck.run(trips, RAW / "trains.json"),
    }
    trips.sort(key=lambda t: t.number)
    train_ids = {t.number: i for i, t in enumerate(trips)}
    meta = [
        {
            "n": t.number,
            "name": t.name,
            "o": t.origin,
            "d": t.destination,
            "kind": t.kind,
            "km": round(t.distance_km),
        }
        for t in trips
    ]
    (OUT / "trains.meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    long_trips = [t for t in trips if t.distance_km >= trains.LONG_DISTANCE_KM]
    other_trips = [t for t in trips if t.distance_km < trains.LONG_DISTANCE_KM]
    files = [
        pack.pack(long_trips, train_ids, OUT / "trains-long.bin"),
        pack.pack(other_trips, train_ids, OUT / "trains-rest.bin"),
        boundaries.build(RAW, OUT / "india-states.json"),
        boundaries.build_districts(RAW, OUT / "india-districts.json", tolerance=0.025),
        fares.write(fares.parse(RAW / "tag2026" / "Fares.pdf"), OUT / "fares.json"),
        census.write(census.parse(RAW / "census-d02"), OUT / "migration-2011.json"),
        census.write_json(
            eacpm.parse(eacpm.fetch(RAW / "eacpm-2024.pdf")), OUT / "rail-travel-2023.json"
        ),
    ]

    by_code = {
        s.code: {"lon": s.lon, "lat": s.lat, "state": s.state, "district": s.district_code}
        for s in gazetteer
    }
    festival, specials_report = specials.build(
        ROOT / "data" / "specials" / "specials-2026.csv", by_code
    )
    files.append(specials.write(festival, OUT / "specials-2026.json"))

    districts = DistrictIndex(RAW / "districts-2011.geojson").districts
    centroids = {d.census_code: d.centroid for d in districts}
    route_data, route_report = routes.build(
        trips, {s.code: s.district_code for s in gazetteer}, centroids
    )
    # name, Census 2011 state, lon, lat, state today (Telangana split from Andhra in 2014)
    state_today = boundaries.current_state_locator(RAW)
    route_data["districts"] = {
        str(d.census_code): [
            d.name,
            d.state,
            round(d.centroid[0], 3),
            round(d.centroid[1], 3),
            state_today(*d.centroid),
        ]
        for d in sorted(districts, key=lambda d: (d.state, d.name))
    }
    files.append(routes.write(route_data, OUT / "routes.json"))

    distance = explore.calibrate_distance(trips, RAW / "trains.json")
    explore_data, explore_report = explore.build(
        tag_trains, trips, gazetteer, distance["factor"], official_names
    )
    files.append(explore.write(explore_data, OUT / "explore.json"))
    train_report["rail_distance_calibration"] = distance
    train_report.update(explore_report)

    report = {
        "routes": route_report,
        "stations": station_report,
        "trains": train_report,
        "specials": specials_report,
        "files": files,
    }
    # Bytes, not text mode: on Windows text mode would write CRLF line endings.
    REPORT.write_bytes((json.dumps(report, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
