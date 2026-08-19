"""
The capture that could never be closed (SRS §6.4).

Nothing is deducted until completion, so for the whole life of an open capture the only record
that a straw is spoken for is the event holding it. The picker did not look at those, so every
capture started before any of them closed was handed the *same* oldest straw of the breed. The
first to complete consumed it; the rest were refused for want of stock on every attempt, for
ever. An insemination had happened, the animal was served, and the app offered a button that
could only produce the same refusal.

Two rules fix it and both are tested here. A straw already held is not offered again, so the
double-booking does not happen in the first place. And a capture whose held straw has gone
anyway — the records already stranded — can be closed *without* a further deduction, because
that straw was inserted into the animal and the flask is one short whatever the system does
next. Taking a second one would charge the holding twice for one insemination, and could
refuse the record all over again for want of a straw that was never this event's to spend.

That second rule is a decision, never an inference. It arrives as `without_stock` from a
person pressing *Close this off* on a record the app has already told them is stuck. An
ordinary completion still fails closed on a missing straw, because two events holding one
straw arriving together is precisely how one straw would come to serve two animals — and the
concurrent version of that promise is held in `test_completion.py`.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.ai_events.models import AIEvent, AIEventTimeline
from apps.ai_events.services import complete_ai_event, start_ai_event
from apps.core.exceptions import InsufficientStock, StrawAlreadyConsumed
from apps.inventory.models import MaitInventory, MaitInventoryLedger, ProductType
from apps.inventory.services import available_straw_count
from apps.payments.models import Payment
from conftest import SemenBatchFactory

pytestmark = pytest.mark.django_db


def hold(mait, straw_count: int, breed: str = "GIR"):
    """`straw_count` straws of one breed, in this Mait's flask."""
    straws = []
    for _ in range(straw_count):
        straw = SemenBatchFactory(breed=breed)
        MaitInventory.objects.create(
            mait=mait,
            product_type=ProductType.STRAW,
            product_ref_id=straw.id,
            qty_available=1,
        )
        straws.append(straw)
    return straws


def open_capture(mait, mpp, member, animal, breed: str = "GIR") -> AIEvent:
    """A capture through the real entry point, so the straw is held the way the app holds it."""
    return start_ai_event(
        mait=mait,
        mpp=mpp,
        owner_type=AIEvent.OwnerType.MEMBER,
        owner=member,
        animal=animal,
        client_uuid=uuid.uuid4(),
        semen_breed=breed,
    )


def ready_to_complete(mait, mpp, member, animal, straw) -> AIEvent:
    """An event parked in `payment_pending` with its payment verified, holding `straw`."""
    event = AIEvent.objects.create(
        client_uuid=uuid.uuid4(),
        mait=mait,
        mpp=mpp,
        owner_type=AIEvent.OwnerType.MEMBER,
        member=member,
        animal=animal,
        semen_batch=straw,
        straw_unique_no=straw.unique_straw_no,
        status=AIEvent.Status.PAYMENT_PENDING,
        performed_at=timezone.now(),
    )
    Payment.objects.create(
        ai_event=event,
        amount=Decimal("250.00"),
        mode=Payment.Mode.COD,
        member_otp_verified=True,
        member_otp_verified_at=timezone.now(),
        cod_otp_verified=True,
        cod_otp_verified_at=timezone.now(),
        status=Payment.Status.VERIFIED,
    )
    return event


class TestTheStrawIsNotHandedOutTwice:
    def test_two_open_captures_hold_two_different_straws(self, mait, mpp, member, animal):
        hold(mait, 2)

        first = open_capture(mait, mpp, member, animal)
        second = open_capture(mait, mpp, member, animal)

        assert first.semen_batch_id != second.semen_batch_id

    def test_the_capture_after_the_last_free_straw_is_refused_at_the_straw(
        self, mait, mpp, member, animal
    ):
        """
        Refused *before* the insemination rather than after it.

        One straw and one capture already holding it. The old picker handed the same straw
        over again and let the Mait serve an animal it could never account for; the honest
        answer is at the straw step, and it says which of the two reasons it is — an indent
        does not help somebody whose straws are all held by their own unfinished captures.
        """
        hold(mait, 1)
        open_capture(mait, mpp, member, animal)

        with pytest.raises(InsufficientStock) as refused:
            open_capture(mait, mpp, member, animal)

        assert "have not finished" in str(refused.value)

    def test_a_finished_capture_stops_holding_anything(self, mait, mpp, member, animal):
        """The hold is on open captures only — a completed one has already spent its straw."""
        straws = hold(mait, 1)
        event = ready_to_complete(mait, mpp, member, animal, straws[0])
        complete_ai_event(event)

        hold(mait, 1)
        # The new straw is free, and the completed event is not standing in front of it.
        assert open_capture(mait, mpp, member, animal).semen_batch is not None


class TestTheStrandedCaptureCanBeClosed:
    def test_it_closes_without_taking_a_second_straw(self, mait, mpp, member, animal):
        held, spare = hold(mait, 2)
        stranded = ready_to_complete(mait, mpp, member, animal, held)

        # Somebody else's completion spent it first — which is the state every record already
        # stranded is in.
        other = ready_to_complete(mait, mpp, member, animal, held)
        complete_ai_event(other)
        assert available_straw_count(mait) == 1

        complete_ai_event(stranded, without_stock=True)

        stranded.refresh_from_db()
        assert stranded.status == AIEvent.Status.COMPLETED
        assert stranded.stock_deducted is False
        # The spare is untouched. The insemination behind this record used the straw it holds,
        # which has already left the flask; deducting the spare would take two straws out of
        # stock for it.
        assert available_straw_count(mait) == 1
        assert spare.is_consumed is False
        assert not MaitInventoryLedger.objects.filter(ref_id=stranded.id).exists()

    def test_it_keeps_pointing_at_the_straw_that_was_actually_used(self, mait, mpp, member, animal):
        """The record is not rewritten to name a straw nobody put in an animal."""
        held, _ = hold(mait, 2)
        stranded = ready_to_complete(mait, mpp, member, animal, held)
        complete_ai_event(ready_to_complete(mait, mpp, member, animal, held))

        complete_ai_event(stranded, without_stock=True)

        stranded.refresh_from_db()
        assert stranded.semen_batch_id == held.id
        assert stranded.straw_unique_no == held.unique_straw_no

    def test_the_audit_trail_says_the_stock_had_already_moved(self, mait, mpp, member, animal):
        """
        Never quietly.

        An admin comparing straws issued against events completed will find one event more
        than the count explains, and the answer has to be on the record rather than in
        somebody's memory of a bug.
        """
        held, _ = hold(mait, 2)
        stranded = ready_to_complete(mait, mpp, member, animal, held)
        complete_ai_event(ready_to_complete(mait, mpp, member, animal, held))

        complete_ai_event(stranded, without_stock=True)

        notes = AIEventTimeline.objects.filter(ai_event=stranded).values_list("note", flat=True)
        assert any("without a stock movement" in note for note in notes)

    def test_an_ordinary_completion_is_still_refused(self, mait, mpp, member, animal):
        """
        The flag is the only way past it, and nothing infers the flag.

        Two events holding one straw arriving together is exactly how one straw would come to
        serve two animals. A completion that quietly shrugged at a missing straw would make
        that the normal path, so the ordinary call still fails closed — and `test_completion`
        holds the concurrent version of the same promise.
        """
        held, _ = hold(mait, 2)
        stranded = ready_to_complete(mait, mpp, member, animal, held)
        complete_ai_event(ready_to_complete(mait, mpp, member, animal, held))

        with pytest.raises((InsufficientStock, StrawAlreadyConsumed)):
            complete_ai_event(stranded)

        stranded.refresh_from_db()
        assert stranded.status == AIEvent.Status.PAYMENT_PENDING

    def test_the_flag_still_deducts_a_straw_that_is_there(self, mait, mpp, member, animal):
        """
        A permission, not an instruction.

        Pressing *Close this off* on a record whose straw is sitting in the flask must still
        cost that straw — otherwise the button would be a way to record an insemination for
        free, which is the leakage this platform exists to stop.
        """
        held, spare = hold(mait, 2)
        event = ready_to_complete(mait, mpp, member, animal, held)

        complete_ai_event(event, without_stock=True)

        event.refresh_from_db()
        held.refresh_from_db()
        assert event.stock_deducted is True
        assert held.is_consumed is True
        assert available_straw_count(mait) == 1
        assert spare.is_consumed is False

    def test_a_capture_whose_straw_is_still_there_deducts_it_as_always(
        self, mait, mpp, member, animal
    ):
        """The ordinary path, guarded here because everything above is the exception to it."""
        held, spare = hold(mait, 2)
        event = ready_to_complete(mait, mpp, member, animal, held)

        complete_ai_event(event)

        held.refresh_from_db()
        spare.refresh_from_db()
        assert held.is_consumed is True
        assert spare.is_consumed is False
        assert available_straw_count(mait) == 1
        assert MaitInventoryLedger.objects.filter(ref_id=event.id).count() == 1

    def test_closing_one_does_not_let_the_next_capture_spend_a_straw_twice(
        self, mait, mpp, member, animal
    ):
        """
        The hole this could have been.

        Completing without a deduction must not leave the consumed straw looking available to
        whatever the Mait does next — the count from here on has to keep meaning what it says.
        """
        held = hold(mait, 1)[0]
        stranded = ready_to_complete(mait, mpp, member, animal, held)
        complete_ai_event(ready_to_complete(mait, mpp, member, animal, held))

        complete_ai_event(stranded, without_stock=True)

        assert available_straw_count(mait) == 0
        with pytest.raises(InsufficientStock):
            open_capture(mait, mpp, member, animal)
