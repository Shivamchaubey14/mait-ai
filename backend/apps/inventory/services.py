"""
Inventory movement services.

Every change to a Mait's stock goes through this module. Nothing else writes
``MaitInventory.qty_available`` — that is what keeps the balance and the ledger in agreement.

The locking discipline here is the implementation of ADR 0002. Read it before changing
anything in ``consume_straw``.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.db.models import Sum

from apps.core.exceptions import BreedRequired, InsufficientStock, StrawAlreadyConsumed

from .models import MaitInventory, MaitInventoryLedger, ProductType, SemenBatch

logger = logging.getLogger(__name__)


def unnumbered_breeds(mait) -> list[str]:
    """Breeds this Mait holds as unnumbered stock, for disambiguating a claim."""
    holdings = MaitInventory.objects.filter(
        mait=mait, product_type=ProductType.STRAW, qty_available__gt=0
    ).values_list("product_ref_id", flat=True)
    return sorted(
        SemenBatch.objects.filter(id__in=list(holdings), is_unnumbered=True, is_consumed=False)
        .values_list("breed", flat=True)
        .distinct()
    )


def _claim_unnumbered(mait, straw_unique_no: str, breed: str | None, claim: bool) -> SemenBatch:
    """
    Resolve a number the platform has never seen against unnumbered stock the Mait holds.

    Straws issued as "25 MURRAH" arrive with no numbers — the depot hands over a bundle and
    the number that matters is the one printed on whichever straw is used. So the first time
    a Mait names one, it claims a placeholder from their balance and becomes that straw.

    Uniqueness is unaffected: the number is written onto a row the Mait already holds, and
    the unique constraint still means one number can serve exactly one animal.
    """
    available = SemenBatch.objects.filter(
        id__in=list(
            MaitInventory.objects.filter(
                mait=mait, product_type=ProductType.STRAW, qty_available__gt=0
            ).values_list("product_ref_id", flat=True)
        ),
        is_unnumbered=True,
        is_consumed=False,
    )
    if breed:
        available = available.filter(breed=breed.strip().upper())

    candidate = available.order_by("id").first()
    if candidate is None:
        raise InsufficientStock(
            f"Straw {straw_unique_no} is not in your current stock. Raise a new indent."
        )

    # Ambiguous only when the Mait is carrying more than one breed of unnumbered stock: the
    # number alone cannot say which bundle it came out of, and guessing would record the
    # wrong bull against the animal.
    if not breed and available.values("breed").distinct().count() > 1:
        raise BreedRequired(f"Straw {straw_unique_no} is not on record yet. Say which breed it is.")

    if not claim:
        return candidate

    candidate.unique_straw_no = straw_unique_no
    candidate.is_unnumbered = False
    try:
        with transaction.atomic():
            candidate.save(update_fields=["unique_straw_no", "is_unnumbered", "updated_at"])
    except IntegrityError:
        # Another event claimed this number between the lookup and here. The number is taken;
        # this Mait's placeholder is untouched and still theirs to name something else.
        raise StrawAlreadyConsumed(
            f"Straw {straw_unique_no} has already been recorded against another AI event."
        ) from None

    logger.info(
        "Unnumbered straw claimed",
        extra={"mait_id": mait.id, "straw_id": candidate.id, "breed": candidate.breed},
    )
    return candidate


def get_straw_for_mait(
    mait, straw_unique_no: str, *, breed: str | None = None, claim: bool = False
) -> SemenBatch:
    """
    Resolve a scanned straw number and confirm this Mait may use it (SRS §6.3 step 4).

    Two distinct rejections, because the field user needs to know which one it is: "not in
    your stock" means raise an indent, "already used" means a data problem worth reporting.

    A number the platform has never seen is not automatically a mistake — stock issued as a
    quantity of a breed carries no numbers until a Mait reads one off a straw. ``claim``
    decides whether that naming is written: the validation endpoint previews without claiming,
    and the event that actually uses the straw claims inside its own transaction.
    """
    try:
        straw = SemenBatch.objects.get(unique_straw_no=straw_unique_no)
    except SemenBatch.DoesNotExist:
        return _claim_unnumbered(mait, straw_unique_no, breed, claim)

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


def take_straw_of_breed(mait, breed: str) -> SemenBatch:
    """
    Pick one straw of a breed out of this Mait's holding, without anybody reading a number.

    **Why no number is asked for.** A straw lives in liquid nitrogen at -196degC. Lifting the
    goblet high enough to read the number printed on a straw warms every straw in it, and the
    damage is cumulative and invisible — the cost of that scan is not the Mait's time, it is
    the viability of the semen they are about to use and of everything sitting beside it. The
    number was a good identifier on paper and a bad instruction in a yard.

    So the gate becomes a count rather than an identity: a Mait holding ten straws of a breed
    can complete ten inseminations of it, and the eleventh is refused for want of stock. What
    is lost is the ability to say *which* straw went into which animal — kept anyway wherever
    the depot issued numbered stock, because the row picked here carries its own number.

    Oldest first, by received date: semen is perishable, and a flask worked front-to-back
    would leave the oldest straws to expire at the bottom.

    **A straw already held by an unfinished capture is not offered again.** Nothing is
    deducted until completion, so for a while the only record that a straw is spoken for is
    the open event holding it — and without this the picker handed the same oldest straw to
    every capture started before any of them closed. The first to complete consumed it and
    every other one was refused for want of stock *forever*: an insemination that happened,
    with a record that could never be closed, however many times the Mait opened it. The count
    is the gate, and this is what makes the count mean anything.
    """
    code = (breed or "").strip().upper()
    if not code:
        raise BreedRequired("Say which breed of straw is being used.")

    holdings = MaitInventory.objects.filter(
        mait=mait, product_type=ProductType.STRAW, qty_available__gt=0
    ).values_list("product_ref_id", flat=True)

    in_stock = SemenBatch.objects.filter(id__in=list(holdings), breed=code, is_consumed=False)

    # Imported here rather than at module scope: the AI event services import this module, and
    # naming them at the top would close the loop.
    from apps.ai_events.models import AIEvent

    spoken_for = set(
        AIEvent.objects.filter(
            mait=mait,
            status__in=AIEvent.UNFINISHED_STATUSES,
            semen_batch__isnull=False,
        ).values_list("semen_batch_id", flat=True)
    )

    straw = in_stock.exclude(id__in=spoken_for).order_by("received_date", "id").first()
    if straw is not None:
        return straw

    # Nothing free. Which of the two reasons it is decides what the Mait should do about it,
    # so they are not collapsed into one sentence: raising an indent does not help somebody
    # whose straws are all held by captures sitting on their own phone.
    if in_stock.exists():
        raise InsufficientStock(
            f"Your {code} straws are all held by captures you have not finished. "
            f"Finish one from AI events, then try again."
        )
    raise InsufficientStock(f"You are not carrying any {code} straws. Raise a new indent.")


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
        raise RuntimeError("consume_straw() must run inside a transaction — see ADR 0002.")

    try:
        inventory = MaitInventory.objects.select_for_update().get(
            mait=mait, product_type=ProductType.STRAW, product_ref_id=straw.id
        )
    except MaitInventory.DoesNotExist:
        raise InsufficientStock(
            f"Straw {straw.unique_straw_no} is not in your current stock."
        ) from None

    # Re-checked after acquiring the lock, not before. Checking first would be the exact
    # race this lock exists to prevent.
    if inventory.qty_available < 1:
        raise InsufficientStock(f"Straw {straw.unique_straw_no} is no longer in your stock.")

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
        "Straw consumed",
        extra={
            "mait_id": mait.id,
            "ai_event_id": ai_event_id,
            "balance_after": inventory.qty_available,
        },
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
    ledger_sum = inventory.ledger_entries.aggregate(total=Sum("qty"))["total"] or 0
    return inventory.qty_available, ledger_sum
