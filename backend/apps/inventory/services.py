"""
Inventory movement services.

Every change to a Mait's stock goes through this module. Nothing else writes
``MaitInventory.qty_available`` — that is what keeps the balance and the ledger in agreement.

The locking discipline here is the implementation of ADR 0002. Read it before changing
anything in ``consume_straw``.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models import Sum

from apps.core.exceptions import InsufficientStock, StrawAlreadyConsumed

from .models import MaitInventory, MaitInventoryLedger, ProductType, SemenBatch

logger = logging.getLogger(__name__)


def get_straw_for_mait(mait, straw_unique_no: str) -> SemenBatch:
    """
    Resolve a scanned straw number and confirm this Mait may use it (SRS §6.3 step 4).

    Two distinct rejections, because the field user needs to know which one it is: "not in
    your stock" means raise an indent, "already used" means a data problem worth reporting.
    """
    try:
        straw = SemenBatch.objects.get(unique_straw_no=straw_unique_no)
    except SemenBatch.DoesNotExist:
        raise InsufficientStock(
            f"Straw {straw_unique_no} is not recognised. Check the number and try again."
        ) from None

    if straw.is_consumed:
        raise StrawAlreadyConsumed(
            f"Straw {straw_unique_no} has already been used for another AI event."
        )

    holding = MaitInventory.objects.filter(
        mait=mait,
        product_type=ProductType.STRAW,
        product_ref_id=straw.id,
        qty_available__gt=0,
    ).exists()
    if not holding:
        raise InsufficientStock(
            f"Straw {straw_unique_no} is not in your current stock. Raise a new indent."
        )

    return straw


def consume_straw(*, mait, straw: SemenBatch, ai_event_id: int, actor=None) -> MaitInventory:
    """
    Deduct one straw from a Mait's stock.

    **Must be called inside an open transaction** — the caller owns the transaction so the
    deduction and the AI event's status change commit together or not at all (SRS §6.4.3).
    Calling this outside one would let a crash between the two writes leave a consumed
    straw with no completed event.

    The row lock serialises concurrent completions: the second caller blocks here, and by
    the time it reads ``qty_available`` the first deduction is already visible.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError(
            "consume_straw() must run inside a transaction — see ADR 0002."
        )

    try:
        inventory = (
            MaitInventory.objects.select_for_update()
            .get(mait=mait, product_type=ProductType.STRAW, product_ref_id=straw.id)
        )
    except MaitInventory.DoesNotExist:
        raise InsufficientStock(
            f"Straw {straw.unique_straw_no} is not in your current stock."
        ) from None

    # Re-checked after acquiring the lock, not before. Checking first would be the exact
    # race this lock exists to prevent.
    if inventory.qty_available < 1:
        raise InsufficientStock(
            f"Straw {straw.unique_straw_no} is no longer in your stock."
        )

    # Re-read under the lock as well: a concurrent completion may have consumed it between
    # validation and here.
    straw.refresh_from_db(fields=["is_consumed"])
    if straw.is_consumed:
        raise StrawAlreadyConsumed(
            f"Straw {straw.unique_straw_no} has already been used for another AI event."
        )

    inventory.qty_available -= 1
    inventory.save(update_fields=["qty_available", "updated_at"])

    straw.is_consumed = True
    straw.save(update_fields=["is_consumed", "updated_at"])

    MaitInventoryLedger.objects.create(
        inventory=inventory,
        txn_type=MaitInventoryLedger.TxnType.CONSUME,
        qty=-1,
        balance_after=inventory.qty_available,
        ref_type=MaitInventoryLedger.RefType.AI_EVENT,
        ref_id=ai_event_id,
        created_by=actor,
    )

    logger.info(
        "Straw consumed", extra={"mait_id": mait.id, "ai_event_id": ai_event_id,
                                 "balance_after": inventory.qty_available},
    )
    return inventory


@transaction.atomic
def credit_stock(
    *,
    mait,
    product_type: str,
    product_ref_id: int,
    qty: int,
    ref_type: str,
    ref_id: int | None = None,
    actor=None,
    note: str = "",
) -> MaitInventory:
    """
    Add stock to a Mait, normally when Indent Easy reports goods issued (SRS §6.6.3).

    Idempotency is the caller's responsibility: the webhook handler dedupes on the Indent
    Easy reference before calling this, so a redelivered callback does not double-credit.
    """
    if qty <= 0:
        raise ValueError("credit_stock requires a positive quantity.")

    inventory, _ = MaitInventory.objects.select_for_update().get_or_create(
        mait=mait,
        product_type=product_type,
        product_ref_id=product_ref_id,
        defaults={"qty_available": 0},
    )
    inventory.qty_available += qty
    inventory.save(update_fields=["qty_available", "updated_at"])

    MaitInventoryLedger.objects.create(
        inventory=inventory,
        txn_type=MaitInventoryLedger.TxnType.ISSUE,
        qty=qty,
        balance_after=inventory.qty_available,
        ref_type=ref_type,
        ref_id=ref_id,
        created_by=actor,
        note=note,
    )
    return inventory


def available_straw_count(mait) -> int:
    """Total straws a Mait currently holds — the number the app gates the flow on."""
    return (
        MaitInventory.objects.filter(mait=mait, product_type=ProductType.STRAW).aggregate(
            total=Sum("qty_available")
        )["total"]
        or 0
    )


def reconcile_balance(inventory: MaitInventory) -> tuple[int, int]:
    """
    Compare the stored balance against the ledger sum.

    Used by the low-stock job as a cheap integrity probe. They should never differ; if they
    do, something wrote the balance outside this module and that is worth an alert.
    """
    ledger_sum = (
        inventory.ledger_entries.aggregate(total=Sum("qty"))["total"] or 0
    )
    return inventory.qty_available, ledger_sum
