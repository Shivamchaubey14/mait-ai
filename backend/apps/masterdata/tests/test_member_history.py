"""
A member across a move — one SAP vendor, two member codes — and the exports that carry her.

When a member starts pouring at another MPP she is given a new member code there, and her SAP
vendor code stays the same. The member master then holds her twice, and her inseminations are
split between the two codes. What matters: the vendor code finds her under both, the history
puts every insemination back together and says which code each was under, and an export
carries her code exactly — leading zero and all — with the vendor beside it.
"""

from __future__ import annotations

import uuid
from io import BytesIO

import pytest
from openpyxl import load_workbook

from apps.ai_events.models import AIEvent
from conftest import AnimalFactory, MemberFactory, MPPFactory, sheet_rows

pytestmark = pytest.mark.django_db

BASE = "/api/v1"
VENDOR = "4000000557"


@pytest.fixture
def admin_client(db):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.accounts.models import Role, User

    admin = User.objects.create_user(
        username="admin-history",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


@pytest.fixture
def moved(mait):
    """Her old code at the MPP she left, and her new one where she pours now."""
    old = MemberFactory(
        mpp=MPPFactory(mait=mait, mpp_code="001315"),
        member_code="0906145300010023",
        member_name="KAMLA DEVI",
        sap_vendor_code=VENDOR,
        activation_status="Temporary Member",
    )
    new = MemberFactory(
        mpp=MPPFactory(mait=mait, mpp_code="001332"),
        member_code="0906129700010085",
        member_name="KAMLA DEVI",
        sap_vendor_code=VENDOR,
        activation_status="Member",
    )
    return old, new


def inseminate(member, straw):
    return AIEvent.objects.create(
        client_uuid=uuid.uuid4(),
        mait=member.mpp.mait,
        mpp=member.mpp,
        owner_type=AIEvent.OwnerType.MEMBER,
        member=member,
        animal=AnimalFactory(member=member),
        straw_unique_no=straw,
        status=AIEvent.Status.STRAW_VERIFIED,
    )


class TestTheExport:
    def test_is_a_workbook_that_keeps_the_leading_zero(self, admin_client, moved):
        old, _new = moved
        inseminate(old, "0012345")

        response = admin_client.get(f"{BASE}/reports/export/")
        assert response["Content-Disposition"].endswith('.xlsx"')

        sheet = load_workbook(BytesIO(response.content)).worksheets[0]
        header = [cell.value for cell in sheet[1]]
        row = sheet[2]
        code = row[header.index("Member code")]
        # A text cell, so Excel shows it as typed rather than as 9.06145E+14.
        assert code.value == "0906145300010023"
        assert code.data_type == "s"
        assert row[header.index("MPP code")].value == "001315"
        assert row[header.index("Straw no.")].value == "0012345"
        assert row[header.index("SAP vendor")].value == VENDOR


class TestFindingHerByVendor:
    def test_the_event_search_finds_her_under_both_codes(self, admin_client, moved):
        old, new = moved
        before = inseminate(old, "OLD-1")
        after = inseminate(new, "NEW-1")
        inseminate(MemberFactory(mpp=new.mpp), "SOMEONE-ELSE")

        body = admin_client.get(f"{BASE}/ai-events/", {"search": VENDOR}).json()
        assert {row["id"] for row in body["results"]} == {before.id, after.id}
        assert {row["sap_vendor_code"] for row in body["results"]} == {VENDOR}

    def test_and_so_does_the_export(self, admin_client, moved):
        old, new = moved
        inseminate(old, "OLD-1")
        inseminate(new, "NEW-1")
        inseminate(MemberFactory(mpp=new.mpp), "SOMEONE-ELSE")

        header, *rows = sheet_rows(admin_client.get(f"{BASE}/reports/export/", {"search": VENDOR}))
        codes = sorted(row[header.index("Member code")] for row in rows)
        assert codes == ["0906129700010085", "0906145300010023"]

    def test_the_member_search_finds_both_codes(self, admin_client, moved):
        body = admin_client.get(f"{BASE}/members/", {"search": VENDOR}).json()
        assert sorted(row["member_code"] for row in body["results"]) == [
            "0906129700010085",
            "0906145300010023",
        ]
        assert body["results"][0]["sap_vendor_code"] == VENDOR


class TestHerHistory:
    def test_every_code_and_every_insemination_saying_which_code(self, admin_client, moved):
        old, new = moved
        before = inseminate(old, "OLD-1")
        after = inseminate(new, "NEW-1")

        body = admin_client.get(f"{BASE}/members/{new.member_code}/history/").json()

        assert body["sap_vendor_code"] == VENDOR
        codes = {row["member_code"]: row for row in body["codes"]}
        assert set(codes) == {old.member_code, new.member_code}
        assert codes[new.member_code]["current"] is True
        assert codes[old.member_code]["current"] is False
        assert codes[old.member_code]["mpp_code"] == "001315"
        assert codes[old.member_code]["ai_count"] == 1

        under = {row["id"]: row["member_code"] for row in body["events"]}
        assert under == {before.id: old.member_code, after.id: new.member_code}

    def test_from_the_old_code_too(self, admin_client, moved):
        old, new = moved
        inseminate(new, "NEW-1")
        body = admin_client.get(f"{BASE}/members/{old.member_code}/history/").json()
        assert [row["member_code"] for row in body["events"]] == [new.member_code]

    def test_a_member_with_no_vendor_has_only_her_own_code(self, admin_client, mpp):
        alone = MemberFactory(mpp=mpp, sap_vendor_code="")
        MemberFactory(mpp=mpp, sap_vendor_code="")
        body = admin_client.get(f"{BASE}/members/{alone.member_code}/history/").json()
        assert [row["member_code"] for row in body["codes"]] == [alone.member_code]

    def test_is_for_the_office_only(self, moved):
        from rest_framework.test import APIClient
        from rest_framework_simplejwt.tokens import RefreshToken

        from apps.accounts.models import Role

        _old, new = moved
        user = new.mpp.mait.user
        user.role = Role.MAIT
        user.save(update_fields=["role"])
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
        assert client.get(f"{BASE}/members/{new.member_code}/history/").status_code == 403


class TestOnTheEvent:
    """The AI events list row and detail page name her other code."""

    def test_an_event_under_her_old_code_names_the_new_one(self, admin_client, moved):
        old, new = moved
        new.activation_status = "Yes"
        new.save(update_fields=["activation_status"])
        event = inseminate(old, "OLD-1")

        row = admin_client.get(f"{BASE}/ai-events/").json()["results"][0]
        assert row["id"] == event.id
        assert row["other_member_codes"] == [
            {
                "member_code": new.member_code,
                "mpp_code": "001332",
                "mpp_name": new.mpp.mpp_name,
                "activation_status": "Yes",
                "current": True,
            }
        ]

        detail = admin_client.get(f"{BASE}/ai-events/{event.id}/").json()
        assert [row["member_code"] for row in detail["other_member_codes"]] == [new.member_code]

    def test_an_event_under_her_new_code_names_the_old_one(self, admin_client, moved):
        old, new = moved
        inseminate(new, "NEW-1")
        row = admin_client.get(f"{BASE}/ai-events/").json()["results"][0]
        assert [(r["member_code"], r["current"]) for r in row["other_member_codes"]] == [
            (old.member_code, False)
        ]

    def test_a_member_with_one_code_has_none(self, admin_client, mpp):
        inseminate(MemberFactory(mpp=mpp, sap_vendor_code="4000000999"), "ONLY-1")
        row = admin_client.get(f"{BASE}/ai-events/").json()["results"][0]
        assert row["other_member_codes"] == []

    def test_a_page_reads_them_in_one_query(self, admin_client, moved):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        old, new = moved
        for straw in range(5):
            inseminate(old, f"OLD-{straw}")
            inseminate(new, f"NEW-{straw}")
        with CaptureQueriesContext(connection) as queries:
            admin_client.get(f"{BASE}/ai-events/")
        # Ten rows, and their other codes looked up once for all of them.
        lookups = [q["sql"] for q in queries.captured_queries if "sap_vendor_code` IN" in q["sql"]]
        assert len(lookups) == 1


class TestTheWholeEvent:
    def test_the_export_carries_every_detail_safe_to_take_away(self, admin_client, moved):
        old, _new = moved
        old.mobile_no = "9876543210"
        old.father_husband_name = "RAM PRASAD"
        old.save(update_fields=["mobile_no", "father_husband_name"])
        inseminate(old, "0012345")

        header, row = sheet_rows(admin_client.get(f"{BASE}/reports/export/"))
        cell = dict(zip(header, row, strict=True))
        for column in (
            "AI done at",
            "Semen breed",
            "Doses",
            "Consumables",
            "Farmer check",
            "Proof photo",
            "Latitude",
            "Pregnancy outcome",
        ):
            assert column in header
        assert cell["Father / husband"] == "RAM PRASAD"
        assert cell["Doses"] == "1"
        assert cell["Proof photo"] == "None"
        # Masked: the file leaves the system.
        assert "9876543210" not in ",".join(row)
        assert cell["Farmer mobile"].endswith("3210")
