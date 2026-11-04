"""
A capture step must never overwrite a status that has already moved on (SRS §11, §13).

This is the race behind the stuck records that needed an office repair. A photo upload (or a
payment-initiate) loads the event while it is early in the flow, then — over a slow connection,
or as a duplicate the client retried — lands its ``save(update_fields=["status"])`` *after* the
capture has advanced, in the worst case after it has ``completed``. The old code decided the
transition against the instance the view had loaded, so the late write sailed past the guards
and wrote ``photo_captured`` / ``payment_pending`` over ``completed`` — silently reopening a
finished insemination.

The fix locks and re-reads the row inside each transition, so the decision is made against the
row as it is now. These tests drive an event to ``completed`` and then replay a step built on a
stale, pre-completion instance; the event must stay completed.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.ai_events.models import AIEvent, AIEventStraw, AIEventTimeline
from apps.ai_events.services import (
    attach_photo,
    complete_ai_event,
    mark_payment_pending,
)
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


def _event_at_straw_verified(mait, mpp, member, animal, stocked_mait):
    """A member capture with its straw held and a verified deduction, sitting at straw_verified."""
    straw = stocked_mait(1)[0]
    event = AIEvent.objects.create(
        client_uuid=uuid.uuid4(),
        mait=mait,
        mpp=mpp,
        owner_type=AIEvent.OwnerType.MEMBER,
        member=member,
        animal=animal,
        semen_batch=straw,
        straw_unique_no=straw.unique_straw_no,
        status=AIEvent.Status.STRAW_VERIFIED,
        performed_at=timezone.now(),
    )
    AIEventStraw.objects.create(ai_event=event, semen_batch=straw)
    Payment.objects.create(
        ai_event=event,
        amount=Decimal("100.00"),
        mode=Payment.Mode.DEDUCTION,
        status=Payment.Status.VERIFIED,
    )
    return event, straw


def _fresh(pk):
    return AIEvent.objects.get(pk=pk)


class TestStaleWriteGuard:
    def test_a_late_photo_upload_does_not_reopen_a_completed_event(
        self, db, mait, mpp, member, animal, stocked_mait
    ):
        event, _ = _event_at_straw_verified(mait, mpp, member, animal, stocked_mait)

        # The duplicate/slow upload that began while the event was straw_verified, captured here
        # exactly as the view would have loaded it before a long upload.
        stale = _fresh(event.pk)
        assert stale.status == AIEvent.Status.STRAW_VERIFIED
        assert stale.ai_photo_url == ""

        # Meanwhile the capture runs to completion on fresh reads, as the live requests did.
        attach_photo(_fresh(event.pk), photo_url="proof.jpg")
        mark_payment_pending(_fresh(event.pk))
        complete_ai_event(_fresh(event.pk))
        assert _fresh(event.pk).status == AIEvent.Status.COMPLETED

        # The late upload finally lands, deciding off its stale straw_verified snapshot.
        attach_photo(stale, photo_url="late-duplicate.jpg")

        after = _fresh(event.pk)
        assert after.status == AIEvent.Status.COMPLETED, "a late photo must not reopen the event"
        assert after.ai_photo_url == "proof.jpg", "the real photo must not be overwritten"
        # And no second straw_verified -> photo_captured row — the clobber left exactly that mark.
        assert (
            AIEventTimeline.objects.filter(
                ai_event=event,
                from_status=AIEvent.Status.STRAW_VERIFIED,
                to_status=AIEvent.Status.PHOTO_CAPTURED,
            ).count()
            == 1
        )

    def test_a_late_payment_initiate_does_not_reopen_a_completed_event(
        self, db, mait, mpp, member, animal, stocked_mait
    ):
        event, _ = _event_at_straw_verified(mait, mpp, member, animal, stocked_mait)

        attach_photo(_fresh(event.pk), photo_url="proof.jpg")
        # The payment-initiate that loaded the event at photo_captured and is now replayed/late.
        stale = _fresh(event.pk)
        assert stale.status == AIEvent.Status.PHOTO_CAPTURED

        mark_payment_pending(_fresh(event.pk))
        complete_ai_event(_fresh(event.pk))
        assert _fresh(event.pk).status == AIEvent.Status.COMPLETED

        mark_payment_pending(stale)

        assert _fresh(event.pk).status == AIEvent.Status.COMPLETED, (
            "a late payment-initiate must not reopen the event"
        )

    def test_duplicate_photo_uploads_write_one_transition(
        self, db, mait, mpp, member, animal, stocked_mait
    ):
        """Two uploads that both loaded the event at straw_verified — the shape of a client retry
        — must leave exactly one photo_captured transition, not two."""
        event, _ = _event_at_straw_verified(mait, mpp, member, animal, stocked_mait)

        first = _fresh(event.pk)
        second = _fresh(event.pk)  # both snapshots see straw_verified, no photo

        attach_photo(first, photo_url="proof.jpg")
        attach_photo(second, photo_url="duplicate.jpg")

        after = _fresh(event.pk)
        assert after.status == AIEvent.Status.PHOTO_CAPTURED
        assert after.ai_photo_url == "proof.jpg"
        assert (
            AIEventTimeline.objects.filter(
                ai_event=event, to_status=AIEvent.Status.PHOTO_CAPTURED
            ).count()
            == 1
        )

    def test_the_ordinary_flow_still_completes(
        self, db, mait, mpp, member, animal, stocked_mait
    ):
        """The guard must not get in the way of a clean, single-threaded capture."""
        event, straw = _event_at_straw_verified(mait, mpp, member, animal, stocked_mait)

        attach_photo(_fresh(event.pk), photo_url="proof.jpg")
        mark_payment_pending(_fresh(event.pk))
        complete_ai_event(_fresh(event.pk))

        after = _fresh(event.pk)
        straw.refresh_from_db()
        assert after.status == AIEvent.Status.COMPLETED
        assert after.completed_at is not None
        assert straw.is_consumed is True
