"""
One-step finish of a member capture (the Mait's own, photo + complete in one request).

The step-by-step close is three ordered round trips — photo, payment, complete — and on a weak
village connection they do not always arrive in order: the photo is queued while the completion
goes live, the completion lands on an event still at ``straw_verified``, and the server refuses
it with *Cannot complete an AI event in state 'straw_verified'*. That was the whole of the
"only Shyamta Prasad gets this" bug — his network, not his handset.

``finalize`` carries the photo and the completion in one request, so the completion can never
reach the server ahead of its own photo. Where it applies it must do exactly what the handset's
own steps would — attach the photo, record the member's verified ₹100 deduction, deduct one
straw, close the event and book the pregnancy check — so the guarantees the completion suite
defends hold here too: one straw per completion, one ledger line, and a replay is a no-op.
"""

from __future__ import annotations

import io
import uuid
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.ai_events.models import AIEvent
from apps.animals.models import AnimalType, BreedConfig
from apps.core.models import AuditLog
from apps.inventory.models import MaitInventoryLedger
from apps.inventory.services import available_straw_count
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
def priced_gir(db):
    """A member rate for the GIR cow the factories build, so `finalize` can price the deduction."""
    return BreedConfig.objects.create(
        animal_type=AnimalType.COW,
        code="GIR",
        name="Gir",
        rate=Decimal("100.00"),
        non_member_rate=Decimal("150.00"),
        is_active=True,
    )


def a_photo(name="proof.jpg"):
    """A tiny but valid JPEG the ImageField will accept."""
    # A 1x1 JPEG. Pillow is a dependency (ImageField validation needs it), so build it rather
    # than ship bytes.
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (1, 1), (120, 90, 60)).save(buffer, format="JPEG")
    buffer.seek(0)
    buffer.name = name
    return buffer


@pytest.fixture
def straw_verified_member_event(db, mait, mpp, member, animal, stocked_mait):
    """
    A member capture exactly where the bug leaves it: the straw checked, one straw still in the
    Mait's stock, and nothing else — no photo, no payment, not completed.
    """

    def _make(status=AIEvent.Status.STRAW_VERIFIED):
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
        )
        return event, straw

    return _make


class TestFinalize:
    def test_it_closes_a_straw_verified_member_capture_in_one_call(
        self, mait_client, straw_verified_member_event, priced_gir, mait
    ):
        event, straw = straw_verified_member_event()
        assert available_straw_count(mait) == 1

        response = mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "26.8467", "gps_lng": "80.9462"},
            format="multipart",
            HTTP_IDEMPOTENCY_KEY=str(event.client_uuid),
        )

        assert response.status_code == 200, response.content
        body = response.json()
        assert body["status"] == "completed"
        event.refresh_from_db()
        straw.refresh_from_db()
        assert event.status == AIEvent.Status.COMPLETED
        assert event.completed_at is not None
        assert event.ai_photo_url, "the proof photo must be on file"
        assert straw.is_consumed is True
        assert available_straw_count(mait) == 0

    def test_it_closes_a_capture_with_no_gps_fix(
        self, mait_client, straw_verified_member_event, priced_gir
    ):
        """
        A phone with no location fix must still close the capture.

        GPS is optional (SRS §6.9). This is the bug that stranded ~all no-GPS member captures at
        straw_verified: the proof serializer required the coordinate, so finalize refused them
        and the offline queue retried forever. The photo alone is enough to complete.
        """
        event, _ = straw_verified_member_event()

        response = mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo()},  # no gps_lat / gps_lng at all
            format="multipart",
        )

        assert response.status_code == 200, response.content
        assert response.json()["status"] == "completed"
        event.refresh_from_db()
        assert event.status == AIEvent.Status.COMPLETED
        assert event.gps_lat is None and event.gps_lng is None

    def test_it_tolerates_the_literal_null_the_offline_queue_sends(
        self, mait_client, straw_verified_member_event, priced_gir
    ):
        """
        The offline queue of a field build sends ``gps_lat="null"`` (a multipart field cannot
        carry a JSON null). That string, parsed as a decimal, was the refusal that stranded the
        capture; it must now be read as "no fix" so already-queued captures drain and close.
        """
        event, _ = straw_verified_member_event()

        response = mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "null", "gps_lng": "null"},
            format="multipart",
        )

        assert response.status_code == 200, response.content
        event.refresh_from_db()
        assert event.status == AIEvent.Status.COMPLETED
        assert event.gps_lat is None and event.gps_lng is None

    def test_it_records_a_verified_member_deduction(
        self, mait_client, straw_verified_member_event, priced_gir
    ):
        event, _ = straw_verified_member_event()

        mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "26.8", "gps_lng": "80.9"},
            format="multipart",
        )

        payment = Payment.objects.get(ai_event=event)
        assert payment.mode == Payment.Mode.DEDUCTION
        assert payment.amount == Decimal("100.00")
        assert payment.is_verified is True

    def test_it_deducts_exactly_one_straw_and_books_a_check(
        self, mait_client, straw_verified_member_event, priced_gir
    ):
        event, _ = straw_verified_member_event()

        mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "26.8", "gps_lng": "80.9"},
            format="multipart",
        )

        ledger = MaitInventoryLedger.objects.filter(
            ref_type=MaitInventoryLedger.RefType.AI_EVENT, ref_id=event.id
        )
        assert ledger.count() == 1
        assert ledger.first().qty == -1
        assert PregnancyCheck.objects.filter(ai_event=event).count() == 1

    def test_a_replay_is_a_no_op(self, mait_client, straw_verified_member_event, priced_gir, mait):
        """The offline queue retries blindly; a second send must not touch a second straw."""
        event, _ = straw_verified_member_event()
        key = str(event.client_uuid)

        first = mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "26.8", "gps_lng": "80.9"},
            format="multipart",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        second = mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "26.8", "gps_lng": "80.9"},
            format="multipart",
            HTTP_IDEMPOTENCY_KEY=key,
        )

        assert first.status_code == 200
        assert second.status_code == 200
        assert second.json()["status"] == "completed"
        assert available_straw_count(mait) == 0
        assert MaitInventoryLedger.objects.filter(ref_id=event.id).count() == 1

    def test_it_completes_an_event_whose_photo_already_landed(
        self, mait_client, straw_verified_member_event, priced_gir, mait
    ):
        """
        The other half of the race: the photo arrived, the completion was lost. A finalize with
        no photo field must still close it — the photo is already on file.
        """
        event, _ = straw_verified_member_event(status=AIEvent.Status.PHOTO_CAPTURED)
        event.ai_photo_url = "/media/ai-photos/x.jpg"
        event.save(update_fields=["ai_photo_url"])

        response = mait_client.post(
            f"{BASE}/{event.id}/finalize/", {}, format="multipart"
        )

        assert response.status_code == 200, response.content
        event.refresh_from_db()
        assert event.status == AIEvent.Status.COMPLETED
        assert available_straw_count(mait) == 0

    def test_it_is_audited_as_a_one_step_finish(
        self, mait_client, straw_verified_member_event, priced_gir
    ):
        event, _ = straw_verified_member_event()

        mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "26.8", "gps_lng": "80.9"},
            format="multipart",
        )

        entry = AuditLog.objects.filter(
            entity_type="ai_event", entity_id=event.id, action="state_change"
        ).latest("id")
        assert entry.meta_json["one_step_finish"] is True
        assert entry.meta_json["to"] == "completed"


class TestFinalizeRefusals:
    def test_a_straw_verified_event_with_no_photo_is_refused(
        self, mait_client, straw_verified_member_event, priced_gir, mait
    ):
        """It still needs its photo, and no field carries one — nothing is touched."""
        event, _ = straw_verified_member_event()

        response = mait_client.post(f"{BASE}/{event.id}/finalize/", {}, format="multipart")

        assert response.status_code == 400
        event.refresh_from_db()
        assert event.status == AIEvent.Status.STRAW_VERIFIED
        assert available_straw_count(mait) == 1

    def test_an_unpriced_breed_is_refused(
        self, mait_client, straw_verified_member_event, mait
    ):
        """No BreedConfig for GIR: the deduction has no amount, so the capture cannot be closed."""
        event, _ = straw_verified_member_event()

        response = mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "26.8", "gps_lng": "80.9"},
            format="multipart",
        )

        # A domain refusal (400), the same mapping the payment endpoint gives an unpriced breed:
        # an admin must price it, no retry will clear it, so the app surfaces it rather than
        # queuing. The photo may have been attached first, but no straw is ever deducted.
        assert response.status_code == 400
        event.refresh_from_db()
        assert event.status in (AIEvent.Status.STRAW_VERIFIED, AIEvent.Status.PHOTO_CAPTURED)
        assert available_straw_count(mait) == 1, "stock is untouched when the close is refused"

    def test_a_non_member_is_refused(
        self, mait_client, mait, mpp, stocked_mait, priced_gir
    ):
        """A non-member authorises her own payment with a code — not a one-step path."""
        from apps.animals.models import Animal
        from apps.masterdata.models import NonMember

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
        )

        response = mait_client.post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "26.8", "gps_lng": "80.9"},
            format="multipart",
        )

        assert response.status_code == 400
        event.refresh_from_db()
        assert event.status == AIEvent.Status.STRAW_VERIFIED
        assert available_straw_count(mait) == 1

    def test_another_maits_event_is_refused(self, straw_verified_member_event, priced_gir):
        """finalize only ever touches the caller's own event (the `_assert_own` guard)."""
        from conftest import MaitFactory

        event, _ = straw_verified_member_event()
        other = MaitFactory()
        response = auth(other.user).post(
            f"{BASE}/{event.id}/finalize/",
            {"photo": a_photo(), "gps_lat": "26.8", "gps_lng": "80.9"},
            format="multipart",
        )

        # Scoped out of the other Mait's queryset entirely — it is not their event to see.
        assert response.status_code in (403, 404)
        event.refresh_from_db()
        assert event.status == AIEvent.Status.STRAW_VERIFIED
