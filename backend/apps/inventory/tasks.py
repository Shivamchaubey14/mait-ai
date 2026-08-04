"""Inventory housekeeping and integrity probes."""

from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.db.models import Sum

from .models import MaitInventory, ProductType

logger = logging.getLogger(__name__)


@shared_task(name="apps.inventory.tasks.flag_low_stock_maits")
def flag_low_stock_maits() -> list[int]:
    """
    Identify Maits running low on straws, for the admin exception view (SRS §6.7.6).

    Runs early each morning so a Mait can raise an indent before setting out, rather than
    discovering an empty flask in a village.
    """
    threshold = settings.LOW_STOCK_THRESHOLD
    low = (
        MaitInventory.objects.filter(product_type=ProductType.STRAW)
        .values("mait_id", "mait__name")
        .annotate(total=Sum("qty_available"))
        .filter(total__lte=threshold)
    )
    mait_ids = [row["mait_id"] for row in low]
    for row in low:
        logger.warning(
            "Mait low on straws",
            extra={"mait_id": row["mait_id"], "balance": row["total"], "threshold": threshold},
        )
    return mait_ids


@shared_task(name="apps.inventory.tasks.verify_ledger_integrity")
def verify_ledger_integrity() -> list[int]:
    """
    Check that every stored balance still equals the sum of its ledger entries.

    They should never diverge — the balance is only ever written by
    ``apps.inventory.services``. A divergence means something bypassed that module, which is
    worth finding before it turns into a stock dispute.
    """
    broken: list[int] = []
    for inventory in MaitInventory.objects.iterator(chunk_size=500):
        ledger_sum = inventory.ledger_entries.aggregate(t=Sum("qty"))["t"] or 0
        if ledger_sum != inventory.qty_available:
            broken.append(inventory.id)
            logger.error(
                "Inventory balance diverges from its ledger",
                extra={
                    "inventory_id": inventory.id,
                    "balance": inventory.qty_available,
                    "ledger_sum": ledger_sum,
                },
            )
    return broken
