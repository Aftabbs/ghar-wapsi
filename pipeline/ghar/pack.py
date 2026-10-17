"""Pack trips into a compact binary the web app can hand straight to deck.gl.

Layout (little-endian), version 1:
    char[4]  magic "GWT1"
    u32      trip count T
    u32      point count P
    f32[4]   bbox: min lon, min lat, max lon, max lat
    i32      time base (minutes)
    u32      time units per minute
    u32[T+1] index of each trip's first point (last entry = P)
    u16[T]   train index into the metadata JSON
    u16[2P]  positions, quantised over the bbox
    u16[P]   times: (minute - base) * units
Positions quantised to 16 bits over India's extent are accurate to ~50 m, which is
far finer than a pixel at any zoom the app allows.
"""

from __future__ import annotations

import struct
from pathlib import Path

from .geo import haversine_km
from .trains import WINDOW, Trip, loop_copies

MAGIC = b"GWT1"
BBOX = (68.0, 6.0, 98.0, 38.0)  # covers the Survey of India boundary with margin
TIME_UNITS = 2  # half-minute resolution keeps respaced stops distinct
TRAIL_MARGIN_MIN = 180  # longest trail the app draws; points older than this are cut
QMAX = 65535
SIMPLIFY_KM = 2.0  # under a pixel at the national view, ~4 px at city zoom


def _trim(points: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
    """Keep only the part of a copy that can be visible inside the window."""
    lo, hi = WINDOW[0] - TRAIL_MARGIN_MIN, WINDOW[1]
    first = 0
    while first + 1 < len(points) and points[first + 1][2] < lo:
        first += 1
    last = len(points) - 1
    while last - 1 > first and points[last - 1][2] > hi:
        last -= 1
    return points[first : last + 1]


def _sync_error_km(a, p, b) -> float:
    """How far the drawn train (moving a -> b at steady speed) is from stop p at p's time."""
    span = b[2] - a[2]
    frac = (p[2] - a[2]) / span if span > 0 else 0.0
    lon = a[0] + (b[0] - a[0]) * frac
    lat = a[1] + (b[1] - a[1]) * frac
    return haversine_km(lon, lat, p[0], p[1])


def simplify(
    points: list[tuple[float, float, float]], tolerance_km: float = SIMPLIFY_KM
) -> list[tuple[float, float, float]]:
    """Douglas-Peucker on synchronised distance.

    Every dropped stop stays within `tolerance_km` of where the animation draws the
    train at the minute it was scheduled there, so both position and timing survive.
    """
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        worst, worst_at = 0.0, -1
        for i in range(start + 1, end):
            err = _sync_error_km(points[start], points[i], points[end])
            if err > worst:
                worst, worst_at = err, i
        if worst > tolerance_km:
            keep[worst_at] = True
            stack.append((start, worst_at))
            stack.append((worst_at, end))
    return [pt for pt, k in zip(points, keep, strict=True) if k]


def _quantise(value: float, low: float, high: float) -> int:
    return max(0, min(QMAX, round((value - low) / (high - low) * QMAX)))


def pack(trips: list[Trip], train_ids: dict[str, int], path: Path) -> dict:
    segments: list[tuple[int, list[tuple[float, float, float]]]] = []
    for trip in trips:
        for copy in loop_copies(trip):
            trimmed = _trim(simplify(copy))
            if len(trimmed) >= 2:
                segments.append((train_ids[trip.number], trimmed))

    base = int(min(p[2] for _, pts in segments for p in pts)) - 1
    top = max(p[2] for _, pts in segments for p in pts)
    if (top - base) * TIME_UNITS > QMAX:
        raise ValueError("time range does not fit in 16 bits")

    starts, train_index, positions, times = [0], [], [], []
    min_lon, min_lat, max_lon, max_lat = BBOX
    for train, points in segments:
        train_index.append(train)
        for lon, lat, minute in points:
            positions.append(_quantise(lon, min_lon, max_lon))
            positions.append(_quantise(lat, min_lat, max_lat))
            times.append(round((minute - base) * TIME_UNITS))
        starts.append(len(times))

    trip_count, point_count = len(segments), len(times)
    with path.open("wb") as out:
        out.write(MAGIC)
        out.write(struct.pack("<II", trip_count, point_count))
        out.write(struct.pack("<4f", *BBOX))
        out.write(struct.pack("<iI", base, TIME_UNITS))
        out.write(struct.pack(f"<{trip_count + 1}I", *starts))
        out.write(struct.pack(f"<{trip_count}H", *train_index))
        if trip_count % 2:  # keep the u16 arrays 4-byte aligned for typed-array views
            out.write(b"\0\0")
        out.write(struct.pack(f"<{2 * point_count}H", *positions))
        out.write(struct.pack(f"<{point_count}H", *times))
    return {
        "file": path.name,
        "trips": trip_count,
        "points": point_count,
        "bytes": path.stat().st_size,
        "time_base": base,
    }


def unpack(path: Path) -> dict:
    """Read a packed file back; used by tests and the stats report."""
    data = path.read_bytes()
    if data[:4] != MAGIC:
        raise ValueError("not a GWT1 file")
    trip_count, point_count = struct.unpack_from("<II", data, 4)
    bbox = struct.unpack_from("<4f", data, 12)
    base, units = struct.unpack_from("<iI", data, 28)
    offset = 36
    starts = struct.unpack_from(f"<{trip_count + 1}I", data, offset)
    offset += 4 * (trip_count + 1)
    train_index = struct.unpack_from(f"<{trip_count}H", data, offset)
    offset += 2 * trip_count + (2 if trip_count % 2 else 0)
    positions = struct.unpack_from(f"<{2 * point_count}H", data, offset)
    offset += 4 * point_count
    times = struct.unpack_from(f"<{point_count}H", data, offset)
    min_lon, min_lat, max_lon, max_lat = bbox
    trips = []
    for t in range(trip_count):
        pts = []
        for i in range(starts[t], starts[t + 1]):
            lon = min_lon + positions[2 * i] / QMAX * (max_lon - min_lon)
            lat = min_lat + positions[2 * i + 1] / QMAX * (max_lat - min_lat)
            pts.append((lon, lat, base + times[i] / units))
        trips.append((train_index[t], pts))
    return {"bbox": bbox, "trips": trips}
