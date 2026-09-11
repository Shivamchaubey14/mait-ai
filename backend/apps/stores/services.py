"""
What a store does: take stock in, and hand approved indents over.

The chain an indent walks, now that stores exist:

1. A Mait raises it in the app. It is routed to the store serving their BMC/MCCs.
2. The zonal manager approves it on the portal.
3. The keeper at that store issues it from the app — all of it, or as much as the shelf has.
   Issuing sets the stock aside and gives the keeper a four-digit code to read out.
4. The Mait types the code into *Confirm collection*. Only then does the stock leave the
   store's count and join theirs (``apps.indents.services.confirm_collection``).

Step 3 can happen more than once. A store holding 18 Murrah against an approval for 25 issues
the 18, and the 7 stay open on the same indent until the next batch lands — the Mait does not
have to ask again.

**Nothing here trusts the keeper's arithmetic.** Every issue re-reads the shelf under a row
lock and subtracts what is already set aside for other Maits, so two keepers at one counter,
or one keeper tapping twice, cannot promise the same straws to two people.
"""

from __future__ import annotations

import logging
import secrets
from collections import Counter

from django.db import transaction
from django.db.models import F, Q, Sum
from django.utils import timezone
from rest_framework import serializers

from apps.core.exceptions import InvalidStateTransition, StoreStockShort
from apps.core.models import AuditLog
from apps.core.services import record_audit
from apps.indents.models import IndentHandover, IndentRequest
from apps.inventory.models import ProductType
from apps.masterdata.models import MPP

from .models import Store, StoreLedger, StorePlant, StoreStock

logger = logging.getLogger(__name__)

# An item on a store's shelf: (product_type, breed, product_ref_id). See `StoreStock`.
Item = tuple[str, str, int]


# --------------------------------------------------------------------------------------
# Which store
# --------------------------------------------------------------------------------------
def store_for_mait(mait) -> Store | None:
    """
    The store a Mait collects from: the one serving most of their collection points.

    A Mait covers several MPPs and those can report into more than one BMC/MCC. The store that
    serves the most of them is the one they pass most often, and ties go to the older store so
    the answer does not change between two calls. None when no open store serves any of them,
    which is every Mait until the Stores screen has been filled in.
    """
    plants = Counter(
        MPP.objects.filter(mait=mait, is_active=True)
        .exclude(plant_code="")
        .values_list("plant_code", flat=True)
    )
    if not plants:
        return None

    served = StorePlant.objects.filter(
        plant_code__in=list(plants), store__is_active=True
    ).select_related("store")
    weight: Counter = Counter()
    stores: dict[int, Store] = {}
    for row in served:
        weight[row.store_id] += plants[row.plant_code]
        stores[row.store_id] = row.store
    if not weight:
        return None
    best = max(weight, key=lambda store_id: (weight[store_id], -store_id))
    return stores[best]


def item_of(indent: IndentRequest) -> Item:
    """The shelf an indent is filled from."""
    if indent.product_type == ProductType.STRAW:
        return (ProductType.STRAW, indent.breed, 0)
    return (indent.product_type, "", int(indent.product_ref_id or 0))


def _item_q(item: Item, prefix: str = "") -> Q:
    product_type, breed, ref = item
    if product_type == ProductType.STRAW:
        return Q(**{f"{prefix}product_type": product_type, f"{prefix}breed": breed})
    return Q(**{f"{prefix}product_type": product_type, f"{prefix}product_ref_id": ref})


def open_indents(store: Store):
    """
    The indents waiting at this store's counter.

    Approved and not fully handed over. Routed here when they were raised or approved — or, for
    an indent that predates the store, belonging to a Mait whose collection points this store
    serves. Those have no store stamped yet and pick this one up on their first handover.
    """
    codes = store.plant_codes
    routed = Q(store=store)
    if codes:
        routed |= Q(store__isnull=True, mait__mpps__plant_code__in=codes)
    return (
        IndentRequest.objects.filter(routed, status=IndentRequest.Status.APPROVED)
        .filter(qty_issued__lt=F("qty_requested"))
        .select_related("mait", "approved_by")
        .prefetch_related("approved_by__zones", "handovers")
        .distinct()
        .order_by("approved_at", "requested_at")
    )


def serves(store: Store, indent: IndentRequest) -> bool:
    """Whether this store may hand this indent over. The same rule ``open_indents`` lists by."""
    if indent.store_id is not None:
        return indent.store_id == store.id
    codes = store.plant_codes
    return bool(codes) and indent.mait.mpps.filter(plant_code__in=codes).exists()


# --------------------------------------------------------------------------------------
# How much
# --------------------------------------------------------------------------------------
def set_aside(store: Store, item: Item) -> int:
    """Issued from this shelf and not yet collected — still here, and already promised."""
    return (
        IndentHandover.objects.filter(
            store=store, collected_at__isnull=True, cancelled_at__isnull=True
        )
        .filter(_item_q(item, "indent__"))
        .aggregate(total=Sum("qty"))["total"]
        or 0
    )


def availability(store: Store) -> dict[Item, dict[str, int]]:
    """
    Every item on the shelf: on hand, set aside, and what can still be promised.

    Two queries for the whole store rather than two per item, because the queue asks this for
    every row it draws.
    """
    shelf: dict[Item, dict[str, int]] = {}
    for row in StoreStock.objects.filter(store=store):
        item = (row.product_type, row.breed, int(row.product_ref_id))
        shelf[item] = {"on_hand": row.qty_on_hand, "set_aside": 0, "available": row.qty_on_hand}

    pending = (
        IndentHandover.objects.filter(
            store=store, collected_at__isnull=True, cancelled_at__isnull=True
        )
        .values("indent__product_type", "indent__breed", "indent__product_ref_id")
        .annotate(total=Sum("qty"))
    )
    for row in pending:
        if row["indent__product_type"] == ProductType.STRAW:
            item = (ProductType.STRAW, row["indent__breed"], 0)
        else:
            item = (row["indent__product_type"], "", int(row["indent__product_ref_id"] or 0))
        line = shelf.setdefault(item, {"on_hand": 0, "set_aside": 0, "available": 0})
        line["set_aside"] += row["total"]
        line["available"] = max(line["on_hand"] - line["set_aside"], 0)
    return shelf


def available_for(store: Store, indent: IndentRequest, shelf=None) -> int:
    shelf = shelf if shelf is not None else availability(store)
    return shelf.get(item_of(indent), {}).get("available", 0)


# --------------------------------------------------------------------------------------
# Stock in
# --------------------------------------------------------------------------------------
@transaction.atomic
def receive_stock(
    *,
    store: Store,
    product_type: str,
    qty: int,
    breed: str = "",
    product_ref_id: int = 0,
    actor=None,
    note: str = "",
    request=None,
) -> StoreStock:
    """
    Record a delivery landing at the store.

    The keeper records it, because they are the one who counts the boxes off the van. Like the
    Mait's own ledger, this is summable to the balance: every receipt is a row, and the count
    on the shelf is those rows added up.
    """
    if qty <= 0:
        raise serializers.ValidationError({"qty": ["Record at least one."]})

    if product_type == ProductType.STRAW:
        breed = (breed or "").strip().upper()
        if not breed:
            raise serializers.ValidationError({"breed": ["Say which breed arrived."]})
        product_ref_id = 0
    else:
        breed = ""
        if not product_ref_id:
            raise serializers.ValidationError({"product_ref_id": ["Say which product arrived."]})

    stock, _ = StoreStock.objects.select_for_update().get_or_create(
        store=store,
        product_type=product_type,
        breed=breed,
        product_ref_id=product_ref_id,
        defaults={"qty_on_hand": 0},
    )
    stock.qty_on_hand += qty
    stock.save(update_fields=["qty_on_hand", "updated_at"])

    StoreLedger.objects.create(
        stock=stock,
        txn_type=StoreLedger.TxnType.RECEIVE,
        qty=qty,
        balance_after=stock.qty_on_hand,
        note=(note or "")[:255],
        created_by=actor,
    )
    record_audit(
        action=AuditLog.Action.CREATE,
        entity_type="store_receipt",
        entity_id=stock.id,
        actor=actor,
        request=request,
        meta={"store": store.code, "item": breed or product_ref_id, "qty": qty},
    )
    return stock


def release_to_mait(handover: IndentHandover, actor=None) -> None:
    """
    Take a collected handover off the store's shelf.

    Called from ``confirm_collection`` inside its transaction, at the moment the stock joins
    the Mait's — so there is no instant at which the straws are counted in both places, or in
    neither.
    """
    item = item_of(handover.indent)
    stock = (
        StoreStock.objects.select_for_update()
        .filter(store_id=handover.store_id)
        .filter(_item_q(item))
        .first()
    )
    if stock is None or stock.qty_on_hand < handover.qty:
        # Only reachable if the shelf was edited under a pending handover. Refusing is right:
        # crediting the Mait while the store's count goes negative would mint stock.
        raise StoreStockShort(
            f"{handover.store.name} no longer has the {handover.qty} set aside for "
            f"IND-{handover.indent_id}. Ask the store to check its count."
        )
    stock.qty_on_hand -= handover.qty
    stock.save(update_fields=["qty_on_hand", "updated_at"])
    StoreLedger.objects.create(
        stock=stock,
        txn_type=StoreLedger.TxnType.ISSUE,
        qty=-handover.qty,
        balance_after=stock.qty_on_hand,
        handover=handover,
        note=f"IND-{handover.indent_id} to {handover.indent.mait.name}"[:255],
        created_by=actor,
    )


# --------------------------------------------------------------------------------------
# Stock out
# --------------------------------------------------------------------------------------
def new_code() -> str:
    """Four digits, from the system's own randomness — the code is the proof of presence."""
    return f"{secrets.randbelow(10 ** IndentHandover.CODE_LENGTH):0{IndentHandover.CODE_LENGTH}d}"


@transaction.atomic
def issue_from_store(
    indent: IndentRequest,
    *,
    store: Store,
    qty: int,
    flask_checked: bool = False,
    actor=None,
    request=None,
) -> IndentHandover:
    """
    Hand some or all of an approved indent over the counter.

    Sets the stock aside and returns the handover with its code; the Mait's balance does not
    move until they type the code in. Whatever is left of the approval stays open on the
    indent, and the indent closes itself once the last of it has been issued.
    """
    # Both locks before any plain read, and in this order. InnoDB fixes a transaction's snapshot
    # at its first non-locking read, so a count of what is set aside taken before the shelf's
    # lock was granted would not see a handover another keeper committed while this one waited
    # — and both would promise the same straws.
    indent = IndentRequest.objects.select_for_update().select_related("mait").get(pk=indent.pk)
    item = item_of(indent)
    stock = StoreStock.objects.select_for_update().filter(store=store).filter(_item_q(item)).first()

    if indent.status != IndentRequest.Status.APPROVED:
        raise InvalidStateTransition(
            f"IND-{indent.id} is {indent.get_status_display().lower()}. "
            "Only an approved indent can be handed over."
        )
    if not serves(store, indent):
        elsewhere = indent.store.name if indent.store_id else "another store"
        raise InvalidStateTransition(f"IND-{indent.id} is collected from {elsewhere}, not here.")
    if indent.product_type != ProductType.STRAW and indent.product_ref_id is None:
        raise serializers.ValidationError(
            {
                "qty": [
                    f"IND-{indent.id} does not say which product was asked for. Ask the office "
                    "to reject it so the Mait can raise it again."
                ]
            }
        )

    open_qty = indent.qty_open
    if qty < 1 or qty > open_qty:
        raise serializers.ValidationError({"qty": [f"Issue between 1 and {open_qty}."]})

    # Straws leave the store in a flask of liquid nitrogen, and a flask that has warmed has
    # already killed them. Checked here as well as on the button, because the button is only
    # a request.
    if indent.product_type == ProductType.STRAW and not flask_checked:
        raise serializers.ValidationError(
            {"flask_checked": ["Check the flask temperature before straws leave the store."]}
        )

    on_hand = stock.qty_on_hand if stock else 0
    available = max(on_hand - set_aside(store, item), 0)
    if qty > available:
        raise StoreStockShort(
            f"The store can hand over {available} of this now."
            if available
            else "There is none of this in the store to hand over."
        )

    handover = IndentHandover.objects.create(
        indent=indent,
        store=store,
        qty=qty,
        collection_code=new_code(),
        flask_checked=bool(flask_checked),
        issued_by=actor,
    )

    indent.store = store
    indent.qty_issued += qty
    indent.issued_at = handover.issued_at
    if indent.qty_issued >= indent.qty_requested:
        indent.status = IndentRequest.Status.ISSUED
    indent.save(update_fields=["store", "qty_issued", "issued_at", "status", "updated_at"])

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="indent",
        entity_id=indent.id,
        actor=actor,
        request=request,
        meta={
            "to": "issued" if indent.status == IndentRequest.Status.ISSUED else "part_issued",
            "store": store.code,
            "handover": handover.id,
            "qty": qty,
            "qty_open": indent.qty_open,
        },
    )
    logger.info(
        "Indent handed over at store",
        extra={"indent_id": indent.id, "store": store.code, "qty": qty},
    )
    return handover


def _locked_handover(handover: IndentHandover, store: Store) -> IndentHandover:
    handover = (
        IndentHandover.objects.select_for_update().select_related("indent").get(pk=handover.pk)
    )
    if handover.store_id != store.id:
        raise InvalidStateTransition("This handover belongs to another store.")
    if not handover.is_pending:
        raise InvalidStateTransition(
            "This has already been collected."
            if handover.collected_at
            else "This handover was already put back."
        )
    return handover


@transaction.atomic
def cancel_handover(handover: IndentHandover, *, store: Store, actor=None, request=None):
    """
    The Mait never collected it: put the stock back on the shelf, and the quantity back open.

    Nothing moved on the shelf when it was issued, so nothing has to move now — the handover
    simply stops holding the stock aside. The indent reopens if this was the issue that closed
    it.
    """
    handover = _locked_handover(handover, store)
    indent = IndentRequest.objects.select_for_update().get(pk=handover.indent_id)

    handover.cancelled_at = timezone.now()
    handover.save(update_fields=["cancelled_at", "updated_at"])

    indent.qty_issued = max(indent.qty_issued - handover.qty, 0)
    if indent.status == IndentRequest.Status.ISSUED:
        indent.status = IndentRequest.Status.APPROVED
    indent.save(update_fields=["qty_issued", "status", "updated_at"])

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="indent",
        entity_id=indent.id,
        actor=actor,
        request=request,
        meta={"to": "handover_cancelled", "handover": handover.id, "qty": handover.qty},
    )
    return handover


@transaction.atomic
def reissue_code(handover: IndentHandover, *, store: Store, actor=None, request=None):
    """
    A fresh code, for a Mait who ran out of attempts at the last one.

    Only the keeper can ask for it, and only in front of the Mait — which is the whole point:
    the lock after too many wrong codes is only worth anything if getting past it means being
    at the counter.
    """
    handover = _locked_handover(handover, store)
    handover.collection_code = new_code()
    handover.code_attempts = 0
    handover.save(update_fields=["collection_code", "code_attempts", "updated_at"])
    record_audit(
        action=AuditLog.Action.UPDATE,
        entity_type="indent_handover",
        entity_id=handover.id,
        actor=actor,
        request=request,
        meta={"new_code": True},
    )
    return handover
