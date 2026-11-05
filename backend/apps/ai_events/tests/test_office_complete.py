"""
Office completion of a stuck AI event (admin only).

The Mait's own ``complete`` is barred to an admin on purpose — nobody closes an insemination
they were not at. ``office-complete`` is the one narrow door the office gets, for a capture the
Mait left stuck: a **member** event at ``photo_captured`` or ``payment_pending`` whose ₹100
deduction is already recorded and verified. Where it applies it does exactly what the handset
would — deduct the straw and close the event — so the guarantees the completion suite defends
(one straw per completion, a ledger line, a booked pregnancy check) must hold here too.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.ai_events.models import AIEvent
from apps.animals.models import Animal, AnimalType, BreedConfig
from apps.core.models import AuditLog
from apps.inventory.models import MaitInventoryLedger
from apps.inventory.services import available_straw_count
from apps.masterdata.models import NonMember
from apps.payments.models import Payment
from apps.pregnancy.models import PregnancyCheck

pytestmark = pytest.mark.django_db

BASE = "/api/v1/ai-events"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def mait_client(mait):
    return auth(mait.user)


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-office-complete",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


@pytest.fixture
def normal_user_client(db):
    """An office account that works the screen as an admin does, but must not complete."""
    user = User.objects.create_user(
        username="normal-office-complete",
        password="a-long-enough-password",
        full_name="Normal User",
        role=Role.NORMAL_USER,
    )
    return auth(user)


@pytest.fixture
def stuck_member_event(db, mait, mpp, member, animal, stocked_mait):
    """
    A member capture sitting where the Mait left it: photo taken, ₹100 deduction recorded and
    verified, one straw still held — but never completed.
    """

    def _make(status=AIEvent.Status.PHOTO_CAPTURED):
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
            status=status,
            performed_at=timezone.now(),
        )
        Payment.objects.create(
            ai_event=event,
            amount=Decimal("100.00"),
            mode=Payment.Mode.DEDUCTION,
            status=Payment.Status.VERIFIED,
        )
        return event, straw

    return _make


class TestOfficeComplete:
    def test_admin_completes_a_photo_captured_event(self, admin_client, stuck_member_event, mait):
        event, straw = stuck_member_event()
        assert available_straw_count(mait) == 1

        response = admin_client.post(f"{BASE}/{event.id}/office-complete/")

        assert response.status_code == 200
        assert response.json()["status"] == "completed"
        event.refresh_from_db()
        straw.refresh_from_db()
        assert event.status == AIEvent.Status.COMPLETED
        assert event.completed_at is not None
        assert straw.is_consumed is True
        assert available_straw_count(mait) == 0

    def test_it_deducts_exactly_one_straw_and_books_a_check(self, admin_client, stuck_member_event):
        event, _ = stuck_member_event()

        admin_client.post(f"{BASE}/{event.id}/office-complete/")

        ledger = MaitInventoryLedger.objects.filter(
            ref_type=MaitInventoryLedger.RefType.AI_EVENT, ref_id=event.id
        )
        assert ledger.count() == 1
        assert ledger.first().qty == -1
        # An insemination's question is booked the moment it completes, the same as the Mait's
        # own completion does it.
        assert PregnancyCheck.objects.filter(ai_event=event).count() == 1

    def test_it_also_completes_from_payment_pending(self, admin_client, stuck_member_event):
        event, _ = stuck_member_event(status=AIEvent.Status.PAYMENT_PENDING)

        response = admin_client.post(f"{BASE}/{event.id}/office-complete/")

        assert response.status_code == 200
        event.refresh_from_db()
        assert event.status == AIEvent.Status.COMPLETED

    def test_completing_twice_is_a_no_op(self, admin_client, stuck_member_event, mait):
        """A second click, or two admins on the same row, must not deduct a second straw."""
        event, _ = stuck_member_event()

        first = admin_client.post(f"{BASE}/{event.id}/office-complete/")
        second = admin_client.post(f"{BASE}/{event.id}/office-complete/")

        assert first.status_code == 200
        assert second.status_code == 200
        assert available_straw_count(mait) == 0
        assert MaitInventoryLedger.objects.filter(ref_id=event.id).count() == 1

    def test_it_is_audited_as_an_office_completion(self, admin_client, stuck_member_event):
        event, _ = stuck_member_event()

        admin_client.post(f"{BASE}/{event.id}/office-complete/")

        entry = AuditLog.objects.filter(
            entity_type="ai_event", entity_id=event.id, action="state_change"
        ).latest("id")
        assert entry.meta_json["office_complete"] is True
        assert entry.meta_json["to"] == "completed"


class TestOfficeCompleteRefusals:
    def test_an_unverified_payment_is_refused(self, admin_client, stuck_member_event, mait):
        event, _ = stuck_member_event()
        Payment.objects.filter(ai_event=event).update(status=Payment.Status.PENDING)

        response = admin_client.post(f"{BASE}/{event.id}/office-complete/")

        assert response.status_code == 409
        event.refresh_from_db()
        assert event.status == AIEvent.Status.PHOTO_CAPTURED
        assert available_straw_count(mait) == 1, "stock must be untouched on a refusal"

    def test_an_event_with_no_payment_is_refused(
        self, admin_client, mait, mpp, member, animal, stocked_mait
    ):
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
            status=AIEvent.Status.PHOTO_CAPTURED,
            performed_at=timezone.now(),
        )

        assert admin_client.post(f"{BASE}/{event.id}/office-complete/").status_code == 409

    def test_a_too_early_event_is_refused(
        self, admin_client, mait, mpp, member, animal
    ):
        """No photo, no straw — nothing to complete, whatever the office wishes."""
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            status=AIEvent.Status.DRAFT,
        )

        assert admin_client.post(f"{BASE}/{event.id}/office-complete/").status_code == 409

    def test_a_non_member_is_refused(self, admin_client, mait, mpp, stocked_mait):
        """A non-member authorises her own payment with a code the office cannot enter."""
        non_member = NonMember.objects.create(
            name="Walk-in", mpp=mpp, created_by_mait=mait
        )
        animal = Animal.objects.create(
            owner_type=Animal.OwnerType.NON_MEMBER,
            non_member=non_member,
            animal_type=AnimalType.COW,
            breed="GIR",
        )
        straw = stocked_mait(1)[0]
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.NON_MEMBER,
            non_member=non_member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=straw.unique_straw_no,
            status=AIEvent.Status.PHOTO_CAPTURED,
            performed_at=timezone.now(),
        )
        Payment.objects.create(
            ai_event=event,
            amount=Decimal("100.00"),
            mode=Payment.Mode.COD,
            member_otp_verified=True,
            cod_otp_verified=True,
            status=Payment.Status.VERIFIED,
        )

        response = admin_client.post(f"{BASE}/{event.id}/office-complete/")

        assert response.status_code == 400
        event.refresh_from_db()
        assert event.status == AIEvent.Status.PHOTO_CAPTURED


class TestOfficeCompletePermissions:
    def test_a_mait_cannot_office_complete(self, mait_client, stuck_member_event):
        event, _ = stuck_member_event()

        assert mait_client.post(f"{BASE}/{event.id}/office-complete/").status_code == 403
        event.refresh_from_db()
        assert event.status == AIEvent.Status.PHOTO_CAPTURED

    def test_a_normal_user_cannot_office_complete(self, normal_user_client, stuck_member_event):
        event, _ = stuck_member_event()

        assert normal_user_client.post(f"{BASE}/{event.id}/office-complete/").status_code == 403


@pytest.fixture
def priced(db):
    """A member rate for the GIR cow the factories build, so force-complete can price the deduction."""
    return BreedConfig.objects.create(
        animal_type=AnimalType.COW,
        code="GIR",
        name="Gir",
        rate=Decimal("100.00"),
        non_member_rate=Decimal("150.00"),
        is_active=True,
    )


@pytest.fixture
def straw_verified_member(db, mait, mpp, member, animal, stocked_mait):
    """A member capture with the straw held and nothing else: no photo, no payment, not done."""

    def _make():
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
        return event, straw

    return _make


class TestForceComplete:
    """Completing a member capture WITHOUT its proof photo — the deliberate no-proof close."""

    def test_it_completes_a_straw_verified_event_with_no_photo(
        self, admin_client, straw_verified_member, priced, mait
    ):
        event, straw = straw_verified_member()
        assert available_straw_count(mait) == 1

        response = admin_client.post(f"{BASE}/{event.id}/force-complete/")

        assert response.status_code == 200
        assert response.json()["status"] == "completed"
        event.refresh_from_db()
        straw.refresh_from_db()
        assert event.status == AIEvent.Status.COMPLETED
        assert not event.ai_photo_url, "a force-complete attaches no proof photo"
        assert straw.is_consumed is True
        assert available_straw_count(mait) == 0
        # The verified member deduction the ordinary close would have recorded.
        payment = Payment.objects.get(ai_event=event)
        assert payment.is_verified is True
        assert payment.amount == Decimal("100.00")
        # The question is still booked, exactly as a completion with a photo books it.
        assert PregnancyCheck.objects.filter(ai_event=event).count() == 1

    def test_it_deducts_exactly_one_straw(self, admin_client, straw_verified_member, priced):
        event, _ = straw_verified_member()

        admin_client.post(f"{BASE}/{event.id}/force-complete/")

        ledger = MaitInventoryLedger.objects.filter(
            ref_type=MaitInventoryLedger.RefType.AI_EVENT, ref_id=event.id
        )
        assert ledger.count() == 1
        assert ledger.first().qty == -1

    def test_a_replay_is_a_no_op(self, admin_client, straw_verified_member, priced, mait):
        event, _ = straw_verified_member()

        first = admin_client.post(f"{BASE}/{event.id}/force-complete/")
        second = admin_client.post(f"{BASE}/{event.id}/force-complete/")

        assert first.status_code == 200
        assert second.status_code == 200
        assert available_straw_count(mait) == 0
        assert MaitInventoryLedger.objects.filter(ref_id=event.id).count() == 1

    def test_it_is_audited_as_a_no_photo_force_complete(
        self, admin_client, straw_verified_member, priced
    ):
        event, _ = straw_verified_member()

        admin_client.post(f"{BASE}/{event.id}/force-complete/")

        entry = AuditLog.objects.filter(
            entity_type="ai_event", entity_id=event.id, action="state_change"
        ).latest("id")
        assert entry.meta_json["force_complete"] is True
        assert entry.meta_json["no_photo"] is True
        assert entry.meta_json["to"] == "completed"

    def test_an_unpriced_breed_is_refused_and_touches_nothing(
        self, admin_client, straw_verified_member, mait
    ):
        """No rate configured for the breed — refused, and the straw stays held."""
        event, _ = straw_verified_member()

        response = admin_client.post(f"{BASE}/{event.id}/force-complete/")

        assert response.status_code == 400
        event.refresh_from_db()
        assert event.status == AIEvent.Status.STRAW_VERIFIED
        assert available_straw_count(mait) == 1

    def test_a_non_member_is_refused(self, admin_client, mait, mpp, stocked_mait, priced):
        non_member = NonMember.objects.create(name="Walk-in", mpp=mpp, created_by_mait=mait)
        animal = Animal.objects.create(
            owner_type=Animal.OwnerType.NON_MEMBER,
            non_member=non_member,
            animal_type=AnimalType.COW,
            breed="GIR",
        )
        straw = stocked_mait(1)[0]
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.NON_MEMBER,
            non_member=non_member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=straw.unique_straw_no,
            status=AIEvent.Status.STRAW_VERIFIED,
            performed_at=timezone.now(),
        )

        assert admin_client.post(f"{BASE}/{event.id}/force-complete/").status_code == 400
        event.refresh_from_db()
        assert event.status == AIEvent.Status.STRAW_VERIFIED

    def test_a_mait_cannot_force_complete(self, mait_client, straw_verified_member, priced):
        event, _ = straw_verified_member()

        assert mait_client.post(f"{BASE}/{event.id}/force-complete/").status_code == 403
        event.refresh_from_db()
        assert event.status == AIEvent.Status.STRAW_VERIFIED

    def test_a_normal_user_cannot_force_complete(
        self, normal_user_client, straw_verified_member, priced
    ):
        event, _ = straw_verified_member()

        assert normal_user_client.post(f"{BASE}/{event.id}/force-complete/").status_code == 403

    def test_anonymous_is_rejected(self, stuck_member_event):
        event, _ = stuck_member_event()

        assert APIClient().post(f"{BASE}/{event.id}/office-complete/").status_code == 401
