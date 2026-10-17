from itertools import pairwise

from ghar.geo import haversine_km
from ghar.pack import SIMPLIFY_KM, _sync_error_km, pack, simplify, unpack
from ghar.trains import DAY, Trip


def test_simplify_keeps_every_stop_within_tolerance():
    # A train that runs straight, stops for 20 minutes, then turns.
    points = [(77.0 + i * 0.05, 13.0, DAY + i * 5.0) for i in range(20)]
    points += [(points[-1][0], 13.0, points[-1][2] + 20)]
    points += [(points[-1][0], 13.0 + i * 0.05, points[-1][2] + i * 5.0) for i in range(1, 20)]
    kept = simplify(points)
    assert len(kept) < len(points)
    for p in points:
        # Find the kept segment covering p's time and check the drawn position.
        for a, b in pairwise(kept):
            if a[2] <= p[2] <= b[2]:
                assert _sync_error_km(a, p, b) <= SIMPLIFY_KM + 1e-9
                break


def test_simplify_keeps_a_long_halt():
    points = [(77.0, 13.0, 0.0), (77.5, 13.0, 30.0), (77.5, 13.0, 90.0), (78.0, 13.0, 120.0)]
    assert len(simplify(points)) == 4


def test_pack_round_trip(tmp_path):
    trips = [
        Trip(
            "12295",
            "Sanghamitra",
            "SBC",
            "PPTA",
            "SF",
            2700,
            [(77.57, 12.97, DAY + 540.0), (80.27, 13.08, DAY + 905.0), (85.1, 25.6, DAY + 3420.0)],
        ),
        Trip(
            "12301",
            "Rajdhani",
            "HWH",
            "NDLS",
            "Raj",
            1450,
            [(88.34, 22.58, DAY + 1010.0), (77.22, 28.64, DAY + 2030.0)],
        ),
    ]
    path = tmp_path / "t.bin"
    info = pack(trips, {"12295": 0, "12301": 1}, path)
    data = unpack(path)
    assert info["trips"] == len(data["trips"]) > 0
    for train, pts in data["trips"]:
        source = trips[train].points
        # Each decoded copy is the source trip shifted by a whole number of days.
        shift = round((pts[0][2] - source[0][2]) / DAY) * DAY
        decoded = {round(t - shift) for _, _, t in pts}
        assert decoded <= {round(t) for _, _, t in source}
        for lon, lat, t in pts:
            match = min(source, key=lambda s: abs(s[2] + shift - t))
            assert abs(match[2] + shift - t) <= 0.5
            assert haversine_km(lon, lat, match[0], match[1]) < 0.1
