"""Fares from the official tables must reproduce real IRCTC fares to the rupee."""

from pathlib import Path

import pytest

from ghar import fares

PDF = Path(__file__).resolve().parents[1] / "data" / "raw" / "tag2026" / "Fares.pdf"
pytestmark = pytest.mark.skipif(not PDF.exists(), reason="run `python -m ghar.tag_extract` first")


@pytest.fixture(scope="module")
def tables():
    return fares.parse(PDF)


@pytest.mark.parametrize(
    ("category", "cls", "km", "expected"),
    [
        # 12627 Karnataka Express, KSR Bengaluru -> New Delhi, 2,395 km (erail.in)
        ("mail_express_nonac", "SL", 2395, 930),
        ("mail_express_ac", "3A", 2395, 2325),
        ("mail_express_ac", "2A", 2395, 3335),
        ("mail_express_ac", "1A", 2395, 5620),
        # 12295 Sanghamitra Express, SMVT Bengaluru -> Danapur, 2,684 km
        ("mail_express_nonac", "SL", 2684, 995),
        ("mail_express_ac", "3A", 2684, 2470),
        ("mail_express_ac", "2A", 2684, 3550),
        ("mail_express_ac", "1A", 2684, 5985),
    ],
)
def test_mail_express_fares_match_published_fares(tables, category, cls, km, expected):
    assert fares.fare(tables, category, cls, km, superfast=True) == expected


@pytest.mark.parametrize(
    ("cls", "meals", "expected"), [("3A", 400, 2360), ("2A", 400, 3160), ("1A", 560, 5215)]
)
def test_rajdhani_fares_match_with_meals_added(tables, cls, meals, expected):
    # 12301 Howrah Rajdhani, 1,449 km; meals are charged on top of the fare.
    assert fares.fare(tables, "rajdhani", cls, 1449, superfast=True) + meals == expected


def test_no_estimate_below_the_tables_read(tables):
    assert fares.basic_fare(tables, "rajdhani", "3A", tables["rajdhani"]["from_km"] - 1) is None
