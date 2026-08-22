"""
Ordering a morning's checks.

The route is the difference between a Mait doing six checks and doing four: sorted by due
date, a round crosses the same villages twice and the far ones get dropped — and the far ones
are the ones already late.

The test that matters is the first: a route was being handed out that was eighteen per cent
longer than the data supported, because "nearest next" grabs the two closest stops and then
has to ride back past a cluster it walked through. On a morning that is a real hour.
"""

from __future__ import annotations

import itertools

import pytest

from apps.pregnancy.route import (
    EXACT_UP_TO,
    haversine_km,
    late_first,
    minutes_for,
    road_km,
    shortest_first,
)

pytestmark = pytest.mark.django_db


class FakeEvent:
    def __init__(self, lat, lng):
        self.gps_lat = lat
        self.gps_lng = lng


class FakeCheck:
    """Enough of a check to be ordered. The real one carries far more that routing ignores."""

    def __init__(self, name, lat, lng, days=5):
        self.name = name
        self.ai_event = FakeEvent(lat, lng)
        self._days = days

    def days_until(self):
        return self._days

    def __repr__(self):
        return self.name


# Five real places around Ayodhya: two out west, and a tight cluster by the river.
AYODHYA = [
    FakeCheck("Ram Mandir", 26.7956, 82.1943, days=-9),
    FakeCheck("Hanuman Garhi", 26.7955, 82.1932, days=-2),
    FakeCheck("Ram Ki Paidi", 26.7975, 82.1870, days=0),
    FakeCheck("Naka", 26.7710, 82.1490, days=1),
    FakeCheck("Bypass", 26.7620, 82.1200, days=4),
]
STATION = (26.7900, 82.1300)


def total_of(stops):
    return round(sum(s.leg_km for s in stops), 1)


def test_the_shortest_round_is_actually_the_shortest():
    # The bug this closes. Greedy returned 19.4 km on this data where 16.0 was available —
    # it took the two nearest stops first, then rode ten kilometres back to the cluster.
    ordered = shortest_first(STATION, AYODHYA)

    best = min(
        itertools.permutations(AYODHYA),
        key=lambda order: sum(
            haversine_km(a, b)
            for a, b in zip(
                [STATION] + [(c.ai_event.gps_lat, c.ai_event.gps_lng) for c in order],
                [(c.ai_event.gps_lat, c.ai_event.gps_lng) for c in order],
                strict=False,
            )
        ),
    )
    best_km = round(
        sum(
            road_km(a, b)
            for a, b in zip(
                [STATION] + [(c.ai_event.gps_lat, c.ai_event.gps_lng) for c in best],
                [(c.ai_event.gps_lat, c.ai_event.gps_lng) for c in best],
                strict=False,
            )
        ),
        1,
    )

    assert total_of(ordered) == pytest.approx(best_km, abs=0.2)


def test_it_keeps_a_cluster_together():
    # Three stops within a kilometre of each other must not be split by a ride out and back.
    ordered = shortest_first(STATION, AYODHYA)
    names = [s.check.name for s in ordered]
    cluster = ["Ram Ki Paidi", "Hanuman Garhi", "Ram Mandir"]
    positions = sorted(names.index(n) for n in cluster)

    assert positions == list(range(positions[0], positions[0] + 3))


def test_every_stop_is_visited_exactly_once():
    ordered = shortest_first(STATION, AYODHYA)
    assert sorted(s.check.name for s in ordered) == sorted(c.name for c in AYODHYA)


def test_a_check_with_no_position_goes_last_rather_than_first():
    # It cannot be placed. Putting it first would order the round by which records happen to
    # carry a location.
    nowhere = FakeCheck("No fix", None, None)
    ordered = shortest_first(STATION, [*AYODHYA, nowhere])

    assert ordered[-1].check.name == "No fix"


def test_late_first_puts_the_overdue_ones_first_and_costs_more():
    late = late_first(STATION, AYODHYA)
    short = shortest_first(STATION, AYODHYA)

    assert [s.check.name for s in late][:2] == ["Ram Mandir", "Hanuman Garhi"] or [
        s.check.name for s in late
    ][:2] == ["Hanuman Garhi", "Ram Mandir"]
    # Longer is the whole point of offering it as a choice rather than picking for somebody.
    assert total_of(late) >= total_of(short)


def test_a_round_with_no_start_still_orders():
    # No GPS fix in a yard with no sky. The round is ordered from the first stop instead.
    ordered = shortest_first(None, AYODHYA)
    assert len(ordered) == len(AYODHYA)


def test_the_estimate_includes_the_checks_not_just_the_riding():
    # Four stops is two hours of examinations before anybody has ridden anywhere.
    assert minutes_for(0, 4) == 120
    assert minutes_for(20, 0) == 60


def test_the_exact_path_is_only_taken_where_it_is_free():
    # Named so the threshold is a decision rather than an accident. Nine stops falls to the
    # greedy-plus-2-opt path, and must still return every stop.
    many = [FakeCheck(f"s{i}", 26.75 + i * 0.01, 82.10 + i * 0.01) for i in range(EXACT_UP_TO + 1)]
    ordered = shortest_first(STATION, many)

    assert len(ordered) == EXACT_UP_TO + 1
