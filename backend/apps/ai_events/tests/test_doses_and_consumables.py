"""
Two doses, and everything else the visit used (SRS §6.4).

One insemination was one straw for as long as this platform has existed, and that is not what
a Mait does. A difficult animal takes two doses in one visit, and every visit takes a sheath
and a pair of gloves — all of it out of the same flask, none of it recorded anywhere. A month
of that ends with a physical count that disagrees with the ledger and nothing to explain the
difference.

So the capture says what it used, and the completion takes exactly that. What must not move is
the promise underneath: a Mait holding ten straws can complete ten *doses* of them, whether
that is ten inseminations or five double ones, and the eleventh is refused for want of stock
rather than quietly allowed.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.ai_events.models import AIEvent, AIEventStraw
from apps.ai_events.services import complete_ai_event, start_ai_event
from apps.core.exceptions import InsufficientStock
from apps.inventory.models import (
    Consumable,
    MaitInventory,
    MaitInventoryLedger,
    ProductType,
)
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


def supply(mait, code: str, name: str, qty: int) -> Consumable:
    """A consumable in the catalogue, and `qty` of it in this Mait's bag."""
    item = Consumable.objects.create(code=code, name=name, unit="piece")
    MaitInventory.objects.create(
        mait=mait,
        product_type=ProductType.CONSUMABLE,
        product_ref_id=item.id,
        qty_available=qty,
    )
    return item


def capture(mait, mpp, member, animal, *, doses: int = 1, consumables=None, breed: str = "GIR"):
    return start_ai_event(
        mait=mait,
        mpp=mpp,
        owner_type=AIEvent.OwnerType.MEMBER,
        owner=member,
        animal=animal,
        client_uuid=uuid.uuid4(),
        semen_breed=breed,
        doses=doses,
        consumables=consumables or [],
    )


def payable(event: AIEvent) -> AIEvent:
    """Walk the event to the door of completion, with its payment verified."""
    event.status = AIEvent.Status.PAYMENT_PENDING
    event.performed_at = timezone.now()
    event.save(update_fields=["status", "performed_at"])
    Payment.objects.create(
        ai_event=event,
        amount=Decimal("250.00"),
        mode=Payment.Mode.COD,
        member_otp_verified=True,
        cod_otp_verified=True,
        status=Payment.Status.VERIFIED,
    )
    return event


class TestDoses:
    def test_two_doses_hold_two_straws(self, mait, mpp, member, animal):
        hold(mait, 4)

        event = capture(mait, mpp, member, animal, doses=2)

        assert event.doses == 2
        assert AIEventStraw.objects.filter(ai_event=event).count() == 2
        # Two different straws, not the same one twice.
        assert (
            AIEventStraw.objects.filter(ai_event=event).values("semen_batch").distinct().count()
            == 2
        )
        # Nothing moves until completion: a capture abandoned here costs the Mait nothing.
        assert available_straw_count(mait) == 4

    def test_completing_deducts_every_dose(self, mait, mpp, member, animal):
        hold(mait, 4)
        event = payable(capture(mait, mpp, member, animal, doses=2))

        complete_ai_event(event)

        assert available_straw_count(mait) == 2
        assert MaitInventoryLedger.objects.filter(ref_id=event.id).count() == 2

    def test_the_count_still_gates_the_work(self, mait, mpp, member, animal):
        """
        Ten straws, ten doses. A Mait carrying three cannot start a two-dose capture on top of
        a two-dose one — the refusal is at the straw, before the animal is served.
        """
        hold(mait, 3)
        capture(mait, mpp, member, animal, doses=2)

        with pytest.raises(InsufficientStock):
            capture(mait, mpp, member, animal, doses=2)

    def test_a_second_capture_cannot_take_a_held_dose(self, mait, mpp, member, animal):
        """The double-booking guard reads the rows, so it sees both of a two-dose hold."""
        hold(mait, 2)
        first = capture(mait, mpp, member, animal, doses=2)

        with pytest.raises(InsufficientStock):
            capture(mait, mpp, member, animal)

        assert AIEventStraw.objects.filter(ai_event=first).count() == 2

    def test_one_dose_is_still_one_straw(self, mait, mpp, member, animal):
        hold(mait, 2)
        event = payable(capture(mait, mpp, member, animal))

        complete_ai_event(event)

        assert event.doses == 1
        assert available_straw_count(mait) == 1


class TestConsumables:
    def test_what_the_visit_used_comes_off_the_bag(self, mait, mpp, member, animal):
        hold(mait, 1)
        sheaths = supply(mait, "SHEATH", "AI sheaths", 46)
        gloves = supply(mait, "GLOVES", "Gloves", 38)

        event = payable(capture(mait, mpp, member, animal, consumables=[(sheaths, 2), (gloves, 1)]))
        complete_ai_event(event)

        assert MaitInventory.objects.get(product_ref_id=sheaths.id).qty_available == 44
        assert MaitInventory.objects.get(product_ref_id=gloves.id).qty_available == 37

    def test_nothing_moves_before_the_event_closes(self, mait, mpp, member, animal):
        """An abandoned capture costs a Mait no gloves, exactly as it costs them no straws."""
        hold(mait, 1)
        sheaths = supply(mait, "SHEATH", "AI sheaths", 46)

        capture(mait, mpp, member, animal, consumables=[(sheaths, 2)])

        assert MaitInventory.objects.get(product_ref_id=sheaths.id).qty_available == 46

    def test_the_ledger_says_which_event_took_them(self, mait, mpp, member, animal):
        """A month-end count that disagrees with the flask has to be answerable from here."""
        hold(mait, 1)
        sheaths = supply(mait, "SHEATH", "AI sheaths", 46)
        event = payable(capture(mait, mpp, member, animal, consumables=[(sheaths, 2)]))

        complete_ai_event(event)

        entry = MaitInventoryLedger.objects.get(
            inventory__product_type=ProductType.CONSUMABLE, ref_id=event.id
        )
        assert entry.qty == -2
        assert entry.txn_type == MaitInventoryLedger.TxnType.CONSUME
        assert entry.balance_after == 44

    def test_running_out_refuses_the_completion(self, mait, mpp, member, animal):
        """
        The straw and the sheath are held to the same standard.

        A completion that shrugged at a missing consumable would leave the ledger claiming
        stock the bag does not have, which is the same leak in a smaller pipe.
        """
        hold(mait, 1)
        sheaths = supply(mait, "SHEATH", "AI sheaths", 1)
        event = payable(capture(mait, mpp, member, animal, consumables=[(sheaths, 2)]))

        with pytest.raises(InsufficientStock):
            complete_ai_event(event)

        event.refresh_from_db()
        assert event.status == AIEvent.Status.PAYMENT_PENDING
        # And nothing was half-taken: the straw is still in the flask.
        assert available_straw_count(mait) == 1

    def test_a_stuck_record_still_closes_without_them(self, mait, mpp, member, animal):
        """`close_without_stock` covers the bag as well as the flask — see test_stranded_straw."""
        hold(mait, 1)
        sheaths = supply(mait, "SHEATH", "AI sheaths", 0)
        event = payable(capture(mait, mpp, member, animal, consumables=[(sheaths, 2)]))

        complete_ai_event(event, without_stock=True)

        event.refresh_from_db()
        assert event.status == AIEvent.Status.COMPLETED
        assert event.stock_deducted is False
