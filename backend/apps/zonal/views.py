"""
The zonal manager's app.

A zonal manager is an ordinary Admin with a zone (``User.is_zonal_manager`` says why there
is no fourth role), and until now their whole job lived in a browser: approve this zone's
indents, watch its stock, chase the depot. The job does not. They are out at collection
points and depots, and the decision a Mait is waiting on is a decision about a yard, taken in
a yard.

So this is the third app on the same handset login, beside the Mait's and the store keeper's:

* ``GET /zonal/`` — the small answer every screen needs: who this is, and what is waiting on
  them. Cheap on purpose; the tab bar's badge reads it.
* ``GET /zonal/dashboard/`` — the zone's work, live (``dashboard.py``).
* ``GET /zonal/approvals/`` — the indents awaiting a decision, each with the facts the
  decision turns on (``serializers.ApprovalSerializer``).
* ``GET /zonal/stock/`` — what is held, by place (``stock.py``).
* ``GET /zonal/history/`` — every approval and rejection they have made (``history.py``).
* ``GET /zonal/events/`` — every insemination in the zone, a page at a time, by date
  (``events.py``). Opened from the Profile tab.
* ``GET /zonal/events/{id}/`` — one insemination, whole: the portal's AI event detail (W6)
  as one answer rather than three, for a manager standing in the village it happened in.

**There is no write path here, and that is deliberate.** Approving and rejecting stay on
``/indents/{id}/approve|reject/``, where the state machine, the store routing and the audit
entry already are; the app posts to those. Two endpoints for one decision is two places for
them to drift, and the one that drifts is always the one nobody tested.

**Everything is scoped twice.** ``IsZonalManager`` settles who may call these at all, and
every queryset is narrowed by ``scope_of`` — the same zone scope every "who" screen in the
portal uses. A manager asking for another zone's figures gets their own.
"""

from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.core.permissions import IsZonalManager
from apps.core.scoping import scope_note, scope_of
from apps.indents.models import IndentRequest
from apps.masterdata.models import Mait
from apps.stores.models import Store
from apps.stores.services import availability

from . import dashboard as zone_dashboard
from . import events as zone_events
from . import history as zone_history
from . import stock as zone_stock
from .serializers import ApprovalSerializer, held_by_maits


def _int(params, key, default, *, low=1, high=10_000) -> int:
    """One query parameter, clamped. Nothing here trusts a number from the wire."""
    try:
        return min(high, max(low, int(params.get(key, default))))
    except (TypeError, ValueError):
        return default


def _indents_in(codes: list[str] | None):
    """
    The zone's indents, reached through the Mait's MPPs.

    An indent carries no plant of its own, which is why this goes the long way round — the
    same path ``IndentViewSet.get_queryset`` takes, so the app and the portal narrow to the
    same rows rather than to two similar ones.
    """
    base = IndentRequest.objects.select_related("mait", "store").prefetch_related("mait__mpps")
    if codes is None:
        return base
    return base.filter(mait__mpps__plant_code__in=codes).distinct()


@extend_schema(
    tags=["zonal"],
    summary="Who this is, and what is waiting on them",
    description=(
        "The small answer every screen in the app needs, and the one the tab bar's badge "
        "reads: the manager, their zones, and the counts that decide whether anything is "
        "owed. The zone's actual figures are `/zonal/dashboard/`.\n\n"
        "Narrowed to the account's own zones, always. `scope` says what the figures cover, "
        "so a number read off this screen is never repeated as a network total."
    ),
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsZonalManager])
def zonal_home(request):
    user = request.user
    codes = scope_of(request)

    indents = _indents_in(codes)
    waiting = list(indents.filter(status=IndentRequest.Status.REQUESTED))
    # Approved and not yet fully handed over — the Mait is waiting on a depot, not on this
    # manager. Worth its own figure: it is the number they ring the store about.
    at_depot = indents.filter(status=IndentRequest.Status.APPROVED).count()

    oldest = min((row.requested_at for row in waiting), default=None)

    maits = Mait.objects.filter(is_active=True)
    stores = Store.objects.filter(is_active=True)
    if codes is not None:
        maits = maits.filter(mpps__plant_code__in=codes).distinct()
        stores = stores.filter(
            Q(plants__plant_code__in=codes) | Q(zone__plants__plant_code__in=codes)
        ).distinct()

    return Response(
        {
            "manager": {
                "name": user.full_name,
                "mobile_no": user.mobile_no,
                "zones": user.zone_names,
                "sections": user.allowed_sections,
            },
            "waiting": len(waiting),
            "oldest_waiting_days": (
                max((timezone.now() - oldest).days, 0) if oldest is not None else 0
            ),
            "at_depot": at_depot,
            "maits": maits.count(),
            "stores": stores.count(),
            "scope": scope_note(request),
        }
    )


@extend_schema(
    tags=["zonal"],
    summary="The zone's work, live",
    description=(
        "What a manager opens the app to see: how many inseminations happened today and how "
        "that compares with yesterday, the week and the month, a day-by-day trend, who and "
        "where the work is coming from, and the last few captures as they land.\n\n"
        "Counted off the events themselves rather than the pre-aggregated table — this is one "
        "zone over a week, and the aggregate's hourly job does not run on the no-Docker "
        "dev path at all, so reading it would report zero on a database full of events."
    ),
    parameters=[
        OpenApiParameter(
            "days",
            description=f"Trend window, default {zone_dashboard.TREND_DAYS}",
            type=int,
        )
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsZonalManager])
def zonal_dashboard(request):
    days = _int(
        request.query_params,
        "days",
        zone_dashboard.TREND_DAYS,
        high=zone_dashboard.MAX_TREND_DAYS,
    )
    body = zone_dashboard.build(scope_of(request), days=days)
    return Response({**body, "days": days, "scope": scope_note(request)})


@extend_schema(
    tags=["zonal"],
    summary="The indents awaiting this manager's decision",
    description=(
        "Oldest first — the Mait who has waited longest is the one to answer. Each row "
        "carries what the decision turns on: what that Mait already holds of the item, what "
        "the depot serving them can still promise (`in_store`, or `-1` where no depot serves "
        "them yet), and how long it has sat.\n\n"
        "`coverage` is that in one word: `ready`, `short`, `empty`, `no-store`.\n\n"
        "Read-only. Approve and reject are `POST /indents/{id}/approve/` and `/reject/`, "
        "which is where the state machine and the audit entry live."
    ),
    parameters=[
        OpenApiParameter("search", description="Mait name, vendor code, or IND-13", type=str),
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsZonalManager])
def zonal_approvals(request):
    codes = scope_of(request)
    queryset = _indents_in(codes).filter(status=IndentRequest.Status.REQUESTED)

    term = (request.query_params.get("search") or "").strip()
    if term:
        match = Q(mait__name__icontains=term) | Q(mait__sahayak_vendor_code__icontains=term)
        number = term.upper().removeprefix("IND").lstrip("-# ")
        if number.isdigit():
            match |= Q(pk=int(number))
        queryset = queryset.filter(match)

    # Oldest first: this is a queue of people waiting, not a list of records.
    rows = list(queryset.order_by("requested_at"))

    # Both context maps are built once for the page. A shelf read per row would be one query
    # per indent on a screen that opens on a village connection.
    shelves = {
        store.id: availability(store)
        for store in Store.objects.filter(
            id__in={row.store_id for row in rows if row.store_id}, is_active=True
        )
    }
    held = held_by_maits(sorted({row.mait_id for row in rows}))

    data = ApprovalSerializer(rows, many=True, context={"shelves": shelves, "held": held}).data
    return Response({"count": len(data), "results": data, "scope": scope_note(request)})


@extend_schema(
    tags=["zonal"],
    summary="The zone's stock, by place",
    description=(
        "Grouped by BMC/MCC first, because a manager works out which way to drive before "
        "they work out who to ring. `locations` carries each centre with the Maits under it, "
        "how many are at zero or low, and the depots that could restock them; `maits` is the "
        "flat list, emptiest first; `stores` is every depot in reach with its shelf.\n\n"
        "**Each Mait lands in exactly one location** — the centre most of their collection "
        "points report into — so the location rows sum to the tile above them. The centres "
        "they also cover are named on the row.\n\n"
        "The figures are read exactly as the portal's Inventory screen reads them, so the two "
        "cannot disagree about who is at zero."
    ),
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsZonalManager])
def zonal_stock(request):
    body = zone_stock.build(scope_of(request))
    return Response({**body, "scope": scope_note(request)})


@extend_schema(
    tags=["zonal"],
    summary="Every approval and rejection this manager has made",
    description=(
        "Their own decisions, newest first, each with the request behind it and **where it "
        "got to since** — approved three weeks ago and still sitting at a depot is the row "
        "somebody opens this to find. A rejection carries the reason the Mait was given.\n\n"
        "Read off the audit trail, because only half the answer is on the indent: approval is "
        "stamped on the row and a rejection is not.\n\n"
        "Their own and nobody else's: the actor is fixed to the signed-in account and is not a "
        "parameter."
    ),
    parameters=[
        OpenApiParameter("days", description=f"Default {zone_history.DEFAULT_DAYS}", type=int),
        OpenApiParameter("outcome", description="`all`, `approved` or `rejected`", type=str),
        OpenApiParameter(
            "limit",
            description=f"Default {zone_history.DEFAULT_LIMIT}, max {zone_history.MAX_LIMIT}",
            type=int,
        ),
        OpenApiParameter("offset", type=int),
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsZonalManager])
def zonal_history(request):
    params = request.query_params
    outcome = params.get("outcome", "all")
    if outcome not in ("all", "approved", "rejected"):
        outcome = "all"

    return Response(
        zone_history.build(
            request.user,
            days=_int(params, "days", zone_history.DEFAULT_DAYS, high=zone_history.MAX_DAYS),
            outcome=outcome,
            limit=_int(params, "limit", zone_history.DEFAULT_LIMIT, high=zone_history.MAX_LIMIT),
            offset=_int(params, "offset", 0, low=0, high=100_000),
        )
    )


@extend_schema(
    tags=["zonal"],
    summary="Every insemination in the zone, by date",
    description=(
        "Newest first, one page at a time — never the whole table. Every status, not only "
        "completed: a capture stopped at payment is exactly the row somebody comes looking "
        "for. Each row names the farmer and whether they are a member, the collection point "
        "and the Mait with their codes.\n\n"
        "`date_from` and `date_to` are local days, both included; either may be left out. "
        "`count` is the whole range, so the screen can say how many before anybody scrolls, "
        "and `has_more` says whether another page follows.\n\n"
        "Narrowed to the manager's own zones through the collection point."
    ),
    parameters=[
        OpenApiParameter("date_from", description="YYYY-MM-DD, included", type=str),
        OpenApiParameter("date_to", description="YYYY-MM-DD, included", type=str),
        OpenApiParameter(
            "limit",
            description=f"Default {zone_events.DEFAULT_LIMIT}, max {zone_events.MAX_LIMIT}",
            type=int,
        ),
        OpenApiParameter("offset", type=int),
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsZonalManager])
def zonal_events(request):
    params = request.query_params
    body = zone_events.build(
        scope_of(request),
        date_from=params.get("date_from"),
        date_to=params.get("date_to"),
        limit=_int(params, "limit", zone_events.DEFAULT_LIMIT, high=zone_events.MAX_LIMIT),
        offset=_int(params, "offset", 0, low=0, high=1_000_000),
    )
    return Response({**body, "scope": scope_note(request)})


@extend_schema(
    tags=["zonal"],
    summary="One insemination, whole",
    description=(
        "The record a dispute is settled from, for a manager standing in the village it "
        "happened in: the straw and the doses, what was charged and whether it cleared, the "
        "proof photo, where the handset was when it was taken, the animal and her owner, "
        "every consumable the visit used, whether it took, and the step-by-step trail.\n\n"
        "**One request, not three.** The portal fetches the event and its trail separately "
        "because it has a desk connection and two panels that fail independently; a manager "
        "opening this on one bar of signal in a yard wants one spinner and one answer, and "
        "there is no offline cache here for the halves to arrive into separately.\n\n"
        "Narrowed to the manager's own zones through the collection point. An event outside "
        "them is a `404`, not a `403`: whether a record exists elsewhere in the network is "
        "not this account's to learn."
    ),
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsZonalManager])
def zonal_event(request, event_id: int):
    from apps.ai_events.models import AIEvent
    from apps.ai_events.serializers import AIEventDetailSerializer, AIEventTimelineSerializer

    codes = scope_of(request)
    events = AIEvent.objects.select_related(
        "mpp", "member", "non_member", "animal", "mait", "payment", "semen_batch"
    ).prefetch_related("consumables__consumable", "pregnancy_checks__ai_event__semen_batch")
    if codes is not None:
        events = events.filter(mpp__plant_code__in=codes)

    event = get_object_or_404(events, pk=event_id)
    trail = event.timeline_entries.select_related("actor").all()

    return Response(
        {
            **AIEventDetailSerializer(event, context={"request": request}).data,
            "timeline": AIEventTimelineSerializer(trail, many=True).data,
        }
    )
