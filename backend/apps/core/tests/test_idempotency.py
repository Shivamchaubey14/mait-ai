"""
Idempotency records are identified by key *and* endpoint (ADR 0003).

ADR 0003 makes the capture's ``client_uuid`` the ``Idempotency-Key`` on every write for that
event, so one key reaches create, complete and the rest with a different body each time. That
is the design. Keyed on the key alone, the create's stored record answered the completion's
lookup, the fingerprints disagreed, and every completion in the product came back 422 — on a
perfect network, with the app then queuing it and showing it as waiting to sync forever.

What still has to conflict is a key reused at *one* endpoint for different content. That is a
genuine client bug and the 422 is the right answer to it.
"""

from __future__ import annotations

import io
import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.ai_events.models import AIEvent
from apps.ai_events.services import mark_payment_pending
from apps.core.models import IdempotencyRecord
from apps.inventory.services import available_straw_count
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

BASE = "/api/v1/ai-events"


@pytest.fixture
def mait_client(mait):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")
    return client


def a_photo():
    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), (90, 140, 110)).save(buffer, format="JPEG")
    return SimpleUploadedFile("proof.jpg", buffer.getvalue(), content_type="image/jpeg")


def _capture(client, mpp, member, animal, straw_no, key):
    """Open an event, carrying the capture's uuid as the key the way the app does."""
    return client.post(
        f"{BASE}/",
        {
            "client_uuid": key,
            "mpp_code": mpp.mpp_code,
            "member_code": member.member_code,
            "animal_id": animal.id,
            "straw_unique_no": straw_no,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def _reach_payment_pending(client, event_id, key):
    client.patch(
        f"{BASE}/{event_id}/photo/",
        {"photo": a_photo(), "gps_lat": "28.3670000", "gps_lng": "79.4304000"},
        format="multipart",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    event = AIEvent.objects.get(pk=event_id)
    Payment.objects.create(
        ai_event=event,
        amount=300,
        mode=Payment.Mode.COD,
        status=Payment.Status.VERIFIED,
        member_otp_verified=True,
        cod_otp_verified=True,
    )
    return mark_payment_pending(event)


class TestOneKeyAcrossEndpoints:
    def test_a_capture_completes_under_the_key_that_created_it(
        self, mait_client, mpp, member, animal, stocked_mait
    ):
        """The regression: the same key at create and at complete, which is every capture."""
        straw = stocked_mait(1)[0]
        key = str(uuid.uuid4())

        created = _capture(mait_client, mpp, member, animal, straw.unique_straw_no, key)
        assert created.status_code == 201, created.json()

        event = _reach_payment_pending(mait_client, created.json()["id"], key)
        response = mait_client.post(f"{BASE}/{event.id}/complete/", HTTP_IDEMPOTENCY_KEY=key)

        assert response.status_code == 200, response.json()
        assert response.json()["status"] == AIEvent.Status.COMPLETED

    def test_each_endpoint_keeps_its_own_record(
        self, mait_client, mpp, member, animal, stocked_mait
    ):
        straw = stocked_mait(1)[0]
        key = str(uuid.uuid4())

        created = _capture(mait_client, mpp, member, animal, straw.unique_straw_no, key)
        event = _reach_payment_pending(mait_client, created.json()["id"], key)
        mait_client.post(f"{BASE}/{event.id}/complete/", HTTP_IDEMPOTENCY_KEY=key)

        endpoints = set(
            IdempotencyRecord.objects.filter(key=key).values_list("endpoint", flat=True)
        )
        assert endpoints == {"ai-events.create", "ai-events.complete"}


class TestReuseWithinOneEndpoint:
    def test_a_repeat_replays_rather_than_consuming_a_second_straw(
        self, mait_client, mait, mpp, member, animal, stocked_mait
    ):
        """
        The reason the table exists: the queue drains blindly and can send the same job twice.
        """
        straw = stocked_mait(2)[0]
        key = str(uuid.uuid4())

        created = _capture(mait_client, mpp, member, animal, straw.unique_straw_no, key)
        event = _reach_payment_pending(mait_client, created.json()["id"], key)

        first = mait_client.post(f"{BASE}/{event.id}/complete/", HTTP_IDEMPOTENCY_KEY=key)
        second = mait_client.post(f"{BASE}/{event.id}/complete/", HTTP_IDEMPOTENCY_KEY=key)

        assert first.status_code == second.status_code == 200
        assert first.json() == second.json()
        # Two identical requests, one straw. This is the whole point.
        assert available_straw_count(mait) == 1

    def test_the_same_key_with_a_different_body_is_still_a_conflict(
        self, mait_client, mpp, member, animal, stocked_mait
    ):
        """
        Still a client bug, and still a 422. Narrowing the lookup to one endpoint must not
        cost the check that catches a key being reused for genuinely different content.
        """
        straws = stocked_mait(2)
        key = str(uuid.uuid4())

        first = _capture(mait_client, mpp, member, animal, straws[0].unique_straw_no, key)
        assert first.status_code == 201

        # Same key, same endpoint, a different straw in the body.
        second = _capture(mait_client, mpp, member, animal, straws[1].unique_straw_no, key)

        assert second.status_code == 422
        assert second.json()["type"].endswith("/idempotency-key-conflict")
