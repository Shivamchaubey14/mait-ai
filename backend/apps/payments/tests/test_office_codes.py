"""
The office's code at the farmer's steps: checking her, and her authorising a cash payment.

When the SMS does not reach her, the Mait asks the office; the office phones *her* on the number
on her record with a code, and she reads it to the Mait. These tests hold the lines that keep
her consent meaning something: the ask is tied to the farmer or payment on the Mait's own screen,
the SMS must have been tried first, the code works for that step and that number only, and the
Mait's asking never returns the code to the Mait.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, SuperOTP, User
from apps.animals.models import Animal, AnimalType, BreedConfig
from apps.masterdata.models import NonMember
from apps.payments.models import OTPLog, Payment
from apps.payments.tests.test_payment_api import open_event

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def mait_client(mait):
    return auth(mait.user)


@pytest.fixture
def office(db):
    return auth(
        User.objects.create_user(
            username="office-steps",
            password="a-long-enough-password",
            full_name="Office",
            role=Role.ADMIN,
            portal_sections=[PortalSection.SUPER_OTP],
        )
    )


@pytest.fixture
def farmer(db, mait, mpp):
    return NonMember.objects.create(
        name="RADHA", mobile_no="9876543210", mpp=mpp, created_by_mait=mait
    )


@pytest.fixture
def cash_payment(mait_client, mpp, stocked_mait, farmer):
    """An insemination for Radha, paying cash, with her authorisation SMS sent."""
    BreedConfig.objects.create(
        animal_type=AnimalType.COW, code="GIR", name="Gir", rate=300, non_member_rate=450
    )
    stocked_mait(1)
    animal = Animal.objects.create(
        owner_type=Animal.OwnerType.NON_MEMBER,
        non_member=farmer,
        animal_type=AnimalType.COW,
        breed="GIR",
    )
    event_id = open_event(mait_client, mpp, animal, non_member=farmer)
    started = mait_client.post(
        f"{BASE}/payments/{event_id}/initiate/", {"mode": "COD"}, format="json"
    )
    assert started.status_code == 200, started.json()
    return event_id


def generate(office, purpose):
    row = SuperOTP.objects.get(purpose=purpose, status=SuperOTP.Status.REQUESTED)
    response = office.post(f"{BASE}/admin/super-otp/{row.id}/issue/")
    assert response.status_code == 201, response.content
    return response.json()


class TestCashPayment:
    def test_the_office_code_authorises_her_payment(
        self, mait_client, office, cash_payment, farmer
    ):
        asked = mait_client.post(f"{BASE}/payments/{cash_payment}/otp/office/", {}, format="json")
        assert asked.status_code == 200, asked.json()
        assert "code" not in asked.json()

        issued = generate(office, OTPLog.Purpose.PAYMENT_COD)
        # The office is told to call her, not the Mait who asked.
        assert issued["for_farmer"] is True
        assert issued["number_on_file"] == farmer.mobile_no
        assert issued["farmer_name"] == "RADHA"
        assert "₹450" in issued["context"]

        confirmed = mait_client.post(
            f"{BASE}/payments/{cash_payment}/otp/verify/", {"otp": issued["code"]}, format="json"
        )
        assert confirmed.status_code == 200, confirmed.json()
        assert confirmed.json()["is_verified"] is True
        assert Payment.objects.get(ai_event_id=cash_payment).is_verified

    def test_it_closes_the_sms_code_it_stood_in_for(self, mait_client, office, cash_payment):
        mait_client.post(f"{BASE}/payments/{cash_payment}/otp/office/", {}, format="json")
        issued = generate(office, OTPLog.Purpose.PAYMENT_COD)
        mait_client.post(
            f"{BASE}/payments/{cash_payment}/otp/verify/", {"otp": issued["code"]}, format="json"
        )
        assert not OTPLog.objects.filter(
            purpose=OTPLog.Purpose.PAYMENT_COD, is_verified=False
        ).exists()

    def test_a_sign_in_code_does_not_pay(self, mait_client, office, cash_payment, farmer, mait):
        # A code for another step, on the Mait's own number, is no use at her payment.
        mait_client.post(f"{BASE}/payments/{cash_payment}/otp/office/", {}, format="json")
        APIClient().post(
            f"{BASE}/auth/otp/super/request/", {"mobile_no": mait.mobile_no}, format="json"
        )
        login_code = generate(office, OTPLog.Purpose.LOGIN)["code"]
        refused = mait_client.post(
            f"{BASE}/payments/{cash_payment}/otp/verify/", {"otp": login_code}, format="json"
        )
        assert refused.status_code == 400
        assert not Payment.objects.get(ai_event_id=cash_payment).is_verified

    def test_another_maits_event_is_not_theirs_to_ask_for(self, cash_payment):
        from conftest import MaitFactory

        intruder = auth(MaitFactory().user)
        response = intruder.post(f"{BASE}/payments/{cash_payment}/otp/office/", {}, format="json")
        assert response.status_code == 404
        assert not SuperOTP.objects.exists()


class TestFarmerCheck:
    def test_the_office_code_checks_her(self, mait_client, office, farmer, settings):
        sent = mait_client.post(
            f"{BASE}/farmers/otp/send/", {"non_member_id": farmer.id}, format="json"
        )
        assert sent.status_code == 200, sent.json()

        asked = mait_client.post(
            f"{BASE}/farmers/otp/office/", {"non_member_id": farmer.id}, format="json"
        )
        assert asked.status_code == 200, asked.json()
        issued = generate(office, OTPLog.Purpose.FARMER_VERIFY)
        assert issued["number_on_file"] == farmer.mobile_no

        checked = mait_client.post(
            f"{BASE}/farmers/otp/verify/",
            {"non_member_id": farmer.id, "otp": issued["code"]},
            format="json",
        )
        assert checked.status_code == 200, checked.json()
        assert checked.json()["verified"] is True

    def test_the_sms_has_to_be_tried_first(self, mait_client, farmer):
        response = mait_client.post(
            f"{BASE}/farmers/otp/office/", {"non_member_id": farmer.id}, format="json"
        )
        assert response.status_code == 400
        assert "SMS" in response.json()["detail"]
        assert not SuperOTP.objects.exists()

    def test_a_farmer_at_somebody_elses_mpp_is_not_found(self, farmer):
        from conftest import MaitFactory

        intruder = auth(MaitFactory().user)
        response = intruder.post(
            f"{BASE}/farmers/otp/office/", {"non_member_id": farmer.id}, format="json"
        )
        assert response.status_code == 404
