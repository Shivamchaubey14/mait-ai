"""
Admin user-management tests (SRS §6.8, §9.10, §6.2.2).

The important cases are the ones that would let a field login exist without a real Sahayak
behind it, or let one Mait end up holding another's MPPs.
"""

from __future__ import annotations

import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.masterdata.models import Mait

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


@pytest.fixture
def admin_client(api_client, db):
    user = User.objects.create_user(
        username="theadmin", password="a-long-enough-password", full_name="Admin", role=Role.ADMIN
    )
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api_client


class TestMaitActivation:
    """SRS §6.8.2 — a Mait login is activated from an existing SAP record."""

    def test_activates_a_mait_and_sets_the_mobile(self, admin_client, mait):
        """
        The number is supplied here because 93% of SAP Sahayak records arrive without one,
        and OTP is the only way a Mait can sign in (docs/DATA_FINDINGS.md §1).
        """
        mait.mobile_no = ""
        mait.user = None
        mait.save(update_fields=["mobile_no", "user"])

        response = admin_client.post(
            f"{BASE}/admin/users/activate-mait/",
            {"sahayak_vendor_code": mait.sahayak_vendor_code, "mobile_no": "9876543210"},
            format="json",
        )
        assert response.status_code == 201, response.json()

        mait.refresh_from_db()
        assert mait.user is not None
        assert mait.mobile_no == "9876543210"
        assert mait.user.role == Role.MAIT
        assert mait.user.mobile_no == "9876543210"

    def test_activated_mait_has_no_usable_password(self, admin_client, mait):
        """OTP must remain the only route into a field account (SRS §9.1)."""
        mait.user = None
        mait.save(update_fields=["user"])
        admin_client.post(
            f"{BASE}/admin/users/activate-mait/",
            {"sahayak_vendor_code": mait.sahayak_vendor_code, "mobile_no": "9876543211"},
            format="json",
        )
        mait.refresh_from_db()
        assert not mait.user.has_usable_password()

    def test_cannot_activate_an_unknown_sahayak(self, admin_client):
        """A login must always trace back to a real SAP record."""
        response = admin_client.post(
            f"{BASE}/admin/users/activate-mait/",
            {"sahayak_vendor_code": "NOPE123", "mobile_no": "9876543210"},
            format="json",
        )
        assert response.status_code == 400
        assert "sahayak_vendor_code" in response.json()["errors"]

    def test_cannot_activate_twice(self, admin_client, mait, mait_user_placeholder):
        response = admin_client.post(
            f"{BASE}/admin/users/activate-mait/",
            {"sahayak_vendor_code": mait.sahayak_vendor_code, "mobile_no": "9876543219"},
            format="json",
        )
        assert response.status_code == 400
        assert "already has a login" in str(response.json())

    def test_rejects_a_mobile_already_used_by_another_mait(self, admin_client, mait):
        """
        Two Maits on one number would make the login OTP ambiguous — whoever requested it
        first would receive a code that signs in as the wrong person.
        """
        Mait.objects.create(
            sahayak_vendor_code="SAH-OTHER", name="Someone Else", mobile_no="9876500000"
        )
        mait.user = None
        mait.save(update_fields=["user"])

        response = admin_client.post(
            f"{BASE}/admin/users/activate-mait/",
            {"sahayak_vendor_code": mait.sahayak_vendor_code, "mobile_no": "9876500000"},
            format="json",
        )
        assert response.status_code == 400
        assert "already uses this number" in str(response.json())

    def test_pending_list_flags_maits_with_no_mobile(self, admin_client, mait):
        mait.user = None
        mait.mobile_no = ""
        mait.save(update_fields=["user", "mobile_no"])

        body = admin_client.get(f"{BASE}/admin/users/pending-maits/").json()
        assert body["summary"]["without_mobile"] >= 1
        assert any(row["needs_mobile"] for row in body["results"])


@pytest.fixture
def mait_user_placeholder(db, mait):
    user = User.objects.create_user(username="existing-mait", full_name="X", role=Role.MAIT)
    mait.user = user
    mait.save(update_fields=["user"])
    return user


class TestOfficeAccounts:
    def test_creates_an_admin(self, admin_client):
        response = admin_client.post(
            f"{BASE}/admin/users/",
            {
                "username": "newadmin",
                "full_name": "New Admin",
                "role": Role.ADMIN,
                "password": "another-long-password",
            },
            format="json",
        )
        assert response.status_code == 201
        assert User.objects.get(username="newadmin").role == Role.ADMIN

    def test_operator_requires_at_least_one_mpp(self, admin_client):
        """An operator with no MPPs could see nothing, so it is a configuration mistake."""
        response = admin_client.post(
            f"{BASE}/admin/users/",
            {
                "username": "operator1",
                "full_name": "Operator",
                "role": Role.MPP_OPERATOR,
                "password": "another-long-password",
            },
            format="json",
        )
        assert response.status_code == 400
        assert "mpp_codes" in response.json()["errors"]

    def test_operator_is_assigned_its_mpps(self, admin_client, mpp):
        response = admin_client.post(
            f"{BASE}/admin/users/",
            {
                "username": "operator2",
                "full_name": "Operator",
                "role": Role.MPP_OPERATOR,
                "password": "another-long-password",
                "mpp_codes": [mpp.mpp_code],
            },
            format="json",
        )
        assert response.status_code == 201
        assert User.objects.get(username="operator2").mpp_assignments.count() == 1

    def test_rejects_a_duplicate_username(self, admin_client):
        response = admin_client.post(
            f"{BASE}/admin/users/",
            {
                "username": "theadmin",
                "full_name": "Clash",
                "role": Role.ADMIN,
                "password": "another-long-password",
            },
            format="json",
        )
        assert response.status_code == 400

    def test_deactivates_an_account(self, admin_client):
        user = User.objects.create_user(
            username="tempadmin",
            password="a-long-enough-password",
            full_name="Temp",
            role=Role.ADMIN,
        )
        response = admin_client.patch(
            f"{BASE}/admin/users/{user.id}/", {"is_active": False}, format="json"
        )
        assert response.status_code == 200
        user.refresh_from_db()
        assert user.is_active is False

    def test_cannot_switch_an_account_between_mait_and_office(
        self, admin_client, mait_user_placeholder
    ):
        """
        Promoting a Mait would leave admin rights attached to a SAP Sahayak record.

        The two account kinds are provisioned differently and cannot be converted.
        """
        response = admin_client.patch(
            f"{BASE}/admin/users/{mait_user_placeholder.id}/",
            {"role": Role.ADMIN},
            format="json",
        )
        assert response.status_code == 400

    def test_cannot_set_a_password_on_a_mait(self, admin_client, mait_user_placeholder):
        response = admin_client.patch(
            f"{BASE}/admin/users/{mait_user_placeholder.id}/",
            {"password": "trying-to-add-one"},
            format="json",
        )
        assert response.status_code == 400

    def test_updating_a_mait_mobile_updates_the_sap_record_too(
        self, admin_client, mait, mait_user_placeholder
    ):
        """Two sources of the OTP number that disagree is how a login silently breaks."""
        admin_client.patch(
            f"{BASE}/admin/users/{mait_user_placeholder.id}/",
            {"mobile_no": "9998887776"},
            format="json",
        )
        mait.refresh_from_db()
        assert mait.mobile_no == "9998887776"


class TestMPPAssignment:
    """SRS §6.2.2 — an Admin can override the SAP-derived Mait assignment."""

    def test_reassigns_an_mpp(self, admin_client, mpp, mait):
        replacement = Mait.objects.create(
            sahayak_vendor_code="SAH-NEW", name="Replacement", mobile_no="9871112223"
        )
        response = admin_client.patch(
            f"{BASE}/mpp/{mpp.mpp_code}/assign-mait/",
            {"sahayak_vendor_code": replacement.sahayak_vendor_code},
            format="json",
        )
        assert response.status_code == 200, response.json()
        mpp.refresh_from_db()
        assert mpp.mait_id == replacement.id

    def test_unassigns_an_mpp(self, admin_client, mpp):
        response = admin_client.patch(
            f"{BASE}/mpp/{mpp.mpp_code}/assign-mait/",
            {"sahayak_vendor_code": None},
            format="json",
        )
        assert response.status_code == 200
        mpp.refresh_from_db()
        assert mpp.mait_id is None

    def test_rejects_an_unknown_mait(self, admin_client, mpp):
        response = admin_client.patch(
            f"{BASE}/mpp/{mpp.mpp_code}/assign-mait/",
            {"sahayak_vendor_code": "GHOST"},
            format="json",
        )
        assert response.status_code == 400

    def test_reassignment_moves_the_members_too(self, admin_client, mpp, member):
        """
        The assignment is what scopes a Mait's app, so it must move both the MPP and its
        members out of one view and into the other (SRS §6.2.3).
        """
        replacement = Mait.objects.create(
            sahayak_vendor_code="SAH-MOVE", name="Replacement", mobile_no="9871112224"
        )
        new_user = User.objects.create_user(
            username="replacement-mait", full_name="Replacement", role=Role.MAIT
        )
        replacement.user = new_user
        replacement.save(update_fields=["user"])

        admin_client.patch(
            f"{BASE}/mpp/{mpp.mpp_code}/assign-mait/",
            {"sahayak_vendor_code": replacement.sahayak_vendor_code},
            format="json",
        )

        from rest_framework.test import APIClient

        client = APIClient()
        client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(new_user).access_token}"
        )
        assert client.get(f"{BASE}/members/").json()["count"] == 1

    def test_only_an_admin_may_reassign(self, api_client, mpp, mait):
        user = User.objects.create_user(username="a-mait", full_name="M", role=Role.MAIT)
        mait.user = user
        mait.save(update_fields=["user"])
        api_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}"
        )
        response = api_client.patch(
            f"{BASE}/mpp/{mpp.mpp_code}/assign-mait/",
            {"sahayak_vendor_code": mait.sahayak_vendor_code},
            format="json",
        )
        assert response.status_code == 403


class TestAdminAccessControl:
    def test_user_administration_is_admin_only(self, api_client, mait):
        user = User.objects.create_user(username="mait-x", full_name="M", role=Role.MAIT)
        mait.user = user
        mait.save(update_fields=["user"])
        api_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}"
        )
        assert api_client.get(f"{BASE}/admin/users/").status_code == 403
        assert api_client.post(f"{BASE}/admin/users/", {}, format="json").status_code == 403

    def test_anonymous_is_rejected(self, api_client):
        assert api_client.get(f"{BASE}/admin/users/").status_code == 401
