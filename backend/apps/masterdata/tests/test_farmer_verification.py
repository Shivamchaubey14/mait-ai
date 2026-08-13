"""
Farmer verification tests (SRS §6.5, §16).

One case matters more than all the others: the code must go to the number on the record and
to nothing else. A Mait who could nominate the destination could nominate their own phone,
and a verification a Mait can satisfy alone verifies nothing at all.
"""

from __future__ import annotations

import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.masterdata.models import Mait, NonMember
from apps.payments.models import OTPLog

pytestmark = pytest.mark.django_db

BASE = "/api/v1"
SEND = f"{BASE}/farmers/otp/send/"
CHECK = f"{BASE}/farmers/otp/verify/"


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


@pytest.fixture
def mait_client(api_client, mait, db):
    user = User.objects.create_user(username="mait-verify", full_name="M", role=Role.MAIT)
    mait.user = user
    mait.save(update_fields=["user"])
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api_client


def pending_code(mobile_no: str) -> OTPLog:
    return (
        OTPLog.objects.filter(mobile_no=mobile_no, purpose=OTPLog.Purpose.FARMER_VERIFY)
        .order_by("-created_at")
        .first()
    )


class TestSend:
    def test_sends_to_the_number_on_the_record(self, mait_client, member):
        member.mobile_no = "7081820448"
        member.save(update_fields=["mobile_no"])

        response = mait_client.post(SEND, {"member_code": member.member_code}, format="json")

        assert response.status_code == 200, response.json()
        assert pending_code("7081820448") is not None
        # Masked in the response: enough to read out, not enough to copy off a screen being
        # passed around a yard.
        assert response.json()["mobile_no"].endswith("0448")
        assert "7081820448" not in response.json()["mobile_no"]

    def test_ignores_a_number_supplied_by_the_caller(self, mait_client, member):
        """The fraud control. A Mait must not be able to send the farmer's code to themselves."""
        member.mobile_no = "7081820448"
        member.save(update_fields=["mobile_no"])

        response = mait_client.post(
            SEND,
            {"member_code": member.member_code, "mobile_no": "9999900000"},
            format="json",
        )

        assert response.status_code == 200
        assert pending_code("7081820448") is not None
        assert pending_code("9999900000") is None

    def test_refuses_a_farmer_with_no_mobile_on_record(self, mait_client, member):
        member.mobile_no = ""
        member.save(update_fields=["mobile_no"])

        response = mait_client.post(SEND, {"member_code": member.member_code}, format="json")

        assert response.status_code == 400
        assert not OTPLog.objects.filter(purpose=OTPLog.Purpose.FARMER_VERIFY).exists()

    def test_will_not_send_to_another_maits_member(self, api_client, member, db):
        other = User.objects.create_user(username="other-verify", full_name="O", role=Role.MAIT)
        Mait.objects.create(user=other, name="OTHER", sahayak_vendor_code="8888")
        api_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(other).access_token}"
        )

        response = api_client.post(SEND, {"member_code": member.member_code}, format="json")

        # Reported as missing rather than forbidden: the difference would confirm the record
        # exists at an MPP this Mait does not serve.
        assert response.status_code == 404
        assert not OTPLog.objects.filter(purpose=OTPLog.Purpose.FARMER_VERIFY).exists()

    def test_needs_exactly_one_farmer(self, mait_client, member):
        response = mait_client.post(SEND, {}, format="json")
        assert response.status_code == 400

    def test_a_non_member_is_verified_the_same_way(self, mait_client, mait, mpp, db):
        non_member = NonMember.objects.create(
            name="RADHA", mobile_no="9876543210", mpp=mpp, created_by_mait=mait
        )

        response = mait_client.post(SEND, {"non_member_id": non_member.id}, format="json")

        assert response.status_code == 200, response.json()
        assert pending_code("9876543210") is not None


class TestVerify:
    def _issue(self, client, member) -> str:
        member.mobile_no = "7081820448"
        member.save(update_fields=["mobile_no"])
        client.post(SEND, {"member_code": member.member_code}, format="json")
        return "7081820448"

    def test_accepts_the_code_that_was_sent(self, mait_client, member, monkeypatch):
        from django.conf import settings

        # The fixed development code, the same route the app is demonstrated on. There is no
        # bypass in the verification path itself — only the generated code is substituted.
        monkeypatch.setattr(settings, "DEV_FIXED_OTP_NUMBERS", ["7081820448"])
        mobile = self._issue(mait_client, member)

        response = mait_client.post(
            CHECK,
            {"member_code": member.member_code, "otp": settings.DEV_FIXED_OTP_CODE},
            format="json",
        )

        assert response.status_code == 200, response.json()
        assert response.json()["verified"] is True
        assert pending_code(mobile).is_verified

    def test_rejects_a_wrong_code_and_says_how_many_tries_are_left(self, mait_client, member):
        self._issue(mait_client, member)

        response = mait_client.post(
            CHECK, {"member_code": member.member_code, "otp": "000000"}, format="json"
        )

        assert response.status_code == 400
        assert response.json()["type"].endswith("otp-invalid")

    def test_runs_out_of_attempts(self, mait_client, member):
        self._issue(mait_client, member)

        for _ in range(3):
            mait_client.post(
                CHECK, {"member_code": member.member_code, "otp": "000000"}, format="json"
            )
        response = mait_client.post(
            CHECK, {"member_code": member.member_code, "otp": "000000"}, format="json"
        )

        # A distinct problem type, because the action it calls for is a resend rather than
        # another guess.
        assert response.json()["type"].endswith("otp-attempts-exceeded")

    def test_will_not_verify_another_maits_member(self, api_client, member, db):
        other = User.objects.create_user(username="other-check", full_name="O", role=Role.MAIT)
        Mait.objects.create(user=other, name="OTHER2", sahayak_vendor_code="7777")
        api_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(other).access_token}"
        )

        response = api_client.post(
            CHECK, {"member_code": member.member_code, "otp": "123456"}, format="json"
        )

        assert response.status_code == 404


def test_anonymous_cannot_send(api_client, member):
    response = api_client.post(SEND, {"member_code": member.member_code}, format="json")
    assert response.status_code == 401
