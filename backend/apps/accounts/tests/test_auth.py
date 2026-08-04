"""
Authentication tests (SRS §9.1, §6.8.2, §16).

The cases that matter are the negative ones: a Mait getting in with a password, a wrong OTP
being accepted, a deactivated account still working, or an unregistered number being
distinguishable from a registered one.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.payments.models import OTPLog

pytestmark = pytest.mark.django_db

BASE = "/api/v1/auth"


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


@pytest.fixture
def admin_user(db):
    return User.objects.create_user(
        username="backoffice",
        password="a-long-enough-password",
        full_name="Back Office",
        role=Role.ADMIN,
    )


@pytest.fixture
def mait_login(db, mait):
    """An activated Mait: a user account linked to the SAP record, with a mobile number."""
    user = User.objects.create_user(
        username="mait-login", full_name=mait.name, role=Role.MAIT, mobile_no=mait.mobile_no
    )
    mait.user = user
    mait.save(update_fields=["user"])
    return user, mait


def latest_otp_code(mobile_no: str) -> str:
    """
    Recover the code a test just triggered.

    Only the hash is stored (SRS §16), so the code is found by brute-forcing the small
    numeric space against the hash — which is precisely why the real thing is rate limited
    and expires in five minutes.
    """
    otp = OTPLog.objects.filter(mobile_no=mobile_no).latest("created_at")
    for candidate in range(10**6):
        code = f"{candidate:06d}"
        if otp.matches(code):
            return code
    raise AssertionError("no matching code found")


class TestPasswordLogin:
    def test_admin_can_log_in(self, api_client, admin_user):
        response = api_client.post(
            f"{BASE}/login/",
            {"username": "backoffice", "password": "a-long-enough-password"},
            format="json",
        )
        assert response.status_code == 200
        assert set(response.json()) == {"access", "refresh"}

    def test_wrong_password_is_rejected(self, api_client, admin_user):
        response = api_client.post(
            f"{BASE}/login/", {"username": "backoffice", "password": "wrong"}, format="json"
        )
        assert response.status_code == 400

    def test_unknown_user_and_wrong_password_look_identical(self, api_client, admin_user):
        """Differing messages would let an attacker enumerate valid usernames."""
        unknown = api_client.post(
            f"{BASE}/login/", {"username": "nobody", "password": "wrong"}, format="json"
        ).json()
        wrong = api_client.post(
            f"{BASE}/login/", {"username": "backoffice", "password": "wrong"}, format="json"
        ).json()
        assert unknown["errors"] == wrong["errors"]

    def test_mait_cannot_use_the_password_endpoint(self, api_client, mait_login):
        """
        A Mait must not have a second, weaker way in (SRS §9.1).

        Their account carries an unusable password, so this fails at authentication — but
        the role check exists so it keeps failing even if a password is ever set.
        """
        user, _ = mait_login
        user.set_password("some-password")
        user.save()

        response = api_client.post(
            f"{BASE}/login/",
            {"username": user.username, "password": "some-password"},
            format="json",
        )
        assert response.status_code == 400
        assert "OTP" in str(response.json())

    def test_deactivated_account_is_refused(self, api_client, admin_user):
        admin_user.is_active = False
        admin_user.save(update_fields=["is_active"])
        response = api_client.post(
            f"{BASE}/login/",
            {"username": "backoffice", "password": "a-long-enough-password"},
            format="json",
        )
        assert response.status_code == 400


class TestOTPLogin:
    def test_full_otp_login_flow(self, api_client, mait_login):
        user, mait = mait_login

        sent = api_client.post(f"{BASE}/otp/send/", {"mobile_no": mait.mobile_no}, format="json")
        assert sent.status_code == 200

        response = api_client.post(
            f"{BASE}/otp/verify/",
            {"mobile_no": mait.mobile_no, "otp": latest_otp_code(mait.mobile_no)},
            format="json",
        )
        assert response.status_code == 200, response.json()
        assert set(response.json()) == {"access", "refresh"}

        user.refresh_from_db()
        assert user.last_login_at is not None

    def test_unregistered_number_is_indistinguishable(self, api_client, mait_login):
        """
        Confirming which numbers exist would leak the field workforce.

        The response must match a registered number exactly — only the absence of a stored
        OTP differs, and that is not visible to the caller.
        """
        _, mait = mait_login
        registered = api_client.post(
            f"{BASE}/otp/send/", {"mobile_no": mait.mobile_no}, format="json"
        )
        unknown = api_client.post(f"{BASE}/otp/send/", {"mobile_no": "9999999999"}, format="json")
        assert registered.status_code == unknown.status_code == 200
        assert registered.json() == unknown.json()
        assert not OTPLog.objects.filter(mobile_no="9999999999").exists()

    def test_wrong_otp_is_rejected(self, api_client, mait_login):
        _, mait = mait_login
        api_client.post(f"{BASE}/otp/send/", {"mobile_no": mait.mobile_no}, format="json")

        response = api_client.post(
            f"{BASE}/otp/verify/", {"mobile_no": mait.mobile_no, "otp": "000000"}, format="json"
        )
        assert response.status_code == 400
        assert response.json()["type"].endswith("otp-invalid")

    def test_expired_otp_is_rejected(self, api_client, mait_login):
        """SRS §6.5.1 — five-minute expiry."""
        _, mait = mait_login
        api_client.post(f"{BASE}/otp/send/", {"mobile_no": mait.mobile_no}, format="json")
        code = latest_otp_code(mait.mobile_no)

        OTPLog.objects.filter(mobile_no=mait.mobile_no).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )

        response = api_client.post(
            f"{BASE}/otp/verify/", {"mobile_no": mait.mobile_no, "otp": code}, format="json"
        )
        assert response.status_code == 400
        assert response.json()["type"].endswith("otp-expired")

    def test_three_wrong_attempts_force_a_resend(self, api_client, mait_login):
        """SRS §6.5.1 — three attempts, then the code is dead even if guessed correctly."""
        _, mait = mait_login
        api_client.post(f"{BASE}/otp/send/", {"mobile_no": mait.mobile_no}, format="json")
        code = latest_otp_code(mait.mobile_no)

        for _ in range(3):
            api_client.post(
                f"{BASE}/otp/verify/",
                {"mobile_no": mait.mobile_no, "otp": "000000"},
                format="json",
            )

        response = api_client.post(
            f"{BASE}/otp/verify/", {"mobile_no": mait.mobile_no, "otp": code}, format="json"
        )
        assert response.status_code == 429
        assert response.json()["type"].endswith("otp-attempts-exceeded")

    def test_resend_invalidates_the_previous_code(self, api_client, mait_login):
        """Two live codes at once would double the guessing surface."""
        _, mait = mait_login
        api_client.post(f"{BASE}/otp/send/", {"mobile_no": mait.mobile_no}, format="json")
        first = latest_otp_code(mait.mobile_no)

        api_client.post(f"{BASE}/otp/send/", {"mobile_no": mait.mobile_no}, format="json")

        response = api_client.post(
            f"{BASE}/otp/verify/", {"mobile_no": mait.mobile_no, "otp": first}, format="json"
        )
        assert response.status_code >= 400

    def test_deactivated_mait_cannot_trade_a_valid_otp(self, api_client, mait_login):
        """A revoked Mait must not exchange a code issued before revocation."""
        user, mait = mait_login
        api_client.post(f"{BASE}/otp/send/", {"mobile_no": mait.mobile_no}, format="json")
        code = latest_otp_code(mait.mobile_no)

        user.is_active = False
        user.save(update_fields=["is_active"])

        response = api_client.post(
            f"{BASE}/otp/verify/", {"mobile_no": mait.mobile_no, "otp": code}, format="json"
        )
        assert response.status_code == 400

    def test_mait_with_no_mobile_gets_no_otp(self, api_client, mait_login):
        """
        93% of the real SAP Sahayak records have no mobile number.

        Such a Mait simply cannot be reached, which is why an Admin sets one at activation
        (SRS §6.8.2, docs/DATA_FINDINGS.md §1).
        """
        _, mait = mait_login
        mait.mobile_no = ""
        mait.save(update_fields=["mobile_no"])

        response = api_client.post(f"{BASE}/otp/send/", {"mobile_no": ""}, format="json")
        assert response.status_code == 400


class TestSessionLifecycle:
    def _tokens(self, api_client, admin_user):
        return api_client.post(
            f"{BASE}/login/",
            {"username": "backoffice", "password": "a-long-enough-password"},
            format="json",
        ).json()

    def test_me_returns_the_current_user(self, api_client, admin_user):
        tokens = self._tokens(api_client, admin_user)
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        body = api_client.get(f"{BASE}/me/").json()
        assert body["username"] == "backoffice"
        assert body["role"] == Role.ADMIN
        assert body["assigned_mpp_codes"] == []

    def test_me_lists_a_maits_assigned_mpps(self, api_client, mait_login, mpp):
        """The app scopes everything off this call (SRS §6.2.3)."""
        user, mait = mait_login
        api_client.post(f"{BASE}/otp/send/", {"mobile_no": mait.mobile_no}, format="json")
        tokens = api_client.post(
            f"{BASE}/otp/verify/",
            {"mobile_no": mait.mobile_no, "otp": latest_otp_code(mait.mobile_no)},
            format="json",
        ).json()
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        body = api_client.get(f"{BASE}/me/").json()
        assert body["assigned_mpp_codes"] == [mpp.mpp_code]
        assert body["sahayak_vendor_code"] == mait.sahayak_vendor_code

    def test_refresh_returns_a_new_access_token(self, api_client, admin_user):
        tokens = self._tokens(api_client, admin_user)
        response = api_client.post(
            f"{BASE}/refresh/", {"refresh": tokens["refresh"]}, format="json"
        )
        assert response.status_code == 200
        assert "access" in response.json()

    def test_logout_blacklists_the_refresh_token(self, api_client, admin_user):
        tokens = self._tokens(api_client, admin_user)
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        assert (
            api_client.post(
                f"{BASE}/logout/", {"refresh": tokens["refresh"]}, format="json"
            ).status_code
            == 205
        )

        reused = api_client.post(f"{BASE}/refresh/", {"refresh": tokens["refresh"]}, format="json")
        assert reused.status_code == 401, "a blacklisted refresh token must not be reusable"

    def test_me_requires_authentication(self, api_client):
        assert api_client.get(f"{BASE}/me/").status_code == 401
