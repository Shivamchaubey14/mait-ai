"""
The Mait's pregnancy checks.

Two things a handset needs: what is due, and a way to say what was found. Everything else —
what an outcome implies, when a recheck falls — is decided in `services.py`, because a rule
a client could choose differently is a rule that can be quietly skipped.

Scoped to the signed-in Mait by the queryset, never by a filter the app sends. A "which Mait
am I" parameter is one that can be omitted or altered.
"""

from __future__ import annotations

from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.pagination import StandardLimitOffsetPagination
from apps.core.services import record_audit
from apps.core.permissions import IsAdmin, IsMait
from apps.masterdata.models import Mait

from .models import ALERT_WINDOW_DAYS, PregnancyCheck, PregnancyRate
from .oversight import Rate, counts_by_mait, empty_counts, rates_by_mait
from .route import late_first, minutes_for, road_minutes, shortest_first
from .serializers import (
    PregnancyCheckSerializer,
    PregnancyRateSerializer,
    RecordCheckSerializer,
)
from .services import CheckAlreadyRecorded, PhotoRequired, record_check


@extend_schema(tags=["pregnancy"])
class PregnancyCheckViewSet(viewsets.ReadOnlyModelViewSet):
    """
    What this Mait owes a visit, and what they have already found.

    `window=due` is the default and the one the app opens on: everything open and due inside
    the alert window, plus everything already overdue. Overdue never falls off the list — a
    check nobody did does not stop mattering, and an animal quietly dropped from the round is
    a conception rate nobody can trust.
    """

    serializer_class = PregnancyCheckSerializer
    permission_classes = [IsAuthenticated, IsMait]

    def get_queryset(self):
        mait = getattr(self.request.user, "mait_profile", None)
        if mait is None:
            return PregnancyCheck.objects.none()

        base = (
            PregnancyCheck.objects.filter(mait=mait)
            .select_related(
                "ai_event",
                "ai_event__mpp",
                "ai_event__animal",
                "ai_event__member",
                "ai_event__non_member",
                "ai_event__semen_batch",
            )
            .order_by("due_on", "id")
        )

        # The window is a property of the *list*. Applied to a detail lookup it would hide a
        # check the moment it was recorded — and the moment after recording is exactly when a
        # replay from the offline queue arrives, so the retry would 404 on its own success.
        if self.action != "list":
            return base

        window = self.request.query_params.get("window", "due")
        today = timezone.localdate()

        if window == "done":
            return base.exclude(outcome="").order_by("-checked_at")
        if window == "all":
            return base
        # Open, and either overdue or due inside the week ahead.
        return base.filter(outcome="", due_on__lte=today + timedelta(days=ALERT_WINDOW_DAYS))

    def get_serializer_context(self):
        context = super().get_serializer_context()
        # One "today" for the whole response, so a request served across midnight cannot put
        # two different day-counts on one screen.
        context["today"] = timezone.localdate()
        return context

    @extend_schema(
        summary="Pregnancy checks for the signed-in Mait",
        parameters=[
            OpenApiParameter(
                name="window",
                description=(
                    "`due` (default) — open checks that are overdue or fall inside the "
                    "seven-day alert window. `done` — checks already recorded, newest first. "
                    "`all` — everything."
                ),
                required=False,
                type=str,
            )
        ],
    )
    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        today = timezone.localdate()
        mine = PregnancyCheck.objects.filter(
            mait=getattr(request.user, "mait_profile", None), outcome=""
        )
        # Counted on the server so every screen that shows a number shows the same one — the
        # Profile row, the list's own headline, and the tab badge.
        response.data["due_this_week"] = mine.filter(
            due_on__lte=today + timedelta(days=ALERT_WINDOW_DAYS)
        ).count()
        response.data["overdue"] = mine.filter(due_on__lt=today).count()
        return response

    @extend_schema(
        summary="Today's round, ordered two ways",
        parameters=[
            OpenApiParameter(name="lat", required=False, type=float),
            OpenApiParameter(name="lng", required=False, type=float),
        ],
        responses={200: dict},
        description=(
            "Both orderings in one response, so the reorder screen needs no second request "
            "and the figures cannot move between the two screens. "
            "**Distances are straight lines scaled for winding, not road geometry.** There is "
            "no routing service configured for this platform. Good enough to order stops; not "
            "good enough to quote without saying what it is, which the app does."
        ),
    )
    @action(detail=False, methods=["get"], url_path="route")
    def route(self, request):
        # The same window the list uses, stated here rather than inherited. `get_queryset`
        # deliberately drops the window for detail lookups, so a round planned off it would
        # have quietly included every check the Mait will owe in the next three months.
        today = timezone.localdate()
        checks = list(
            self.get_queryset()
            .filter(outcome="", due_on__lte=today + timedelta(days=ALERT_WINDOW_DAYS))
            .order_by("due_on", "id")
        )

        start = None
        try:
            if request.query_params.get("lat") and request.query_params.get("lng"):
                start = (float(request.query_params["lat"]), float(request.query_params["lng"]))
        except (TypeError, ValueError):
            start = None

        def shape(stops):
            total = round(sum(s.leg_km for s in stops), 1)
            return {
                "total_km": total,
                "minutes_total": minutes_for(total, len(stops)),
                "minutes_on_road": road_minutes(total),
                "stops": [
                    {
                        **PregnancyCheckSerializer(
                            s.check, context=self.get_serializer_context()
                        ).data,
                        "leg_km": s.leg_km,
                        "lat": s.point[0] if s.point else None,
                        "lng": s.point[1] if s.point else None,
                    }
                    for s in stops
                ],
            }

        return Response(
            {
                "from_here": start is not None,
                "stop_count": len(checks),
                # Named rather than positional: the app picks by key, so an order added later
                # cannot silently become the default by being listed first.
                "options": {
                    "shortest": shape(shortest_first(start, checks)),
                    "late_first": shape(late_first(start, checks)),
                },
                "without_location": sum(
                    1 for c in checks if c.ai_event.gps_lat is None or c.ai_event.gps_lng is None
                ),
            }
        )

    @extend_schema(
        summary="Record what the Mait found",
        request=RecordCheckSerializer,
        responses={200: PregnancyCheckSerializer},
    )
    @action(detail=True, methods=["post"], url_path="record")
    def record(self, request, pk=None):
        check = self.get_object()

        mait = getattr(request.user, "mait_profile", None)
        if check.mait_id != getattr(mait, "id", None):
            raise PermissionDenied("This check belongs to another Mait.")

        payload = RecordCheckSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        client_uuid = data.get("client_uuid")
        if client_uuid:
            # A replay from the offline queue. The result already written is the answer —
            # returning it rather than refusing keeps a retrying handset from treating its own
            # success as a failure and asking a Mait to record the same visit twice.
            already = PregnancyCheck.objects.filter(client_uuid=client_uuid).first()
            if already:
                return Response(self.get_serializer(already).data)
            check.client_uuid = client_uuid
            check.save(update_fields=["client_uuid", "updated_at"])

        try:
            record_check(
                check,
                outcome=data["outcome"],
                photo_url=data.get("photo_url", ""),
                note=data.get("note", ""),
                actor=request.user,
            )
        except PhotoRequired as exc:
            raise ValidationError({"photo_url": [str(exc)]}) from exc
        except CheckAlreadyRecorded:
            # Not an error the Mait can do anything about, and not a failure either: the visit
            # is on the record. Answered with the record rather than a red screen.
            return Response(
                self.get_serializer(check).data,
                status=status.HTTP_200_OK,
                headers={"X-Already-Recorded": "1"},
            )

        return Response(self.get_serializer(check).data)


# ==========================================================================================
# Admin oversight
# ==========================================================================================
# The endpoints above are the Mait's own, scoped by `request.user.mait_profile`. An admin has
# no such profile, so calling them from the portal answers an empty list rather than an error
# — which is the worst of both, a screen that looks like it works and reports nothing.
#
# So the portal gets its own surface, the way `apps.inventory` does: a Mait view and a
# separate admin-wide one, rather than a single view trying to guess which audience is asking
# from a query parameter that can be omitted or altered.


def _mait_identity(mait) -> dict:
    return {
        "mait_id": mait.id,
        "name": mait.name,
        "sahayak_vendor_code": mait.sahayak_vendor_code,
        "mpp_codes": [mpp.mpp_code for mpp in mait.mpps.all()],
    }


@extend_schema(
    tags=["pregnancy"],
    summary="Pregnancy diagnosis across every Mait",
    description=(
        "Admin oversight. The Mait-facing endpoints only ever report the caller's own "
        "checks, so this is the only view that can answer whether anybody's round is being "
        "dropped.\n\n"
        "Sorted most overdue first: the screen is opened to find the rounds nobody is "
        "walking, not to browse a roster. Every active Mait appears, including the ones with "
        "no checks at all — a Mait whose inseminations are too recent to have booked one "
        "reads very differently from a Mait ignoring twenty, and a list built only from "
        "check rows could not tell them apart.\n\n"
        "`conception_rate` is a percentage of **settled inseminations**, not of checks: an "
        "unsure result books a recheck, and an event whose second check came back pregnant "
        "did not fail. An insemination still carrying an open check is in neither half of "
        "the fraction — otherwise a Mait improves their own rate by staying at home."
        "\n\n"
        "`declined` counts the visits an owner refused. It is reported beside the three "
        "findings and never added to them: nobody examined the animal, so the insemination "
        "is in neither half of the rate either. A refusal books the next attempt, so those "
        "checks are still in `open` as well — the round has not lost the animal."
    ),
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def pregnancy_oversight(request):
    today = timezone.localdate()
    counts = counts_by_mait(today)
    rates, overall = rates_by_mait()

    rows = []
    for mait in Mait.objects.filter(is_active=True).prefetch_related("mpps"):
        rate = rates.get(mait.id, Rate())
        rows.append(
            {
                **_mait_identity(mait),
                **counts.get(mait.id, empty_counts()),
                **rate.as_dict(),
            }
        )

    # Most overdue first, then the fullest open list, then by name so the order is stable
    # between two loads of an unchanged screen.
    rows.sort(key=lambda row: (-row["overdue"], -row["open"], row["name"]))

    return Response(
        {
            "summary": {
                "maits": len(rows),
                "open": sum(row["open"] for row in rows),
                "overdue": sum(row["overdue"] for row in rows),
                "due_this_week": sum(row["due_this_week"] for row in rows),
                "recorded": sum(row["recorded"] for row in rows),
                "pregnant": sum(row["pregnant"] for row in rows),
                "not_pregnant": sum(row["not_pregnant"] for row in rows),
                "unsure": sum(row["unsure"] for row in rows),
                "declined": sum(row["declined"] for row in rows),
                "alert_window_days": ALERT_WINDOW_DAYS,
                **overall.as_dict(),
            },
            "results": rows,
        }
    )


@extend_schema(
    tags=["pregnancy"],
    summary="One Mait's pregnancy checks",
    description=(
        "The drill-down behind a row of the oversight table, in the same shape the app shows "
        "that Mait — so an admin reading it down the phone is looking at the same list.\n\n"
        "`window=due` is open checks, **oldest first**: this screen is read to find what has "
        "been dropped, and the app's soonest-first order buries exactly that at the bottom. "
        "`done` is what was recorded, newest first. `all` is both."
    ),
    parameters=[
        OpenApiParameter(
            name="window",
            description="`due` (default), `done`, or `all`.",
            required=False,
            type=str,
        )
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def mait_pregnancy_checks(request, mait_id: int):
    mait = get_object_or_404(Mait.objects.prefetch_related("mpps"), pk=mait_id)
    today = timezone.localdate()

    mine = PregnancyCheck.objects.filter(mait=mait)
    counts = counts_by_mait(today, mine).get(mait.id, empty_counts())
    rates, _ = rates_by_mait(mine)

    base = mine.select_related(
        "ai_event",
        "ai_event__mpp",
        "ai_event__animal",
        "ai_event__member",
        "ai_event__non_member",
        "ai_event__semen_batch",
    )

    window = request.query_params.get("window", "due")
    if window == "done":
        checks = base.exclude(outcome="").order_by("-checked_at")
    elif window == "all":
        checks = base.order_by("outcome", "due_on", "id")
    else:
        checks = base.filter(outcome="").order_by("due_on", "id")

    paginator = StandardLimitOffsetPagination()
    page = paginator.paginate_queryset(checks, request)
    serialized = PregnancyCheckSerializer(page, many=True, context={"today": today}).data

    response = paginator.get_paginated_response(serialized)
    response.data["mait"] = _mait_identity(mait)
    response.data["summary"] = {
        **counts,
        **rates.get(mait.id, Rate()).as_dict(),
        "alert_window_days": ALERT_WINDOW_DAYS,
    }
    return response


def _the_pd_rate() -> PregnancyRate:
    """
    The one row, created if a deployment somehow reaches this without its data migration.

    Cheaper than making every caller — and every screen — handle an absent row.
    """
    rate, _ = PregnancyRate.objects.get_or_create(
        service=PregnancyRate.Service.PREGNANCY_DIAGNOSIS,
        defaults={"member_rate": 0, "non_member_rate": 0},
    )
    return rate


@extend_schema(
    tags=["pregnancy"],
    summary="What a pregnancy diagnosis costs",
    description=(
        "The two prices, read and set from the Rates screen."
        "\n\n"
        "Flat rather than per breed, unlike the insemination rate: a straw's price "
        "follows the bull it came from, and this one follows the visit, which is the "
        "same work whatever animal it is."
        "\n\n"
        "**Zero means not priced, never free.** A rate nobody has entered reaches a "
        "Mait as \"chargeable, amount not set\" rather than as a farmer being told "
        "the visit costs nothing. `PATCH` accepts either rate on its own."
    ),
    request=PregnancyRateSerializer,
    responses={200: PregnancyRateSerializer},
)
@api_view(["GET", "PATCH"])
@permission_classes([IsAdmin])
def pregnancy_rate(request):
    rate = _the_pd_rate()

    if request.method == "GET":
        return Response(PregnancyRateSerializer(rate).data)

    serializer = PregnancyRateSerializer(rate, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()

    # Audited like any other price change. What a farmer was charged is the thing that gets
    # disputed, and "who set it to that, and when" is the first question asked.
    record_audit(
        action="update",
        entity_type="pregnancy_rate",
        entity_id=rate.id,
        actor=request.user,
        meta={
            "member_rate": str(rate.member_rate),
            "non_member_rate": str(rate.non_member_rate),
        },
    )
    return Response(serializer.data)
