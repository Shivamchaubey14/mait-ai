"""
The zone as a manager opens the app to see it: what is happening, where, and by whom.

**Counted live, not off `DailyAIAggregate`.** The portal's dashboard reads the pre-aggregated
table because it answers "this month grouped by district" across the whole network against a
400ms budget. This one is a single zone over a week, which is a bounded count on an
indexed column — and reading the aggregate here would buy nothing while inheriting its one
sharp edge: the hourly job that fills it does not run on the no-Docker dev path at all, so
every figure reads zero until somebody remembers `rebuild_ai_aggregates`. A dashboard that is
silently zero is worse than one that costs a query.

Days are bucketed in Python, never with `TruncDate`: on a MySQL without timezone tables that
compiles to a `CONVERT_TZ` returning NULL, which drops every row rather than raising. See
`apps.core.timeframe`.
"""

from __future__ import annotations

from collections import Counter
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from apps.ai_events.models import AIEvent
from apps.core.timeframe import end_of_day, local_day, start_of_day

#: The trend window the app draws. A week of bars fits across a handset with the day's name
#: under each, and it is the span a manager plans their visits in.
TREND_DAYS = 7
MAX_TREND_DAYS = 90

#: How many captures the "happening" feed carries. It is a glance at the work, not a list of
#: it — the AI events screen on the portal is where a whole day is read.
RECENT = 8

#: How many rows the two "busiest" panels show.
TOP = 4


def _completed(codes: list[str] | None):
    events = AIEvent.objects.filter(status=AIEvent.Status.COMPLETED)
    if codes is not None:
        events = events.filter(mpp__plant_code__in=codes)
    return events


def _between(codes, start, end=None) -> int:
    """Completed events across a range of local days, `end` included."""
    events = _completed(codes).filter(completed_at__gte=start_of_day(start))
    if end is not None:
        events = events.filter(completed_at__lt=end_of_day(end))
    return events.count()


def trend(codes: list[str] | None, days: int) -> list[dict]:
    """
    One row per day, oldest first, so the app can draw bars without arithmetic of its own.

    Every day in the window appears, including the empty ones. A chart built only from the
    days that had work compresses a quiet week into a busy-looking line.
    """
    end = timezone.localdate()
    start = end - timedelta(days=days - 1)

    by_day: dict = {}
    for completed_at in (
        _completed(codes)
        .filter(completed_at__gte=start_of_day(start), completed_at__lt=end_of_day(end))
        .values_list("completed_at", flat=True)
    ):
        day = local_day(completed_at)
        by_day[day] = by_day.get(day, 0) + 1

    return [
        {
            "date": (start + timedelta(days=offset)).isoformat(),
            "label": (start + timedelta(days=offset)).strftime("%d %b"),
            "short_label": (start + timedelta(days=offset)).strftime("%a"),
            "completed": by_day.get(start + timedelta(days=offset), 0),
        }
        for offset in range(days)
    ]


def busiest_maits(codes: list[str] | None, since) -> list[dict]:
    """Who did the work this week. Ranked, with the share each holds of the zone's total."""
    rows = (
        _completed(codes)
        .filter(completed_at__gte=start_of_day(since))
        .values("mait_id", "mait__name", "mait__sahayak_vendor_code")
        .annotate(events=Count("id"))
        .order_by("-events", "mait__name")[:TOP]
    )
    rows = list(rows)
    most = max((row["events"] for row in rows), default=0)
    return [
        {
            "mait_id": row["mait_id"],
            "name": row["mait__name"],
            "code": row["mait__sahayak_vendor_code"] or "",
            "events": row["events"],
            # Relative to the leader rather than to a target: the villages differ by an order
            # of magnitude and there is no per-Mait quota to draw against.
            "share": round(row["events"] / most, 3) if most else 0.0,
        }
        for row in rows
    ]


def busiest_villages(codes: list[str] | None, since) -> list[dict]:
    """Where the work is happening. The collection point, which is the place a manager knows."""
    rows = list(
        _completed(codes)
        .filter(completed_at__gte=start_of_day(since))
        .values("mpp__mpp_code", "mpp__mpp_name", "mpp__plant_name")
        .annotate(events=Count("id"))
        .order_by("-events", "mpp__mpp_name")[:TOP]
    )
    most = max((row["events"] for row in rows), default=0)
    return [
        {
            "mpp_code": row["mpp__mpp_code"],
            "name": row["mpp__mpp_name"] or row["mpp__mpp_code"],
            "plant_name": row["mpp__plant_name"] or "",
            "events": row["events"],
            "share": round(row["events"] / most, 3) if most else 0.0,
        }
        for row in rows
    ]


def happening(codes: list[str] | None) -> list[dict]:
    """
    The last few captures in the zone, newest first — the feed that makes the zone feel live.

    Completed only. A half-finished capture is on somebody's handset and may yet be abandoned;
    putting it here would have a manager ring about an insemination that never happened.
    """
    rows = (
        _completed(codes).select_related("mait", "mpp", "animal").order_by("-completed_at")[:RECENT]
    )
    return [
        {
            "id": event.id,
            "mait_name": event.mait.name,
            "mait_code": event.mait.sahayak_vendor_code or "",
            "mpp_name": event.mpp.mpp_name or event.mpp.mpp_code,
            "mpp_code": event.mpp.mpp_code,
            "plant_name": event.mpp.plant_name or "",
            "breed": event.animal.breed if event.animal_id else "",
            "doses": event.doses,
            "when": event.completed_at,
        }
        for event in rows
    ]


def build(codes: list[str] | None, days: int = TREND_DAYS) -> dict:
    """Everything the manager's first screen draws, in one answer."""
    today = timezone.localdate()
    yesterday = today - timedelta(days=1)
    week_from = today - timedelta(days=6)

    series = trend(codes, days)
    best = max(series, key=lambda row: row["completed"]) if series else None

    today_count = _between(codes, today, today)
    yesterday_count = _between(codes, yesterday, yesterday)

    # Who is out working right now, as a count of distinct Maits with a completed capture
    # today. The figure a manager reads as "is the zone moving".
    working = (
        _completed(codes)
        .filter(completed_at__gte=start_of_day(today))
        .values("mait_id")
        .distinct()
        .count()
    )

    # Still on somebody's handset, or waiting on money. Not a count of work done, and drawn
    # apart from it for that reason.
    open_events = AIEvent.objects.exclude(
        status__in=[AIEvent.Status.COMPLETED, AIEvent.Status.CANCELLED]
    )
    if codes is not None:
        open_events = open_events.filter(mpp__plant_code__in=codes)
    in_progress = Counter(open_events.values_list("status", flat=True))

    return {
        "today": today_count,
        "yesterday": yesterday_count,
        "on_yesterday": today_count - yesterday_count,
        "week": _between(codes, week_from, today),
        "month": _between(codes, today.replace(day=1), today),
        "maits_working_today": working,
        "in_progress": sum(in_progress.values()),
        "payment_pending": in_progress.get(AIEvent.Status.PAYMENT_PENDING, 0),
        "trend": series,
        "best_day": best if best and best["completed"] else None,
        "busiest_maits": busiest_maits(codes, week_from),
        "busiest_villages": busiest_villages(codes, week_from),
        "happening": happening(codes),
    }
