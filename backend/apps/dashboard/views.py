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
from apps.indents.models import STALE_AFTER_DAYS, IndentRequest, stale_indent_q
from apps.inventory.models import MaitInventory, ProductType
from apps.masterdata.models import Mait
from apps.payments.models import OTPLog, Payment
from apps.pregnancy.models import PregnancyCheck
from apps.pregnancy.oversight import rates_by_mait

from .models import DailyAIAggregate, PlatformMilestone

MAX_EXCEPTION_ROWS = 3

#: How far back the dashboard looks for refused pregnancy checks. A working signal, not a
#: lifetime total — see `_pregnancy`.
DECLINE_WINDOW_DAYS = 30
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
        "exception queues (SRS §6.7.1, §6.7.2, §6.7.6) and conception rate (§9.11).\n\n"
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
            # Not from the aggregate tables, unlike everything above it: those know nothing
            # about pregnancy, and the alternative was a tile reading 0.0% until somebody
            # remembered to extend the nightly rebuild. It is one grouped query over a table
            # holding one row per insemination, and it is the number this platform is
            # ultimately judged on — worth the read (docs/API_CONTRACT.md §9.11).
            "pregnancy": _pregnancy(),
        }
    )


def _pregnancy() -> dict:
    """Conception rate, the round nobody is walking, and the yards that turned a Mait away.

    The same arithmetic the pregnancy oversight screen shows, from the same module, so the
    tile and the screen it links to cannot disagree.

    `declined` is the last thirty days rather than all time. It is on the dashboard as a
    working signal — is this happening, and is it getting worse — and a lifetime total answers
    neither: it only ever goes up, so it stops meaning anything within a quarter of go-live.
    """
    today = timezone.localdate()
    _, overall = rates_by_mait()
    return {
        **overall.as_dict(),
        "overdue": PregnancyCheck.objects.filter(outcome="", due_on__lt=today).count(),
        "declined_30d": PregnancyCheck.objects.filter(
            outcome=PregnancyCheck.Outcome.DECLINED,
            checked_at__gte=timezone.now() - timedelta(days=DECLINE_WINDOW_DAYS),
        ).count(),
    }


def _exceptions() -> dict:
    """
    The queues from SRS §6.7.6, and the two pregnancy queues (§9.11): checks nobody has
    walked, and visits an owner refused.

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

    # `stale_indent_q` rather than a cutoff spelled out here: this queue links to the Indents
    # screen filtered by the same query, and when the two were written separately the count
    # and the screen disagreed — four stale indents opened onto an empty table.
    stale = IndentRequest.objects.filter(stale_indent_q())
    approved_not_issued = stale.filter(status=IndentRequest.Status.APPROVED).count()
    awaiting = stale.filter(status=IndentRequest.Status.REQUESTED).count()
    never_pushed = stale.filter(sync_status=IndentRequest.SyncStatus.FAILED).count()
    stale_rows = []
    if approved_not_issued:
        stale_rows.append(
            {
                "label": "Approved, not issued",
                "meta": f"{approved_not_issued} older than {STALE_AFTER_DAYS} days",
                "severity": "warning",
            }
        )
    if awaiting:
        stale_rows.append(
            {
                "label": "Awaiting approval",
                "meta": f"{awaiting} older than {STALE_AFTER_DAYS} days",
                "severity": "warning",
            }
        )
    # A different failure from the two above, and the only one where the request never left
    # this platform at all. It counted towards the total already; without a row of its own the
    # total could exceed everything the card lists and look like an arithmetic bug.
    if never_pushed:
        stale_rows.append(
            {
                "label": "Never reached Indent Easy",
                "meta": f"{never_pushed} push failed",
                "severity": "error",
            }
        )

    # A check nobody did does not stop mattering, and an animal quietly dropped from the
    # round is a conception rate computed over the visits that happened to be convenient. So
    # overdue checks are a queue like any other, sampled by the Mait carrying the most of
    # them — which is the call to make, not the individual animal.
    overdue = PregnancyCheck.objects.filter(outcome="", due_on__lt=timezone.localdate())
    overdue_by_mait = overdue.values("mait_id", "mait__name").annotate(n=Count("id")).order_by("-n")
    by_mait = overdue_by_mait[:MAX_EXCEPTION_ROWS]
    overdue_rows = [
        {
            "label": row["mait__name"],
            "meta": f"{row['n']} check(s) overdue",
            # Waiting, not blocked: the Mait can still work, and the animal is still carrying
            # or not whatever anybody does about it today. Yellow, by the rule the Exceptions
            # screen states out loud.
            "severity": "warning",
        }
        for row in by_mait
    ]

    # Refused visits, grouped by village rather than by Mait or by animal. A single owner
    # turning a Mait away on a wet morning is not a problem anybody should be paged about; the
    # same village doing it repeatedly is, and it is an awareness conversation with that
    # collection point rather than anything the Mait can fix on their own round. Windowed to
    # the last thirty days for the same reason the tile is — see `_pregnancy`.
    declined = PregnancyCheck.objects.filter(
        outcome=PregnancyCheck.Outcome.DECLINED,
        checked_at__gte=timezone.now() - timedelta(days=DECLINE_WINDOW_DAYS),
    )
    declined_by_mpp = (
        declined.values("ai_event__mpp__mpp_name").annotate(n=Count("id")).order_by("-n")
    )
    declined_rows = [
        {
            "label": row["ai_event__mpp__mpp_name"] or "Unknown village",
            "meta": f"{row['n']} owner(s) declined",
            # Waiting, not blocked, and not anybody's failure. The animal is still in the
            # round — a refusal books the next attempt — so this is yellow like the overdue
            # queue rather than red.
            "severity": "warning",
        }
        for row in declined_by_mpp[:MAX_EXCEPTION_ROWS]
    ]

    return {
        # Every queue states its own `more` — how many rows it left out — rather than letting
        # the screen infer it. The screen's arithmetic was `count - len(rows)`, which only
        # holds where a queue samples the same thing it counts, and exactly one of these does.
        # The other three count events and sample the people or the categories behind them, so
        # subtracting produced a "N more" underneath rows that had already accounted for
        # everything: one Mait line for two overdue checks read as another Mait hiding.
        "pending_payments": {
            # Individual payments, sampled oldest first. The one queue where subtracting was
            # right all along, and it is stated here so it stays right by declaration.
            "count": pending.count(),
            "rows": pending_rows,
            "more": max(0, pending.count() - len(pending_rows)),
        },
        "failed_otps": {
            # Counts failures and samples the numbers behind them: one number that failed
            # eleven times is one row and eleven towards the count.
            "count": sum(row["n"] for row in failed),
            "rows": failed_rows,
            "more": max(0, len(failed) - len(failed_rows)),
        },
        "low_stock": {
            # Two summary lines standing for every low Mait, so nothing is ever left out.
            "count": len(low_list),
            "rows": low_rows,
            "more": 0,
        },
        "stale_indents": {
            # Rows are categories, not indents: the three between them cover every stale one,
            # which is why "Never reached Indent Easy" was given a row of its own.
            "count": stale.count(),
            "rows": stale_rows,
            "more": 0,
        },
        # `more` stated rather than left to be worked out. Every other queue here samples
        # rows of the same thing it counts, so a reader can subtract; this one counts checks
        # and samples Maits, and subtracting gave "1 more" under a row that already accounted
        # for every overdue check on the platform.
        "overdue_checks": {
            "count": overdue.count(),
            "rows": overdue_rows,
            "more": max(0, overdue_by_mait.count() - len(overdue_rows)),
        },
        # Counts refusals and samples the villages behind them, so `more` is stated the same
        # way the overdue queue states it rather than subtracted.
        "declined_checks": {
            "count": declined.count(),
            "rows": declined_rows,
            "more": max(0, declined_by_mpp.count() - len(declined_rows)),
        },
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

    # Today is read live, overriding whatever the aggregate holds for it.
    #
    # The aggregate is written hourly, so today's slice is missing until the first run after
    # midnight and stale by up to an hour after that. The "AI events today" tile directly
    # above this chart is already counted live (see `summary`), so reading the chart from the
    # aggregate alone put two numbers that contradict each other on one screen — the tile
    # saying one event today, the chart drawing a flat line — and the chart was the wrong one.
    #
    # This costs one day of rows, not the window: settled days stay on the aggregate, which is
    # what it is for. `summary` bounds its own counts the same way against the same §7 target.
    today_completed = AIEvent.objects.filter(
        status=AIEvent.Status.COMPLETED,
        completed_at__gte=start_of_day(end),
        completed_at__lt=end_of_day(end),
    )
    if district:
        today_completed = today_completed.filter(mpp__district_code=district)
    by_day[end] = today_completed.count()

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
    today = timezone.localdate()
    start = today - timedelta(days=days - 1)

    # Settled days only. Today is added live below, the way `trends` and `summary` do it: the
    # aggregate is written hourly, so today's slice is absent until the first run after
    # midnight and up to an hour behind after that. Read from the aggregate alone, a Mait who
    # had worked all morning showed yesterday's total — and a leaderboard that does not move
    # when somebody works is one they stop believing.
    settled = (
        DailyAIAggregate.objects.filter(date__gte=start, date__lt=today)
        .values("mait_id", "mait__name", "mait__sahayak_vendor_code")
        .annotate(
            ai_count=Sum("ai_count"),
            collected=Sum("amount_collected"),
            cod=Sum("cod_amount"),
            online=Sum("online_amount"),
        )
    )

    totals: dict[int, dict] = {}
    for row in settled:
        totals[row["mait_id"]] = {
            "mait_id": row["mait_id"],
            "name": row["mait__name"],
            "sahayak_vendor_code": row["mait__sahayak_vendor_code"],
            "ai_count": row["ai_count"] or 0,
            "collected": row["collected"] or 0,
            "cod": row["cod"] or 0,
            "online": row["online"] or 0,
        }

    def slot(mait_id: int, name: str, code: str) -> dict:
        """The running total for one Mait, created on first sight."""
        return totals.setdefault(
            mait_id,
            {
                "mait_id": mait_id,
                "name": name,
                "sahayak_vendor_code": code,
                "ai_count": 0,
                "collected": 0,
                "cod": 0,
                "online": 0,
            },
        )

    # Bounded by instants rather than by `completed_at__date`, which compiles to a CONVERT_TZ
    # that is NULL on a MySQL without timezone tables loaded — the failure `apps.core.timeframe`
    # exists to prevent, and one that would silently drop every row rather than raise.
    today_events = (
        AIEvent.objects.filter(
            status=AIEvent.Status.COMPLETED,
            completed_at__gte=start_of_day(today),
            completed_at__lt=end_of_day(today),
        )
        .values("mait_id", "mait__name", "mait__sahayak_vendor_code")
        .annotate(n=Count("id"))
    )
    for row in today_events:
        slot(row["mait_id"], row["mait__name"], row["mait__sahayak_vendor_code"])[
            "ai_count"
        ] += row["n"]

    # The same split the aggregate keeps, computed the same way as `_money_for_slice`: only
    # verified payments count, because an unconfirmed one is money nobody has yet agreed
    # changed hands.
    today_money = (
        Payment.objects.filter(
            status=Payment.Status.VERIFIED,
            ai_event__completed_at__gte=start_of_day(today),
            ai_event__completed_at__lt=end_of_day(today),
        )
        .values("ai_event__mait_id")
        .annotate(
            total=Sum("amount"),
            cod=Sum("amount", filter=Q(mode=Payment.Mode.COD)),
            online=Sum("amount", filter=Q(mode=Payment.Mode.ONLINE)),
        )
    )
    for row in today_money:
        entry = totals.get(row["ai_event__mait_id"])
        # No entry means a verified payment against an event this window does not hold, which
        # the join above makes impossible. Skipped rather than invented: a name is not
        # available here, and a row on the leaderboard with money and no inseminations would
        # be the worst kind of wrong.
        if entry is None:
            continue
        entry["collected"] += row["total"] or 0
        entry["cod"] += row["cod"] or 0
        entry["online"] += row["online"] or 0

    # Ordered here rather than in SQL, because today's live counts are only merged in now and
    # a Mait who did twenty this morning has to be able to reach the top of the board.
    ranked = sorted(totals.values(), key=lambda e: e["ai_count"], reverse=True)[:50]

    return Response(
        {
            "days": days,
            "results": [
                {
                    "mait_id": e["mait_id"],
                    "name": e["name"],
                    "sahayak_vendor_code": e["sahayak_vendor_code"],
                    "ai_count": e["ai_count"],
                    "amount_collected": str(e["collected"]),
                    "cod_amount": str(e["cod"]),
                    "online_amount": str(e["online"]),
                }
                for e in ranked
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
