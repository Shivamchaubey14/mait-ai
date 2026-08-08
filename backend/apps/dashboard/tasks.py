"""Scheduled pre-aggregation for the dashboards (SRS §6.7, §7 Performance)."""

from __future__ import annotations

import logging
from datetime import date, timedelta

from celery import shared_task
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.ai_events.models import AIEvent
from apps.core.timeframe import end_of_day, local_day, start_of_day
from apps.payments.models import Payment

from .models import DailyAIAggregate, PlatformMilestone

logger = logging.getLogger(__name__)


@shared_task(name="apps.dashboard.tasks.aggregate_daily_ai_counts")
def aggregate_daily_ai_counts(lookback_days: int = 2) -> int:
    """
    Rebuild the daily aggregate slices for the recent window.

    Runs hourly, so it must be cheap and safe to repeat. It recomputes the last couple of
    days wholesale rather than incrementing counters: an event completed offline can arrive
    hours late and land on yesterday's date, and an incremental counter would miss it.

    ``lookback_days`` bounds the work. Backfilling further is a management command, not a
    scheduled job.
    """
    since = timezone.localdate() - timedelta(days=lookback_days)

    # Grouped here rather than by TruncDate in SQL. TruncDate on an aware column compiles to
    # CONVERT_TZ, which is NULL on a MySQL without timezone tables loaded — every slice would
    # then key on NULL, and this job's whole output is what the dashboard reads. The window is
    # a couple of days, so the rows fit in memory by construction (apps.core.timeframe).
    events = AIEvent.objects.filter(
        status=AIEvent.Status.COMPLETED, completed_at__gte=start_of_day(since)
    ).values_list("completed_at", "mpp_id", "mait_id", "mpp__district_code", "member_id")

    slices: dict[tuple, dict] = {}
    for completed_at, mpp_id, mait_id, district_code, member_id in events.iterator():
        slice_ = slices.setdefault(
            (local_day(completed_at), mpp_id, mait_id),
            {
                "district_code": district_code or "",
                "ai_count": 0,
                "member_ai_count": 0,
                "non_member_ai_count": 0,
                "members": set(),
            },
        )
        slice_["ai_count"] += 1
        if member_id:
            slice_["member_ai_count"] += 1
            slice_["members"].add(member_id)
        else:
            slice_["non_member_ai_count"] += 1

    written = 0
    with transaction.atomic():
        for (day, mpp_id, mait_id), slice_ in slices.items():
            DailyAIAggregate.objects.update_or_create(
                date=day,
                mpp_id=mpp_id,
                mait_id=mait_id,
                defaults={
                    "district_code": slice_["district_code"],
                    "ai_count": slice_["ai_count"],
                    "member_ai_count": slice_["member_ai_count"],
                    "non_member_ai_count": slice_["non_member_ai_count"],
                    "distinct_members_served": len(slice_["members"]),
                    **_money_for_slice(day, mpp_id, mait_id),
                },
            )
            written += 1

    logger.info("Rebuilt %s daily aggregate slices since %s", written, since)
    refresh_platform_milestones.delay()
    return written


def _money_for_slice(day: date, mpp_id: int, mait_id: int) -> dict:
    """Collections for one (date, MPP, Mait) slice, split by payment mode."""
    totals = Payment.objects.filter(
        status=Payment.Status.VERIFIED,
        ai_event__completed_at__gte=start_of_day(day),
        ai_event__completed_at__lt=end_of_day(day),
        ai_event__mpp_id=mpp_id,
        ai_event__mait_id=mait_id,
    ).aggregate(
        total=Sum("amount"),
        cod=Sum("amount", filter=Q(mode=Payment.Mode.COD)),
        online=Sum("amount", filter=Q(mode=Payment.Mode.ONLINE)),
    )
    return {
        "amount_collected": totals["total"] or 0,
        "cod_amount": totals["cod"] or 0,
        "online_amount": totals["online"] or 0,
    }


@shared_task(name="apps.dashboard.tasks.refresh_platform_milestones")
def refresh_platform_milestones() -> None:
    """Recompute the all-time highs shown on the home dashboard (SRS §6.7.2)."""
    by_day = (
        DailyAIAggregate.objects.values("date")
        .annotate(total=Sum("ai_count"))
        .order_by("-total")
        .first()
    )
    if by_day:
        PlatformMilestone.objects.update_or_create(
            kind=PlatformMilestone.Kind.HIGHEST_DAY,
            defaults={
                "value": by_day["total"],
                "occurred_on": by_day["date"],
                "label": by_day["date"].strftime("%d %b %Y"),
            },
        )

    by_month: dict[tuple[int, int], int] = {}
    for row in DailyAIAggregate.objects.values("date").annotate(total=Sum("ai_count")):
        key = (row["date"].year, row["date"].month)
        by_month[key] = by_month.get(key, 0) + row["total"]

    if by_month:
        (year, month), total = max(by_month.items(), key=lambda kv: kv[1])
        PlatformMilestone.objects.update_or_create(
            kind=PlatformMilestone.Kind.HIGHEST_MONTH,
            defaults={
                "value": total,
                "occurred_on": date(year, month, 1),
                "label": date(year, month, 1).strftime("%B %Y"),
            },
        )
