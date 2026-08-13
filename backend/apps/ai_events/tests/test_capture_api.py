"""
Photo capture and completion over HTTP (SRS §6.3 steps 5–6, §9.6).

The completion endpoint is the one that moves inventory, so the tests that matter are the
ones about it refusing: no verified payment, no straw, not your event. The transactional
guarantee itself is proved in test_completion.py — this is about the door in front of it.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.ai_events.models import AIEvent
from apps.inventory.services import available_straw_count
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

BASE = "/api/v1/ai-events"


def auth(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def a_photo(name="proof.jpg", size=(40, 40)):
    """A real JPEG — ImageField opens it, so a handful of bytes will not do."""
    buffer = io.BytesIO()
    Image.new("RGB", size, (90, 140, 110)).save(buffer, format="JPEG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")


@pytest.fixture
def mait_client(mait):
    return auth(mait.user)


@pytest.fixture
def verified_event(ai_event_ready_to_complete):
    """An event in payment_pending with a verified payment and one straw held."""
    return ai_event_ready_to_complete


class TestPhoto:
    def test_attaches_the_photo_and_advances(
        self, mait_client, mait, mpp, member, animal, stocked_mait
    ):
        straw = stocked_mait(1)[0]
        event = mait_client.post(
            f"{BASE}/",
            {
                "client_uuid": "11111111-1111-4111-8111-111111111111",
                "mpp_code": mpp.mpp_code,
                "member_code": member.member_code,
                "animal_id": animal.id,
                "straw_unique_no": straw.unique_straw_no,
            },
            format="json",
        ).json()

        response = mait_client.patch(
            f"{BASE}/{event['id']}/photo/",
            {"photo": a_photo(), "gps_lat": "28.3670000", "gps_lng": "79.4304000"},
            format="multipart",
        )

        assert response.status_code == 200, response.json()
        assert response.json()["status"] == AIEvent.Status.PHOTO_CAPTURED
        assert response.json()["ai_photo_url"]
        assert response.json()["gps_lat"] == "28.3670000"

    def test_the_device_clock_decides_when_it_happened(
        self, mait_client, mpp, member, animal, stocked_mait
    ):
        """
        An offline event may not reach us for hours. A server timestamp would move every one
        of them to whenever the phone next found signal.
        """
        straw = stocked_mait(1)[0]
        event = mait_client.post(
            f"{BASE}/",
            {
                "client_uuid": "22222222-2222-4222-8222-222222222222",
                "mpp_code": mpp.mpp_code,
                "member_code": member.member_code,
                "animal_id": animal.id,
                "straw_unique_no": straw.unique_straw_no,
            },
            format="json",
        ).json()

        performed = timezone.now() - timedelta(hours=6)
        response = mait_client.patch(
            f"{BASE}/{event['id']}/photo/",
            {
                "photo": a_photo(),
                "gps_lat": "28.3670000",
                "gps_lng": "79.4304000",
                "performed_at": performed.isoformat(),
            },
            format="multipart",
        )

        assert response.status_code == 200
        # Compared as instants, not as the first ten characters of a string. DRF renders in
        # the project's timezone, so for the five and a half hours after midnight IST the
        # local date is a day ahead of the UTC one and a prefix match fails on a response
        # that is perfectly correct.
        returned = datetime.fromisoformat(response.json()["performed_at"])
        assert abs((returned - performed).total_seconds()) < 1

    def test_rejects_a_future_timestamp(self, mait_client, mpp, member, animal, stocked_mait):
        """A wrong phone clock would sort the event ahead of everything real."""
        straw = stocked_mait(1)[0]
        event = mait_client.post(
            f"{BASE}/",
            {
                "client_uuid": "33333333-3333-4333-8333-333333333333",
                "mpp_code": mpp.mpp_code,
                "member_code": member.member_code,
                "animal_id": animal.id,
                "straw_unique_no": straw.unique_straw_no,
            },
            format="json",
        ).json()

        response = mait_client.patch(
            f"{BASE}/{event['id']}/photo/",
            {
                "photo": a_photo(),
                "gps_lat": "28.3670000",
                "gps_lng": "79.4304000",
                "performed_at": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            format="multipart",
        )

        assert response.status_code == 400
        assert "performed_at" in response.json()["errors"]

    def test_a_photo_without_a_verified_straw_is_refused(self, mait_client, mpp, member, animal):
        """A photo on a draft is a picture of an animal, not evidence of an insemination."""
        event = mait_client.post(
            f"{BASE}/",
            {
                "client_uuid": "44444444-4444-4444-8444-444444444444",
                "mpp_code": mpp.mpp_code,
                "member_code": member.member_code,
                "animal_id": animal.id,
            },
            format="json",
        ).json()

        response = mait_client.patch(
            f"{BASE}/{event['id']}/photo/",
            {"photo": a_photo(), "gps_lat": "28.3670000", "gps_lng": "79.4304000"},
            format="multipart",
        )

        assert response.status_code == 409
        assert response.json()["type"].endswith("/invalid-state-transition")

    def test_gps_is_required(self, mait_client, mpp, member, animal, stocked_mait):
        """The photo proves an animal; the pin ties it to the village it was billed to."""
        straw = stocked_mait(1)[0]
        event = mait_client.post(
            f"{BASE}/",
            {
                "client_uuid": "55555555-5555-4555-8555-555555555555",
                "mpp_code": mpp.mpp_code,
                "member_code": member.member_code,
                "animal_id": animal.id,
                "straw_unique_no": straw.unique_straw_no,
            },
            format="json",
        ).json()

        response = mait_client.patch(
            f"{BASE}/{event['id']}/photo/", {"photo": a_photo()}, format="multipart"
        )

        assert response.status_code == 400
        assert "gps_lat" in response.json()["errors"]


class TestComplete:
    def test_completing_deducts_the_straw(self, mait_client, mait, verified_event):
        event, straw = verified_event()
        assert available_straw_count(mait) == 1

        response = mait_client.post(f"{BASE}/{event.id}/complete/")

        assert response.status_code == 200, response.json()
        assert response.json()["status"] == AIEvent.Status.COMPLETED
        assert available_straw_count(mait) == 0

    def test_it_fails_closed_without_a_verified_payment(self, mait_client, mait, verified_event):
        """SRS §6.5.3. The straw must be untouched when it refuses."""
        event, _ = verified_event()
        payment = event.payment
        payment.status = Payment.Status.PENDING
        payment.member_otp_verified = False
        payment.save(update_fields=["status", "member_otp_verified"])

        response = mait_client.post(f"{BASE}/{event.id}/complete/")

        assert response.status_code == 409
        assert response.json()["type"].endswith("/payment-not-verified")
        assert available_straw_count(mait) == 1

    def test_completing_twice_takes_one_straw(self, mait_client, mait, verified_event):
        """A retry whose first response was lost must not consume a second straw."""
        event, _ = verified_event()

        first = mait_client.post(f"{BASE}/{event.id}/complete/")
        second = mait_client.post(f"{BASE}/{event.id}/complete/")

        assert first.status_code == 200
        assert second.status_code == 200
        assert available_straw_count(mait) == 0

    def test_another_mait_cannot_complete_it(self, verified_event, db):
        """An admin can read every event. Nobody may finish one they were not present for."""
        event, _ = verified_event()
        intruder = User.objects.create_user(
            username="mait-intruder", full_name="Intruder", role=Role.MAIT
        )

        response = auth(intruder).post(f"{BASE}/{event.id}/complete/")

        # 404 rather than 403: the queryset scopes it away before the ownership check, which
        # is the stronger answer — it does not confirm the event exists.
        assert response.status_code in (403, 404)
        assert AIEvent.objects.get(pk=event.pk).status != AIEvent.Status.COMPLETED

    def test_an_admin_cannot_complete_an_event(self, verified_event, db):
        event, _ = verified_event()
        admin = User.objects.create_user(
            username="admin-complete",
            password="a-long-enough-password",
            full_name="Admin",
            role=Role.ADMIN,
        )

        assert auth(admin).post(f"{BASE}/{event.id}/complete/").status_code == 403
