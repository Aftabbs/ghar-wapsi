"""Cross-check parsed 2026 journey times against an independent 2016 timetable.

For trains that start and end at the same stations in both, the ratio of 2026 to 2016
end-to-end journey time should sit close to 1. A drift here means a parsing problem.
The result is written to report.json and quoted on the methods page.
"""

from __future__ import annotations

import json
from pathlib import Path


def run(trips, datameet_trains: Path) -> dict:
    features = json.loads(datameet_trains.read_text(encoding="utf-8"))["features"]
    old = {f["properties"]["number"]: f["properties"] for f in features}
    ratios = []
    for trip in trips:
        o = old.get(trip.number)
        if not o or (o["from_station_code"], o["to_station_code"]) != (
            trip.origin,
            trip.destination,
        ):
            continue
        old_h = (o["duration_h"] or 0) + (o["duration_m"] or 0) / 60
        if old_h >= 1:
            ratios.append(trip.span / 60 / old_h)
    ratios.sort()
    n = len(ratios)
    if not n:
        return {"compared": 0}
    return {
        "compared": n,
        "median_ratio": round(ratios[n // 2], 3),
        "p5_ratio": round(ratios[int(0.05 * n)], 3),
        "p95_ratio": round(ratios[int(0.95 * n)], 3),
        "share_within_25pct": round(sum(0.8 <= r <= 1.25 for r in ratios) / n, 3),
    }
