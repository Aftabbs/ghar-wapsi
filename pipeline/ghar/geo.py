"""Geography helpers: Census 2011 district lookup and distances."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from shapely import STRtree
from shapely.geometry import Point, shape

EARTH_RADIUS_KM = 6371.0088
COASTAL_TOLERANCE_DEG = 0.05  # ~5 km; enough for coastline simplification, not for Bangladesh


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


@dataclass(frozen=True)
class District:
    census_code: int  # Census 2011 district code (matches the D-series tables)
    name: str
    state: str  # Census 2011 state name (pre-Telangana boundaries)
    state_code: int
    centroid: tuple[float, float]  # lon, lat


class DistrictIndex:
    """Point-in-polygon lookup against the Census 2011 district boundaries."""

    def __init__(self, geojson_path: Path) -> None:
        features = json.loads(geojson_path.read_text(encoding="utf-8"))["features"]
        self._geoms = []
        self.districts: list[District] = []
        for feature in features:
            props = feature["properties"]
            geom = shape(feature["geometry"])
            self._geoms.append(geom)
            c = geom.representative_point()
            self.districts.append(
                District(
                    census_code=int(props["censuscode"]),
                    name=props["DISTRICT"],
                    state=props["ST_NM"],
                    state_code=int(props["ST_CEN_CD"]),
                    centroid=(c.x, c.y),
                )
            )
        self._tree = STRtree(self._geoms)

    def locate(self, lon: float, lat: float) -> District | None:
        point = Point(lon, lat)
        for i in self._tree.query(point, predicate="intersects"):
            return self.districts[int(i)]
        # Coastal stations can fall just outside the simplified district outlines.
        nearest = int(self._tree.nearest(point))
        if self._geoms[nearest].distance(point) <= COASTAL_TOLERANCE_DEG:
            return self.districts[nearest]
        return None
