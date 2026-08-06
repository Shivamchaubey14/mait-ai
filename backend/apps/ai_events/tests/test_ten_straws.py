"""
The whole promise, end to end over HTTP (SRS §6.4, ROADMAP Day 14).

A Mait holding ten straws completes exactly ten AI events. Not eleven under a retry, not
eleven when two requests arrive together, not eleven because the queue replayed. Everything
else this platform does is reporting on top of that sentence.

`test_completion.py` proves the transaction. This proves the thing a Mait actually does: a
day's work, through the real endpoints, including the retries a village connection forces.
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
from apps.animals.models import Animal, AnimalType
from apps.inventory.services import available_straw_count
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

BASE = "/api/v1/ai-events"
STRAWS = 10


@pytest.fixture
def mait_client(mait):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")
    return client


def a_photo():
    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), (90, 140, 110)).save(buffer, format="JPEG")
    return SimpleUploadedFile("proof.jpg", buffer.getvalue(), content_type="image/jpeg")


def _reach_payment_pending(client, event_id):
    """
    Walk steps 5 and 6 for an event that has a verified straw.

    The photo goes through the real endpoint. The move to `payment_pending` goes through the
    service, because the payment endpoints are Phase 4 and do not exist yet — the state
    machine will not let completion happen without that step, and skipping it here would test
    a path the app can never take.
    """
    response = client.patch(
        f"{BASE}/{event_id}/photo/",
        {"photo": a_photo(), "gps_lat": "28.3670000", "gps_lng": "79.4304000"},
        format="multipart",
    )
    assert response.status_code == 200, response.json()

    event = AIEvent.objects.get(pk=event_id)
    # Stand-in for Phase 4: the payment record and the transition that initiating one causes.
    Payment.objects.create(
        ai_event=event,
        amount=300,
        mode=Payment.Mode.COD,
        status=Payment.Status.VERIFIED,
        member_otp_verified=True,
        cod_otp_verified=True,
    )
    return mark_payment_pending(event)


def _capture(client, mpp, member, animal, straw_no):
    """Open an event with a straw scanned — steps 1 to 4."""
    return client.post(
        f"{BASE}/",
        {
            "client_uuid": str(uuid.uuid4()),
            "mpp_code": mpp.mpp_code,
            "member_code": member.member_code,
            "animal_id": animal.id,
            "straw_unique_no": straw_no,
        },
        format="json",
    )


class TestTenStrawsTenEvents:
    def test_ten_straws_complete_exactly_ten_events(
        self, mait_client, mait, mpp, member, animal, stocked_mait
    ):
        straws = stocked_mait(STRAWS)
        assert available_straw_count(mait) == STRAWS

        completed = 0
        for straw in straws:
            created = _capture(mait_client, mpp, member, animal, straw.unique_straw_no)
            assert created.status_code == 201, created.json()

            event = _reach_payment_pending(mait_client, created.json()["id"])

            response = mait_client.post(f"{BASE}/{event.id}/complete/")
            assert response.status_code == 200, response.json()
            completed += 1

        assert completed == STRAWS
        assert available_straw_count(mait) == 0
        assert AIEvent.objects.filter(status=AIEvent.Status.COMPLETED).count() == STRAWS

    def test_the_eleventh_capture_is_refused(
        self, mait_client, mait, mpp, member, animal, stocked_mait
    ):
        """
        The gate holds at the scan, before anything is recorded.

        This is the number that matters: an eleventh completed event against ten straws is
        the leakage the platform exists to stop, and it must be impossible to reach rather
        than merely unlikely.
        """
        straws = stocked_mait(STRAWS)
        for straw in straws:
            created = _capture(mait_client, mpp, member, animal, straw.unique_straw_no)
            _reach_payment_pending(mait_client, created.json()["id"])
            mait_client.post(f"{BASE}/{created.json()['id']}/complete/")

        eleventh = _capture(mait_client, mpp, member, animal, "STRAW-THAT-IS-NOT-HELD")

        assert eleventh.status_code == 409
        assert eleventh.json()["type"].endswith("/insufficient-stock")
        assert AIEvent.objects.filter(status=AIEvent.Status.COMPLETED).count() == STRAWS

    def test_a_replayed_queue_does_not_consume_extra_straws(
        self, mait_client, mait, mpp, member, animal, stocked_mait
    ):
        """
        The offline queue drains blindly and can send the whole day twice.

        Every write carries the device's client_uuid, so the second pass returns the events
        that already exist. Ten straws in, ten events out, whatever the network did.
        """
        straws = stocked_mait(STRAWS)
        bodies = [
            {
                "client_uuid": str(uuid.uuid4()),
                "mpp_code": mpp.mpp_code,
                "member_code": member.member_code,
                "animal_id": animal.id,
                "straw_unique_no": straw.unique_straw_no,
            }
            for straw in straws
        ]

        for body in bodies:
            created = mait_client.post(f"{BASE}/", body, format="json")
            _reach_payment_pending(mait_client, created.json()["id"])
            mait_client.post(
                f"{BASE}/{created.json()['id']}/complete/",
                HTTP_IDEMPOTENCY_KEY=body["client_uuid"],
            )

        # The queue wakes up and sends everything again.
        for body in bodies:
            replay = mait_client.post(f"{BASE}/", body, format="json")
            assert replay.status_code == 200
            mait_client.post(
                f"{BASE}/{replay.json()['id']}/complete/",
                HTTP_IDEMPOTENCY_KEY=body["client_uuid"],
            )

        assert AIEvent.objects.count() == STRAWS
        assert AIEvent.objects.filter(status=AIEvent.Status.COMPLETED).count() == STRAWS
        assert available_straw_count(mait) == 0

    def test_one_straw_cannot_serve_two_animals(
        self, mait_client, mait, mpp, member, animal, stocked_mait
    ):
        """A second capture against a consumed straw is a data problem, and is named as one."""
        straw = stocked_mait(1)[0]

        first = _capture(mait_client, mpp, member, animal, straw.unique_straw_no)
        _reach_payment_pending(mait_client, first.json()["id"])
        mait_client.post(f"{BASE}/{first.json()['id']}/complete/")

        other_animal = Animal.objects.create(
            owner_type=Animal.OwnerType.MEMBER,
            member=member,
            animal_type=AnimalType.COW,
            breed="GIR",
        )
        second = _capture(mait_client, mpp, member, other_animal, straw.unique_straw_no)

        assert second.status_code == 409
        assert second.json()["type"].endswith("/straw-already-consumed")
