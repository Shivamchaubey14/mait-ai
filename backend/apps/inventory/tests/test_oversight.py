"""
Admin inventory oversight and the CSV export (SRS §6.7.6, §9.9).

The oversight endpoint answers one question the Mait-facing endpoints structurally cannot:
who is about to run out. A Mait at zero is the case worth separating — they are not low, they
are stopped, and no AI event can be recorded at that MPP until stock arrives.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.masterdata.models import Mait

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


def auth(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-oversight",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


class TestInventoryOversight:
    def test_reports_stock_per_mait(self, admin_client, mait, stocked_mait):
        stocked_mait(3)

        body = admin_client.get(f"{BASE}/admin/inventory/").json()
        row = next(r for r in body["results"] if r["mait_id"] == mait.id)

        assert row["total"] == 3
        assert row["by_breed"] == {"GIR": 3}
        assert body["summary"]["total_straws"] == 3

    def test_a_mait_holding_nothing_still_appears(self, admin_client, mait):
        """
        The whole point of the screen. Building the list from stock rows alone would omit
        exactly the Maits who cannot record anything.
        """
        body = admin_client.get(f"{BASE}/admin/inventory/").json()

        assert [r["mait_id"] for r in body["results"]] == [mait.id]
        assert body["results"][0]["total"] == 0
        assert body["summary"]["at_zero"] == 1

    def test_at_zero_is_counted_apart_from_low(self, admin_client, mait, stocked_mait, db):
        stocked_mait(1)
        Mait.objects.create(sahayak_vendor_code="SAH-EMPTY", name="Empty")

        summary = admin_client.get(f"{BASE}/admin/inventory/").json()["summary"]

        assert summary["low"] == 1
        assert summary["at_zero"] == 1

    def test_the_emptiest_mait_is_listed_first(self, admin_client, mait, stocked_mait, db):
        """Ordered by need: the screen is opened to find who to send straws to."""
        stocked_mait(2)
        Mait.objects.create(sahayak_vendor_code="SAH-ZERO", name="Zero")

        results = admin_client.get(f"{BASE}/admin/inventory/").json()["results"]
        assert results[0]["total"] == 0

    def test_a_mait_cannot_see_everyone_elses_stock(self, mait):
        assert auth(mait.user).get(f"{BASE}/admin/inventory/").status_code == 403


class TestCsvExport:
    def test_exports_events_as_csv(self, admin_client, ai_event_ready_to_complete):
        ai_event_ready_to_complete()

        response = admin_client.get(f"{BASE}/reports/export/")
        body = b"".join(response.streaming_content).decode()

        assert response.status_code == 200
        assert response["Content-Type"] == "text/csv"
        assert "attachment" in response["Content-Disposition"]
        assert body.splitlines()[0].startswith("event_id,status,captured_at")
        assert len(body.splitlines()) == 2

    def test_carries_no_personal_data(self, admin_client, member, ai_event_ready_to_complete):
        """
        The file leaves the system — an inbox, a shared drive, a laptop. Aadhaar and bank
        details are read one record at a time, where the access is logged (SRS §16).
        """
        member.aadhar_no = "514389489509"
        member.mobile_no = "7081820448"
        member.folio_no = "FOLIO-99881"
        member.save(update_fields=["aadhar_no", "mobile_no", "folio_no"])
        ai_event_ready_to_complete()

        body = b"".join(admin_client.get(f"{BASE}/reports/export/").streaming_content).decode()

        assert "514389489509" not in body
        assert "7081820448" not in body
        assert "FOLIO-99881" not in body
        header = body.splitlines()[0]
        assert "aadhar" not in header
        assert "mobile" not in header

    def test_filters_by_date(self, admin_client, ai_event_ready_to_complete):
        ai_event_ready_to_complete()

        body = b"".join(
            admin_client.get(
                f"{BASE}/reports/export/?date_from=2000-01-01&date_to=2000-01-02"
            ).streaming_content
        ).decode()

        # Header only: nothing was captured in 2000.
        assert len(body.splitlines()) == 1

    def test_a_mait_cannot_export(self, mait):
        assert auth(mait.user).get(f"{BASE}/reports/export/").status_code == 403
