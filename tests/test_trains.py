from collections import Counter

from ghar.trains import DAY, WINDOW, Trip, _strictly_increasing, loop_copies


def test_same_minute_stops_are_spread_until_strictly_increasing():
    points = [[0, 0, 10.0], [1, 0, 10.0], [2, 0, 10.0], [3, 0, 16.0]]
    _strictly_increasing(points, Counter())
    times = [p[2] for p in points]
    assert times == [10.0, 12.0, 14.0, 16.0]


def trip(start, end):
    return Trip("1", "t", "A", "B", "Exp", 1000, [(70, 20, start), (80, 25, end)])


def test_daytime_train_appears_once():
    assert len(loop_copies(trip(DAY + 600, DAY + 900))) == 1


def test_overnight_train_appears_on_both_clock_days():
    copies = loop_copies(trip(DAY + 22 * 60, DAY + 30 * 60))  # 22:00 -> 06:00 next day
    assert len(copies) == 2
    for copy in copies:
        assert copy[0][2] < WINDOW[1] and copy[-1][2] > WINDOW[0]


def test_two_day_train_is_on_screen_at_every_minute_it_runs():
    t = trip(0, 50 * 60)
    copies = loop_copies(t)
    for minute in range(WINDOW[0], WINDOW[1], 15):
        assert any(c[0][2] <= minute <= c[-1][2] for c in copies)


def test_all_caps_train_names_are_tidied_but_abbreviations_kept():
    from ghar.trains import tidy_name

    assert tidy_name("MYSORE - DARBHANGA BAGMATI SF Exp") == "Mysore - Darbhanga Bagmati SF Exp"
    assert tidy_name("MUMBAI LTT - CHHAPRA Godan Exp") == "Mumbai LTT - Chhapra Godan Exp"
    assert tidy_name("Howrah-New Delhi Rajdhani Express") == "Howrah-New Delhi Rajdhani Express"


def test_hyphenated_line_breaks_are_rejoined():
    from ghar.trains import tidy_name

    assert tidy_name("New Delhi Kan- pur Shatabdi Express") == "New Delhi Kanpur Shatabdi Express"
    assert tidy_name("Mumbai LTT - Chhapra Godan Exp") == "Mumbai LTT - Chhapra Godan Exp"
