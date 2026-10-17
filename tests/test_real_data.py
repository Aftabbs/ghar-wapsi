"""Checks against the real downloads. Skipped when data/raw has not been fetched."""

from pathlib import Path

import pytest

from ghar import stations, trains

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
pytestmark = pytest.mark.skipif(
    not (RAW / "schedules.json").exists(), reason="run `python -m ghar.fetch` first"
)


@pytest.fixture(scope="module")
def built():
    from ghar import tag

    gazetteer, _ = stations.build(RAW)
    rows = [{"code": s.code, "name": s.name, "lon": s.lon, "lat": s.lat} for s in gazetteer]
    index = tag.station_index(RAW / "tag2026" / "Station_Code_Index.pdf")
    parsed, report = tag.parse(RAW / "tag2026" / "tables.json", index, rows)
    trips, _ = trains.from_tag(parsed, {s.code: (s.lon, s.lat) for s in gazetteer})
    return {s.code: s for s in gazetteer}, {t.number: t for t in trips}, report


def test_new_bengaluru_terminal_is_on_the_map(built):
    by_code, _, _ = built
    smvt = by_code["SMVB"]
    assert smvt.state == "Karnataka"
    assert smvt.source == "osm"


def test_disputed_station_keeps_the_location_its_neighbours_confirm(built):
    by_code, _, _ = built
    # OSM reuses KTCR for Katlicherra (Assam); the timetable's KTCR is in Andhra.
    assert by_code["KTCR"].state == "Andhra Pradesh"


@pytest.mark.parametrize(
    ("number", "origin", "destination", "low_h", "high_h"),
    [
        ("12295", "SMVB", "DNR", 44, 50),  # Sanghamitra, Bengaluru -> Patna (Danapur)
        ("12301", "HWH", "NDLS", 16, 18),  # Howrah Rajdhani
        ("12627", "SBC", "NDLS", 36, 40),  # Karnataka Express
        ("12578", "MYS", "DBG", 50, 56),  # Bagmati Express, Mysuru -> Darbhanga
    ],
)
def test_known_2026_journeys(built, number, origin, destination, low_h, high_h):
    _, trips, _ = built
    trip = trips[number]
    assert (trip.origin, trip.destination) == (origin, destination)
    assert low_h <= trip.span / 60 <= high_h


def test_most_timetable_trains_are_read(built):
    _, _, report = built
    assert report["trains_out"] >= 2500
    assert report["trains_out"] / report["trains_found"] > 0.7


def test_census_flows_match_published_tables():
    from ghar import census

    data = census.parse(RAW / "census-d02")
    assert data["interstate_total"] == 54_264_749
    assert data["states"]["NCT of Delhi"]["Bihar"] == 1_106_629
    bangalore = data["districts"]["572"]
    assert bangalore["name"] == "Bangalore"
    assert bangalore["from"]["Bihar"] == 65_002


def test_every_published_special_is_officially_sourced():
    import csv

    rows = list(
        csv.DictReader((RAW.parent / "specials" / "specials-2026.csv").open(encoding="utf-8"))
    )
    assert len(rows) >= 100
    assert all(".indianrailways.gov.in/" in r["source_url"] for r in rows)
    bengaluru = {"SBC", "SMVB", "YPR", "BNC", "KJM", "YNK"}
    assert sum(r["from_code"] in bengaluru for r in rows) >= 10
