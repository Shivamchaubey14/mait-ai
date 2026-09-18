"""
Store endpoints.

Two audiences, two prefixes. ``/store/...`` is the keeper's app: one store's queue, its shelf,
and the handovers across its counter — never another store's, and nothing else in the
platform. ``/admin/stores/...`` is the portal's Stores screen, where head office decides which
depot serves which BMC/MCCs and who stands behind each counter.
"""

from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.models import PortalSection, Role, User
from apps.animals.models import BreedConfig
from apps.core.exceptions import RecordInUse
from apps.core.idempotency import idempotent
from apps.core.permissions import IsAdmin, IsStoreKeeper, in_section
from apps.core.services import record_audit
from apps.core.timeframe import end_of_day, start_of_day
from apps.indents.models import IndentHandover
from apps.inventory.models import Consumable
from apps.masterdata.models import plants_with_counts

from .models import Store, StorePlant
from .serializers import (
    AddKeeperSerializer,
    IssueSerializer,
    ItemNames,
    ReceiveSerializer,
    StoreAdminSerializer,
    StoreHandoverSerializer,
    StoreIndentSerializer,
    stock_lines,
)
from .services import (
    availability,
    cancel_handover,
    issue_from_store,
    open_indents,
    receive_stock,
    reissue_code,
)

# The most handovers one history request returns. A busy depot does a few dozen a day.
HISTORY_LIMIT = 500


def _store(request) -> Store:
    return request.user.store


def _matches(term: str) -> Q:
    """Search by what the keeper can read off the Mait or their slip: the name, or IND-13."""
    match = Q(mait__name__icontains=term) | Q(mait__sahayak_vendor_code__icontains=term)
    number = term.upper().removeprefix("IND").lstrip("-# ")
    if number.isdigit():
        match |= Q(pk=int(number))
    return match


# --------------------------------------------------------------------------------------
# The keeper's app
# --------------------------------------------------------------------------------------
@extend_schema(tags=["store"])
class StoreQueueViewSet(viewsets.ViewSet):
    """The store's counter: what is waiting to be handed over, and handing it over."""

    permission_classes = [IsStoreKeeper]

    @extend_schema(
        summary="What is waiting at this store",
        description=(
            "Approved indents routed to this store and not yet fully handed over, oldest "
            "approval first. Each row carries what the shelf can promise against it — "
            "`readiness` is `ready`, `short` or `waiting`. `search` matches the Mait's name, "
            "their vendor code, or the indent number (`IND-13` or `13`)."
        ),
        responses={200: StoreIndentSerializer(many=True)},
    )
    def list(self, request):
        store = _store(request)
        rows = open_indents(store)
        term = (request.query_params.get("search") or "").strip()
        if term:
            rows = rows.filter(_matches(term))
        context = {"shelf": availability(store), "names": ItemNames()}
        return Response(StoreIndentSerializer(rows, many=True, context=context).data)

    @extend_schema(summary="One indent in this store's queue", responses=StoreIndentSerializer)
    def retrieve(self, request, pk=None):
        store = _store(request)
        indent = get_object_or_404(open_indents(store), pk=pk)
        context = {"shelf": availability(store)}
        return Response(StoreIndentSerializer(indent, context=context).data)

    @extend_schema(
        summary="Hand an indent over",
        description=(
            "Sets `qty` aside for the Mait and returns the handover with its four-digit "
            "`collection_code`, which the keeper reads out. The Mait's stock rises — and the "
            "store's falls — only when they type it into *Confirm collection*.\n\n"
            "Issue less than is owed and the rest stays open on the same indent. Straws need "
            "`flask_checked`. Refused as `store-stock-short` beyond what the shelf can "
            "promise, counting what is already set aside for other Maits.\n\n"
            "Accepts an `Idempotency-Key`, so a tap repeated over a bad connection hands over "
            "once."
        ),
        request=IssueSerializer,
        responses={201: StoreHandoverSerializer},
    )
    @action(detail=True, methods=["post"])
    @idempotent(endpoint="store.issue")
    def issue(self, request, pk=None):
        store = _store(request)
        payload = IssueSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        indent = get_object_or_404(open_indents(store), pk=pk)
        handover = issue_from_store(
            indent,
            store=store,
            qty=payload.validated_data["qty"],
            flask_checked=payload.validated_data["flask_checked"],
            actor=request.user,
            request=request,
        )
        handover = IndentHandover.objects.select_related("indent__mait").get(pk=handover.pk)
        return Response(StoreHandoverSerializer(handover).data, status=status.HTTP_201_CREATED)


@extend_schema(tags=["store"])
class StoreHandoverViewSet(viewsets.ViewSet):
    """Handovers across this store's counter — the ones still waiting on a Mait, and today's."""

    permission_classes = [IsStoreKeeper]

    def _rows(self, request):
        return IndentHandover.objects.filter(store=_store(request)).select_related("indent__mait")

    @extend_schema(
        summary="Handovers at this store — the waiting list, and the history",
        description=(
            "Newest first. `state=waiting` for the ones a Mait has not collected yet — the "
            "keeper reads the code out again from here; `collected` and `cancelled` for the "
            "rest; `today` for everything issued today.\n\n"
            "The history screen narrows by `from` and `to` (local dates, `YYYY-MM-DD`, both "
            "inclusive) and `search` (the Mait's name or the indent number). At most "
            f"{HISTORY_LIMIT} rows — a keeper reads a month, not a year."
        ),
        responses={200: StoreHandoverSerializer(many=True)},
    )
    def list(self, request):
        rows = self._rows(request)
        params = request.query_params
        state = params.get("state")
        if state == "waiting":
            rows = rows.filter(collected_at__isnull=True, cancelled_at__isnull=True)
        elif state == "collected":
            rows = rows.filter(collected_at__isnull=False)
        elif state == "cancelled":
            rows = rows.filter(cancelled_at__isnull=False)
        elif state == "today":
            rows = rows.filter(issued_at__gte=start_of_day(timezone.localdate()))

        # Compared against the instants a local day starts and ends, never `__date`: MySQL
        # answers that with CONVERT_TZ, which is NULL on a database without timezone tables,
        # and the history would be empty on exactly the servers nobody thought to check.
        start, end = parse_date(params.get("from") or ""), parse_date(params.get("to") or "")
        if start:
            rows = rows.filter(issued_at__gte=start_of_day(start))
        if end:
            rows = rows.filter(issued_at__lte=end_of_day(end))

        term = (params.get("search") or "").strip()
        if term:
            match = Q(indent__mait__name__icontains=term)
            number = term.upper().removeprefix("IND").lstrip("-# ")
            if number.isdigit():
                match |= Q(indent_id=int(number))
            rows = rows.filter(match)

        return Response(
            StoreHandoverSerializer(
                rows.order_by("-issued_at")[:HISTORY_LIMIT],
                many=True,
                context={"names": ItemNames()},
            ).data
        )

    @extend_schema(summary="One handover", responses=StoreHandoverSerializer)
    def retrieve(self, request, pk=None):
        handover = get_object_or_404(self._rows(request), pk=pk)
        return Response(StoreHandoverSerializer(handover).data)

    @extend_schema(
        summary="Put an uncollected handover back",
        description=(
            "For a Mait who walked off without confirming. The stock stops being set aside "
            "and the quantity is open on the indent again."
        ),
        request=None,
        responses=StoreHandoverSerializer,
    )
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        handover = get_object_or_404(self._rows(request), pk=pk)
        cancel_handover(handover, store=_store(request), actor=request.user, request=request)
        handover = self._rows(request).get(pk=pk)
        return Response(StoreHandoverSerializer(handover).data)

    @extend_schema(
        summary="A fresh collection code",
        description="After too many wrong codes. The keeper reads the new one out.",
        request=None,
        responses=StoreHandoverSerializer,
    )
    @action(detail=True, methods=["post"], url_path="new-code")
    def new_code(self, request, pk=None):
        handover = get_object_or_404(self._rows(request), pk=pk)
        reissue_code(handover, store=_store(request), actor=request.user, request=request)
        handover = self._rows(request).get(pk=pk)
        return Response(StoreHandoverSerializer(handover).data)


@extend_schema(
    tags=["store"],
    summary="This store, and the figures on the keeper's first screen",
    description=(
        "`waiting` is every open indent in the queue and `short` the ones the shelf covers "
        "only part of; `issued_today` counts handovers and `not_collected` the ones a Mait "
        "has yet to confirm."
    ),
    responses=OpenApiTypes.OBJECT,
)
@api_view(["GET"])
@permission_classes([IsStoreKeeper])
def store_home(request):
    store = _store(request)
    shelf = availability(store)
    queue = list(open_indents(store))
    context = {"shelf": shelf}
    readiness = [StoreIndentSerializer(context=context).get_readiness(indent) for indent in queue]
    handovers = IndentHandover.objects.filter(store=store, cancelled_at__isnull=True)
    return Response(
        {
            "store": {
                "id": store.id,
                "code": store.code,
                "name": store.name,
                "zone_name": store.zone.name if store.zone_id else "",
                "plant_names": [p.plant_name or p.plant_code for p in store.plants.all()],
            },
            "waiting": len(queue),
            "ready": readiness.count("ready"),
            "short": readiness.count("short"),
            "empty": readiness.count("waiting"),
            "issued_today": handovers.filter(
                issued_at__gte=start_of_day(timezone.localdate())
            ).count(),
            "not_collected": handovers.filter(collected_at__isnull=True).count(),
        }
    )


@extend_schema(tags=["store"])
class StoreStockViewSet(viewsets.ViewSet):
    """The store's shelf, and deliveries onto it."""

    permission_classes = [IsStoreKeeper]

    @extend_schema(
        summary="What is on the shelf",
        description=(
            "One line per item the store holds: `on_hand` is what is physically there, "
            "`set_aside` what is issued and waiting for a Mait to collect, and `available` "
            "what can still be promised."
        ),
        responses=OpenApiTypes.OBJECT,
    )
    def list(self, request):
        return Response(stock_lines(_store(request)))

    @extend_schema(
        summary="Record a delivery into the store",
        description=(
            "Straws by `breed`, anything else by `product_ref_id` from the catalogue. Returns "
            "the shelf as it now stands. Accepts an `Idempotency-Key`, so a delivery recorded "
            "over a bad connection is counted once."
        ),
        request=ReceiveSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["post"])
    @idempotent(endpoint="store.receive")
    def receive(self, request):
        payload = ReceiveSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        receive_stock(
            store=_store(request),
            product_type=data["product_type"],
            breed=data.get("breed", ""),
            product_ref_id=data.get("product_ref_id") or 0,
            qty=data["qty"],
            note=data.get("note", ""),
            actor=request.user,
            request=request,
        )
        return Response(stock_lines(_store(request)), status=status.HTTP_201_CREATED)


@extend_schema(
    tags=["store"],
    summary="What a delivery can be",
    description="The breeds and products a keeper picks from when recording a delivery.",
    responses=OpenApiTypes.OBJECT,
)
@api_view(["GET"])
@permission_classes([IsStoreKeeper])
def store_catalogue(request):
    # Every active breed the admin has configured, cow and buffalo alike, in the order they set
    # — the keeper picks the animal first and then its breeds, the same two steps the portal's
    # own breed list is arranged in.
    #
    # Deduped per *animal type and code*, which is the model's own uniqueness. It used to be by
    # code alone, so a breed an admin added under the second animal type with a code the first
    # already used never reached this list at all — the keeper could not record a delivery of
    # something the portal said existed. Both are shelved under the one code, which is what the
    # shelf and the indent both key on.
    breeds = list(
        BreedConfig.objects.filter(is_active=True)
        .order_by("animal_type", "display_order", "name")
        .values("code", "name", "name_hi", "animal_type")
    )
    products = Consumable.objects.filter(is_active=True).values("id", "name", "unit", "category")
    return Response({"breeds": breeds, "products": list(products)})


# --------------------------------------------------------------------------------------
# The portal's Stores screen
# --------------------------------------------------------------------------------------
@extend_schema(tags=["stores"])
class StoreAdminViewSet(viewsets.ModelViewSet):
    """
    Which depot serves which BMC/MCCs, and who works each counter.

    Every write is audited: a BMC/MCC moving between stores changes where a village's Maits
    are sent to collect, and "why did Sunil's indent go to Barsana" needs an answer.
    """

    serializer_class = StoreAdminSerializer
    permission_classes = [IsAdmin, in_section(PortalSection.STORES)]
    queryset = Store.objects.select_related("zone").prefetch_related("plants").order_by("name")
    pagination_class = None

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["names"] = ItemNames()
        return context

    def perform_create(self, serializer):
        store = serializer.save()
        record_audit(
            action="create",
            entity_type="store",
            entity_id=store.id,
            request=self.request,
            meta={"code": store.code, "name": store.name, "plants": store.plant_codes},
        )

    def perform_update(self, serializer):
        before = serializer.instance.plant_codes
        store = serializer.save()
        record_audit(
            action="update",
            entity_type="store",
            entity_id=store.id,
            request=self.request,
            meta={
                "code": store.code,
                "plants": {"before": sorted(before), "after": sorted(store.plant_codes)},
                "is_active": store.is_active,
            },
        )

    def perform_destroy(self, instance):
        """
        Delete only a store nothing has happened at.

        Indents, handovers and the shelf's ledger all point at it, and they carry no copy of
        its name. Closing it — inactive — takes it out of every queue and every sign-in and
        keeps the history readable.
        """
        if instance.indents.exists() or instance.handovers.exists() or instance.stock.exists():
            raise RecordInUse(
                f"{instance.name} has indents and stock on its records. Make it inactive instead."
            )
        record_audit(
            action="delete",
            entity_type="store",
            entity_id=instance.id,
            request=self.request,
            meta={"code": instance.code, "name": instance.name},
        )
        User.objects.filter(store=instance, role=Role.STORE).update(is_active=False)
        instance.delete()

    @extend_schema(summary="Every BMC/MCC, and the store that serves it")
    @action(detail=False, methods=["get"], url_path="plants")
    def plants(self, request):
        served = {row.plant_code: row for row in StorePlant.objects.select_related("store")}
        rows = []
        for plant in plants_with_counts():
            held = served.get(plant["plant_code"])
            rows.append(
                {
                    **plant,
                    "store_id": held.store_id if held else None,
                    "store_name": held.store.name if held else "",
                }
            )
        return Response(
            {
                "count": len(rows),
                "unserved": sum(1 for row in rows if not row["store_id"]),
                "results": rows,
            }
        )

    @extend_schema(
        summary="Give a store a keeper",
        description=(
            "Makes a store-keeper account from a name and a mobile number. They sign in to the "
            "app with that number and an OTP, the same way a Mait does, and see this store's "
            "queue and nothing else."
        ),
        request=AddKeeperSerializer,
    )
    @action(detail=True, methods=["post"], url_path="keepers")
    def add_keeper(self, request, pk=None):
        store = self.get_object()
        payload = AddKeeperSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        keeper = User.objects.create_user(
            username=f"store-{data['mobile_no']}",
            full_name=data["full_name"],
            mobile_no=data["mobile_no"],
            role=Role.STORE,
            store=store,
        )
        record_audit(
            action="create",
            entity_type="user",
            entity_id=keeper.id,
            request=request,
            meta={"role": Role.STORE, "store": store.code},
        )
        return Response(self.get_serializer(store).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Take a keeper off a store",
        description="Deactivates the account, so it can no longer sign in.",
        request=None,
    )
    @action(detail=True, methods=["post"], url_path=r"keepers/(?P<user_id>\d+)/remove")
    def remove_keeper(self, request, pk=None, user_id=None):
        store = self.get_object()
        keeper = get_object_or_404(User, pk=user_id, store=store, role=Role.STORE)
        keeper.is_active = False
        keeper.save(update_fields=["is_active", "updated_at"])
        record_audit(
            action="update",
            entity_type="user",
            entity_id=keeper.id,
            request=request,
            meta={"is_active": False, "store": store.code},
        )
        return Response(self.get_serializer(store).data)
