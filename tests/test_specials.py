import csv
from pathlib import Path

from ghar.specials import build

HEADER = (
    "train_number,name,from_code,from_station,to_code,to_station,departure_time,arrival_time,"
    "arrival_day_offset,run_days,first_run,last_run,source_url,source_title,verified_on,notes"
)
STATIONS = {
    "SMVB": {"lon": 77.64, "lat": 13.0, "state": "Karnataka"},
    "RPAN": {"lon": 92.1, "lat": 26.8, "state": "Assam"},
}
OFFICIAL = "https://swr.indianrailways.gov.in/view_detail.jsp?id=1"


def write(tmp_path: Path, *rows: list[str]) -> Path:
    path = tmp_path / "specials.csv"
    with path.open("w", encoding="utf-8", newline="") as f:
        f.write(HEADER + "\n")
        csv.writer(f).writerows(rows)
    return path


def row(**overrides):
    base = {
        "train_number": "06559",
        "name": "SMVT-Rangapara",
        "from_code": "SMVB",
        "from_station": "SMVT",
        "to_code": "RPAN",
        "to_station": "Rangapara North",
        "departure_time": "23:40",
        "arrival_time": "06:30",
        "arrival_day_offset": "3",
        "run_days": "Tue",
        "first_run": "2026-10-20",
        "last_run": "2026-11-24",
        "source_url": OFFICIAL,
        "source_title": "SWR 290",
        "verified_on": "2026-10-17",
        "notes": "",
    }
    base.update(overrides)
    return list(base.values())


def test_official_row_is_kept_with_journey_time(tmp_path):
    specials, report = build(write(tmp_path, row()), STATIONS)
    assert report["problems"] == []
    assert specials[0]["hours"] == 54.8  # Tue 23:40 -> Fri 06:30


def test_aggregator_source_is_rejected(tmp_path):
    specials, report = build(
        write(tmp_path, row(source_url="https://railwise.in/special-trains/")), STATIONS
    )
    assert specials == []
    assert "official" in report["problems"][0]["issues"][0]


def test_unknown_station_is_reported(tmp_path):
    _, report = build(write(tmp_path, row(to_code="XXXX")), STATIONS)
    assert "unknown destination code XXXX" in report["problems"][0]["issues"]


def test_impossible_journey_time_is_rejected(tmp_path):
    _, report = build(write(tmp_path, row(arrival_day_offset="0", arrival_time="23:50")), STATIONS)
    assert "implausible" in report["problems"][0]["issues"][0]


def test_missing_times_are_kept_without_inventing_them(tmp_path):
    specials, _ = build(write(tmp_path, row(departure_time="", arrival_time="")), STATIONS)
    assert specials[0]["hours"] is None and specials[0]["dep"] is None
