"""Run the whole pipeline: raw downloads -> web/public/data + a stats report.

python -m ghar.fetch    # once
python -m ghar.build
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from . import boundaries, census, pack, specials, stations, trains

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
    trips, train_report = trains.build(RAW, located)
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
        census.write(census.parse(RAW / "census-d02"), OUT / "migration-2011.json"),
    ]

    by_code = {s.code: {"lon": s.lon, "lat": s.lat, "state": s.state} for s in gazetteer}
    festival, specials_report = specials.build(
        ROOT / "data" / "specials" / "specials-2026.csv", by_code
    )
    files.append(specials.write(festival, OUT / "specials-2026.json"))

    report = {
        "stations": station_report,
        "trains": train_report,
        "specials": specials_report,
        "files": files,
    }
    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
