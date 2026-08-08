"""
Dashboard endpoints (SRS §6.7, §9.9).

Everything here reads the pre-aggregated tables, never the raw ``ai_event`` rows. With
105k+ members and a growing event volume, computing "this month grouped by district" live
would scan the whole table on every page load, against a P95 target of 400ms (SRS §7).

The exception panels are the exception: they are small, bounded counts of things that are
wrong right now, and a stale answer there is worse than a slightly slower one.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db.models import Count, Q, Sum
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.ai_events.models import AIEvent
from apps.core.permissions import IsAdmin
from apps.core.timeframe import end_of_day, local_day, start_of_day
from apps.indents.models import IndentRequest
from apps.inventory.models import MaitInventory, ProductType
from apps.masterdata.models import Mait
from apps.payments.models import OTPLog, Payment

from .models import DailyAIAggregate, PlatformMilestone

MAX_EXCEPTION_ROWS = 3
MAX_TREND_DAYS = 120

# Coverage is reported for the whole network but tabulated for the largest villages only —
# nobody reads three thousand rows, and the summary is what the tiles are for.
MAX_COVERAGE_ROWS = 100
MAX_COVERAGE_DAYS = 365


def _completed_between(start, end=None):
    """
    Completed events in a range of local days, `end` included.

    Compared against instants rather than `completed_at__date`, which returns nothing at all
    on a MySQL without timezone tables — see `apps.core.timeframe`.
    """
    qs = AIEvent.objects.filter(
        status=AIEvent.Status.COMPLETED, completed_at__gte=start_of_day(start)
    )
    if end is not None:
        qs = qs.filter(completed_at__lt=end_of_day(end))
    return qs.count()


@extend_schema(
    tags=["dashboard"],
    summary="Headline counts and exceptions",
    description=(
        "AI events today, this week, this month and lifetime, the all-time highs, and the "
        "four exception queues (SRS §6.7.1, §6.7.2, §6.7.6).\n\n"
        "The month comparison is against the *same day* last month, not the whole of it — a "
        "month-to-date total against a completed month always looks like a collapse."
    ),
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def summary(request):
    today = timezone.localdate()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)

    today_count = _completed_between(today, today)
    yesterday_count = _completed_between(today - timedelta(days=1), today - timedelta(days=1))

    # Same day last month, so a partial month is compared against a partial month.
    last_month_end = month_start - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1)
    same_day_last_month = min(last_month_end, last_month_start + timedelta(days=today.day - 1))

    milestones = {m.kind: m for m in PlatformMilestone.objects.all()}
    highest_month = milestones.get(PlatformMilestone.Kind.HIGHEST_MONTH)
    highest_day = milestones.get(PlatformMilestone.Kind.HIGHEST_DAY)

    first_event = (
        AIEvent.objects.filter(status=AIEvent.Status.COMPLETED)
        .order_by("completed_at")
        .values_list("completed_at", flat=True)
        .first()
    )

    delta_percent = None
    if yesterday_count:
        delta_percent = round((today_count - yesterday_count) / yesterday_count * 100, 1)

    return Response(
        {
            "today": today_count,
            "today_delta_percent": delta_percent,
            "this_week": _completed_between(week_start, today),
            "this_month": _completed_between(month_start, today),
            "last_month_to_same_day": _completed_between(last_month_start, same_day_last_month),
            "lifetime": AIEvent.objects.filter(status=AIEvent.Status.COMPLETED).count(),
            "since": first_event.strftime("%b %Y") if first_event else None,
            "highest_day": (
                {"value": highest_day.value, "label": highest_day.label} if highest_day else None
            ),
            "highest_month": (
                {"value": highest_month.value, "label": highest_month.label}
                if highest_month
                else None
            ),
            "exceptions": _exceptions(),
        }
    )


def _exceptions() -> dict:
    """
    The four queues from SRS §6.7.6.

    Each returns a bounded sample alongside the full count — the count is what tells an admin
    how bad it is, and the sample is what tells them where to start.
    """
    pending = Payment.objects.filter(status=Payment.Status.PENDING).select_related("ai_event__mpp")
    pending_rows = [
        {
            "label": f"{p.ai_event.mpp.mpp_name} · ₹{p.amount}",
            "meta": f"{(timezone.now() - p.created_at).days} days old",
            "severity": "warning",
        }
        for p in pending.order_by("created_at")[:MAX_EXCEPTION_ROWS]
    ]

    since = timezone.now() - timedelta(days=1)
    failed = (
        OTPLog.objects.filter(is_verified=False, attempt_count__gte=1, created_at__gte=since)
        .values("mobile_no")
        .annotate(n=Count("id"))
        .order_by("-n")
    )
    failed_rows = [
        {
            "label": f"{row['mobile_no'][:6]}••••",
            "meta": f"{row['n']} failure(s) today",
            "severity": "error",
        }
        for row in failed[:MAX_EXCEPTION_ROWS]
    ]

    low = (
        MaitInventory.objects.filter(product_type=ProductType.STRAW)
        .values("mait_id", "mait__name")
        .annotate(total=Sum("qty_available"))
        .filter(total__lte=settings.LOW_STOCK_THRESHOLD)
    )
    low_list = list(low)
    at_zero = sum(1 for row in low_list if (row["total"] or 0) == 0)
    low_rows = []
    if low_list:
        low_rows.append(
            {
                "label": f"{len(low_list)} Maits under {settings.LOW_STOCK_THRESHOLD} straws",
                "meta": "Cannot start many more events",
                "severity": "warning",
            }
        )
    if at_zero:
        low_rows.append(
            {
                "label": f"{at_zero} Maits at zero",
                "meta": "Cannot record events at all",
                "severity": "error",
            }
        )

    stale_cutoff = timezone.now() - timedelta(days=3)
    stale = IndentRequest.objects.filter(
        requested_at__lt=stale_cutoff,
        status__in=[IndentRequest.Status.REQUESTED, IndentRequest.Status.APPROVED],
    )
    approved_not_issued = stale.filter(status=IndentRequest.Status.APPROVED).count()
    awaiting = stale.filter(status=IndentRequest.Status.REQUESTED).count()
    stale_rows = []
    if approved_not_issued:
        stale_rows.append(
            {
                "label": "Approved, not issued",
                "meta": f"{approved_not_issued} older than 3 days",
                "severity": "warning",
            }
        )
    if awaiting:
        stale_rows.append(
            {
                "label": "Awaiting approval",
                "meta": f"{awaiting} older than 3 days",
                "severity": "warning",
            }
        )

    return {
        "pending_payments": {"count": pending.count(), "rows": pending_rows},
        "failed_otps": {"count": sum(row["n"] for row in failed), "rows": failed_rows},
        "low_stock": {"count": len(low_list), "rows": low_rows},
        "stale_indents": {"count": stale.count(), "rows": stale_rows},
    }


@extend_schema(
    tags=["dashboard"],
    summary="AI events per day",
    description=(
        "Completed and pending-payment counts per day, for the trend chart (SRS §6.7.3).\n\n"
        "Every day in the window is returned, including the empty ones. A chart that skips "
        "quiet days silently compresses time and makes a bad week look normal."
    ),
    parameters=[
        OpenApiParameter("days", description="Window size, up to 120. Default 30.", type=int),
        OpenApiParameter("district_code", description="Restrict to one district.", type=str),
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def trends(request):
    try:
        days = min(MAX_TREND_DAYS, max(1, int(request.query_params.get("days", 30))))
    except (TypeError, ValueError):
        days = 30

    end = timezone.localdate()
    start = end - timedelta(days=days - 1)

    completed = DailyAIAggregate.objects.filter(date__gte=start, date__lte=end)
    district = request.query_params.get("district_code")
    if district:
        completed = completed.filter(district_code=district)

    by_day = {
        row["date"]: row["total"]
        for row in completed.values("date").annotate(total=Sum("ai_count"))
    }

    # Pending payments are read live: they are by definition not yet aggregated, and the
    # number is small. Small enough that the day each one falls on is worked out here rather
    # than asked of the database, which cannot answer it without timezone tables.
    pending_qs = AIEvent.objects.filter(
        status=AIEvent.Status.PAYMENT_PENDING, created_at__gte=start_of_day(start)
    )
    if district:
        pending_qs = pending_qs.filter(mpp__district_code=district)

    pending_by_day: dict = {}
    for created_at in pending_qs.values_list("created_at", flat=True):
        day = local_day(created_at)
        pending_by_day[day] = pending_by_day.get(day, 0) + 1

    results = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        results.append(
            {
                "date": day.isoformat(),
                "label": day.strftime("%d %b"),
                "short_label": day.strftime("%a"),
                "completed": by_day.get(day, 0),
                "pending": pending_by_day.get(day, 0),
            }
        )

    return Response({"days": days, "district_code": district, "results": results})


@extend_schema(
    tags=["dashboard"],
    summary="Per-Mait performance",
    description="AI count and collections per Mait for a period (SRS §6.7.4).",
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def mait_performance(request):
    try:
        days = min(MAX_TREND_DAYS, max(1, int(request.query_params.get("days", 30))))
    except (TypeError, ValueError):
        days = 30
    start = timezone.localdate() - timedelta(days=days - 1)

    rows = (
        DailyAIAggregate.objects.filter(date__gte=start)
        .values("mait_id", "mait__name", "mait__sahayak_vendor_code")
        .annotate(
            ai_count=Sum("ai_count"),
            collected=Sum("amount_collected"),
            cod=Sum("cod_amount"),
            online=Sum("online_amount"),
        )
        .order_by("-ai_count")[:50]
    )

    return Response(
        {
            "days": days,
            "results": [
                {
                    "mait_id": r["mait_id"],
                    "name": r["mait__name"],
                    "sahayak_vendor_code": r["mait__sahayak_vendor_code"],
                    "ai_count": r["ai_count"] or 0,
                    "amount_collected": str(r["collected"] or 0),
                    "cod_amount": str(r["cod"] or 0),
                    "online_amount": str(r["online"] or 0),
                }
                for r in rows
            ],
        }
    )


@extend_schema(
    tags=["dashboard"],
    summary="MPP coverage",
    description=(
        "Members served versus total members per MPP for a window (SRS §6.7.5). Coverage is "
        "what tells the business where the service is reaching people and where it is not: a "
        "member counts once however many inseminations they bought, so an MPP cannot look "
        "covered because one farmer is a heavy user.\n\n"
        "`summary` is the whole network — every active MPP that has members. `results` is the "
        "leaderboard's worth of that, the largest MPPs by member count, so the two must not be "
        "confused: totalling `results` describes the villages shown and nothing more."
    ),
    parameters=[
        OpenApiParameter(
            "days",
            int,
            description=(
                "Window in days, counted on `completed_at`. Default 30, capped at "
                f"{MAX_COVERAGE_DAYS}."
            ),
        )
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def mpp_coverage(request):
    from apps.masterdata.models import MPP

    try:
        days = min(MAX_COVERAGE_DAYS, max(1, int(request.query_params.get("days", 30))))
    except (TypeError, ValueError):
        days = 30

    # An instant, never `completed_at__date` — see `apps.core.timeframe` for why that returns
    # nothing at all here, and why this is also the form the index can serve.
    window_start = start_of_day(timezone.localdate() - timedelta(days=days - 1))

    # Every active MPP with members, not a page of them. The tiles on the coverage screen speak
    # for the network, and a network total computed from the hundred biggest villages is a
    # different number wearing the same label.
    #
    # This does group over ai_event, which the rest of this module avoids — but it groups by
    # MPP, and there are thousands of MPPs rather than millions. The window is what keeps it
    # off the whole table, and `aievent_completed_idx` is what serves the window.
    ranked = (
        MPP.objects.filter(is_active=True)
        .annotate(
            total_members=Count("members", distinct=True),
            served=Count(
                "ai_events__member",
                filter=Q(
                    ai_events__status=AIEvent.Status.COMPLETED,
                    ai_events__completed_at__gte=window_start,
                ),
                distinct=True,
            ),
        )
        .filter(total_members__gt=0)
        .select_related("mait")
        .order_by("-total_members")
    )

    network = list(ranked)
    members = sum(r.total_members for r in network)
    # A member belongs to exactly one MPP and is counted once within it, so this sums cleanly.
    served = sum(r.served for r in network)

    def as_row(r):
        return {
            "mpp_code": r.mpp_code,
            "mpp_name": r.mpp_name,
            "district_code": r.district_code,
            "total_members": r.total_members,
            "members_served": r.served,
            "coverage_percent": round(r.served / r.total_members * 100, 1),
            # Zero coverage has three different causes and three different fixes: nobody is
            # assigned, somebody is assigned but cannot log in, or they can and have not been.
            # The screen cannot tell them apart without being told which.
            "mait_code": r.mait.sahayak_vendor_code if r.mait_id else "",
            "mait_name": r.mait.name if r.mait_id else "",
            "mait_activated": bool(r.mait_id and r.mait.user_id),
        }

    return Response(
        {
            "days": days,
            "summary": {
                "mpps": len(network),
                "members": members,
                "members_served": served,
                "coverage_percent": round(served / members * 100, 1) if members else 0.0,
                "mpps_above_40": sum(1 for r in network if r.served / r.total_members >= 0.4),
                "mpps_at_zero": sum(1 for r in network if not r.served),
            },
            "rows_shown": min(len(network), MAX_COVERAGE_ROWS),
            "results": [as_row(r) for r in network[:MAX_COVERAGE_ROWS]],
        }
    )


@extend_schema(
    tags=["dashboard"],
    summary="Maits awaiting a mobile number",
    description=(
        "2,886 of 3,110 Sahayak records arrive from SAP with no mobile number, and OTP is a "
        "Mait's only way in (docs/DATA_FINDINGS.md §1). Surfaced on the dashboard because it "
        "blocks rollout, not because it is a curiosity."
    ),
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def activation_readiness(request):
    total = Mait.objects.filter(is_active=True).count()
    activated = Mait.objects.filter(is_active=True, user__isnull=False).count()
    no_mobile = Mait.objects.filter(is_active=True, mobile_no="").count()

    return Response(
        {
            "total_maits": total,
            "activated": activated,
            "awaiting_activation": total - activated,
            "without_mobile": no_mobile,
            "can_be_activated_now": total - activated - no_mobile,
        }
    )
