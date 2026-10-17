from collections import Counter

from ghar.trains import DAY, WINDOW, Trip, _stop_times, _strictly_increasing, loop_copies


def row(code, arrival, departure, day=1):
    return {"station_code": code, "arrival": arrival, "departure": departure, "day": day}


def test_midnight_crossing_adds_a_day():
    rows = [row("A", "None", "23:30:00"), row("B", "00:20:00", "00:25:00", day=None)]
    stops = _stop_times(rows, Counter())
    assert stops == [("A", None, 23 * 60 + 30), ("B", DAY + 20, DAY + 25)]


def test_dwell_across_midnight_within_one_stop():
    stops = _stop_times([row("A", "23:55:00", "00:05:00")], Counter())
    assert stops == [("A", 23 * 60 + 55, DAY + 5)]


def test_repeated_row_after_reversal_is_dropped():
    # The 2016 scrape repeats BBQ after MAS when the train reverses out of Chennai.
    rows = [
        row("BBQ", "15:03:00", "15:03:00"),
        row("MAS", "15:05:00", "15:40:00"),
        row("BBQ", "15:03:00", "15:03:00"),
        row("KOK", "15:44:00", "15:44:00"),
    ]
    report = Counter()
    stops = _stop_times(rows, report)
    assert [s[0] for s in stops] == ["BBQ", "MAS", "KOK"]
    assert report["stops_dropped_out_of_order"] == 1


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
