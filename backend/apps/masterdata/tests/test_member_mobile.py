"""
The office changing a member's mobile number, and the SAP master never taking it back.

Written from the operator's side, like `test_uploads_never_overwrite`: an Admin corrects the
number, somebody re-uploads the member master that still carries the old one, and the
correction is what is on file afterwards — with the upload report saying it kept it.

The number is where payment and verification OTPs go, so the rest is who may change it and
how a change can go wrong: only an Admin with the Members section, only within their zones,
never without a reason, never to a malformed number, and never over a colleague's change
they had not seen.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.base import ContentFile
from openpyxl import Workbook
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.core.models import AuditLog
from apps.masterdata import tasks
from apps.masterdata.member_mobile import AUDIT_ENTITY
from apps.masterdata.models import MPP, DataUploadLog, Member, Zone, ZonePlant
from apps.masterdata.phone import normalise_mobile
from conftest import MaitFactory

pytestmark = pytest.mark.django_db

HEADERS = ["Member Code", "Member Name", "MPP", "Mobile No"]


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def admin(username="office", sections=(PortalSection.MEMBERS,), role=Role.ADMIN) -> User:
    return User.objects.create_user(
        username=username,
        password="a-long-enough-password",
        full_name=username.title(),
        role=role,
        portal_sections=list(sections),
    )


@pytest.fixture
def mpp(db):
    return MPP.objects.create(mpp_code="001302", mpp_name="BAROLI", plant_code="1101")


@pytest.fixture
def anita(mpp):
    return Member.objects.create(
        mpp=mpp, member_code="MEM0001", member_name="ANITA DEVI", mobile_no="9876500001"
    )


def change(user, member, **body):
    return auth(user).post(
        f"/api/v1/members/{member.member_code}/mobile/",
        {"mobile_no": "9812345678", "reason": "She rang the office", **body},
        format="json",
    )


def member_upload(uploader, rows) -> DataUploadLog:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(HEADERS)
    for row in rows:
        sheet.append(row)
    stream = io.BytesIO()
    workbook.save(stream)
    upload = DataUploadLog.objects.create(
        upload_type=DataUploadLog.UploadType.MEMBER,
        file_name="members.xlsx",
        uploaded_by=uploader,
        status=DataUploadLog.Status.QUEUED,
    )
    upload.file.save("members.xlsx", ContentFile(stream.getvalue()), save=True)
    return upload


# --------------------------------------------------------------------------------------
# Changing it
# --------------------------------------------------------------------------------------
class TestAnAdminChangesTheNumber:
    def test_the_number_changes_and_is_marked_as_the_office_s(self, anita):
        office = admin()
        response = change(office, anita, expected_mobile="9876500001")

        assert response.status_code == 200, response.content
        body = response.json()["member"]
        assert body["mobile_no"] == "9812345678"
        assert body["mobile_source"] == "office"
        assert body["mobile_updated_by_name"] == "Office"
        anita.refresh_from_db()
        assert (anita.mobile_no, anita.mobile_source) == ("9812345678", "office")
        assert anita.mobile_updated_by == office
        assert anita.mobile_updated_at is not None

    def test_it_is_audited_with_both_numbers_masked_and_the_reason(self, anita):
        change(admin(), anita)

        entry = AuditLog.objects.get(entity_type=AUDIT_ENTITY, entity_id=str(anita.id))
        assert entry.action == AuditLog.Action.UPDATE
        assert entry.meta_json["reason"] == "She rang the office"
        # Masked: the log is read far more widely than the Members screen.
        assert entry.meta_json["before"].endswith("0001")
        assert "98765" not in entry.meta_json["before"]
        assert entry.meta_json["after"].endswith("5678")

    def test_the_history_reads_every_change_back_newest_first(self, anita):
        office = admin()
        change(office, anita, mobile_no="9812345678")
        change(office, anita, mobile_no="9812345699", reason="Wrong digit last time")

        rows = (
            auth(office)
            .get(f"/api/v1/members/{anita.member_code}/mobile-history/")
            .json()["results"]
        )
        assert [row["reason"] for row in rows] == ["Wrong digit last time", "She rang the office"]
        assert rows[0]["by"] == "Office"
        assert rows[0]["after"].endswith("5699")

    def test_a_number_typed_with_the_country_code_is_stored_as_ten_digits(self, anita):
        response = change(admin(), anita, mobile_no="+91 98123 45678")

        assert response.status_code == 200, response.content
        anita.refresh_from_db()
        assert anita.mobile_no == "9812345678"

    def test_another_member_on_the_number_is_a_warning_not_a_refusal(self, anita, mpp):
        # A household often shares one phone.
        Member.objects.create(
            mpp=mpp, member_code="MEM0002", member_name="SUNITA DEVI", mobile_no="9812345678"
        )
        response = change(admin(), anita)

        assert response.status_code == 200
        assert response.json()["shared_with"] == [
            {"member_code": "MEM0002", "member_name": "SUNITA DEVI"}
        ]


class TestFindingThem:
    def test_the_list_filters_to_the_numbers_the_office_set(self, anita, mpp):
        Member.objects.create(mpp=mpp, member_code="MEM0009", member_name="ASHA", mobile_no="")
        office = admin()
        change(office, anita)

        page = auth(office).get("/api/v1/members/", {"mobile_source": "office"}).json()
        assert [row["member_code"] for row in page["results"]] == ["MEM0001"]


class TestTheAadhaarColumn:
    def test_an_admin_sees_it_masked_to_the_last_four(self, anita):
        anita.aadhar_no = "123456789012"
        anita.save()

        row = auth(admin()).get("/api/v1/members/").json()["results"][0]

        assert row["aadhar_masked"] == "XXXXXXXX9012"
        assert "123456789012" not in str(row)

    def test_a_mait_is_not_sent_it_at_all(self, anita):
        mait = MaitFactory()
        anita.mpp.mait = mait
        anita.mpp.save()
        anita.aadhar_no = "123456789012"
        anita.save()

        rows = auth(mait.user).get("/api/v1/members/").json()["results"]

        assert rows and "aadhar_masked" not in rows[0]


class TestRevealingTheAadhaar:
    def reveal(self, user, member):
        return auth(user).get(f"/api/v1/members/{member.member_code}/aadhaar/")

    def test_an_admin_sees_the_whole_number_and_the_read_is_logged(self, anita):
        anita.aadhar_no = "123456789012"
        anita.save()
        office = admin()

        response = self.reveal(office, anita)

        assert response.status_code == 200
        assert response.json()["aadhar_no"] == "123456789012"
        assert response["Cache-Control"] == "no-store"
        entry = AuditLog.objects.get(action=AuditLog.Action.PII_ACCESS, entity_type="member")
        assert entry.actor == office
        assert entry.meta_json == {"aadhaar_viewed": True, "member_code": "MEM0001"}
        # The log keeps who looked, not the number itself.
        assert "123456789012" not in str(entry.meta_json)

    def test_a_member_with_no_aadhaar_says_so(self, anita):
        body = self.reveal(admin(), anita).json()

        assert (body["aadhar_no"], body["on_file"]) == ("", False)

    def test_a_mait_may_not(self, anita):
        mait = MaitFactory()
        anita.mpp.mait = mait
        anita.mpp.save()

        assert self.reveal(mait.user, anita).status_code == 403
        assert not AuditLog.objects.filter(action=AuditLog.Action.PII_ACCESS).exists()

    def test_an_admin_without_the_members_section_may_not(self, anita):
        assert self.reveal(admin(sections=(PortalSection.DASHBOARD,)), anita).status_code == 403

    def test_not_outside_the_admin_s_zones(self, anita):
        zone = Zone.objects.create(code="ELSEWHERE", name="Elsewhere")
        ZonePlant.objects.create(zone=zone, plant_code="9999", plant_name="ELSEWHERE BMC")
        zonal = admin("zonal")
        zonal.zones.add(zone)

        assert self.reveal(zonal, anita).status_code == 404


class TestWhatIsRefused:
    @pytest.mark.parametrize("bad", ["12345", "5812345678", "98123456789", "abcdefghij"])
    def test_a_malformed_number(self, anita, bad):
        response = change(admin(), anita, mobile_no=bad)

        assert response.status_code == 400
        anita.refresh_from_db()
        assert anita.mobile_no == "9876500001"

    def test_no_reason(self, anita):
        response = change(admin(), anita, reason="  ")

        assert response.status_code == 400
        assert not AuditLog.objects.filter(entity_type=AUDIT_ENTITY).exists()

    def test_the_number_already_on_file(self, anita):
        response = change(admin(), anita, mobile_no="9876500001")

        assert response.status_code == 400
        assert "already the number" in str(response.json())

    def test_a_change_made_over_one_the_admin_had_not_seen(self, anita):
        """Two admins on the same member: the second is told, not silently overwritten."""
        change(admin("first"), anita, expected_mobile="9876500001")

        response = change(
            admin("second"), anita, mobile_no="9800000001", expected_mobile="9876500001"
        )

        assert response.status_code == 409
        assert response.json()["type"].endswith("/mobile-changed")
        anita.refresh_from_db()
        assert anita.mobile_no == "9812345678"


class TestWhoMayChangeIt:
    def test_a_mait_may_not(self, anita):
        mait = MaitFactory()
        response = change(mait.user, anita)

        assert response.status_code == 403
        anita.refresh_from_db()
        assert anita.mobile_no == "9876500001"

    def test_an_admin_without_the_members_section_may_not(self, anita):
        response = change(admin(sections=(PortalSection.DASHBOARD,)), anita)

        assert response.status_code == 403

    def test_a_super_admin_may(self, anita):
        response = change(admin("root", sections=(), role=Role.SUPER_ADMIN), anita)

        assert response.status_code == 200, response.content

    def test_a_zonal_admin_cannot_reach_a_member_outside_their_zone(self, anita):
        zone = Zone.objects.create(code="ELSEWHERE", name="Elsewhere")
        ZonePlant.objects.create(zone=zone, plant_code="9999", plant_name="ELSEWHERE BMC")
        zonal = admin("zonal")
        zonal.zones.add(zone)

        response = change(zonal, anita)

        # Not a 403: whether a member exists in another zone is not this account's to learn.
        assert response.status_code == 404
        anita.refresh_from_db()
        assert anita.mobile_no == "9876500001"


# --------------------------------------------------------------------------------------
# And the SAP master does not take it back
# --------------------------------------------------------------------------------------
class TestAReUploadKeepsTheOfficesNumber:
    def test_the_office_number_survives_and_the_report_says_it_was_kept(self, anita, mpp):
        office = admin()
        change(office, anita)

        # Last month's export still carries the old number, and a genuinely new member.
        upload = member_upload(
            office,
            [
                ["MEM0001", "ANITA DEVI", "001302", "9876500001"],
                ["MEM0003", "KAMLA DEVI", "001302", "9876500003"],
            ],
        )
        tasks.process_master_upload(upload.id)
        upload.refresh_from_db()

        anita.refresh_from_db()
        assert (anita.mobile_no, anita.mobile_source) == ("9812345678", "office")
        assert upload.success_rows == 1
        assert upload.skipped_rows == 1
        assert upload.kept_rows == 1
        # The new member is added with SAP's number, marked as SAP's.
        kamla = Member.objects.get(member_code="MEM0003")
        assert (kamla.mobile_no, kamla.mobile_source) == ("9876500003", "sap")

    def test_a_file_that_agrees_with_the_office_counts_nothing_as_kept(self, anita):
        office = admin()
        change(office, anita)

        upload = member_upload(office, [["MEM0001", "ANITA DEVI", "001302", "9812345678"]])
        tasks.process_master_upload(upload.id)
        upload.refresh_from_db()

        assert upload.skipped_rows == 1
        assert upload.kept_rows == 0

    def test_an_sap_number_is_still_left_alone_on_a_re_upload(self, anita):
        """Insert-only for every member, as before — this feature only makes it explicit."""
        upload = member_upload(admin(), [["MEM0001", "ANITA DEVI", "001302", "9800000009"]])
        tasks.process_master_upload(upload.id)

        anita.refresh_from_db()
        assert (anita.mobile_no, anita.mobile_source) == ("9876500001", "sap")


class TestTheNumberRule:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("9876543210", "9876543210"),
            ("+91 98765 43210", "9876543210"),
            ("919876543210", "9876543210"),
            ("98765-43210", "9876543210"),
            ("5876543210", ""),
            ("98765", ""),
            (None, ""),
        ],
    )
    def test_one_rule_for_the_importer_and_the_office(self, raw, expected):
        assert normalise_mobile(raw) == expected
