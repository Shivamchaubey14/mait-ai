"""
The Mait roster endpoint (W7).

Separate from `/admin/users/` because most of the roster has no login: 93% of Maits arrive
from SAP with no mobile number and cannot sign in (docs/DATA_FINDINGS.md). A user-derived
list would show the handful already activated and silently omit everyone still waiting, which
is precisely the population the screen exists to work through.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.masterdata.models import MPP, Mait

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/users/maits/"


def auth(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-roster",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


@pytest.fixture
def roster(db):
    """One activated Mait, one waiting with a number, one waiting without."""
    activated = Mait.objects.create(
        sahayak_vendor_code="SAH-A",
        name="Activated Mait",
        mobile_no="9876543210",
        user=User.objects.create_user(
            username="mait-a", full_name="Activated Mait", role=Role.MAIT
        ),
    )
    waiting = Mait.objects.create(
        sahayak_vendor_code="SAH-B", name="Waiting Mait", mobile_no="9876500000"
    )
    no_mobile = Mait.objects.create(sahayak_vendor_code="SAH-C", name="No Number Mait")
    MPP.objects.create(mpp_code="MPP-R1", mpp_name="Rostered", mait=waiting)
    return activated, waiting, no_mobile


class TestRoster:
    def test_lists_activated_and_waiting_alike(self, admin_client, roster):
        codes = [row["sahayak_vendor_code"] for row in admin_client.get(URL).json()["results"]]
        assert set(codes) == {"SAH-A", "SAH-B", "SAH-C"}

    def test_reports_who_can_actually_sign_in(self, admin_client, roster):
        rows = {r["sahayak_vendor_code"]: r for r in admin_client.get(URL).json()["results"]}

        assert rows["SAH-A"]["activated"] is True
        assert rows["SAH-B"]["activated"] is False
        assert rows["SAH-C"]["needs_mobile"] is True
        assert rows["SAH-B"]["needs_mobile"] is False

    def test_summarises_the_whole_backlog(self, admin_client, roster):
        summary = admin_client.get(URL).json()["summary"]

        assert summary["total"] == 3
        assert summary["activated"] == 1
        assert summary["without_mobile"] == 1

    def test_the_summary_ignores_the_filters(self, admin_client, roster):
        """The banner reports the size of the backlog; a filtered count would understate it."""
        summary = admin_client.get(f"{URL}?needs_mobile=true").json()["summary"]
        assert summary["total"] == 3

    def test_filters_to_those_needing_a_number(self, admin_client, roster):
        results = admin_client.get(f"{URL}?needs_mobile=true").json()["results"]
        assert [r["sahayak_vendor_code"] for r in results] == ["SAH-C"]

    def test_filters_to_those_not_yet_activated(self, admin_client, roster):
        results = admin_client.get(f"{URL}?activated=false").json()["results"]
        assert {r["sahayak_vendor_code"] for r in results} == {"SAH-B", "SAH-C"}

    def test_searches_by_name_and_code(self, admin_client, roster):
        assert len(admin_client.get(f"{URL}?search=Waiting").json()["results"]) == 1
        assert len(admin_client.get(f"{URL}?search=SAH-C").json()["results"]) == 1

    def test_carries_the_mpps_each_covers(self, admin_client, roster):
        rows = {r["sahayak_vendor_code"]: r for r in admin_client.get(URL).json()["results"]}
        assert rows["SAH-B"]["mpp_codes"] == ["MPP-R1"]
        assert rows["SAH-A"]["mpp_count"] == 0

    def test_a_mait_cannot_read_the_roster(self, mait):
        assert auth(mait.user).get(URL).status_code == 403
