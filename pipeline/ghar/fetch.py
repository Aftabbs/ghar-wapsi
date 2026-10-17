"""Download the raw inputs into data/raw. Safe to rerun: existing files are kept."""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parents[2] / "data" / "raw"
USER_AGENT = "ghar-wapsi-pipeline/0.1 (+https://github.com/Aftabbs/ghar-wapsi)"

DATAMEET_RAILWAYS = "https://raw.githubusercontent.com/datameet/railways/master/"
DATAMEET_MAPS = "https://raw.githubusercontent.com/datameet/maps/master/"

SOURCES = {
    "stations.json": DATAMEET_RAILWAYS + "stations.json",
    "trains.json": DATAMEET_RAILWAYS + "trains.json",
    "schedules.json": DATAMEET_RAILWAYS + "schedules.json",
    "india-soi.geojson": DATAMEET_MAPS + "Country/india-soi.geojson",
    "states.geojson": DATAMEET_MAPS + "docs/data/geojson/states.geojson",
    "districts-2011.geojson": DATAMEET_MAPS + "docs/data/geojson/dists11.geojson",
}

OVERPASS_MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
OSM_STATIONS_QUERY = """
[out:json][timeout:180];
area["ISO3166-1"="IN"]->.india;
node["railway"="station"]["ref"](area.india);
out;
"""


def _get(url: str, data: bytes | None = None) -> bytes:
    request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


def fetch_osm_stations(target: Path) -> None:
    body = urllib.parse.urlencode({"data": OSM_STATIONS_QUERY}).encode()
    payload = None
    for attempt, mirror in enumerate(OVERPASS_MIRRORS * 2):
        try:
            payload = json.loads(_get(mirror, body))
            break
        except (OSError, ValueError) as err:  # HTTP errors, dropped connections, bad JSON
            print(f"       {mirror} failed ({err}); retrying")
            time.sleep(5 * (attempt + 1))
    if payload is None:
        raise RuntimeError("every Overpass mirror failed")
    stations = [
        {
            "ref": el["tags"]["ref"],
            "name": el["tags"].get("name"),
            "lat": el["lat"],
            "lon": el["lon"],
            "osm_id": el["id"],
            # Metro and monorail stations share the ref tag; keep what we need to drop them.
            "station": el["tags"].get("station"),
            "network": el["tags"].get("network"),
        }
        for el in payload["elements"]
        if "lat" in el
    ]
    if len(stations) < 5000:  # India has ~8,000 tagged stations; less means a bad response
        raise RuntimeError(f"Overpass returned only {len(stations)} stations")
    target.write_text(json.dumps(stations, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        target = RAW / name
        if target.exists():
            print(f"have   {name}")
            continue
        print(f"fetch  {name}")
        target.write_bytes(_get(url))
    osm = RAW / "osm-stations.json"
    if osm.exists():
        print("have   osm-stations.json")
    else:
        print("fetch  osm-stations.json (Overpass)")
        fetch_osm_stations(osm)
    return 0


if __name__ == "__main__":
    sys.exit(main())
