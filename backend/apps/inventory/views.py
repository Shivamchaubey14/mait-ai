"""
Inventory endpoints (SRS §9.5).

The validation endpoint is the stock gate a Mait meets at step 4 of the capture flow. It
answers, and reserves nothing — stock is deducted only at completion, so a Mait who abandons
the flow here leaves their inventory untouched, which is correct because no insemination
happened.
"""

from __future__ import annotations

from django.conf import settings
from django.db.models import Min, Q, Sum
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.animals.models import BreedConfig
from apps.core.exceptions import (
    BreedRequired,
    InsufficientStock,
    RecordInUse,
    StrawAlreadyConsumed,
)
from apps.core.permissions import IsAdmin, IsMait
from apps.masterdata.models import Mait

from .models import Consumable, MaitInventory, MaitInventoryLedger, ProductType, SemenBatch
from .serializers import (
    ConsumableSerializer,
    ConsumableWriteSerializer,
    InventorySummarySerializer,
    LedgerEntrySerializer,
    MaitInventorySerializer,
    SemenBatchSerializer,
    StrawValidationSerializer,
)
from .services import available_straw_count, get_straw_for_mait, unnumbered_breeds


def _mait(request):
    return getattr(request.user, "mait_profile", None)


@extend_schema(tags=["inventory"])
class StrawValidateView(APIView):
    """Validate a scanned straw against this Mait's stock (SRS §6.3 step 4)."""

    permission_classes = [IsMait]

    @extend_schema(
        summary="Validate a scanned straw",
        description=(
            "Two rejections are kept distinct because the Mait's next action differs:\n\n"
            "- `not_in_stock` — the straw is not theirs. Raise an indent.\n"
            "- `already_used` — it was consumed by another AI event. A data problem worth "
            "reporting, not something to retry.\n\n"
            "Returns 200 with `valid: false` rather than an error status: a rejected scan is "
            "a normal outcome of the flow, not a failed request, and the app renders it as "
            "guidance rather than a crash."
        ),
        responses={200: StrawValidationSerializer},
    )
    def get(self, request, unique_no: str):
        mait = _mait(request)
        available = available_straw_count(mait)

        try:
            # Previewing only. The claim that names an unnumbered straw belongs to the event
            # that uses it, inside its own transaction — a GET must not rename anything.
            straw = get_straw_for_mait(
                mait, unique_no.strip(), breed=request.query_params.get("breed")
            )
        except BreedRequired:
            return Response(
                {
                    "valid": False,
                    "reason": "breed_required",
                    "straw": None,
                    "available_straws": available,
                    "breed_choices": unnumbered_breeds(mait),
                }
            )
        except StrawAlreadyConsumed:
            return Response(
                {
                    "valid": False,
                    "reason": "already_used",
                    "straw": None,
                    "available_straws": available,
                }
            )
        except InsufficientStock:
            return Response(
                {
                    "valid": False,
                    "reason": "not_in_stock",
                    "straw": None,
                    "available_straws": available,
                }
            )

        return Response(
            {
                "valid": True,
                "reason": None,
                "straw": SemenBatchSerializer(straw).data,
                "available_straws": available,
            }
        )


@extend_schema(
    tags=["inventory"],
    summary="What a Mait can ask for",
    description=(
        "The product catalogue behind the stock request form, split by category.\n\n"
        "Straws are absent on purpose: they are requested by breed, and the breed list is "
        "its own config endpoint (`/config/breeds/`).\n\n"
        "Consumables are used up and asked for by the dozen; equipment is issued once and "
        "kept. A Mait requesting five AI guns is a mistake, five boxes of gloves is a Tuesday "
        "— so the form treats them differently."
    ),
    responses={200: ConsumableSerializer(many=True)},
)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def product_catalogue(request):
    products = Consumable.objects.filter(is_active=True)
    return Response(ConsumableSerializer(products, many=True).data)


def build_summary(mait) -> dict:
    """
    One Mait's stock, split the way it gets used.

    Shared by the Mait's own endpoint and the admin's per-Mait view rather than written
    twice: an admin looking at a Mait's stock to answer a phone call has to be seeing the
    same numbers the Mait is looking at, or the call goes nowhere.
    """
    lines = list(
        MaitInventory.objects.filter(mait=mait, qty_available__gt=0).only(
            "product_type", "product_ref_id", "qty_available"
        )
    )

    straw_ids = [line.product_ref_id for line in lines if line.product_type == ProductType.STRAW]
    batches = SemenBatch.objects.in_bulk(straw_ids)

    # -- what the ledger already knows ------------------------------------------------------
    #
    # The balances say what is left. They do not say what a Mait started with, and on the stock
    # screen that is the difference between "2 straws" and "2 straws, because 8 of the 10 you
    # were issued have been used" — the second is a day's work accounted for, the first is a
    # number to worry about. The ledger has carried both all along; nothing asked it.
    #
    # One grouped query for the whole of a Mait's stock, read before anything is built, so no
    # row is assembled twice and nothing has to be matched back up afterwards.
    movements = (
        MaitInventoryLedger.objects.filter(inventory__mait=mait)
        .values("inventory__product_type", "inventory__product_ref_id")
        .annotate(
            credited=Sum("qty", filter=Q(qty__gt=0)),
            debited=Sum("qty", filter=Q(qty__lt=0)),
            first_issued_at=Min("created_at", filter=Q(qty__gt=0)),
        )
    )
    history = {
        (row["inventory__product_type"], row["inventory__product_ref_id"]): {
            "issued": row["credited"] or 0,
            # Debits are stored negative, which is right for summing to a balance and wrong
            # for reading on a card.
            "used": abs(row["debited"] or 0),
            "issued_at": row["first_issued_at"],
        }
        for row in movements
    }

    def movement_for(line) -> dict:
        # A line with no ledger behind it predates the ledger, or was seeded directly. Treating
        # what is in hand as what was issued is the honest reading — nothing is known to have
        # been used.
        return history.get(
            (line.product_type, line.product_ref_id),
            {"issued": line.qty_available, "used": 0, "issued_at": None},
        )

    by_breed: dict[str, int] = {}
    for line in lines:
        # The product_type check is not redundant. `product_ref_id` means SemenBatch.id for
        # straws and Consumable.id for everything else, and the two id spaces overlap — so a
        # box of 40 sheaths whose Consumable.id happens to match a straw id was being counted
        # as 40 straws of that breed. The number this endpoint exists to give is the one the
        # capture flow gates on, and it was reading high.
        if line.product_type != ProductType.STRAW:
            continue
        batch = batches.get(line.product_ref_id)
        if batch is not None:
            by_breed[batch.breed] = by_breed.get(batch.breed, 0) + line.qty_available

    consumable_ids = [
        line.product_ref_id for line in lines if line.product_type == ProductType.CONSUMABLE
    ]
    products = Consumable.objects.in_bulk(consumable_ids)

    # Split by category, because a Mait restocks them differently: consumables run out and
    # get reordered, equipment is issued once and only replaced when it breaks.
    consumables: list[dict] = []
    assets: list[dict] = []
    for line in lines:
        if line.product_type != ProductType.CONSUMABLE:
            continue
        product = products.get(line.product_ref_id)
        moved = movement_for(line)
        row = {
            "code": getattr(product, "code", ""),
            "name": getattr(product, "name", "Unknown"),
            "unit": getattr(product, "unit", ""),
            "qty": line.qty_available,
            "issued": moved["issued"],
            "used": moved["used"],
            # When it reached this Mait. Equipment is the case that needs it — a thing held
            # until the dairy asks for it back is described by how long it has been held.
            "issued_at": moved["issued_at"],
        }
        if getattr(product, "category", "consumable") == Consumable.Category.ASSET:
            assets.append(row)
        else:
            consumables.append(row)

    # -- straws, as rows rather than a bare tally -------------------------------------------
    #
    # `by_breed` stays exactly as it is: the capture flow and Home gate on it, and changing a
    # shape two screens depend on to add a field a third one wants is how those two break.
    # This is the same information with the species and the history alongside, so the stock
    # screen can group cow from buffalo without a second call and say what became of what.
    species = {
        config.code: config.animal_type
        for config in BreedConfig.objects.only("code", "animal_type")
    }
    breed_history: dict[str, dict] = {}
    for line in lines:
        if line.product_type != ProductType.STRAW:
            continue
        batch = batches.get(line.product_ref_id)
        if batch is None:
            continue
        moved = movement_for(line)
        slot = breed_history.setdefault(batch.breed, {"issued": 0, "used": 0})
        slot["issued"] += moved["issued"]
        slot["used"] += moved["used"]

    straws = [
        {
            "breed": breed,
            # Blank rather than guessed for a breed the administrator has since retired: the
            # straws are real and still in the flask, and filing them under the wrong species
            # is worse than filing them under none.
            "animal_type": species.get(breed, ""),
            "qty": qty,
            "issued": breed_history.get(breed, {}).get("issued", qty),
            "used": breed_history.get(breed, {}).get("used", 0),
        }
        for breed, qty in sorted(by_breed.items(), key=lambda item: (-item[1], item[0]))
    ]

    total = sum(by_breed.values())
    return {
        "total_straws": total,
        "is_low_stock": total <= settings.LOW_STOCK_THRESHOLD,
        "by_breed": by_breed,
        "straws": straws,
        "consumables": consumables,
        "assets": assets,
    }


@extend_schema(tags=["inventory"])
@api_view(["GET"])
@permission_classes([IsMait])
def inventory_summary(request):
    """
    The Mait's current stock, in the shape the app gates on (SRS §6.4.1).

    Refreshed at login and after every completed AI and fulfilled indent.
    """
    return Response(InventorySummarySerializer(build_summary(_mait(request))).data)


@extend_schema(
    tags=["inventory"],
    summary="One Mait's stock, for the admin",
    description=(
        "The same breakdown the Mait sees in the app — straws by breed, consumables and "
        "equipment — for whichever Mait is being looked at.\n\n"
        "The oversight list carries straw counts only, because that is what decides whether "
        "someone can work. This is the rest of the answer, for the moment an admin has a Mait "
        "on the phone."
    ),
    responses={200: InventorySummarySerializer},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def mait_inventory_detail(request, mait_id: int):
    mait = get_object_or_404(Mait, pk=mait_id)
    payload = build_summary(mait)
    payload["mait_id"] = mait.id
    payload["mait_name"] = mait.name
    payload["sahayak_vendor_code"] = mait.sahayak_vendor_code
    return Response(payload)


@extend_schema(tags=["inventory"])
class ProductAdminViewSet(viewsets.ModelViewSet):
    """
    Maintain the catalogue a Mait can ask for (SRS §6.6.1).

    Straws are absent by design — they are requested by breed, and the breed list is its own
    config. This is everything else: sheaths, gloves, liquid nitrogen, AI guns.

    Full CRUD, with one guard on delete: a product an indent or a stock row already points at
    cannot be removed, because those references carry no copy of the name and would be left
    reading as a quantity of something. Retiring takes it off the app and keeps the history
    legible. Deleting stays available for what it is actually for — a row added by mistake.
    """

    serializer_class = ConsumableWriteSerializer
    permission_classes = [IsAdmin]
    queryset = Consumable.objects.all().order_by("category", "display_order", "name")
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def perform_destroy(self, instance):
        from apps.indents.models import IndentRequest

        referenced = (
            IndentRequest.objects.filter(
                product_type=ProductType.CONSUMABLE, product_ref_id=instance.pk
            ).exists()
            or MaitInventory.objects.filter(
                product_type=ProductType.CONSUMABLE, product_ref_id=instance.pk
            ).exists()
        )
        if referenced:
            raise RecordInUse(
                f"{instance.name} is already on an indent or in a Mait's stock, so it cannot "
                "be deleted. Retire it instead — it disappears from the request form and the "
                "existing records keep their name."
            )
        instance.delete()

    @extend_schema(summary="List catalogue products", responses={200: ConsumableWriteSerializer})
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(
        summary="Add a catalogue product",
        description="`code` is set once here and never edited — indents key on it.",
        responses={201: ConsumableWriteSerializer},
    )
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @extend_schema(
        summary="Edit a catalogue product",
        description="Name, unit, rate, ordering and active state. `code` is ignored.",
        responses={200: ConsumableWriteSerializer},
    )
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    @extend_schema(
        summary="Delete a catalogue product",
        description=(
            "Only for a row added by mistake. A product already on an indent or in a Mait's "
            "stock answers `409 record-in-use` — retire it instead, which takes it off the "
            "request form and leaves those records still naming it."
        ),
    )
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)


@extend_schema(tags=["inventory"])
class InventoryLineViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The individual stock lines behind the summary."""

    serializer_class = MaitInventorySerializer
    permission_classes = [IsMait]

    def get_queryset(self):
        mait = _mait(self.request)
        if mait is None:
            return MaitInventory.objects.none()
        return MaitInventory.objects.filter(mait=mait, qty_available__gt=0).order_by("id")

    def get_serializer_context(self):
        """
        Resolve every straw in one query rather than one per row.

        A Mait holding fifty straws would otherwise cost fifty queries to render a list they
        open several times a day.
        """
        context = super().get_serializer_context()
        page = getattr(self, "_page_for_context", None) or self.get_queryset()
        ids = [row.product_ref_id for row in page if row.product_type == ProductType.STRAW]
        context["batches"] = SemenBatch.objects.in_bulk(ids)
        return context

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        self._page_for_context = page
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)


@extend_schema(tags=["inventory"])
class LedgerViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    Stock movement history (SRS §9.5).

    Append-only. Summing it must always reproduce the balance; a divergence means something
    wrote stock outside the service layer and is worth investigating.
    """

    serializer_class = LedgerEntrySerializer
    permission_classes = [IsMait]

    def get_queryset(self):
        mait = _mait(self.request)
        if mait is None:
            return MaitInventoryLedger.objects.none()
        return MaitInventoryLedger.objects.filter(inventory__mait=mait).select_related("inventory")

    @extend_schema(
        summary="Stock movement history",
        responses={200: LedgerEntrySerializer(many=True)},
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)


@extend_schema(
    tags=["inventory"],
    summary="Stock across every Mait",
    description=(
        "Admin oversight of where the straws are (SRS §6.7.6). The Mait-facing endpoints "
        "only ever report the caller's own stock, so this is the only view that can answer "
        "who is about to run out.\n\n"
        "A Mait at zero is reported separately from one merely low: at zero they cannot "
        "record an AI event at all, which is a stopped Mait rather than a warning."
    ),
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def inventory_oversight(request):
    lines = (
        MaitInventory.objects.filter(product_type=ProductType.STRAW, qty_available__gt=0)
        .select_related("mait")
        .prefetch_related("mait__mpps")
    )

    batches = SemenBatch.objects.in_bulk([line.product_ref_id for line in lines])

    # Rolled up per Mait and per breed in one pass. Doing it in SQL would need a join through
    # product_ref_id, which is a plain integer rather than a foreign key precisely so stock
    # can hold straws and consumables in one table.
    holders: dict[int, dict] = {}
    for line in lines:
        holder = holders.setdefault(
            line.mait_id,
            {
                "mait_id": line.mait_id,
                "name": line.mait.name,
                "sahayak_vendor_code": line.mait.sahayak_vendor_code,
                "mpp_codes": [mpp.mpp_code for mpp in line.mait.mpps.all()],
                "by_breed": {},
                "total": 0,
            },
        )
        batch = batches.get(line.product_ref_id)
        breed = batch.breed if batch else "unknown"
        holder["by_breed"][breed] = holder["by_breed"].get(breed, 0) + line.qty_available
        holder["total"] += line.qty_available

    # Every active Mait appears, including the ones holding nothing — they are the whole
    # point of the screen, and a list built only from stock rows would omit them.
    for mait in Mait.objects.filter(is_active=True).prefetch_related("mpps"):
        holders.setdefault(
            mait.id,
            {
                "mait_id": mait.id,
                "name": mait.name,
                "sahayak_vendor_code": mait.sahayak_vendor_code,
                "mpp_codes": [mpp.mpp_code for mpp in mait.mpps.all()],
                "by_breed": {},
                "total": 0,
            },
        )

    rows = sorted(holders.values(), key=lambda row: (row["total"], row["name"]))

    threshold = settings.LOW_STOCK_THRESHOLD
    return Response(
        {
            "summary": {
                "total_straws": sum(row["total"] for row in rows),
                "maits": len(rows),
                "low": sum(1 for row in rows if 0 < row["total"] <= threshold),
                "at_zero": sum(1 for row in rows if row["total"] == 0),
                "low_stock_threshold": threshold,
            },
            "results": rows,
        }
    )


@extend_schema(tags=["inventory"])
@api_view(["GET"])
@permission_classes([IsMait])
def ledger_balance_check(request):
    """
    Compare the stored balance against the ledger sum.

    Exposed because the two must never disagree — the balance is a materialised convenience
    and the ledger is the truth. A mismatch here is the earliest visible sign that something
    wrote stock without going through the service layer.
    """
    mait = _mait(request)
    rows = MaitInventory.objects.filter(mait=mait).annotate(ledger_sum=Sum("ledger_entries__qty"))
    divergent = [
        {
            "inventory_id": row.id,
            "balance": row.qty_available,
            "ledger_sum": row.ledger_sum or 0,
        }
        for row in rows
        if (row.ledger_sum or 0) != row.qty_available
    ]
    return Response({"consistent": not divergent, "divergent": divergent})
