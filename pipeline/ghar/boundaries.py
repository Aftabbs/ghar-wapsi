"""Simplified state boundaries for the base map.

The DataMeet state polygons union to the Survey of India outline, so the map shows
India's official boundary. Simplification is coverage-aware, so neighbouring states
keep a shared edge with no slivers between them.
"""

from __future__ import annotations

import json
from pathlib import Path

import shapely
from shapely.geometry import mapping, shape

TOLERANCE_DEG = 0.02  # ~2 km: invisible at the national view, keeps the file small

# Spelling fixes for the DataMeet state names, so the app shows names people recognise.
STATE_NAMES = {
    "Andaman & Nicobar Island": "Andaman & Nicobar Islands",
    "Arunanchal Pradesh": "Arunachal Pradesh",
    "Dadara & Nagar Havelli": "Dadra & Nagar Haveli",
}
DECIMALS = 3


def _round(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], DECIMALS), round(coords[1], DECIMALS)]
    return [_round(c) for c in coords]


def build(raw: Path, out: Path) -> dict:
    features = json.loads((raw / "states.geojson").read_text(encoding="utf-8"))["features"]
    names = [STATE_NAMES.get(f["properties"]["ST_NM"], f["properties"]["ST_NM"]) for f in features]
    geoms = [shape(f["geometry"]).buffer(0) for f in features]
    simplified = shapely.coverage_simplify(geoms, TOLERANCE_DEG)
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": name},
                "geometry": {
                    "type": mapping(geom)["type"],
                    "coordinates": _round(mapping(geom)["coordinates"]),
                },
            }
            for name, geom in zip(names, simplified, strict=True)
            if not geom.is_empty
        ],
    }
    out.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    return {"file": out.name, "states": len(collection["features"]), "bytes": out.stat().st_size}


def current_state_locator(raw: Path):
    """Return a function mapping (lon, lat) to today's state name (post-2014 boundaries)."""
    from shapely import STRtree
    from shapely.geometry import Point

    features = json.loads((raw / "states.geojson").read_text(encoding="utf-8"))["features"]
    names = [STATE_NAMES.get(f["properties"]["ST_NM"], f["properties"]["ST_NM"]) for f in features]
    geoms = [shape(f["geometry"]).buffer(0) for f in features]
    tree = STRtree(geoms)

    def locate(lon: float, lat: float) -> str | None:
        point = Point(lon, lat)
        hits = tree.query(point, predicate="intersects")
        index = int(hits[0]) if len(hits) else int(tree.nearest(point))
        return names[index]

    return locate
