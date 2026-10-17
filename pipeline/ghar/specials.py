"""2026 festival specials from data/specials/specials-2026.csv.

Each row was transcribed from an official Indian Railways notice (source_url). Rows
are validated here; anything that fails is reported, never silently fixed.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from .geo import haversine_km

TIME = re.compile(r"^\d{2}:\d{2}$")
DATE = re.compile(r"^2026-\d{2}-\d{2}$")
# "Specific dates" means the notice lists dates rather than weekdays (see the row notes).
DAYS = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Daily", "Specific dates"}


def build(csv_path: Path, stations: dict[str, dict]) -> tuple[list[dict], dict]:
    rows = list(csv.DictReader(csv_path.open(encoding="utf-8")))
    out, problems = [], []
    for row in rows:
        number = row["train_number"].strip()
        issues = []
        origin, dest = stations.get(row["from_code"].strip()), stations.get(row["to_code"].strip())
        if not origin:
            issues.append(f"unknown origin code {row['from_code']}")
        if not dest:
            issues.append(f"unknown destination code {row['to_code']}")
        if (
            not row["source_url"].startswith("https://")
            or "indianrailways.gov.in" not in (row["source_url"])
        ):
            issues.append("source is not an official indianrailways.gov.in page")
        days = [d.strip() for d in row["run_days"].split(",") if d.strip()]
        if days and not set(days) <= DAYS:
            issues.append(f"bad run_days {row['run_days']}")
        for field in ("first_run", "last_run"):
            if row[field] and not DATE.match(row[field]):
                issues.append(f"bad {field} {row[field]}")
        timed = bool(TIME.match(row["departure_time"]) and TIME.match(row["arrival_time"]))
        if issues:
            problems.append({"train": number, "issues": issues})
            continue

        hours = None
        if timed and row["arrival_day_offset"].strip().isdigit():
            dh, dm = map(int, row["departure_time"].split(":"))
            ah, am = map(int, row["arrival_time"].split(":"))
            minutes = int(row["arrival_day_offset"]) * 1440 + ah * 60 + am - (dh * 60 + dm)
            km = haversine_km(origin["lon"], origin["lat"], dest["lon"], dest["lat"])
            if minutes <= 0 or km / (minutes / 60) > 130:
                problems.append({"train": number, "issues": [f"implausible journey {minutes} min"]})
                continue
            hours = round(minutes / 60, 1)

        out.append(
            {
                "n": number,
                "name": row["name"].strip(),
                "o": row["from_code"].strip(),
                "d": row["to_code"].strip(),
                "oState": origin["state"],
                "dState": dest["state"],
                "oDistrict": origin.get("district"),
                "dDistrict": dest.get("district"),
                "from": [origin["lon"], origin["lat"]],
                "to": [dest["lon"], dest["lat"]],
                "dep": row["departure_time"] or None,
                "hours": hours,
                "days": days,
                "first": row["first_run"] or None,
                "last": row["last_run"] or None,
                "source": row["source_url"],
                "verified": row["verified_on"],
            }
        )

    report = {
        "rows_in": len(rows),
        "rows_out": len(out),
        "with_journey_time": sum(s["hours"] is not None for s in out),
        "problems": problems,
    }
    return out, report


def write(specials: list[dict], path: Path) -> dict:
    path.write_text(
        json.dumps(specials, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    return {"file": path.name, "specials": len(specials), "bytes": path.stat().st_size}
