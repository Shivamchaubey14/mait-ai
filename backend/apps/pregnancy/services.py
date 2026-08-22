"""
Booking and recording pregnancy checks.

Every rule that decides what happens to an animal lives here rather than in a view or on the
handset. The app draws the three buttons; what a "not sure" *means* — that it books another
visit three weeks out — is a domain decision, and a client that could choose otherwise is a
client that can quietly stop the recheck happening.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.core.services import record_audit
from apps.core.timeframe import local_day

from .models import DAYS_TO_CHECK, RECHECK_AFTER_DAYS, PregnancyCheck, calving_due_from

logger = logging.getLogger(__name__)


class CheckAlreadyRecorded(Exception):
    """A result is final. Correcting one is an admin job, not a second tap on a handset."""


class PhotoRequired(Exception):
    """Not pregnant, and nothing to show for it."""


@transaction.atomic
def schedule_check(ai_event, *, actor=None) -> PregnancyCheck | None:
    """
    Book the ninety-day check for a completed insemination.

    Called from `complete_ai_event`, so a check exists the moment the event does and nothing
    has to sweep for events that were missed. Idempotent by construction: an event that
    already has an open check gets no second one, which matters because completion is
    retryable from the offline queue.
    """
    existing = ai_event.pregnancy_checks.filter(outcome="").first()
    if existing:
        return existing

    served = local_day(ai_event.performed_at or ai_event.completed_at or timezone.now())
    check = PregnancyCheck.objects.create(
        ai_event=ai_event,
        mait=ai_event.mait,
        due_on=served + timedelta(days=DAYS_TO_CHECK),
    )

    logger.info(
        "Pregnancy check booked",
        extra={"ai_event_id": ai_event.id, "check_id": check.id, "due_on": str(check.due_on)},
    )
    record_audit(
        action="create",
        entity_type="pregnancy_check",
        entity_id=check.id,
        actor=actor,
        meta={"ai_event_id": ai_event.id, "due_on": str(check.due_on)},
    )
    return check


@transaction.atomic
def record_check(
    check: PregnancyCheck,
    *,
    outcome: str,
    photo_url: str = "",
    note: str = "",
    actor=None,
) -> PregnancyCheck:
    """
    Write what the Mait found, and do whatever that answer implies.

    The three outcomes each have a consequence, and all three live here:
    pregnant fixes a calving date, unsure books a recheck, not pregnant does neither and
    demands a photograph.
    """
    if check.is_recorded:
        raise CheckAlreadyRecorded(
            f"Check {check.id} was already recorded as {check.get_outcome_display()}."
        )

    if outcome == PregnancyCheck.Outcome.NOT_PREGNANT and not photo_url:
        # The one outcome that costs somebody money, and the one a farmer disputes. A photo
        # is cheap; an argument six months later with nothing on the record is not.
        raise PhotoRequired("A photo of the animal is required when she is not pregnant.")

    check.outcome = outcome
    check.checked_at = timezone.now()
    check.photo_url = photo_url
    check.note = note

    if outcome == PregnancyCheck.Outcome.PREGNANT:
        event = check.ai_event
        served = local_day(event.performed_at or event.completed_at or check.checked_at)
        # Counted from the insemination, not from today: the animal's clock started when she
        # was served, and a check done late must not push her calving date late with it.
        check.calving_due_on = calving_due_from(served, event.animal.animal_type)

    check.save(
        update_fields=["outcome", "checked_at", "photo_url", "note", "calving_due_on", "updated_at"]
    )

    recheck = None
    if outcome == PregnancyCheck.Outcome.UNSURE:
        recheck = PregnancyCheck.objects.create(
            ai_event=check.ai_event,
            mait=check.mait,
            due_on=local_day(check.checked_at) + timedelta(days=RECHECK_AFTER_DAYS),
            rechecks=check,
        )

    logger.info(
        "Pregnancy check recorded",
        extra={
            "check_id": check.id,
            "ai_event_id": check.ai_event_id,
            "outcome": outcome,
            "recheck_id": recheck.id if recheck else None,
        },
    )
    record_audit(
        action="state_change",
        entity_type="pregnancy_check",
        entity_id=check.id,
        actor=actor,
        meta={
            "outcome": outcome,
            "ai_event_id": check.ai_event_id,
            "calving_due_on": str(check.calving_due_on) if check.calving_due_on else None,
            "recheck_id": recheck.id if recheck else None,
        },
    )
    return check
