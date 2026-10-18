"""
Inventory movement services.

Every change to a Mait's stock goes through this module. Nothing else writes
``MaitInventory.qty_available`` — that is what keeps the balance and the ledger in agreement.

The locking discipline here is the implementation of ADR 0002. Read it before changing
anything in ``consume_straw``.
"""

from __future__ import annotations

import logging
import secrets
from datetime import date

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers

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
    #
    # Every straw held by an open capture comes from the rows that hold them — an event using
    # two doses holds two, and reading only `semen_batch` would offer the second one away.
    from apps.ai_events.models import AIEvent, AIEventStraw

    spoken_for = set(
        AIEventStraw.objects.filter(
            ai_event__mait=mait, ai_event__status__in=AIEvent.UNFINISHED_STATUSES
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


def consume_supply(*, mait, consumable, qty: int, ai_event_id: int, actor=None) -> MaitInventory:
    """
    Take a consumable off a Mait's stock — sheaths, gloves, whatever the visit used.

    The same rules as a straw and for the same reason: **must run inside an open transaction**,
    so the deduction and the event that caused it commit together, and the row is locked so two
    completions arriving at once cannot both spend the last sheath.

    Unlike a straw it is a quantity rather than an identity — there is no row per glove — so
    the guard is the balance, and the check runs after the lock rather than before it.
    """
    if qty <= 0:
        raise ValueError("consume_supply requires a positive quantity.")
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("consume_supply() must run inside a transaction — see ADR 0002.")

    try:
        inventory = MaitInventory.objects.select_for_update().get(
            mait=mait, product_type=ProductType.CONSUMABLE, product_ref_id=consumable.id
        )
    except MaitInventory.DoesNotExist:
        raise InsufficientStock(f"You are not carrying any {consumable.name}.") from None

    if inventory.qty_available < qty:
        raise InsufficientStock(
            f"You have {inventory.qty_available} {consumable.name} left, not {qty}."
        )

    inventory.qty_available -= qty
    inventory.save(update_fields=["qty_available", "updated_at"])

    MaitInventoryLedger.objects.create(
        inventory=inventory,
        txn_type=MaitInventoryLedger.TxnType.CONSUME,
        qty=-qty,
        balance_after=inventory.qty_available,
        ref_type=MaitInventoryLedger.RefType.AI_EVENT,
        ref_id=ai_event_id,
        created_by=actor,
    )

    logger.info(
        "Consumable used",
        extra={
            "mait_id": mait.id,
            "ai_event_id": ai_event_id,
            "consumable": consumable.code,
            "qty": qty,
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
    txn_type: str = MaitInventoryLedger.TxnType.ISSUE,
) -> MaitInventory:
    """
    Add stock to a Mait, normally when they collect an indent at a store (SRS §6.6.8).

    Idempotency is the caller's responsibility: the webhook handler dedupes on the Indent
    Easy reference before calling this, so a redelivered callback does not double-credit.

    ``txn_type`` is ``issue`` for the ordinary path — stock arriving against an indent. The
    office's own correction passes ``adjustment`` (with ``ref_type=manual``), so the ledger
    tells apart what a store handed over from what a desk credited by hand.
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
        txn_type=txn_type,
        qty=qty,
        balance_after=inventory.qty_available,
        ref_type=ref_type,
        ref_id=ref_id,
        created_by=actor,
        note=note,
    )
    return inventory


def _new_placeholder_straw(breed: str) -> SemenBatch:
    """
    One unnumbered placeholder straw, with a number short enough to store.

    ``unique_straw_no`` is 30 characters. The number only has to be unique and recognisable as
    a manual adjustment — the breed lives in its own column and the ledger note says where the
    straw came from — so it is a short random token rather than the breed, the Mait id and the
    clock strung together, which ran past 30 for a long breed code (``SEX_SORTED_SEMEN``) and
    failed the write with "Data too long".

    Each attempt is its own savepoint, so the one-in-astronomical collision that trips the
    unique constraint rolls back cleanly and retries rather than poisoning the transaction the
    credit runs in.
    """
    for _ in range(6):
        number = f"ADJ-{secrets.token_hex(6)}"  # 16 chars, well inside the column
        try:
            with transaction.atomic():
                return SemenBatch.objects.create(
                    unique_straw_no=number,
                    breed=breed,
                    received_date=timezone.localdate(),
                    is_unnumbered=True,
                )
        except IntegrityError:
            continue
    raise IntegrityError("Could not allocate a unique placeholder straw number.")


@transaction.atomic
def add_mait_stock(
    *,
    mait,
    product_type: str,
    qty: int,
    breed: str = "",
    product_ref_id: int = 0,
    actor=None,
    note: str = "",
    request=None,
) -> None:
    """
    Credit stock straight to a Mait from the office — a manual adjustment, not an indent.

    The ordinary path is a store handing an approved indent over the counter (SRS §6.6.7).
    This is the exception the oversight screen needs for the stock that never walked that path:
    an opening balance when the platform goes live mid-season, straws carried over by hand, a
    count the desk has to put right. Recorded as an ``adjustment`` against ``manual`` so the
    ledger still sums to the balance and the audit trail still names who did it.

    Straws are credited by breed — one unnumbered placeholder row per straw, exactly as an
    unnumbered indent collection makes them (``apps.indents.services``) — so the number the
    Mait reads off the straw at the AI step still claims a row they already hold. Everything
    else is credited against its catalogue id.

    The caller is trusted to have validated ``breed`` / ``product_ref_id`` against the
    catalogue (see ``MaitStockCreditSerializer``); the ``qty`` guard here is the last word.
    """
    # Imported here rather than at module scope: the core services module reaches back into
    # inventory in places, and naming it at the top would risk closing the loop at startup.
    from apps.core.models import AuditLog
    from apps.core.services import record_audit

    if qty <= 0:
        raise serializers.ValidationError({"qty": ["Add at least one."]})

    if product_type == ProductType.STRAW:
        code = (breed or "").strip().upper()
        if not code:
            raise serializers.ValidationError({"breed": ["Say which breed is being added."]})
        for _ in range(qty):
            straw = _new_placeholder_straw(code)
            credit_stock(
                mait=mait,
                product_type=ProductType.STRAW,
                product_ref_id=straw.id,
                qty=1,
                ref_type=MaitInventoryLedger.RefType.MANUAL,
                txn_type=MaitInventoryLedger.TxnType.ADJUSTMENT,
                actor=actor,
                note=(note or f"Office adjustment · {code}")[:255],
            )
        item = code
    else:
        if not product_ref_id:
            raise serializers.ValidationError(
                {"product_ref_id": ["Say which product is being added."]}
            )
        credit_stock(
            mait=mait,
            product_type=product_type,
            product_ref_id=product_ref_id,
            qty=qty,
            ref_type=MaitInventoryLedger.RefType.MANUAL,
            txn_type=MaitInventoryLedger.TxnType.ADJUSTMENT,
            actor=actor,
            note=(note or "Office adjustment")[:255],
        )
        item = product_ref_id

    record_audit(
        action=AuditLog.Action.CREATE,
        entity_type="mait_stock",
        entity_id=mait.id,
        actor=actor,
        request=request,
        meta={
            "mait": mait.sahayak_vendor_code,
            "product_type": product_type,
            "item": item,
            "qty": qty,
            "note": (note or "")[:255],
        },
    )


def _remove_supply(mait, product_type: str, product_ref_id: int, qty: int, actor, note: str) -> None:
    """Take a quantity of one consumable or asset off a Mait, as an office adjustment."""
    try:
        inventory = MaitInventory.objects.select_for_update().get(
            mait=mait, product_type=product_type, product_ref_id=product_ref_id
        )
    except MaitInventory.DoesNotExist:
        raise serializers.ValidationError(
            {"qty": ["This Mait is not carrying that product, so there is nothing to remove."]}
        ) from None

    if inventory.qty_available < qty:
        raise serializers.ValidationError(
            {
                "qty": [
                    f"They hold only {inventory.qty_available}, so {qty} cannot be removed."
                ]
            }
        )

    inventory.qty_available -= qty
    inventory.save(update_fields=["qty_available", "updated_at"])
    MaitInventoryLedger.objects.create(
        inventory=inventory,
        txn_type=MaitInventoryLedger.TxnType.ADJUSTMENT,
        qty=-qty,
        balance_after=inventory.qty_available,
        ref_type=MaitInventoryLedger.RefType.MANUAL,
        ref_id=None,
        created_by=actor,
        note=(note or "Office adjustment · removed")[:255],
    )


def _remove_straws_of_breed(mait, code: str, qty: int, actor, note: str) -> None:
    """
    Take ``qty`` straws of a breed off a Mait, oldest first — the mirror of crediting them.

    Each straw is its own row (``add_mait_stock`` makes one placeholder per straw), so this
    zeroes whole rows rather than decrementing a tally, writing a ``-1`` adjustment against
    each. Straws already held by an unfinished capture on the Mait's phone are left alone: a
    capture that still has to complete needs the straw it is standing on, and removing it
    underneath would strand an event that can never be closed (``take_straw_of_breed`` keeps
    the same ones back for the same reason).
    """
    from apps.ai_events.models import AIEvent, AIEventStraw

    rows = list(
        MaitInventory.objects.select_for_update().filter(
            mait=mait, product_type=ProductType.STRAW, qty_available__gt=0
        )
    )
    batches = SemenBatch.objects.in_bulk([row.product_ref_id for row in rows])
    of_breed = [row for row in rows if getattr(batches.get(row.product_ref_id), "breed", None) == code]

    spoken_for = set(
        AIEventStraw.objects.filter(
            ai_event__mait=mait, ai_event__status__in=AIEvent.UNFINISHED_STATUSES
        ).values_list("semen_batch_id", flat=True)
    )
    free = [row for row in of_breed if row.product_ref_id not in spoken_for]
    # Oldest first, so a correction spends the straws nearest to expiring; an unknown received
    # date sorts last rather than jumping the queue.
    free.sort(key=lambda row: (batches[row.product_ref_id].received_date or date.max, row.id))

    if qty > len(free):
        held = sum(row.qty_available for row in of_breed)
        if held >= qty:
            raise serializers.ValidationError(
                {
                    "qty": [
                        f"{qty - len(free)} of those {code} straws are held by unfinished "
                        "captures and cannot be removed. Finish or cancel those events first."
                    ]
                }
            )
        raise serializers.ValidationError(
            {"qty": [f"This Mait holds only {held} {code} straw(s)."]}
        )

    for row in free[:qty]:
        row.qty_available = 0
        row.save(update_fields=["qty_available", "updated_at"])
        MaitInventoryLedger.objects.create(
            inventory=row,
            txn_type=MaitInventoryLedger.TxnType.ADJUSTMENT,
            qty=-1,
            balance_after=0,
            ref_type=MaitInventoryLedger.RefType.MANUAL,
            ref_id=None,
            created_by=actor,
            note=(note or f"Office adjustment · removed {code}")[:255],
        )


@transaction.atomic
def remove_mait_stock(
    *,
    mait,
    product_type: str,
    qty: int,
    breed: str = "",
    product_ref_id: int = 0,
    actor=None,
    note: str = "",
    request=None,
) -> None:
    """
    Take stock off a Mait from the office — the mirror of :func:`add_mait_stock`.

    The one correction the oversight screen could not make: a count entered too high, stock
    recorded against the wrong Mait, equipment handed back. Recorded as an ``adjustment``
    against ``manual`` with a negative quantity, so the ledger still sums to the balance and the
    audit trail still names who did it — a balance is never *set* by hand, only moved.

    Straws come off by breed (oldest first); everything else by its catalogue id. The caller is
    trusted to have validated ``breed`` / ``product_ref_id`` against the catalogue
    (``MaitStockCreditSerializer``); the ``qty`` and holding guards here are the last word.
    """
    from apps.core.models import AuditLog
    from apps.core.services import record_audit

    if qty <= 0:
        raise serializers.ValidationError({"qty": ["Remove at least one."]})

    if product_type == ProductType.STRAW:
        code = (breed or "").strip().upper()
        if not code:
            raise serializers.ValidationError({"breed": ["Say which breed is being removed."]})
        _remove_straws_of_breed(mait, code, qty, actor, note)
        item = code
    else:
        if not product_ref_id:
            raise serializers.ValidationError(
                {"product_ref_id": ["Say which product is being removed."]}
            )
        _remove_supply(mait, product_type, product_ref_id, qty, actor, note)
        item = product_ref_id

    record_audit(
        action=AuditLog.Action.UPDATE,
        entity_type="mait_stock",
        entity_id=mait.id,
        actor=actor,
        request=request,
        meta={
            "mait": mait.sahayak_vendor_code,
            "product_type": product_type,
            "item": item,
            # Negative, so the audit trail reads a removal as a removal rather than a credit.
            "qty": -qty,
            "note": (note or "")[:255],
        },
    )


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
