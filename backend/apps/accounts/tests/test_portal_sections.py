"""
Per-account portal access (SRS §6.8.3).

Role says what kind of account someone has; sections say which of the portal's seventeen
screens that account is there to work. What matters here is that the answer is given by the
API and not by the sidebar — the portal is one static file per screen, and a shorter menu
has nothing to say about a URL typed into the address bar.
"""

from __future__ import annotations

import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


def _as(api_client, user):
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api_client


@pytest.fixture
def limited_admin(db):
    """An Admin who was given two screens and nothing else."""
    return User.objects.create_user(
        username="rates-only",
        password="a-long-enough-password",
        full_name="Rates Clerk",
        role=Role.ADMIN,
        portal_sections=[PortalSection.RATES, PortalSection.DASHBOARD],
    )


@pytest.fixture
def super_admin(db):
    return User.objects.create_user(
        username="thesuper",
        password="a-long-enough-password",
        full_name="Super",
        role=Role.SUPER_ADMIN,
    )


@pytest.fixture
def full_admin(db):
    """Created the way every admin was before access existed — with no list supplied."""
    return User.objects.create_user(
        username="full-admin",
        password="a-long-enough-password",
        full_name="Back Office",
        role=Role.ADMIN,
    )


class TestWhatAnAccountReaches:
    def test_an_omitted_list_means_the_whole_portal(self, full_admin):
        """
        The behaviour every admin had before this feature, kept.

        An account created by a management command or a seed script that has never heard of
        sections must not sign in to an empty sidebar — that reads as a broken portal rather
        than as a decision somebody made.
        """
        assert full_admin.allowed_sections == list(PortalSection.values)

    def test_a_super_admin_is_never_restricted(self, super_admin):
        """They are the accounts that hand access out; one bad save must not lock them out."""
        super_admin.portal_sections = [PortalSection.RATES]
        assert super_admin.allowed_sections == list(PortalSection.values)

    def test_a_mait_has_no_sections_at_all(self, mait):
        assert mait.user.allowed_sections == []

    def test_sections_come_back_in_sidebar_order(self, limited_admin):
        """Stored order is whatever the operator ticked in; read order is the menu's."""
        limited_admin.portal_sections = [PortalSection.RATES, PortalSection.DASHBOARD]
        assert limited_admin.allowed_sections == [PortalSection.DASHBOARD, PortalSection.RATES]

    def test_a_retired_section_is_dropped_rather_than_returned(self, limited_admin):
        """A key the catalogue no longer has would otherwise draw a dead link in the sidebar."""
        limited_admin.portal_sections = [PortalSection.RATES, "a-screen-we-removed"]
        assert limited_admin.allowed_sections == [PortalSection.RATES]


class TestTheAPIEnforcesIt:
    """The sidebar is a convenience. These are the checks that actually hold."""

    def test_a_section_they_hold_is_open(self, api_client, limited_admin):
        response = _as(api_client, limited_admin).get(f"{BASE}/admin/pregnancy/rate/")
        assert response.status_code == 200

    def test_a_section_they_do_not_hold_is_refused(self, api_client, limited_admin):
        response = _as(api_client, limited_admin).get(f"{BASE}/admin/products/")
        assert response.status_code == 403

    def test_the_refusal_says_what_is_wrong(self, api_client, limited_admin):
        response = _as(api_client, limited_admin).get(f"{BASE}/admin/inventory/")
        assert response.status_code == 403
        assert "portal" in response.json()["detail"].lower()

    def test_an_endpoint_two_screens_share_opens_for_either(self, api_client, limited_admin):
        """
        Rates prices each breed's straw and Products maintains the list.

        An admin holding one of the two must not be refused the catalogue behind it because
        they lack the other — which is why the check is any-of rather than all-of.
        """
        response = _as(api_client, limited_admin).get(f"{BASE}/admin/breeds/")
        assert response.status_code == 200

    def test_a_full_admin_still_reaches_everything(self, api_client, full_admin):
        client = _as(api_client, full_admin)
        for path in ("/admin/products/", "/admin/inventory/", "/admin/users/"):
            assert client.get(f"{BASE}{path}").status_code == 200, path

    def test_a_super_admin_reaches_everything(self, api_client, super_admin):
        assert _as(api_client, super_admin).get(f"{BASE}/admin/products/").status_code == 200

    def test_a_mait_is_not_gated_by_sections(self, api_client, mait, mpp):
        """
        The app is scoped by the MPPs a Mait covers, not by portal sections.

        `/members/` carries the Members section for the portal's sake; applying it to a Mait
        would refuse the app the master data the capture flow runs on.
        """
        response = _as(api_client, mait.user).get(f"{BASE}/members/", {"mpp": mpp.mpp_code})
        assert response.status_code == 200


class TestAssigningAccess:
    def test_an_admin_can_be_narrowed(self, api_client, super_admin, full_admin):
        response = _as(api_client, super_admin).patch(
            f"{BASE}/admin/users/{full_admin.id}/",
            {"portal_sections": [PortalSection.UPLOADS, PortalSection.DASHBOARD]},
            format="json",
        )
        assert response.status_code == 200, response.json()
        assert response.json()["portal_sections"] == [
            PortalSection.DASHBOARD,
            PortalSection.UPLOADS,
        ]

        full_admin.refresh_from_db()
        assert full_admin.can_view_section(PortalSection.UPLOADS)
        assert not full_admin.can_view_section(PortalSection.RATES)

    def test_access_can_be_taken_away_entirely(self, api_client, super_admin, full_admin):
        """An empty list is a real answer — deactivating is the other, harsher one."""
        response = _as(api_client, super_admin).patch(
            f"{BASE}/admin/users/{full_admin.id}/",
            {"portal_sections": []},
            format="json",
        )
        assert response.status_code == 200, response.json()
        assert response.json()["portal_sections"] == []

    def test_nobody_edits_their_own_access(self, api_client, super_admin):
        """
        An Admin holding Users & roles could otherwise untick it and lock themselves out of
        the only screen that could put it back.
        """
        response = _as(api_client, super_admin).patch(
            f"{BASE}/admin/users/{super_admin.id}/",
            {"portal_sections": [PortalSection.DASHBOARD]},
            format="json",
        )
        assert response.status_code == 400
        assert "your own" in str(response.json()).lower()

    def test_a_super_admin_has_nothing_to_assign(self, api_client, super_admin):
        other = User.objects.create_user(
            username="second-super",
            password="a-long-enough-password",
            full_name="Second",
            role=Role.SUPER_ADMIN,
        )
        response = _as(api_client, super_admin).patch(
            f"{BASE}/admin/users/{other.id}/",
            {"portal_sections": [PortalSection.DASHBOARD]},
            format="json",
        )
        assert response.status_code == 400

    def test_an_unknown_section_is_refused(self, api_client, super_admin, full_admin):
        response = _as(api_client, super_admin).patch(
            f"{BASE}/admin/users/{full_admin.id}/",
            {"portal_sections": ["dashboard", "not-a-screen"]},
            format="json",
        )
        assert response.status_code == 400

    def test_a_new_account_can_be_given_its_screens_at_creation(self, api_client, super_admin):
        response = _as(api_client, super_admin).post(
            f"{BASE}/admin/users/",
            {
                "username": "uploads-clerk",
                "full_name": "Uploads Clerk",
                "role": Role.ADMIN,
                "password": "a-long-enough-password",
                "portal_sections": [PortalSection.UPLOADS],
            },
            format="json",
        )
        assert response.status_code == 201, response.json()
        assert response.json()["portal_sections"] == [PortalSection.UPLOADS]

    def test_a_new_account_created_without_a_list_gets_the_portal(self, api_client, super_admin):
        response = _as(api_client, super_admin).post(
            f"{BASE}/admin/users/",
            {
                "username": "another-admin",
                "full_name": "Another",
                "role": Role.ADMIN,
                "password": "a-long-enough-password",
            },
            format="json",
        )
        assert response.status_code == 201, response.json()
        assert response.json()["portal_sections"] == list(PortalSection.values)

    def test_the_change_is_audit_logged(self, api_client, super_admin, full_admin):
        """Handing out access is the most privileged thing the portal does."""
        from apps.core.models import AuditLog

        _as(api_client, super_admin).patch(
            f"{BASE}/admin/users/{full_admin.id}/",
            {"portal_sections": [PortalSection.DASHBOARD]},
            format="json",
        )
        entry = AuditLog.objects.filter(entity_type="user", entity_id=full_admin.id).latest("id")
        assert entry.meta_json["before"]["portal_sections"] == list(PortalSection.values)
        assert entry.meta_json["after"]["portal_sections"] == [PortalSection.DASHBOARD]


class TestWhatThePortalIsTold:
    def test_me_carries_the_sections_the_sidebar_draws(self, api_client, limited_admin):
        response = _as(api_client, limited_admin).get(f"{BASE}/auth/me/")
        assert response.status_code == 200
        assert response.json()["portal_sections"] == [
            PortalSection.DASHBOARD,
            PortalSection.RATES,
        ]

    def test_the_catalogue_lists_every_section_in_sidebar_order(self, api_client, super_admin):
        response = _as(api_client, super_admin).get(f"{BASE}/admin/users/portal-sections/")
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == len(PortalSection.values)
        assert [row["key"] for row in body["results"]] == list(PortalSection.values)

    def test_the_catalogue_is_behind_the_screen_that_uses_it(self, api_client, limited_admin):
        response = _as(api_client, limited_admin).get(f"{BASE}/admin/users/portal-sections/")
        assert response.status_code == 403


class TestOneViewsetThreeSections:
    """`/admin/users/` backs the account list, the Mait roster and the activation queue."""

    @pytest.fixture
    def maits_only(self, db):
        return User.objects.create_user(
            username="roster-clerk",
            password="a-long-enough-password",
            full_name="Roster Clerk",
            role=Role.ADMIN,
            portal_sections=[PortalSection.MAITS],
        )

    def test_the_roster_is_open_to_the_maits_screen(self, api_client, maits_only):
        assert _as(api_client, maits_only).get(f"{BASE}/admin/users/maits/").status_code == 200

    def test_creating_an_account_is_not(self, api_client, maits_only):
        response = _as(api_client, maits_only).post(
            f"{BASE}/admin/users/",
            {
                "username": "sneaky",
                "full_name": "Sneaky",
                "role": Role.SUPER_ADMIN,
                "password": "a-long-enough-password",
            },
            format="json",
        )
        assert response.status_code == 403
