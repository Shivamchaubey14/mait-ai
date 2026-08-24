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

    Each outcome has a consequence and all of them live here: pregnant fixes a calving date,
    unsure books a recheck three weeks out, not pregnant does neither and demands a
    photograph — and declined ends it. A refusal books nothing and closes the row: the owner
    said no, and there is nothing further for the Mait to do or be reminded about.

    That leaves the chain recorded with no finding on it, which `oversight.rates_by_mait` has
    to recognise and exclude — otherwise the animal is scored a failed insemination for an
    examination her owner did not permit. The rule lives there rather than here because it is
    a question about reading the data, not about writing it.
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

    # What the visit cost, stamped now rather than derived later. The figure the farmer was
    # quoted in the yard is a fact about today, and reading it back through whatever the rate
    # happens to be next quarter would silently restate every visit already made.
    #
    # Nothing is stamped on a refusal: no examination happened, so there is nothing to bill
    # for, and a charge against a visit the owner declined is the one thing that would make a
    # Mait stop offering the choice honestly.
    if check.is_finding:
        # Imported here rather than at module scope: `payments.pricing` reads this app's own
        # models, and pulling it in at import time closes the loop.
        from apps.payments.pricing import pd_price_for

        check.amount_charged = pd_price_for(owner_type=check.ai_event.owner_type)

    if outcome == PregnancyCheck.Outcome.PREGNANT:
        event = check.ai_event
        served = local_day(event.performed_at or event.completed_at or check.checked_at)
        # Counted from the insemination, not from today: the animal's clock started when she
        # was served, and a check done late must not push her calving date late with it.
        check.calving_due_on = calving_due_from(served, event.animal.animal_type)

    check.save(
        update_fields=[
            "outcome",
            "checked_at",
            "photo_url",
            "note",
            "calving_due_on",
            "amount_charged",
            "updated_at",
        ]
    )

    # Only an unsure result books another visit. A refusal does not: the owner has answered,
    # and a check that reappears in the round every week is how a Mait gets told to stop
    # coming. If the dairy wants to try again it is a decision somebody makes, not one this
    # function makes on their behalf.
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
            # On the trail, because what somebody was charged is the thing they come back to
            # argue about and the rate it came from can change underneath the record.
            "amount_charged": str(check.amount_charged) if check.amount_charged else None,
        },
    )
    return check
