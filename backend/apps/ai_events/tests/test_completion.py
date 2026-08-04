"""
Tests for the inventory invariant (SRS §6.4, §13 "Concurrency / Data Integrity").

This is the suite that matters most. The platform's entire value proposition is that a Mait
holding N straws can complete exactly N AI events — not N+1 under a retry, and not N+1 when
two requests arrive together. Everything else is reporting on top of that guarantee.
"""

from __future__ import annotations

import threading
import uuid

import pytest
from django.db import connections, transaction

from apps.ai_events.models import AIEvent
from apps.ai_events.services import cancel_ai_event, complete_ai_event, verify_straw
from apps.core.exceptions import (
    InsufficientStock,
    InvalidStateTransition,
    PaymentNotVerified,
    StrawAlreadyConsumed,
)
from apps.inventory.models import MaitInventory, MaitInventoryLedger, ProductType
from apps.inventory.services import available_straw_count
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


class TestCompletion:
    def test_completing_deducts_exactly_one_straw(self, ai_event_ready_to_complete, mait):
        event, straw = ai_event_ready_to_complete()
        assert available_straw_count(mait) == 1

        complete_ai_event(event)

        event.refresh_from_db()
        straw.refresh_from_db()
        assert event.status == AIEvent.Status.COMPLETED
        assert event.completed_at is not None
        assert straw.is_consumed is True
        assert available_straw_count(mait) == 0

    def test_completion_writes_a_ledger_entry(self, ai_event_ready_to_complete):
        event, straw = ai_event_ready_to_complete()
        complete_ai_event(event)

        entry = MaitInventoryLedger.objects.get(
            ref_type=MaitInventoryLedger.RefType.AI_EVENT, ref_id=event.id
        )
        assert entry.txn_type == MaitInventoryLedger.TxnType.CONSUME
        assert entry.qty == -1
        assert entry.balance_after == 0

    def test_completing_twice_is_a_no_op(self, ai_event_ready_to_complete, mait):
        """A retry whose first response was lost must not deduct a second straw."""
        event, _ = ai_event_ready_to_complete()

        complete_ai_event(event)
        complete_ai_event(event)

        assert available_straw_count(mait) == 0
        assert MaitInventoryLedger.objects.filter(ref_id=event.id).count() == 1

    def test_cannot_complete_without_verified_payment(self, ai_event_ready_to_complete, mait):
        """SRS §6.5.3 — an unpaid event must never reach completed."""
        event, _ = ai_event_ready_to_complete()
        Payment.objects.filter(ai_event=event).update(status=Payment.Status.PENDING)
        event.refresh_from_db()

        with pytest.raises(PaymentNotVerified):
            complete_ai_event(event)

        event.refresh_from_db()
        assert event.status == AIEvent.Status.PAYMENT_PENDING
        assert available_straw_count(mait) == 1, "stock must be untouched on a failed completion"

    def test_cannot_complete_from_draft(self, ai_event_ready_to_complete):
        event, _ = ai_event_ready_to_complete()
        event.status = AIEvent.Status.DRAFT
        event.save(update_fields=["status"])

        with pytest.raises(InvalidStateTransition):
            complete_ai_event(event)

    def test_cancelling_does_not_deduct_stock(self, ai_event_ready_to_complete, mait):
        event, straw = ai_event_ready_to_complete()

        cancel_ai_event(event, reason="Farmer declined")

        event.refresh_from_db()
        straw.refresh_from_db()
        assert event.status == AIEvent.Status.CANCELLED
        assert straw.is_consumed is False
        assert available_straw_count(mait) == 1

    def test_completed_event_cannot_be_cancelled(self, ai_event_ready_to_complete):
        event, _ = ai_event_ready_to_complete()
        complete_ai_event(event)

        with pytest.raises(InvalidStateTransition):
            cancel_ai_event(event, reason="too late")


class TestStrawValidation:
    def test_straw_not_in_stock_is_rejected(self, db, mait, mpp, member, animal):
        """SRS §6.4.2 — the 11th attempt on 10 straws is blocked at the scan step."""
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
        )
        with pytest.raises(InsufficientStock):
            verify_straw(event, "STRAW-NOT-HELD")

        event.refresh_from_db()
        assert event.status == AIEvent.Status.DRAFT

    def test_consumed_straw_is_rejected(
        self, ai_event_ready_to_complete, db, mait, mpp, member, animal
    ):
        first, straw = ai_event_ready_to_complete()
        complete_ai_event(first)

        second = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
        )
        with pytest.raises((StrawAlreadyConsumed, InsufficientStock)):
            verify_straw(second, straw.unique_straw_no)


class TestInventoryFloor:
    def test_database_refuses_negative_stock(self, db, mait):
        """
        The check constraint is the last line of defence (ADR 0002).

        Even if application logic were wrong, the database must not store negative stock.
        """
        from django.db.utils import IntegrityError

        inventory = MaitInventory.objects.create(
            mait=mait, product_type=ProductType.STRAW, product_ref_id=1, qty_available=0
        )
        with pytest.raises(IntegrityError), transaction.atomic():
            MaitInventory.objects.filter(pk=inventory.pk).update(qty_available=-1)


@pytest.mark.django_db(transaction=True)
class TestConcurrentCompletion:
    """
    Two completions racing for one straw (SRS §13).

    Requires ``transaction=True`` so each thread gets a real connection — the default
    test transaction would hide the very interleaving under test.
    """

    def test_only_one_of_two_concurrent_completions_succeeds(
        self, ai_event_ready_to_complete, mait
    ):
        event, straw = ai_event_ready_to_complete()

        # A second event pointed at the same straw — the shape a duplicated offline sync
        # produces.
        rival = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=event.mait,
            mpp=event.mpp,
            owner_type=event.owner_type,
            member=event.member,
            animal=event.animal,
            semen_batch=straw,
            straw_unique_no=straw.unique_straw_no,
            status=AIEvent.Status.PAYMENT_PENDING,
        )
        Payment.objects.create(
            ai_event=rival,
            amount=event.payment.amount,
            mode=Payment.Mode.COD,
            member_otp_verified=True,
            cod_otp_verified=True,
            status=Payment.Status.VERIFIED,
        )

        results: list[Exception | str] = []
        barrier = threading.Barrier(2)

        def attempt(target_id: int) -> None:
            try:
                barrier.wait(timeout=5)  # maximise the overlap
                target = AIEvent.objects.get(pk=target_id)
                complete_ai_event(target)
                results.append("ok")
            except Exception as exc:
                results.append(exc)
            finally:
                connections.close_all()

        threads = [
            threading.Thread(target=attempt, args=(event.id,)),
            threading.Thread(target=attempt, args=(rival.id,)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=15)

        assert results.count("ok") == 1, f"exactly one completion must win, got {results}"
        assert available_straw_count(mait) == 0
        assert MaitInventory.objects.filter(mait=mait, qty_available__lt=0).exists() is False
        assert AIEvent.objects.filter(status=AIEvent.Status.COMPLETED).count() == 1
