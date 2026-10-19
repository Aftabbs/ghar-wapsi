from collections import Counter

from ghar.tag import Gazetteer, _absolute, _days, _split_block, _union, normalise, read_table


def test_normalise_lines_up_spellings():
    assert normalise("Katpadi Jn.") == normalise("KATPADI")
    assert normalise("Pt. Deen Dayal a Upadhyaya Jn.") == "PT DEEN DAYAL UPADHYAYA"
    assert normalise("Agra Cantt.") == "AGRA CANTONMENT"


def test_station_block_splits_flags_from_name():
    assert _split_block("a d\nBikaner\nd a") == (["a", "d"], "Bikaner", ["d", "a"])
    assert _split_block("200 Asansol") == ([], "Asansol", [])


# A left-layout page: km | station | a/d | trains, read top to bottom.
LEFT_LAYOUT = [
    ["TRAIN NAME", None, None, "Kolkata\nAmritsar\nExpress", "Kolkata\nJammu\nExpress"],
    ["Train Number", None, None, "12317", "13151"],
    ["Class of accommodation", None, None, "1A,2A", "SL,II"],
    ["Days of departure at originating\nstation", None, None, "W,Su", "Daily"],
    ["Km.", "Kolkata", "d", "07.40", "11.45"],
    ["200", "Asansol", "d", "10.26", "15.10"],
    ["271", "Dhanbad", "a\nd", "", "16.50\n16.55"],
    ["", "Days of arrival", "", "F", "Daily"],
]


def test_reads_each_train_column_with_arrival_and_departure():
    names: dict[str, str] = {}
    trains = read_table(LEFT_LAYOUT, Counter(), names)
    assert set(trains) == {"12317", "13151"}
    jammu = trains["13151"][0]
    assert [c.station for c in jammu] == ["Kolkata", "Asansol", "Dhanbad"]
    assert jammu[-1].times == [("a", 16 * 60 + 50), ("d", 16 * 60 + 55)]
    assert names["13151"] == "Kolkata Jammu Express"


def test_join_keeps_travel_order_when_segments_overlap():
    # Table 20 starts at Mysuru; table 17 spells it Mysore and continues past Bengaluru.
    a = [("Mysore", 630, 630), ("KSR Bengaluru", 830, 830), ("Jolarpettai", 1000, 1000)]
    b = [("Mysuru", 630, 630), ("Mandya", 671, 671), ("KSR Bengaluru", 820, 820)]
    merged = [s[0] for s in _union(b, a)]
    assert merged == ["Mysore", "Mysuru", "Mandya", "KSR Bengaluru", "Jolarpettai"]


def test_absolute_times_cross_midnight_and_drop_a_bad_stop():
    seq = [
        ("A", 22 * 60, 22 * 60 + 10),
        ("B", 23 * 60 + 50, 23 * 60 + 55),
        ("C", 23 * 60 + 40, 23 * 60 + 40),  # small step back: a misread stop
        ("D", 2 * 60, 2 * 60 + 5),  # next day
        ("E", 13 * 60, 13 * 60),  # long gap with no listed stops, still the next day
    ]
    report = Counter()
    out = _absolute(seq, report)
    assert [s[0] for s in out] == ["A", "B", "D", "E"]
    assert out[2][1] == 1440 + 120
    assert out[3][1] == 1440 + 13 * 60
    assert report["stops_dropped_out_of_order"] == 1


def test_swapped_arrival_and_departure_are_put_right():
    out = _absolute([("A", 154, 151), ("B", 200, 200)], Counter())
    assert out[0][1:] == (151.0, 154.0)


def test_gazetteer_matches_renamed_and_clipped_names():
    stations = [
        {"code": "SBC", "name": "BANGALORE CITY JN", "lon": 77.57, "lat": 12.98},
        {"code": "ST", "name": "SURAT", "lon": 72.84, "lat": 21.2},
        {"code": "BHP", "name": "BOLPUR SHANTINIKETAN", "lon": 87.69, "lat": 23.66},
    ]
    gazetteer = Gazetteer.build(stations, index={})
    assert gazetteer.exact("KSR Bengaluru") == ["SBC"]  # renamed station
    assert gazetteer.candidates("urat") == ["ST"]  # first letter clipped by the PDF
    assert gazetteer.candidates("Bolpur") == ["BHP"]  # shorter official name


def test_days_of_running():
    assert _days("Daily") == ["Daily"]
    assert _days("Tu, F,Su") == ["Tue", "Fri", "Sun"]
    assert _days("W,Th,\nSu") == ["Wed", "Thu", "Sun"]
    assert _days("Except W") == ["Mon", "Tue", "Thu", "Fri", "Sat", "Sun"]
    assert _days("") is None
