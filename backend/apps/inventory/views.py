"""
Inventory endpoints (SRS §9.5).

The validation endpoint is the stock gate a Mait meets at step 4 of the capture flow. It
answers, and reserves nothing — stock is deducted only at completion, so a Mait who abandons
the flow here leaves their inventory untouched, which is correct because no insemination
happened.
"""

from __future__ import annotations

from django.conf import settings
from django.db.models import Sum
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import InsufficientStock, StrawAlreadyConsumed
from apps.core.permissions import IsAdmin, IsMait
from apps.masterdata.models import Mait

from .models import Consumable, MaitInventory, MaitInventoryLedger, ProductType, SemenBatch
from .serializers import (
    InventorySummarySerializer,
    LedgerEntrySerializer,
    MaitInventorySerializer,
    SemenBatchSerializer,
    StrawValidationSerializer,
)
from .services import available_straw_count, get_straw_for_mait


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
            straw = get_straw_for_mait(mait, unique_no.strip())
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


@extend_schema(tags=["inventory"])
@api_view(["GET"])
@permission_classes([IsMait])
def inventory_summary(request):
    """
    The Mait's current stock, in the shape the app gates on (SRS §6.4.1).

    Refreshed at login and after every completed AI and fulfilled indent.
    """
    mait = _mait(request)
    lines = list(
        MaitInventory.objects.filter(mait=mait, qty_available__gt=0).only(
            "product_type", "product_ref_id", "qty_available"
        )
    )

    straw_ids = [line.product_ref_id for line in lines if line.product_type == ProductType.STRAW]
    batches = SemenBatch.objects.in_bulk(straw_ids)

    by_breed: dict[str, int] = {}
    for line in lines:
        batch = batches.get(line.product_ref_id)
        if batch is not None:
            by_breed[batch.breed] = by_breed.get(batch.breed, 0) + line.qty_available

    consumable_ids = [
        line.product_ref_id for line in lines if line.product_type == ProductType.CONSUMABLE
    ]
    consumable_names = Consumable.objects.in_bulk(consumable_ids)
    consumables = [
        {
            "name": getattr(consumable_names.get(line.product_ref_id), "name", "Unknown"),
            "qty": line.qty_available,
        }
        for line in lines
        if line.product_type == ProductType.CONSUMABLE
    ]

    total = sum(by_breed.values())
    payload = {
        "total_straws": total,
        "is_low_stock": total <= settings.LOW_STOCK_THRESHOLD,
        "by_breed": by_breed,
        "consumables": consumables,
    }
    return Response(InventorySummarySerializer(payload).data)


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
