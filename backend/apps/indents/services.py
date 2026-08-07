"""
Fulfilment of an indent by a back-office admin.

**Read this before changing anything here.** The original design deliberately had no way to
issue an indent from this platform: fulfilment belongs to Indent Easy, which reports goods
issued through the GRN callback (SRS §6.6.2–6.6.3), and an admin who could mark stock issued
would be creating straws no depot ever handed over.

That integration is not built (ROADMAP phase 5, days 20–22), so today an indent raised in the
app can never leave ``requested`` and every Mait waits forever. These services are the manual
path in the meantime, written so that the guarantee the original note was protecting still
holds:

* Straws are issued **by number**, never by quantity. A straw is a physical object with a
  number printed on it, and the ledger has to name the ones that changed hands — otherwise
  "25 straws issued" credits a balance no Mait can scan against.
* Nothing is credited twice. A straw already held by a Mait, already set aside for another
  indent, or already consumed by an AI event, is refused rather than re-issued.
* Every movement goes through ``credit_stock``, so the ledger stays summable to the balance
  exactly as it does for the GRN callback.

**Issuing sets stock aside; collecting is what credits it.** Between the two the straws are
at the depot, and a balance claiming otherwise would tell a Mait they can start an AI whose
straw is miles away. So ``issue_indent`` records the numbers on the indent and
``confirm_collection`` moves them into stock.

What this cannot do is prove a physical handover happened. The audit trail names the admin
who recorded it; that is the control, and it is a weaker one than a depot callback.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.core.exceptions import InvalidStateTransition, StrawAlreadyConsumed, StrawAlreadyIssued
from apps.core.models import AuditLog
from apps.core.services import record_audit
from apps.inventory.models import MaitInventory, MaitInventoryLedger, ProductType, SemenBatch
from apps.inventory.services import credit_stock

from .models import IndentRequest

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

    indent.status = IndentRequest.Status.APPROVED
    indent.save(update_fields=["status", "updated_at"])

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="indent",
        entity_id=indent.id,
        actor=actor,
        request=request,
        meta={"to": "approved", "qty_requested": indent.qty_requested},
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


@transaction.atomic
def confirm_collection(indent: IndentRequest, *, actor=None, request=None) -> IndentRequest:
    """
    The Mait confirms the goods are in their hands, and the stock becomes theirs.

    This is where the balance moves, not ``issue_indent``. Until a Mait has collected, the
    straws are at the depot: a count that included them would tell them they can start an AI
    whose straw is miles away, and the whole platform rests on not being able to consume a
    straw you do not hold (ADR 0002). It is also the only step in the chain the Mait owns.
    """
    indent = _locked(indent)
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
    return indent


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


def _credit_unnumbered_straws(indent: IndentRequest, count: int, actor) -> None:
    """
    Credit a bundle issued as a quantity of a breed.

    One row per straw still, because a straw is still one physical object that one animal
    gets — they simply have no numbers yet. Each carries a generated placeholder number that
    the Mait replaces with the real one when they use it.
    """
    for index in range(count):
        straw = SemenBatch.objects.create(
            unique_straw_no=f"IND{indent.id}-{index + 1:04d}",
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
            note=f"IND-{indent.id} {indent.breed} (unnumbered)",
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
