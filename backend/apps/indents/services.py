"""
Fulfilment of an indent by a back-office admin.

**Read this before changing anything here.** The original design deliberately had no way to
issue an indent from this platform: fulfilment was to happen in Indent Easy, a separate web
application that reported goods issued through a GRN callback, and an admin who could mark
stock issued would be creating straws no depot ever handed over. That integration was dropped
on 2026-09-18 — the store keeper's app replaced it — but the guarantee the original note was
protecting still holds here:

* Straws are issued **by number**, never by quantity. A straw is a physical object with a
  number printed on it, and the ledger has to name the ones that changed hands — otherwise
  "25 straws issued" credits a balance no Mait can scan against.
* Nothing is credited twice. A straw already held by a Mait, already set aside for another
  indent, or already consumed by an AI event, is refused rather than re-issued.
* Every movement goes through ``credit_stock``, so the ledger stays summable to the balance
  exactly as it does for a store's handover.

**Issuing sets stock aside; collecting is what credits it.** Between the two the straws are
at the depot, and a balance claiming otherwise would tell a Mait they can start an AI whose
straw is miles away. So ``issue_indent`` records the numbers on the indent and
``confirm_collection`` moves them into stock.

What this cannot do is prove a physical handover happened. The audit trail names the admin
who recorded it; that is the control, and it is weaker than a store handover, where the Mait
types a code at the counter.

**Where a store serves the Mait, the store issues — not this.** ``apps.stores`` is the
counter an approved indent is handed over at, by a keeper using the app, and a handover there
comes with a code the Mait types in to collect: proof they were standing at the counter, which
this path never had. The admin issue below is refused for an indent routed to a store, so one
indent never has two people issuing against it. It stays as the way out for Maits no store
serves yet.
"""

from __future__ import annotations

import logging
import secrets

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.core.exceptions import (
    CollectionCodeInvalid,
    CollectionCodeLocked,
    InvalidStateTransition,
    StrawAlreadyConsumed,
    StrawAlreadyIssued,
)
from apps.core.models import AuditLog
from apps.core.services import record_audit
from apps.inventory.models import MaitInventory, MaitInventoryLedger, ProductType, SemenBatch
from apps.inventory.services import credit_stock

from .models import IndentHandover, IndentRequest

logger = logging.getLogger(__name__)


def _locked(indent: IndentRequest) -> IndentRequest:
    """
    Re-read the indent under a row lock.

    Two admins working the same queue is ordinary, and without this both would pass the
    status check and the second would credit stock against an indent already issued.
    """
    return IndentRequest.objects.select_for_update().get(pk=indent.pk)


@transaction.atomic
def approve_indent(indent: IndentRequest, *, actor=None, request=None) -> IndentRequest:
    """Agree to the request. Moves no stock — that is ``issue_indent``."""
    indent = _locked(indent)
    if indent.status != IndentRequest.Status.REQUESTED:
        raise InvalidStateTransition(
            f"IND-{indent.id} is {indent.get_status_display().lower()}, so it cannot be approved."
        )

    # Routed again if it was raised before a store served this Mait: approval is the moment it
    # joins a keeper's queue, and the keeper has to be the right one.
    from apps.stores.services import store_for_mait

    indent.status = IndentRequest.Status.APPROVED
    indent.approved_at = timezone.now()
    indent.approved_by = actor if getattr(actor, "is_authenticated", False) else None
    if indent.store_id is None:
        indent.store = store_for_mait(indent.mait)
    indent.save(update_fields=["status", "approved_at", "approved_by", "store", "updated_at"])

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="indent",
        entity_id=indent.id,
        actor=actor,
        request=request,
        meta={
            "to": "approved",
            "qty_requested": indent.qty_requested,
            "store": indent.store.code if indent.store_id else None,
        },
    )
    return indent


@transaction.atomic
def reject_indent(indent: IndentRequest, *, reason: str = "", actor=None, request=None):
    """
    Decline the request.

    The reason is kept on the indent rather than only in the audit log: the Mait sees the
    indent, not the log, and "rejected" with no explanation is a phone call to the office.

    An approved indent can still be declined. Approval is the office agreeing, not the depot
    packing, and stock runs out between the two often enough that the alternative — an
    approved request nobody can fulfil, sitting there looking like stock on its way — is the
    worse outcome. Once it is issued it is too late: straws have been set aside against it.
    """
    indent = _locked(indent)
    if indent.status not in (IndentRequest.Status.REQUESTED, IndentRequest.Status.APPROVED):
        raise InvalidStateTransition(
            f"IND-{indent.id} is {indent.get_status_display().lower()}, so it cannot be rejected."
        )

    # Part of it has already gone over a store's counter. Rejecting now would close an indent
    # the Mait is holding stock against, with the stock still counted as issued to it.
    if _live_handovers(indent).exists():
        raise InvalidStateTransition(
            f"IND-{indent.id} has already been part-issued at {indent.store.name}, so it cannot "
            "be rejected."
        )

    reason = (reason or "").strip()
    indent.status = IndentRequest.Status.REJECTED
    if reason:
        # Appended, so a note the Mait wrote when raising it is not overwritten.
        indent.note = f"{indent.note} · Rejected: {reason}".strip(" ·")[:255]
    indent.save(update_fields=["status", "note", "updated_at"])

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="indent",
        entity_id=indent.id,
        actor=actor,
        request=request,
        meta={"to": "rejected", "reason": reason},
    )
    return indent


def _live_handovers(indent: IndentRequest):
    """Every handover not put back — collected or still waiting."""
    return indent.handovers.filter(cancelled_at__isnull=True)


def confirm_collection(
    indent: IndentRequest, *, code: str | None = None, actor=None, request=None
) -> IndentRequest:
    """
    The Mait confirms the goods are in their hands, and the stock becomes theirs.

    This is where the balance moves, not ``issue_indent``. Until a Mait has collected, the
    straws are at the depot: a count that included them would tell them they can start an AI
    whose straw is miles away, and the whole platform rests on not being able to consume a
    straw you do not hold (ADR 0002). It is also the only step in the chain the Mait owns.

    Stock handed over at a store needs the code the keeper read out. A wrong code is counted
    and refused — and the count has to survive the refusal, which is why the refusal is raised
    out here rather than inside the transaction that would roll it back.
    """
    indent, refusal = _confirm(indent, code=code, actor=actor, request=request)
    if refusal is not None:
        raise refusal
    return indent


@transaction.atomic
def _confirm(indent: IndentRequest, *, code, actor, request):
    indent = _locked(indent)

    pending = list(
        indent.handovers.select_for_update()
        .select_related("store")
        .filter(collected_at__isnull=True, cancelled_at__isnull=True)
    )
    if pending:
        return _collect_handover(indent, pending, code=code, actor=actor, request=request)

    if indent.status != IndentRequest.Status.ISSUED:
        raise InvalidStateTransition(
            f"IND-{indent.id} is {indent.get_status_display().lower()}. "
            "Only issued stock can be confirmed as collected."
        )
    if indent.received_at is not None:
        raise InvalidStateTransition(f"IND-{indent.id} was already confirmed as collected.")

    if indent.product_type == ProductType.STRAW:
        numbered = indent.issued_straw_numbers or []
        if numbered:
            _credit_straws(indent, numbered, actor)
        else:
            _credit_unnumbered_straws(indent, indent.qty_issued, actor)
    elif indent.product_ref_id is not None and indent.qty_issued > 0:
        credit_stock(
            mait=indent.mait,
            product_type=indent.product_type,
            product_ref_id=indent.product_ref_id,
            qty=indent.qty_issued,
            ref_type=MaitInventoryLedger.RefType.INDENT,
            ref_id=indent.id,
            actor=actor,
            note=f"IND-{indent.id}",
        )

    indent.received_at = timezone.now()
    indent.save(update_fields=["received_at", "updated_at"])

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="indent",
        entity_id=indent.id,
        actor=actor,
        request=request,
        meta={"to": "received", "qty_issued": indent.qty_issued},
    )
    return indent, None


def _collect_handover(indent: IndentRequest, pending, *, code, actor, request):
    """
    Credit the handover whose code the Mait typed.

    Several can be pending at once — the depot issued 18 on Monday and the remaining 7 on
    Thursday, and the Mait collects both on Thursday — so the code picks which. Returns the
    refusal instead of raising it, so a wrong attempt is still counted when the caller raises.
    """
    from apps.stores.services import release_to_mait

    typed = "".join(ch for ch in (code or "") if ch.isdigit())
    if not typed:
        return None, CollectionCodeInvalid(
            f"Ask {pending[0].store.name} for the {IndentHandover.CODE_LENGTH}-digit code and "
            "type it in."
        )

    usable = [handover for handover in pending if not handover.is_locked]
    if not usable:
        return None, CollectionCodeLocked()

    match = next((h for h in usable if secrets.compare_digest(h.collection_code, typed)), None)
    if match is None:
        for handover in usable:
            handover.code_attempts += 1
            handover.save(update_fields=["code_attempts", "updated_at"])
        if all(handover.is_locked for handover in usable):
            return None, CollectionCodeLocked()
        return None, CollectionCodeInvalid()

    release_to_mait(match, actor)
    if indent.product_type == ProductType.STRAW:
        _credit_unnumbered_straws(
            indent,
            match.qty,
            actor,
            prefix=f"IND{indent.id}-H{match.id}",
            # Which trip, and how many on it. An indent collected in two batches otherwise
            # reads as five identical rows on the Mait's ledger, and "was I given 2 or 5" has
            # no answer on the screen they check it on.
            note=f"IND-{indent.id} · {match.qty} {indent.breed} from {match.store.name}",
        )
    else:
        credit_stock(
            mait=indent.mait,
            product_type=indent.product_type,
            product_ref_id=indent.product_ref_id,
            qty=match.qty,
            ref_type=MaitInventoryLedger.RefType.INDENT,
            ref_id=indent.id,
            actor=actor,
            note=f"IND-{indent.id} from {match.store.name}",
        )

    match.collected_at = timezone.now()
    match.save(update_fields=["collected_at", "updated_at"])

    # Received once nothing is left owed on it and nothing is left at the counter. A part
    # collected while the rest is still open is not the indent received — the Mait is still
    # owed seven.
    still_waiting = any(handover.id != match.id for handover in pending)
    if indent.status == IndentRequest.Status.ISSUED and not still_waiting:
        indent.received_at = match.collected_at
        indent.save(update_fields=["received_at", "updated_at"])

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="indent",
        entity_id=indent.id,
        actor=actor,
        request=request,
        meta={"to": "collected", "handover": match.id, "qty": match.qty},
    )
    return indent, None


def _clean_straw_numbers(raw: list[str], indent: IndentRequest) -> list[str]:
    numbers: list[str] = []
    seen: set[str] = set()
    for value in raw or []:
        number = (value or "").strip().upper()
        if not number:
            continue
        if number in seen:
            raise serializers.ValidationError(
                {"straw_numbers": [f"{number} is listed twice. Each straw is one physical object."]}
            )
        seen.add(number)
        numbers.append(number)

    if len(numbers) > indent.qty_requested:
        raise serializers.ValidationError(
            {
                "straw_numbers": [
                    f"{len(numbers)} straws listed but only {indent.qty_requested} were requested."
                ]
            }
        )
    return numbers


def _resolve_straw(indent: IndentRequest, number: str) -> SemenBatch:
    """
    Find or receive the straw, and refuse it if it is not free to hand over.

    Run at issue and again at collection: the two are minutes or days apart, and the second
    check is what stops a straw set aside on Monday being credited on Friday after an AI event
    already consumed it.
    """
    straw, created = SemenBatch.objects.get_or_create(
        unique_straw_no=number,
        defaults={
            "breed": indent.breed,
            "semen_station": "",
            "received_date": timezone.localdate(),
        },
    )

    # A straw the platform has never seen is being received into it here, which is what a
    # depot handover is. One it has seen must match what was asked for — crediting a Gir
    # straw against a Murrah request leaves the app counting a breed the Mait is not
    # carrying, and they find out with a farmer waiting.
    if not created and indent.breed and straw.breed != indent.breed:
        raise serializers.ValidationError(
            {
                "straw_numbers": [
                    f"{number} is a {straw.breed} straw; this request is for {indent.breed}."
                ]
            }
        )

    if straw.is_consumed:
        raise StrawAlreadyConsumed(
            f"Straw {number} has already been used for an AI event and cannot be issued."
        )

    held_by = (
        MaitInventory.objects.select_related("mait")
        .filter(product_type=ProductType.STRAW, product_ref_id=straw.id, qty_available__gt=0)
        .first()
    )
    if held_by is not None:
        raise StrawAlreadyIssued(
            f"Straw {number} is already held by {held_by.mait.name}. Check the number."
        )

    return straw


def _reserve_straws(indent: IndentRequest, numbers: list[str]) -> None:
    """
    Set the straws aside without crediting them.

    Also refuses one already set aside for someone else's uncollected indent — otherwise two
    Maits could be sent to the depot for the same physical straw and the second would find it
    gone, having been told it was theirs.
    """
    pending = (
        IndentRequest.objects.filter(status=IndentRequest.Status.ISSUED, received_at__isnull=True)
        .exclude(pk=indent.pk)
        .values_list("issued_straw_numbers", flat=True)
    )
    spoken_for = {number for allocation in pending for number in (allocation or [])}

    for number in numbers:
        if number in spoken_for:
            raise StrawAlreadyIssued(
                f"Straw {number} is already set aside for another indent. Check the number."
            )
        _resolve_straw(indent, number)


def _credit_straws(indent: IndentRequest, numbers: list[str], actor) -> None:
    for number in numbers:
        straw = _resolve_straw(indent, number)
        credit_stock(
            mait=indent.mait,
            product_type=ProductType.STRAW,
            product_ref_id=straw.id,
            qty=1,
            ref_type=MaitInventoryLedger.RefType.INDENT,
            ref_id=indent.id,
            actor=actor,
            note=f"IND-{indent.id} {number}",
        )


def _credit_unnumbered_straws(
    indent: IndentRequest,
    count: int,
    actor,
    prefix: str | None = None,
    note: str | None = None,
) -> None:
    """
    Credit a bundle issued as a quantity of a breed.

    One row per straw still, because a straw is still one physical object that one animal
    gets — they simply have no numbers yet. Each carries a generated placeholder number that
    the Mait replaces with the real one when they use it.

    ``prefix`` keeps the placeholders of two handovers against one indent apart. Both would
    otherwise start at ``IND13-0001``, and the second collection would fail on a straw number
    the first had already taken.
    """
    prefix = prefix or f"IND{indent.id}"
    for index in range(count):
        straw = SemenBatch.objects.create(
            unique_straw_no=f"{prefix}-{index + 1:04d}",
            breed=indent.breed,
            received_date=timezone.localdate(),
            is_unnumbered=True,
        )
        credit_stock(
            mait=indent.mait,
            product_type=ProductType.STRAW,
            product_ref_id=straw.id,
            qty=1,
            ref_type=MaitInventoryLedger.RefType.INDENT,
            ref_id=indent.id,
            actor=actor,
            note=(note or f"IND-{indent.id} {indent.breed} (unnumbered)")[:255],
        )


@transaction.atomic
def issue_indent(
    indent: IndentRequest,
    *,
    straw_numbers: list[str] | None = None,
    qty: int | None = None,
    actor=None,
    request=None,
) -> IndentRequest:
    """
    Set the stock aside for the Mait to collect.

    Credits nothing: ``confirm_collection`` does that, when the goods are actually in their
    hands. Straw requests take ``straw_numbers``; consumable requests take ``qty``. Issuing
    fewer than were asked for is allowed and closes the indent — the model has no partial
    state, and a Mait given 18 of 25 needs a fresh request for the rest rather than an indent
    that stays open and looks like stock still coming.
    """
    indent = _locked(indent)
    if indent.status != IndentRequest.Status.APPROVED:
        raise InvalidStateTransition(
            f"IND-{indent.id} is {indent.get_status_display().lower()}. "
            "Only an approved indent can be issued."
        )
    # One indent, one issuer. A store serving this Mait hands it over from the app, with a code
    # the Mait types in at the counter; an admin issuing the same indent from here as well
    # would send the Mait to collect it twice.
    if indent.store_id is not None or _live_handovers(indent).exists():
        store = indent.store.name if indent.store_id else "the store"
        raise InvalidStateTransition(
            f"IND-{indent.id} is handed over at {store}, from the store app. It is not issued "
            "from the portal."
        )

    numbers: list[str] = []
    if indent.product_type == ProductType.STRAW:
        numbers = _clean_straw_numbers(straw_numbers or [], indent)
        if numbers:
            _reserve_straws(indent, numbers)
            issued = len(numbers)
            meta_detail = {"straw_numbers": numbers}
        else:
            # No numbers: the depot handed over a bundle of a breed. The numbers that matter
            # are the ones printed on the straws, and a Mait reads those off at the AI step —
            # so they are recorded then rather than transcribed here twice.
            issued = int(qty if qty is not None else indent.qty_requested)
            if issued < 1 or issued > indent.qty_requested:
                raise serializers.ValidationError(
                    {"qty": [f"Issue between 1 and {indent.qty_requested}."]}
                )
            meta_detail = {"unnumbered": issued}
    else:
        if indent.product_ref_id is None:
            # Nothing here can repair it: the row records a quantity of "something
            # consumable" and never said what. Raised before the app sent a catalogue id,
            # so the only honest way out is to decline it and have the Mait ask again.
            raise serializers.ValidationError(
                {
                    "qty": [
                        f"IND-{indent.id} does not say which product was asked for, so "
                        "nothing can be issued against it. Reject it and ask the Mait to "
                        "raise the request again."
                    ]
                }
            )
        issued = int(qty if qty is not None else indent.qty_requested)
        if issued < 1 or issued > indent.qty_requested:
            raise serializers.ValidationError(
                {"qty": [f"Issue between 1 and {indent.qty_requested}."]}
            )
        meta_detail = {}

    indent.qty_issued = issued
    indent.issued_straw_numbers = numbers
    indent.issued_at = timezone.now()
    indent.status = IndentRequest.Status.ISSUED
    indent.save(
        update_fields=[
            "qty_issued",
            "issued_straw_numbers",
            "issued_at",
            "status",
            "updated_at",
        ]
    )

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="indent",
        entity_id=indent.id,
        actor=actor,
        request=request,
        meta={
            "to": "issued",
            "qty_issued": issued,
            "qty_requested": indent.qty_requested,
            **meta_detail,
        },
    )

    logger.info(
        "Indent issued by admin",
        extra={"indent_id": indent.id, "mait_id": indent.mait_id, "qty_issued": issued},
    )
    return indent
