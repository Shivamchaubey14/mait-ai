"""
AI event state transitions (SRS §11).

Every transition lives here. Views translate HTTP into a call on one of these functions and
translate the result back; they hold no business rules of their own. That keeps the state
machine testable in isolation and reusable from Celery tasks and management commands.

``complete_ai_event`` is the most consequential function in the codebase — it is the only
place stock is deducted for an insemination.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from apps.core.exceptions import InvalidStateTransition, MPPNotAssigned, PaymentNotVerified
from apps.core.services import record_audit
from apps.inventory.services import consume_straw, get_straw_for_mait

from .models import AIEvent, AIEventTimeline

logger = logging.getLogger(__name__)


def _transition(event: AIEvent, to_status: str, *, actor=None, note: str = "") -> None:
    """Validate and record a status change. Does not save the event — the caller does."""
    if not event.can_transition_to(to_status):
        raise InvalidStateTransition(
            f"Cannot move an AI event from '{event.status}' to '{to_status}'."
        )
    AIEventTimeline.objects.create(
        ai_event=event,
        from_status=event.status,
        to_status=to_status,
        note=note,
        actor=actor,
    )
    event.status = to_status


def assert_mait_assigned_to_mpp(mait, mpp) -> None:
    """
    Guard against cross-Mait tampering (SRS §16).

    Checked on every write that names an MPP, not only at event creation — an event's MPP
    is fixed at draft time, but a later request could still carry a different one.
    """
    if not mpp.mpp_code:
        raise MPPNotAssigned()
    if mpp.mait_id != mait.id:
        raise MPPNotAssigned(f"You are not assigned to MPP {mpp.mpp_code}.")


@transaction.atomic
def start_ai_event(
    *,
    mait,
    mpp,
    owner_type: str,
    owner,
    animal,
    client_uuid,
    straw_unique_no: str = "",
    actor=None,
    synced_from_offline: bool = False,
) -> AIEvent:
    """
    Open a capture and, when a straw is named, validate it in the same transaction.

    The two are one call because they are one moment in the field: the Mait scans the straw
    at the animal's side. Splitting them would leave a draft behind every time a scan failed,
    and the Mait would have no way to tell those drafts from ones they meant to keep.

    Nothing is deducted here. Stock moves only at completion (SRS §6.4.3), so an abandoned
    capture costs the Mait nothing — which is correct, because no insemination happened.
    """
    assert_mait_assigned_to_mpp(mait, mpp)

    event = AIEvent.objects.create(
        client_uuid=client_uuid,
        mait=mait,
        mpp=mpp,
        owner_type=owner_type,
        member=owner if owner_type == AIEvent.OwnerType.MEMBER else None,
        non_member=owner if owner_type == AIEvent.OwnerType.NON_MEMBER else None,
        animal=animal,
        synced_from_offline=synced_from_offline,
    )
    AIEventTimeline.objects.create(
        ai_event=event,
        from_status="",
        to_status=AIEvent.Status.DRAFT,
        note="Capture started",
        actor=actor,
    )

    if straw_unique_no:
        # Raises on a straw the Mait does not hold or has already used, which rolls the
        # draft back with it — a failed scan must not leave a half-started event behind.
        verify_straw(event, straw_unique_no, actor=actor)

    return event


@transaction.atomic
def verify_straw(event: AIEvent, straw_unique_no: str, *, actor=None) -> AIEvent:
    """
    Validate the scanned straw and advance ``draft`` → ``straw_verified`` (SRS §6.3 step 4).

    This only checks and reserves nothing — stock is not deducted until completion. A Mait
    who abandons the flow here leaves their inventory untouched, which is correct: no
    insemination happened.
    """
    straw = get_straw_for_mait(event.mait, straw_unique_no)

    _transition(
        event,
        AIEvent.Status.STRAW_VERIFIED,
        actor=actor,
        note=f"Straw {straw_unique_no} validated against stock",
    )
    event.semen_batch = straw
    event.straw_unique_no = straw.unique_straw_no
    event.save(update_fields=["semen_batch", "straw_unique_no", "status", "updated_at"])
    return event


@transaction.atomic
def attach_photo(
    event: AIEvent,
    *,
    photo_url: str,
    gps_lat=None,
    gps_lng=None,
    performed_at=None,
    actor=None,
) -> AIEvent:
    """
    Record the proof photo and advance to ``photo_captured`` (SRS §6.3 step 5).

    ``performed_at`` comes from the device rather than the server clock, because an event
    captured offline may not reach us for hours and the report must show when the
    insemination actually happened.
    """
    _transition(event, AIEvent.Status.PHOTO_CAPTURED, actor=actor, note="AI proof photo captured")
    event.ai_photo_url = photo_url
    event.gps_lat = gps_lat
    event.gps_lng = gps_lng
    event.performed_at = performed_at or timezone.now()
    event.save(
        update_fields=[
            "ai_photo_url",
            "gps_lat",
            "gps_lng",
            "performed_at",
            "status",
            "updated_at",
        ]
    )
    return event


@transaction.atomic
def mark_payment_pending(event: AIEvent, *, actor=None) -> AIEvent:
    """Advance to ``payment_pending`` when payment is initiated (SRS §6.5)."""
    _transition(event, AIEvent.Status.PAYMENT_PENDING, actor=actor, note="Payment initiated")
    event.save(update_fields=["status", "updated_at"])
    return event


@transaction.atomic
def complete_ai_event(event: AIEvent, *, actor=None) -> AIEvent:
    """
    Finalise an AI event: deduct the straw and close it, atomically (SRS §6.4.3).

    The whole thing runs in one transaction, and the inventory row is locked inside it, so
    two concurrent completions cannot both succeed against one straw (ADR 0002).

    Deliberately kept small and free of I/O. No S3 upload, no SMS, no outbound HTTP —
    anything slow inside this block would hold the row lock while it waited.
    """
    if event.status == AIEvent.Status.COMPLETED:
        # Not an error. A retry whose original response was lost lands here, and the
        # honest answer is that the event is already complete.
        return event

    if not event.can_transition_to(AIEvent.Status.COMPLETED):
        raise InvalidStateTransition(f"Cannot complete an AI event in state '{event.status}'.")

    # SRS §6.5.3 — payment must be verified first. Checked inside the transaction so a
    # concurrent payment change cannot slip in between the check and the deduction.
    payment = getattr(event, "payment", None)
    if payment is None or not payment.is_verified:
        raise PaymentNotVerified()

    if event.semen_batch_id is None:
        raise InvalidStateTransition("This event has no verified straw to deduct.")

    consume_straw(
        mait=event.mait,
        straw=event.semen_batch,
        ai_event_id=event.id,
        actor=actor,
    )

    _transition(
        event, AIEvent.Status.COMPLETED, actor=actor, note="Payment verified, straw deducted"
    )
    event.completed_at = timezone.now()
    event.save(update_fields=["status", "completed_at", "updated_at"])

    record_audit(
        action="state_change",
        entity_type="ai_event",
        entity_id=event.id,
        actor=actor,
        meta={
            "to": AIEvent.Status.COMPLETED,
            "straw": event.straw_unique_no,
            "mait_id": event.mait_id,
            "mpp_code": event.mpp.mpp_code,
        },
    )
    logger.info("AI event completed", extra={"ai_event_id": event.id})
    return event


@transaction.atomic
def cancel_ai_event(event: AIEvent, *, reason: str = "", actor=None) -> AIEvent:
    """
    Abort a draft (SRS §11 `cancelled`).

    Terminal, and no straw is deducted — a cancelled event must never touch stock.
    """
    if event.status == AIEvent.Status.COMPLETED:
        raise InvalidStateTransition("A completed AI event cannot be cancelled.")
    if event.status == AIEvent.Status.CANCELLED:
        return event

    _transition(event, AIEvent.Status.CANCELLED, actor=actor, note=reason or "Cancelled")
    event.cancelled_reason = reason
    event.save(update_fields=["status", "cancelled_reason", "updated_at"])
    return event
