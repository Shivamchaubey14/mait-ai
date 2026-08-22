"""
Ordering a morning's pregnancy checks.

A Mait with six checks scattered across three villages does not want a list sorted by date —
they want to know which way to walk. Sorted by due date, a round can send somebody to
Nandgaon, back to Barsana and out to Nandgaon again in one morning, and the checks that get
dropped are the ones at the far end.

**These are straight-line distances, and the app says so.** There is no routing service
configured for this platform and no road geometry to ask, so the figures here are
as-the-crow-flies between the points the inseminations were captured at. On village roads the
real distance is commonly a third longer again and occasionally double, where a river or a
canal has to be gone around. That is good enough to *order* stops — the nearest one is almost
always still the nearest — and not good enough to quote as a distance without saying what it
is. When a routing service is added, only `leg_km` changes; the ordering below does not.

**The stop is where the animal was served**, taken off the AI event's own GPS stamp. MPPs
carry no coordinates, and a village centroid would put four animals in one place anyway.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass

#: Village roads, a motorbike, and gates to open. An estimate, and named so it can be argued
#: with rather than found inside a formula.
ROAD_SPEED_KMPH = 20.0

#: How long a check itself takes — the walk to the animal, the examination, the recording,
#: and the conversation with the farmer that always follows.
MINUTES_PER_CHECK = 30

#: What the straight line under-reports by on this terrain. Applied so the figure shown is at
#: least honest about being an estimate rather than confidently short.
ROAD_WINDING_FACTOR = 1.35

EARTH_RADIUS_KM = 6371.0


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance between two (lat, lng) points, in kilometres."""
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def road_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """The straight line, scaled for the fact that roads are not straight."""
    return round(haversine_km(a, b) * ROAD_WINDING_FACTOR, 1)


@dataclass
class Stop:
    check: object
    point: tuple[float, float] | None
    leg_km: float = 0.0


def _point(check) -> tuple[float, float] | None:
    event = check.ai_event
    if event.gps_lat is None or event.gps_lng is None:
        return None
    return (float(event.gps_lat), float(event.gps_lng))


def _walk(start: tuple[float, float] | None, stops: list[Stop]) -> float:
    """Fill in each leg from the one before, and hand back the total."""
    total = 0.0
    here = start
    for stop in stops:
        if here is not None and stop.point is not None:
            stop.leg_km = road_km(here, stop.point)
            total += stop.leg_km
        else:
            stop.leg_km = 0.0
        if stop.point is not None:
            here = stop.point
    return round(total, 1)


#: Above this many stops the exact answer stops being free. A Mait's week rarely reaches it;
#: past it the greedy walk is improved by 2-opt instead, which gets most of the way.
EXACT_UP_TO = 8


def _length(start: tuple[float, float] | None, points: list[tuple[float, float]]) -> float:
    total = 0.0
    here = start
    for point in points:
        if here is not None:
            total += haversine_km(here, point)
        here = point
    return total


def _greedy(start: tuple[float, float] | None, stops: list[Stop]) -> list[Stop]:
    """Nearest next, every time. A decent start and a poor finish — see below."""
    ordered: list[Stop] = []
    here = start
    remaining = stops[:]
    while remaining:
        if here is None:
            nearest = remaining[0]
        else:
            nearest = min(remaining, key=lambda s: haversine_km(here, s.point))  # type: ignore[arg-type]
        remaining.remove(nearest)
        ordered.append(nearest)
        here = nearest.point
    return ordered


def _two_opt(start: tuple[float, float] | None, stops: list[Stop]) -> list[Stop]:
    """
    Untangle a route by reversing any stretch that crosses itself.

    What greedy leaves behind. Repeated until nothing improves, which on a dozen stops is a
    handful of passes.
    """
    best = stops[:]
    best_len = _length(start, [s.point for s in best])  # type: ignore[misc]
    improved = True
    while improved:
        improved = False
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                candidate = best[:i] + best[i : j + 1][::-1] + best[j + 1 :]
                length = _length(start, [s.point for s in candidate])  # type: ignore[misc]
                if length < best_len - 1e-9:
                    best, best_len, improved = candidate, length, True
    return best


def shortest_first(start: tuple[float, float] | None, checks: list) -> list[Stop]:
    """
    The shortest round, actually shortest.

    This was a plain greedy walk — nearest next, every time — on the reasoning that an exact
    answer over approximate inputs was precision nobody had earned. That was wrong, and
    measurably: on five stops around Ayodhya greedy returned 19.4 km where 16.0 was available,
    because it grabbed the two nearest stops first and then had to ride ten kilometres back to
    a cluster it had walked past. Eighteen per cent of a morning, given away to save
    microseconds. The inputs being rough is a reason to say so on screen, not a reason to hand
    somebody a worse route than the data supports.

    So: exact for the number of stops a week actually holds, and greedy improved by 2-opt
    above that. Both are instant at this size.

    Stops with no fix go last, in due order. They cannot be placed, and putting them first
    would sort the round by the accident of which records happen to carry a location.
    """
    located = [Stop(check=c, point=_point(c)) for c in checks if _point(c) is not None]
    unlocated = [Stop(check=c, point=None) for c in checks if _point(c) is None]

    if not located:
        ordered = unlocated
    elif len(located) <= EXACT_UP_TO:
        ordered = list(
            min(
                itertools.permutations(located),
                key=lambda order: _length(start, [s.point for s in order]),  # type: ignore[misc]
            )
        )
        ordered.extend(unlocated)
    else:
        ordered = _two_opt(start, _greedy(start, located))
        ordered.extend(unlocated)

    _walk(start, ordered)
    return ordered


def late_first(start: tuple[float, float] | None, checks: list) -> list[Stop]:
    """
    The overdue ones first, then the nearest of the rest.

    Longer, always — that is the point of offering it as a choice rather than picking for
    somebody. A check three weeks late is a farmer who has been waiting and an animal that
    may have been open all that time, and a Mait may judge that worth the extra distance.
    The screen shows both totals and lets them decide.
    """
    overdue = [c for c in checks if c.days_until() < 0]
    rest = [c for c in checks if c.days_until() >= 0]

    ordered = shortest_first(start, overdue)
    tail_start = ordered[-1].point if ordered and ordered[-1].point else start
    tail = shortest_first(tail_start, rest)

    combined = ordered + tail
    _walk(start, combined)
    return combined


def minutes_for(total_km: float, stop_count: int) -> int:
    """Road time plus the checks themselves. An estimate, and labelled as one on screen."""
    on_road = (total_km / ROAD_SPEED_KMPH) * 60 if ROAD_SPEED_KMPH else 0
    return int(round(on_road + stop_count * MINUTES_PER_CHECK))


def road_minutes(total_km: float) -> int:
    """Just the riding, for the screen that compares two orders."""
    return int(round((total_km / ROAD_SPEED_KMPH) * 60)) if ROAD_SPEED_KMPH else 0
