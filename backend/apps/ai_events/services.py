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

from apps.core.exceptions import (
    InsufficientStock,
    InvalidStateTransition,
    MPPNotAssigned,
    PaymentNotVerified,
    StrawAlreadyConsumed,
)
from apps.core.services import record_audit
from apps.inventory.services import (
    consume_straw,
    consume_supply,
    get_straw_for_mait,
    take_straw_of_breed,
)

from .models import AIEvent, AIEventConsumable, AIEventStraw, AIEventTimeline

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
    semen_breed: str = "",
    doses: int = 1,
    consumables=None,
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
        verify_straw(event, straw_unique_no, semen_breed=semen_breed, actor=actor)
    elif semen_breed:
        reserve_straw_by_breed(event, semen_breed, doses=doses, actor=actor)

    # What the visit took besides semen. Recorded here, deducted at completion, exactly like
    # the straws: a capture abandoned halfway costs a Mait no gloves.
    for consumable, qty in consumables or []:
        AIEventConsumable.objects.create(ai_event=event, consumable=consumable, qty=qty)

    return event


@transaction.atomic
def reserve_straw_by_breed(
    event: AIEvent, semen_breed: str, *, doses: int = 1, actor=None
) -> AIEvent:
    """
    Hold one straw of a breed against this event, with no number read (SRS §6.3 step 4).

    The capture flow no longer asks for a straw number. Reading one means lifting the goblet
    clear of the liquid nitrogen, which warms every straw in it — the app was asking a Mait to
    damage the semen in order to record it. The breed is asked instead, at the step before,
    and the count is what gates the work: ten straws of a breed complete ten inseminations of
    it, and the eleventh is refused for want of stock.

    Nothing is deducted here, exactly as with a scanned number. Stock moves at completion
    (SRS §6.4.3), so a capture the Mait abandons costs them nothing — no insemination
    happened.
    """
    # One at a time, and each one is held the moment it is picked — so the second dose cannot
    # be handed the straw the first has already taken.
    held = []
    for _ in range(max(1, doses)):
        straw = take_straw_of_breed(event.mait, semen_breed)
        AIEventStraw.objects.create(ai_event=event, semen_batch=straw)
        held.append(straw)

    code = semen_breed.strip().upper()
    _transition(
        event,
        AIEvent.Status.STRAW_VERIFIED,
        actor=actor,
        note=(
            f"{code} straw held from stock"
            if len(held) == 1
            else f"{len(held)} {code} straws held from stock"
        ),
    )
    event.semen_batch = held[0]
    event.doses = len(held)
    # Carried when the depot issued numbered stock, and left blank when it did not. An
    # unnumbered row's placeholder is a bookkeeping artefact, not a number anyone read off a
    # straw, and writing it here would look like a scan that never happened.
    event.straw_unique_no = "" if held[0].is_unnumbered else held[0].unique_straw_no
    event.save(update_fields=["semen_batch", "doses", "straw_unique_no", "status", "updated_at"])
    return event


@transaction.atomic
def verify_straw(
    event: AIEvent, straw_unique_no: str, *, semen_breed: str = "", actor=None
) -> AIEvent:
    """
    Validate the scanned straw and advance ``draft`` → ``straw_verified`` (SRS §6.3 step 4).

    This only checks and reserves nothing — stock is not deducted until completion. A Mait
    who abandons the flow here leaves their inventory untouched, which is correct: no
    insemination happened.

    ``claim=True`` because this is the moment a number becomes real. Stock issued as a
    quantity of a breed carries no numbers, and the Mait reading one off the straw in their
    hand is what names it — written here, inside the event's own transaction, so a number and
    the event that used it commit together or not at all.
    """
    straw = get_straw_for_mait(event.mait, straw_unique_no, breed=semen_breed or None, claim=True)

    _transition(
        event,
        AIEvent.Status.STRAW_VERIFIED,
        actor=actor,
        note=f"Straw {straw_unique_no} validated against stock",
    )
    event.semen_batch = straw
    event.straw_unique_no = straw.unique_straw_no
    AIEventStraw.objects.get_or_create(ai_event=event, semen_batch=straw)
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
    photo_source: str = AIEvent.PhotoSource.CAMERA,
    gps_source: str = AIEvent.GpsSource.DEVICE,
    actor=None,
) -> AIEvent:
    """
    Record the proof photo and advance to ``photo_captured`` (SRS §6.3 step 5).

    ``performed_at`` comes from the device rather than the server clock, because an event
    captured offline may not reach us for hours and the report must show when the
    insemination actually happened.

    ``photo_source`` says whether the picture came through the app's own camera or out of the
    handset's gallery, and ``gps_source`` says whether the pin is where the handset was or
    what was written into the photograph. Both are recorded rather than assumed, and both go
    on the audit trail: a live capture is evidence that this animal was served at this place
    and time, and a chosen photograph is a photograph. The platform still accepts it — a Mait
    whose camera will not open has to be able to finish the round — but nobody reading the
    record later should have to guess which of the two they are holding.
    """
    chosen = photo_source == AIEvent.PhotoSource.GALLERY
    _transition(
        event,
        AIEvent.Status.PHOTO_CAPTURED,
        actor=actor,
        note=("AI proof photo chosen from the gallery" if chosen else "AI proof photo captured"),
    )
    event.ai_photo_url = photo_url
    event.photo_source = photo_source
    event.gps_lat = gps_lat
    event.gps_lng = gps_lng
    event.gps_source = gps_source
    event.performed_at = performed_at or timezone.now()
    event.save(
        update_fields=[
            "ai_photo_url",
            "photo_source",
            "gps_lat",
            "gps_lng",
            "gps_source",
            "performed_at",
            "status",
            "updated_at",
        ]
    )
    return event


@transaction.atomic
def mark_payment_pending(event: AIEvent, *, actor=None) -> AIEvent:
    """Advance to ``payment_pending`` when payment is initiated (SRS §6.5)."""
    _transition(
        event,
        AIEvent.Status.PAYMENT_PENDING,
        actor=actor,
        note="Payment initiated (Will be processed by Finance Department)",
    )
    event.save(update_fields=["status", "updated_at"])
    return event


def _deduct_the_stock(event: AIEvent, *, actor=None, without_stock: bool = False) -> None:
    """
    Take everything this insemination used out of the Mait's stock.

    Every straw held for it — one, or two on a difficult animal — and every consumable the
    Mait said they used. All of it inside the caller's transaction, so the deductions and the
    event's own status change commit together or not at all.

    A straw that cannot be deducted refuses the completion, and it has to: two events holding
    one straw arriving together is exactly the case where one straw would serve two animals,
    which is the thing this platform exists to prevent (ADR 0002).

    ``without_stock`` is the one exception, and it is never inferred — it comes from a person
    pressing *Close this off* on a record the app has already told them is stuck. Then a straw
    that has already gone stops being a refusal: the animal was served, that straw was inserted
    into it, and the flask is one short whatever the system does next. Deducting a *different*
    straw would charge the holding twice for one insemination, and could refuse the record all
    over again for want of a straw that was never this event's to spend. So the completion does
    the one thing actually outstanding — it closes the event — and the record carries
    ``stock_deducted=False`` and a line on the audit trail saying so.

    Even then the flag is a permission rather than an instruction: where the straw *is* still
    in stock it is deducted exactly as always. And what keeps the exception from becoming a
    hole is the picker, which no longer offers a straw an unfinished capture is holding
    (``take_straw_of_breed``) — two of a Mait's events can no longer come to share one straw in
    the first place. This path is for the records that already did.

    Consumables follow the straws rather than leading them: they are the smaller loss, and a
    record that closed without its sheath while the semen it used went unaccounted for would be
    the wrong way round.
    """
    # `semen_batch` is the first of them and stays on the event for every reader that wants the
    # breed; the rows are what says how many there were. An event recorded before the rows
    # existed has none, and its one straw is still on the event itself.
    held = [row.semen_batch for row in event.straws.select_related("semen_batch").all()]
    if not held and event.semen_batch_id:
        held = [event.semen_batch]

    for straw in held:
        try:
            consume_straw(mait=event.mait, straw=straw, ai_event_id=event.id, actor=actor)
        except (InsufficientStock, StrawAlreadyConsumed) as gone:
            if not without_stock:
                raise

            event.stock_deducted = False
            AIEventTimeline.objects.create(
                ai_event=event,
                from_status=event.status,
                to_status=event.status,
                note=f"Closed without a stock movement — {gone}"[:255],
                actor=actor,
            )
            logger.info(
                "AI event closed without a stock movement",
                extra={
                    "ai_event_id": event.id,
                    "mait_id": event.mait_id,
                    "straw": straw.unique_straw_no,
                },
            )

    for line in event.consumables.select_related("consumable").all():
        try:
            consume_supply(
                mait=event.mait,
                consumable=line.consumable,
                qty=line.qty,
                ai_event_id=event.id,
                actor=actor,
            )
        except InsufficientStock as short:
            if not without_stock:
                raise

            # Same rule, same reason: the sheath was opened whatever the count says.
            event.stock_deducted = False
            AIEventTimeline.objects.create(
                ai_event=event,
                from_status=event.status,
                to_status=event.status,
                note=f"Closed without a stock movement — {short}"[:255],
                actor=actor,
            )


@transaction.atomic
def complete_ai_event(event: AIEvent, *, actor=None, without_stock: bool = False) -> AIEvent:
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

    consumables = list(event.consumables.select_related("consumable").all())

    _deduct_the_stock(event, actor=actor, without_stock=without_stock)

    used = [f"{event.doses} straw" if event.doses == 1 else f"{event.doses} straws"]
    used += [f"{line.qty} × {line.consumable.name}" for line in consumables]
    _transition(
        event,
        AIEvent.Status.COMPLETED,
        actor=actor,
        note=f"Payment initiated, {', '.join(used)} deducted"[:255],
    )
    event.completed_at = timezone.now()
    event.save(update_fields=["status", "completed_at", "stock_deducted", "updated_at"])

    record_audit(
        action="state_change",
        entity_type="ai_event",
        entity_id=event.id,
        actor=actor,
        meta={
            "to": AIEvent.Status.COMPLETED,
            "straw": event.straw_unique_no,
            "stock_deducted": event.stock_deducted,
            "mait_id": event.mait_id,
            "mpp_code": event.mpp.mpp_code,
        },
    )
    # The insemination is finished; the question it asked is not. Booked here rather than by
    # a sweep looking for events that were missed, so a check exists the moment the event
    # does — and imported locally, because the pregnancy services import this module's models
    # and naming them at the top would close the loop.
    from apps.pregnancy.services import schedule_check

    schedule_check(event, actor=actor)

    logger.info(
        "AI event completed",
        extra={"ai_event_id": event.id, "doses": event.doses},
    )
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
