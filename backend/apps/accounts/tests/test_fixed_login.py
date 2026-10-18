"""
The admin's fixed-login switch (`User.fixed_otp_enabled`).

A per-account sign-in bypass an admin turns on for a Mait being shown the app, or to keep
sign-ins working while the SMS gateway is down. It must be exactly that — scoped to the one
account, flowing through the ordinary OTP path, taking effect at once, and recorded — and
nothing broader: off by default, and no account the admin has not flipped is affected.
"""

from __future__ import annotations

import pytest
from django.conf import settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.core.models import AuditLog
from apps.payments.models import OTPLog
from apps.payments.services import generate_code, issue_otp, verify_otp

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-fixed",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


def _mait(mobile="9876500000", fixed=False):
    return User.objects.create_user(
        username=f"mait-{mobile}",
        full_name="Trainee Mait",
        role=Role.MAIT,
        mobile_no=mobile,
        fixed_otp_enabled=fixed,
    )


class TestFixedCode:
    def test_an_enabled_account_gets_the_fixed_code(self):
        _mait(mobile="9876500000", fixed=True)
        assert generate_code("9876500000") == settings.FIXED_LOGIN_OTP_CODE

    def test_off_by_default_the_code_is_random(self):
        _mait(mobile="9876500001", fixed=False)
        # Not the fixed code, and a real-length OTP. (A random code colliding with 123456 is a
        # one-in-a-million event; the length check is the honest assertion.)
        code = generate_code("9876500001")
        assert len(code) == settings.OTP_LENGTH
        assert code != settings.FIXED_LOGIN_OTP_CODE

    def test_a_number_with_no_such_account_is_untouched(self):
        assert generate_code("9876509999") != settings.FIXED_LOGIN_OTP_CODE

    def test_a_deactivated_account_does_not_get_the_fixed_code(self):
        _mait(mobile="9876500002", fixed=True).__class__.objects.filter(
            mobile_no="9876500002"
        ).update(is_active=False)
        assert generate_code("9876500002") != settings.FIXED_LOGIN_OTP_CODE

    def test_the_fixed_code_signs_in_through_the_ordinary_path(self):
        """Issued and verified exactly as a texted code — no bypass in the verify path."""
        _mait(mobile="9876500003", fixed=True)
        issue_otp(mobile_no="9876500003", purpose=OTPLog.Purpose.LOGIN)

        verified = verify_otp(
            mobile_no="9876500003",
            purpose=OTPLog.Purpose.LOGIN,
            code=settings.FIXED_LOGIN_OTP_CODE,
        )
        assert verified.is_verified is True


class TestAdminToggle:
    def test_admin_turns_it_on_and_it_is_audited(self, admin_client):
        mait = _mait(mobile="9876500010", fixed=False)

        response = admin_client.patch(
            f"{BASE}/admin/users/{mait.id}/",
            {"fixed_otp_enabled": True},
            format="json",
        )

        assert response.status_code == 200, response.json()
        assert response.json()["fixed_otp_enabled"] is True
        mait.refresh_from_db()
        assert mait.fixed_otp_enabled is True

        entry = AuditLog.objects.filter(
            entity_type="user", entity_id=mait.id, action=AuditLog.Action.UPDATE
        ).latest("created_at")
        assert entry.meta_json["before"]["fixed_otp_enabled"] is False
        assert entry.meta_json["after"]["fixed_otp_enabled"] is True

    def test_admin_turns_it_back_off(self, admin_client):
        mait = _mait(mobile="9876500011", fixed=True)

        admin_client.patch(
            f"{BASE}/admin/users/{mait.id}/",
            {"fixed_otp_enabled": False},
            format="json",
        )
        mait.refresh_from_db()
        assert mait.fixed_otp_enabled is False
        # Off again means an ordinary OTP at once — the switch leaves no trace in the code path.
        assert generate_code("9876500011") != settings.FIXED_LOGIN_OTP_CODE

    def test_the_read_shape_carries_the_flag(self, admin_client):
        mait = _mait(mobile="9876500012", fixed=True)
        row = admin_client.get(f"{BASE}/admin/users/?role=mait").json()
        mine = [u for u in row["results"] if u["id"] == mait.id][0]
        assert mine["fixed_otp_enabled"] is True
