from ghar.narrate import ALL_SCENARIOS, check, fill, scenario, scenario_facts

FESTIVALS = ["Diwali", "Chhath"]
GOOD = {
    "en": "This Chhath, festival specials are running from {city} to {state}, "
    "carrying a large community home.",
    "hi": "इस छठ पर {city_hi} से {state_hi} तक त्योहार स्पेशल ट्रेनें चल रही हैं।",
}


def test_a_good_template_passes():
    assert check(GOOD, FESTIVALS) == []


def test_each_slot_must_appear_exactly_once():
    problems = check({**GOOD, "en": "Festival specials run to {state} and {state}."}, FESTIVALS)
    assert "English must use {city} exactly once" in problems
    assert "English must use {state} exactly once" in problems
    assert "unknown slot" in check({**GOOD, "hi": GOOD["hi"] + " {name}"}, FESTIVALS)


def test_numbers_and_quantity_words_are_rejected():
    assert "contains a number" in check(
        {**GOOD, "en": GOOD["en"].replace("This", "In 2026, this")}, FESTIVALS
    )
    assert "contains a number" in check({**GOOD, "hi": GOOD["hi"] + " २"}, FESTIVALS)
    assert "contains a quantity word" in check({**GOOD, "hi": GOOD["hi"] + " लाखों"}, FESTIVALS)


def test_only_listed_festivals_may_be_named():
    problems = check(GOOD, ["Diwali"])
    assert "names Chhath, which is not in the facts" in problems


def test_hindi_must_be_in_devanagari():
    latin = {**GOOD, "hi": "{city_hi} se {state_hi} tak trains chal rahi hain."}
    assert "Hindi is not mostly Devanagari" in check(latin, FESTIVALS)


def test_scenarios_cover_every_combination():
    assert len(ALL_SCENARIOS) == len(set(ALL_SCENARIOS)) == 16
    assert scenario(True, True, 65_002) == "specials=yes|chhath=yes|community=medium"
    assert scenario(False, False, 0) == "specials=no|chhath=no|community=none"
    facts = scenario_facts("specials=no|chhath=no|community=big")
    assert facts["festivals"] == ["Diwali"]
    assert "verified list" in facts["festival_specials"]
    assert not any(ch.isdigit() for value in facts.values() for ch in str(value))


def test_fill_uses_the_right_template_and_hindi_names():
    data = {
        "routes": {
            "cities": {"bengaluru": {"name": "Bengaluru", "districts": [572]}},
            "districts": {
                "572": ["Bangalore", "Karnataka", 77.6, 12.97, "Karnataka"],
                "230": ["Patna", "Bihar", 85.1, 25.6, "Bihar"],
            },
        },
        "migration": {"districts": {"572": {"from": {"Bihar": 65_002}}}},
        "specials": [{"oDistrict": 572, "dState": "Bihar"}],
    }
    templates = {"specials=yes|chhath=yes|community=medium": [GOOD]}
    cards, report = fill(data, templates, {"Bengaluru": "बेंगलुरु", "Bihar": "बिहार"})
    assert report == {"pairs": 1, "filled": 1, "missing_template": 0, "missing_hindi_name": 0}
    assert cards["bengaluru|Bihar"]["en"].startswith(
        "This Chhath, festival specials are running from Bengaluru to Bihar"
    )
    assert cards["bengaluru|Bihar"]["hi"].startswith("इस छठ पर बेंगलुरु से बिहार तक")
