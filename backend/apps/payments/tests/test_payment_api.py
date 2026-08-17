"""
Payment endpoint tests (SRS §6.5, §9.7).

Two farmers, two shapes, and the difference is the whole point: a member hands over nothing
and the dairy settles it against her milk payout; a non-member hands cash to a Mait in a yard,
which is the only moment in this product where money moves between two people with nobody
watching. That is what the authorisation code is for, and what these tests are mostly about.

The amount is never in the request. A handset that could name the price could name a different
one for every farmer.
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
from apps.animals.models import Animal, AnimalType, BreedConfig
from apps.masterdata.models import NonMember
from apps.payments.models import OTPLog, Payment

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


@pytest.fixture
def mait_client(mait):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")
    return client


@pytest.fixture
def priced_breed(db):
    """GIR, priced apart for the two kinds of farmer, as a dairy actually prices it."""
    return BreedConfig.objects.create(
        animal_type=AnimalType.COW, code="GIR", name="Gir", rate=300, non_member_rate=450
    )


@pytest.fixture
def fixed_otp(settings):
    settings.DEV_FIXED_OTP_NUMBERS = ["*"]
    settings.DEV_FIXED_OTP_CODE = "123456"
    return "123456"


def a_screenshot():
    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), (30, 60, 90)).save(buffer, format="JPEG")
    return SimpleUploadedFile("upi.jpg", buffer.getvalue(), content_type="image/jpeg")


def open_event(client, mpp, animal, *, member=None, non_member=None) -> int:
    body = {
        "client_uuid": str(uuid.uuid4()),
        "mpp_code": mpp.mpp_code,
        "animal_id": animal.id,
        "semen_breed": "GIR",
    }
    if member is not None:
        body["member_code"] = member.member_code
    else:
        body["non_member_id"] = non_member.id
    response = client.post(f"{BASE}/ai-events/", body, format="json")
    assert response.status_code == 201, response.json()
    return response.json()["id"]


class TestMemberPaysNothing:
    def test_the_charge_is_recorded_as_a_deduction_and_verified_at_once(
        self, mait_client, mpp, member, animal, stocked_mait, priced_breed
    ):
        """
        Nobody is asked for money, so there is nothing to authorise — but the dairy still
        has to reconcile the payout, and this row is what it reconciles against.
        """
        stocked_mait(1)
        event_id = open_event(mait_client, mpp, animal, member=member)

        response = mait_client.post(f"{BASE}/payments/{event_id}/initiate/", {}, format="json")

        assert response.status_code == 200, response.json()
        body = response.json()
        assert body["mode"] == Payment.Mode.DEDUCTION
        assert body["is_verified"] is True
        assert body["amount"] == "300.00"
        # No code was sent to anybody.
        assert not OTPLog.objects.filter(purpose=OTPLog.Purpose.PAYMENT_COD).exists()

    def test_a_member_cannot_be_billed_the_non_member_rate(
        self, mait_client, mpp, member, animal, stocked_mait, priced_breed
    ):
        stocked_mait(1)
        event_id = open_event(mait_client, mpp, animal, member=member)

        response = mait_client.post(
            f"{BASE}/payments/{event_id}/initiate/", {"mode": "COD"}, format="json"
        )

        # The mode she was given is ignored: a member's is not the app's to choose.
        assert response.json()["mode"] == Payment.Mode.DEDUCTION
        assert response.json()["amount"] == "300.00"

    def test_the_event_can_then_be_completed(
        self, mait_client, mpp, member, animal, stocked_mait, priced_breed
    ):
        stocked_mait(1)
        event_id = open_event(mait_client, mpp, animal, member=member)
        mait_client.patch(
            f"{BASE}/ai-events/{event_id}/photo/",
            {"photo": a_screenshot(), "gps_lat": "28.3670000", "gps_lng": "79.4304000"},
            format="multipart",
        )
        mait_client.post(f"{BASE}/payments/{event_id}/initiate/", {}, format="json")

        response = mait_client.post(f"{BASE}/ai-events/{event_id}/complete/")

        assert response.status_code == 200, response.json()
        assert AIEvent.objects.get(pk=event_id).status == AIEvent.Status.COMPLETED


class TestNonMemberPaysTheMait:
    @pytest.fixture
    def non_member_animal(self, db, mait, mpp):
        farmer = NonMember.objects.create(
            name="RADHA", mobile_no="9876543210", mpp=mpp, created_by_mait=mait
        )
        animal = Animal.objects.create(
            owner_type=Animal.OwnerType.NON_MEMBER,
            non_member=farmer,
            animal_type=AnimalType.COW,
            breed="GIR",
        )
        return farmer, animal

    def test_cash_is_authorised_by_a_code_to_her_own_number(
        self, mait_client, mpp, stocked_mait, priced_breed, non_member_animal, fixed_otp
    ):
        stocked_mait(1)
        farmer, animal = non_member_animal
        event_id = open_event(mait_client, mpp, animal, non_member=farmer)

        started = mait_client.post(
            f"{BASE}/payments/{event_id}/initiate/", {"mode": "COD"}, format="json"
        )
        assert started.status_code == 200, started.json()
        assert started.json()["amount"] == "450.00", "the non-member rate, not the member one"
        assert started.json()["is_verified"] is False

        # The code went to the farmer, not to the Mait.
        sent = OTPLog.objects.filter(purpose=OTPLog.Purpose.PAYMENT_COD).latest("created_at")
        assert sent.mobile_no == farmer.mobile_no

        confirmed = mait_client.post(
            f"{BASE}/payments/{event_id}/otp/verify/", {"otp": fixed_otp}, format="json"
        )

        assert confirmed.status_code == 200, confirmed.json()
        assert confirmed.json()["is_verified"] is True

    def test_confirming_an_already_authorised_payment_says_so(
        self, mait_client, mpp, stocked_mait, priced_breed, non_member_animal, fixed_otp
    ):
        """
        A retried tap must not be told the code was wrong.

        A verified OTP is consumed, so a second lookup finds nothing pending and the honest
        answer from `verify_otp` is "no OTP is pending" — which the app could only render as
        the code being bad. It was not bad; it had already been accepted. That is exactly what
        a Mait met: the first tap authorised the payment, the completion behind it was refused
        for an unrelated reason, and the second tap sent them back to the farmer to re-read a
        number that could never work again.
        """
        stocked_mait(1)
        farmer, animal = non_member_animal
        event_id = open_event(mait_client, mpp, animal, non_member=farmer)
        mait_client.post(f"{BASE}/payments/{event_id}/initiate/", {"mode": "COD"}, format="json")

        first = mait_client.post(
            f"{BASE}/payments/{event_id}/otp/verify/", {"otp": fixed_otp}, format="json"
        )
        assert first.status_code == 200, first.json()

        again = mait_client.post(
            f"{BASE}/payments/{event_id}/otp/verify/", {"otp": fixed_otp}, format="json"
        )

        assert again.status_code == 200, again.json()
        assert again.json()["is_verified"] is True

    def test_a_wrong_code_leaves_the_payment_unverified(
        self, mait_client, mpp, stocked_mait, priced_breed, non_member_animal, fixed_otp
    ):
        stocked_mait(1)
        farmer, animal = non_member_animal
        event_id = open_event(mait_client, mpp, animal, non_member=farmer)
        mait_client.post(f"{BASE}/payments/{event_id}/initiate/", {"mode": "COD"}, format="json")

        response = mait_client.post(
            f"{BASE}/payments/{event_id}/otp/verify/", {"otp": "000000"}, format="json"
        )

        assert response.status_code == 400
        assert response.json()["type"].endswith("otp-invalid")
        assert Payment.objects.get(ai_event_id=event_id).is_verified is False

    def test_an_online_payment_needs_the_reference_and_the_screenshot(
        self, mait_client, mpp, stocked_mait, priced_breed, non_member_animal, fixed_otp
    ):
        """A UTR alone is a number a Mait could invent, and an image alone reconciles nothing."""
        stocked_mait(1)
        farmer, animal = non_member_animal
        event_id = open_event(mait_client, mpp, animal, non_member=farmer)
        mait_client.post(f"{BASE}/payments/{event_id}/initiate/", {"mode": "ONLINE"}, format="json")
        mait_client.post(
            f"{BASE}/payments/{event_id}/otp/verify/", {"otp": fixed_otp}, format="json"
        )

        assert Payment.objects.get(ai_event_id=event_id).is_verified is False

        response = mait_client.post(
            f"{BASE}/payments/{event_id}/proof/",
            {"utr_number": "UTR12345678", "screenshot": a_screenshot()},
            format="multipart",
        )

        assert response.status_code == 200, response.json()
        assert response.json()["is_verified"] is True
        assert response.json()["payment_screenshot_url"]

    def test_a_mode_is_required_when_she_is_the_one_paying(
        self, mait_client, mpp, stocked_mait, priced_breed, non_member_animal
    ):
        stocked_mait(1)
        farmer, animal = non_member_animal
        event_id = open_event(mait_client, mpp, animal, non_member=farmer)

        response = mait_client.post(f"{BASE}/payments/{event_id}/initiate/", {}, format="json")

        assert response.status_code == 400
        assert not Payment.objects.exists()


class TestPricing:
    def test_an_unpriced_breed_refuses_rather_than_charging_zero(
        self, mait_client, mpp, member, animal, stocked_mait, db
    ):
        """A rate nobody entered must never reach a farmer as free."""
        BreedConfig.objects.create(animal_type=AnimalType.COW, code="GIR", name="Gir", rate=0)
        stocked_mait(1)
        event_id = open_event(mait_client, mpp, animal, member=member)

        response = mait_client.post(f"{BASE}/payments/{event_id}/initiate/", {}, format="json")

        assert response.status_code >= 400
        assert not Payment.objects.exists()

    def test_the_event_carries_what_it_will_cost_before_anything_is_recorded(
        self, mait_client, mpp, member, animal, stocked_mait, priced_breed
    ):
        stocked_mait(1)
        event_id = open_event(mait_client, mpp, animal, member=member)

        response = mait_client.get(f"{BASE}/payments/{event_id}/amount/")

        assert response.status_code == 200
        assert response.json()["amount_due"] == "300.00"
        assert response.json()["semen_breed"] == "GIR"


class TestScoping:
    def test_a_mait_cannot_pay_for_another_maits_event(
        self, mait_client, mpp, member, animal, stocked_mait, priced_breed, db
    ):
        from apps.accounts.models import Role, User
        from apps.masterdata.models import Mait

        stocked_mait(1)
        event_id = open_event(mait_client, mpp, animal, member=member)

        other = User.objects.create_user(username="other-pay", full_name="O", role=Role.MAIT)
        Mait.objects.create(user=other, name="OTHER", sahayak_vendor_code="6666")
        intruder = APIClient()
        intruder.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(other).access_token}"
        )

        response = intruder.post(f"{BASE}/payments/{event_id}/initiate/", {}, format="json")

        assert response.status_code == 404
        assert not Payment.objects.exists()


class TestPricingAcrossSpecies:
    def test_a_buffalo_straw_used_on_a_cow_is_still_priced(
        self, mait_client, mpp, member, animal, stocked_mait, db
    ):
        """
        The rate belongs to the semen, not to the animal it goes into.

        Keying it on the animal's species left a MURRAH straw used on a cow unpriced — there is
        no COW/MURRAH row to find — and the app told the Mait the breed had no rate when the
        dairy had priced it perfectly well.
        """
        BreedConfig.objects.create(
            animal_type=AnimalType.BUFFALO, code="GIR", name="Gir", rate=275, non_member_rate=400
        )
        stocked_mait(1)
        event_id = open_event(mait_client, mpp, animal, member=member)

        response = mait_client.get(f"{BASE}/payments/{event_id}/amount/")

        assert response.json()["amount_due"] == "275.00"

    def test_the_animal_s_own_species_still_wins_where_both_exist(
        self, mait_client, mpp, member, animal, stocked_mait, priced_breed, db
    ):
        BreedConfig.objects.create(
            animal_type=AnimalType.BUFFALO, code="GIR", name="Gir", rate=999, non_member_rate=999
        )
        stocked_mait(1)
        event_id = open_event(mait_client, mpp, animal, member=member)

        response = mait_client.get(f"{BASE}/payments/{event_id}/amount/")

        assert response.json()["amount_due"] == "300.00"
