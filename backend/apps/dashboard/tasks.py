"""Scheduled pre-aggregation for the dashboards (SRS §6.7, §7 Performance)."""

from __future__ import annotations

import logging
from datetime import date, timedelta

from celery import shared_task
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from apps.ai_events.models import AIEvent
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

    rows = (
        AIEvent.objects.filter(
            status=AIEvent.Status.COMPLETED, completed_at__date__gte=since
        )
        .annotate(day=TruncDate("completed_at"))
        .values("day", "mpp_id", "mait_id", "mpp__district_code")
        .annotate(
            ai_count=Count("id"),
            member_ai_count=Count("id", filter=Q(member__isnull=False)),
            non_member_ai_count=Count("id", filter=Q(non_member__isnull=False)),
            distinct_members=Count("member_id", distinct=True),
        )
    )

    written = 0
    with transaction.atomic():
        for row in rows:
            money = _money_for_slice(row["day"], row["mpp_id"], row["mait_id"])
            DailyAIAggregate.objects.update_or_create(
                date=row["day"],
                mpp_id=row["mpp_id"],
                mait_id=row["mait_id"],
                defaults={
                    "district_code": row["mpp__district_code"] or "",
                    "ai_count": row["ai_count"],
                    "member_ai_count": row["member_ai_count"],
                    "non_member_ai_count": row["non_member_ai_count"],
                    "distinct_members_served": row["distinct_members"],
                    **money,
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
        ai_event__completed_at__date=day,
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
