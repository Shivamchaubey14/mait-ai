"""
Pregnancy diagnosis, read the way an admin reads it.

The app's screens answer a Mait's question — which yard do I walk to next. An admin's question
is a different one: *is anybody's round being dropped*, and *is any of this working*. So the
rollups here are by Mait rather than by animal, and the headline figure is conception rate,
which is the number this platform is ultimately judged on and cannot be computed from AI
events alone.

The arithmetic lives here rather than in a view because three screens show it — the pregnancy
oversight table, its per-Mait drill-down, and the dashboard tile. A figure computed three
times is a figure that starts disagreeing with itself the first time one of them is edited.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from django.db.models import Count, Q, QuerySet

from .models import ALERT_WINDOW_DAYS, PregnancyCheck


@dataclass
class Rate:
    """Conceived out of settled. Kept as the pair, so a percentage always says what it is of."""

    conceived: int = 0
    decided: int = 0

    @property
    def percent(self) -> float | None:
        # None rather than zero when nothing has settled yet. A rate of 0.0% is a platform
        # that is failing; no rate at all is a platform whose first checks are not due yet,
        # and a screen that renders them the same way is a screen that raises a false alarm
        # in its first ninety days.
        if not self.decided:
            return None
        return round(self.conceived / self.decided * 100, 1)

    def as_dict(self) -> dict:
        return {
            "conception_rate": self.percent,
            "conceived": self.conceived,
            "decided": self.decided,
        }


def _per_insemination(checks: QuerySet[PregnancyCheck]):
    """
    Roll checks up to one row per insemination.

    The chain is the unit, not the check. An unsure result books a recheck three weeks out,
    and an event whose second check came back pregnant did not fail — counting checks would
    score that insemination as half a failure and quietly depress every rate on the screen.
    """
    return (
        checks.values("ai_event_id", "mait_id")
        .annotate(
            pregnant=Count("id", filter=Q(outcome=PregnancyCheck.Outcome.PREGNANT)),
            still_open=Count("id", filter=Q(outcome="")),
        )
        .order_by()
    )


def rates_by_mait(checks: QuerySet[PregnancyCheck] | None = None) -> tuple[dict[int, Rate], Rate]:
    """
    Conception rate per Mait, and across the whole field.

    An insemination counts as **settled** once it can no longer change: either something on
    its chain came back pregnant, or every check on it has been recorded and none booked
    another. An event still carrying an open check is left out of both halves of the fraction
    rather than counted as a failure — the visit has not happened, and scoring it as a failure
    would mean a Mait improved their own rate by staying at home.

    Rolled up in Python from one grouped query. The second aggregation — over the first
    group-by rather than over the table — needs a subquery the ORM will not express without
    losing the filter, and this is a back-office screen reading one small row per completed
    insemination, not a hot path.
    """
    rows = _per_insemination(checks if checks is not None else PregnancyCheck.objects.all())

    per_mait: dict[int, Rate] = defaultdict(Rate)
    overall = Rate()

    for row in rows:
        conceived = row["pregnant"] > 0
        # A pregnant result settles the insemination whatever else is on the chain: the
        # recheck an earlier unsure booked is the visit that produced this answer.
        if not (conceived or row["still_open"] == 0):
            continue

        rate = per_mait[row["mait_id"]]
        rate.decided += 1
        overall.decided += 1
        if conceived:
            rate.conceived += 1
            overall.conceived += 1

    return dict(per_mait), overall


def counts_by_mait(today: date, checks: QuerySet[PregnancyCheck] | None = None) -> dict[int, dict]:
    """
    What each Mait owes and what they have recorded.

    `due_this_week` counts the overdue ones too, exactly as the app's own list does — the
    window is "everything open that falls on or before the end of the week ahead", and an
    overdue check has certainly done that. Two surfaces using one word for two populations is
    how a Mait and an admin end up arguing about which number is wrong.
    """
    base = checks if checks is not None else PregnancyCheck.objects.all()
    horizon = today + timedelta(days=ALERT_WINDOW_DAYS)

    rows = (
        base.values("mait_id")
        .annotate(
            open=Count("id", filter=Q(outcome="")),
            overdue=Count("id", filter=Q(outcome="", due_on__lt=today)),
            due_this_week=Count("id", filter=Q(outcome="", due_on__lte=horizon)),
            recorded=Count("id", filter=~Q(outcome="")),
            pregnant=Count("id", filter=Q(outcome=PregnancyCheck.Outcome.PREGNANT)),
            not_pregnant=Count("id", filter=Q(outcome=PregnancyCheck.Outcome.NOT_PREGNANT)),
            unsure=Count("id", filter=Q(outcome=PregnancyCheck.Outcome.UNSURE)),
        )
        .order_by()
    )

    return {row.pop("mait_id"): row for row in rows}


def empty_counts() -> dict:
    """A Mait with no checks at all. Written out rather than left missing — see the view."""
    return {
        "open": 0,
        "overdue": 0,
        "due_this_week": 0,
        "recorded": 0,
        "pregnant": 0,
        "not_pregnant": 0,
        "unsure": 0,
    }
