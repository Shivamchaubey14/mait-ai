"""
API tests for the master-data endpoints (SRS §9.2, §9.3).

The scoping and masking cases are the ones that matter: a Mait seeing another Mait's members,
or an Aadhaar number leaving the API in the clear, are the failures with real consequences.
"""

from __future__ import annotations

import io
import json

import pytest
from django.db import connection
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.masterdata.models import DataUploadLog, Member, NonMember

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


def auth(api_client, user):
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api_client


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


@pytest.fixture
def admin_user(db):
    return User.objects.create_user(
        username="admin1", password="pw-for-tests-only", full_name="Admin", role=Role.ADMIN
    )


@pytest.fixture
def mait_user(db, mait):
    user = User.objects.create_user(username="mait1", full_name=mait.name, role=Role.MAIT)
    mait.user = user
    mait.save(update_fields=["user"])
    return user


class TestAuthentication:
    def test_anonymous_is_rejected(self, api_client):
        response = api_client.get(f"{BASE}/members/")
        assert response.status_code == 401

    def test_error_uses_problem_details(self, api_client):
        """Every error shares one shape so clients parse a single format (SRS §9.11)."""
        body = api_client.get(f"{BASE}/members/").json()
        assert body["status"] == 401
        assert body["type"].endswith("authentication-required")
        assert "title" in body and "detail" in body

    def test_health_stays_public(self, api_client):
        assert api_client.get(f"{BASE}/health/").status_code == 200


class TestMaitScoping:
    """SRS §6.2.3 — a Mait's app shows only their own MPPs and members."""

    def test_mait_sees_only_assigned_mpps(self, api_client, mait_user, mpp, member):
        from apps.masterdata.models import MPP, Mait

        other_mait = Mait.objects.create(sahayak_vendor_code="SAH999999", name="Other")
        MPP.objects.create(mpp_code="MPP999999", mpp_name="Elsewhere", mait=other_mait)

        response = auth(api_client, mait_user).get(f"{BASE}/mpp/")
        codes = [row["mpp_code"] for row in response.json()["results"]]

        assert response.status_code == 200
        assert codes == [mpp.mpp_code]
        assert "MPP999999" not in codes

    def test_mait_cannot_see_another_maits_members(self, api_client, mait_user, member):
        from apps.masterdata.models import MPP, Mait

        stranger = Mait.objects.create(sahayak_vendor_code="SAH888888", name="Stranger")
        other_mpp = MPP.objects.create(mpp_code="MPP888888", mpp_name="Far", mait=stranger)
        Member.objects.create(member_code="MEM888888", member_name="Not Yours", mpp=other_mpp)

        response = auth(api_client, mait_user).get(f"{BASE}/members/")
        codes = [row["member_code"] for row in response.json()["results"]]

        assert "MEM888888" not in codes
        assert member.member_code in codes

    def test_mait_cannot_reach_admin_uploads(self, api_client, mait_user):
        response = auth(api_client, mait_user).get(f"{BASE}/admin/uploads/")
        assert response.status_code == 403

    def test_admin_sees_everything(self, api_client, admin_user, mpp, member):
        response = auth(api_client, admin_user).get(f"{BASE}/members/")
        assert response.status_code == 200
        assert response.json()["count"] == Member.objects.count()


class TestPIIMasking:
    """SRS §16 — PII is masked in every standard response."""

    def test_member_aadhaar_is_masked(self, api_client, admin_user, member):
        member.aadhar_no = "514389489509"
        member.save(update_fields=["aadhar_no"])

        body = auth(api_client, admin_user).get(f"{BASE}/members/{member.member_code}/").json()

        assert body["aadhar_no"] == "XXXXXXXX9509"
        assert "514389489509" not in str(body)

    def test_mait_bank_details_are_masked(self, api_client, admin_user, mpp, mait):
        mait.bank_account_no = "14340100024381"
        mait.aadhar_no = "650719330383"
        mait.save(update_fields=["bank_account_no", "aadhar_no"])

        body = auth(api_client, admin_user).get(f"{BASE}/mpp/{mpp.mpp_code}/").json()

        assert body["mait"]["bank_account_no"].endswith("4381")
        assert "14340100024381" not in str(body)
        assert "650719330383" not in str(body)


class TestMemberAnimals:
    """
    Step 3 of the capture flow picks from the farmer's existing animals (SRS §6.3).

    They ride along on the member detail rather than a second call: the Mait is standing in
    a yard with one bar of signal, and two round trips to render one screen is one too many.
    """

    def test_detail_carries_the_members_animals(self, api_client, admin_user, member, animal):
        body = auth(api_client, admin_user).get(f"{BASE}/members/{member.member_code}/").json()

        assert [row["id"] for row in body["animals"]] == [animal.id]
        assert body["animals"][0]["breed"] == animal.breed

    def test_the_search_list_does_not_carry_them(self, api_client, admin_user, member, animal):
        """105k rows: prefetching animals for a page of search results buys nothing."""
        body = auth(api_client, admin_user).get(f"{BASE}/members/").json()
        assert "animals" not in body["results"][0]


class TestOTPReachability:
    """
    Surfaces whether a record can actually complete a payment (docs/DATA_FINDINGS.md).

    1.5% of real members have an unusable mobile number. The app checks before starting the
    flow rather than stranding a Mait mid-event with a consumed straw.
    """

    def test_flags_a_member_with_no_mobile(self, api_client, admin_user, member):
        member.mobile_no = ""
        member.save(update_fields=["mobile_no"])
        body = auth(api_client, admin_user).get(f"{BASE}/members/{member.member_code}/").json()
        assert body["can_receive_otp"] is False

    def test_flags_a_member_with_a_mobile(self, api_client, admin_user, member):
        body = auth(api_client, admin_user).get(f"{BASE}/members/{member.member_code}/").json()
        assert body["can_receive_otp"] is True


class TestSearchAndFilter:
    def test_search_matches_member_name(self, api_client, admin_user, member):
        member.member_name = "REETA DEVI"
        member.save(update_fields=["member_name"])

        response = auth(api_client, admin_user).get(f"{BASE}/members/?search=REETA")
        assert [r["member_code"] for r in response.json()["results"]] == [member.member_code]

    def test_filter_by_mpp_code(self, api_client, admin_user, member, mpp):
        response = auth(api_client, admin_user).get(f"{BASE}/members/?mpp__mpp_code={mpp.mpp_code}")
        assert response.json()["count"] == 1

    def test_list_uses_the_standard_envelope(self, api_client, admin_user, member):
        body = auth(api_client, admin_user).get(f"{BASE}/members/").json()
        assert set(body) >= {"count", "next", "previous", "results"}


class TestUploadValidation:
    """SRS §6.1 — bad files are rejected before anything is queued."""

    def _upload(self, client, name: str, content: bytes = b"x" * 100):
        return client.post(
            f"{BASE}/admin/uploads/members/",
            {"file": io.BytesIO(content) if content else io.BytesIO(b"")},
            format="multipart",
        )

    def test_rejects_a_non_xlsx_file(self, api_client, admin_user):
        client = auth(api_client, admin_user)
        upload = io.BytesIO(b"not a spreadsheet")
        upload.name = "members.csv"
        response = client.post(
            f"{BASE}/admin/uploads/members/", {"file": upload}, format="multipart"
        )
        assert response.status_code == 400
        assert "xlsx" in str(response.json()).lower()
        assert not DataUploadLog.objects.exists(), "nothing should be queued for a bad file"

    def test_rejects_an_empty_file(self, api_client, admin_user):
        client = auth(api_client, admin_user)
        upload = io.BytesIO(b"")
        upload.name = "members.xlsx"
        response = client.post(
            f"{BASE}/admin/uploads/members/", {"file": upload}, format="multipart"
        )
        assert response.status_code == 400
        assert not DataUploadLog.objects.exists()

    def test_upload_history_is_admin_only(self, api_client, mait_user):
        assert auth(api_client, mait_user).get(f"{BASE}/admin/uploads/").status_code == 403


class TestNonMemberRegistration:
    """SRS §6.3 step 2 — quick capture in the field."""

    def test_mait_registers_a_non_member(self, api_client, mait_user, mpp):
        response = auth(api_client, mait_user).post(
            f"{BASE}/non-members/",
            {
                "name": "Ramesh",
                "mobile_no": "9876543210",
                "mpp": mpp.id,
                "address": "Village",
                "aadhar_no": "111122223333",
            },
            format="json",
        )
        assert response.status_code == 201, response.json()
        assert response.json()["created_by_mait"] == mait_user.mait_profile.id

    def test_rejects_an_invalid_mobile(self, api_client, mait_user, mpp):
        """The number is the only OTP channel, so a bad one must not be stored."""
        response = auth(api_client, mait_user).post(
            f"{BASE}/non-members/",
            {"name": "Ramesh", "mobile_no": "12345", "mpp": mpp.id, "aadhar_no": "111122223333"},
            format="json",
        )
        assert response.status_code == 400
        assert "mobile_no" in response.json()["errors"]

    def test_admin_cannot_register_a_non_member(self, api_client, admin_user, mpp):
        """Registration happens in the field, by the Mait who met the farmer."""
        response = auth(api_client, admin_user).post(
            f"{BASE}/non-members/",
            {
                "name": "Ramesh",
                "mobile_no": "9876543210",
                "mpp": mpp.id,
                "aadhar_no": "111122223333",
            },
            format="json",
        )
        assert response.status_code == 403

    def test_aadhaar_is_stored_encrypted_and_never_returned(self, api_client, mait_user, mpp):
        """
        SRS §16 — the number goes up once and only ever comes back masked.

        A handset in a field is the last place twelve unmasked digits belong, so the write
        field and the read field are deliberately different fields.
        """
        response = auth(api_client, mait_user).post(
            f"{BASE}/non-members/",
            {
                "name": "Radha Singh",
                "father_husband_name": "Mohan Singh",
                "mobile_no": "9876543210",
                "mpp": mpp.id,
                "aadhar_no": "123456789012",
            },
            format="json",
        )
        assert response.status_code == 201, response.json()

        body = response.json()
        assert "123456789012" not in json.dumps(body)
        assert body["masked_aadhar"].endswith("9012")
        assert body["father_husband_name"] == "Mohan Singh"

        stored = NonMember.objects.get(pk=body["id"])
        assert stored.aadhar_no == "123456789012"

        # Encrypted at rest, checked against the column itself rather than through the ORM —
        # the field decrypts on read, so going through the model would pass either way.
        with connection.cursor() as cursor:
            cursor.execute("SELECT aadhar_no FROM non_member WHERE id = %s", [stored.pk])
            row = cursor.fetchone()
        assert row is not None
        assert "123456789012" not in str(row[0])

    def test_a_half_typed_aadhaar_is_refused(self, api_client, mait_user, mpp):
        """Six digits identify nobody, and cannot be corrected without asking her again."""
        response = auth(api_client, mait_user).post(
            f"{BASE}/non-members/",
            {"name": "Radha", "mobile_no": "9876543210", "mpp": mpp.id, "aadhar_no": "123456"},
            format="json",
        )
        assert response.status_code == 400
        assert "aadhar_no" in response.json()["errors"]

    def test_aadhaar_is_required(self, api_client, mait_user, mpp):
        """It is the only thing proving this farmer is not already on the roll."""
        response = auth(api_client, mait_user).post(
            f"{BASE}/non-members/",
            {"name": "Radha", "mobile_no": "9876543211", "mpp": mpp.id},
            format="json",
        )
        assert response.status_code == 400
        assert "aadhar_no" in response.json()["errors"]

    def test_a_member_cannot_be_registered_as_a_non_member(self, api_client, mait_user, mpp):
        """
        The fraud this whole check exists for.

        A member recorded as a non-member is a farmer the Mait can take cash from for a
        service the dairy has already paid for out of her milk cheque. She has no reason to
        query it — she was asked for money and she paid.
        """
        member = Member.objects.create(
            mpp=mpp,
            member_code="M-9001",
            member_name="Radha Singh",
            mobile_no="9876500001",
            aadhar_no="123456789012",
        )

        response = auth(api_client, mait_user).post(
            f"{BASE}/non-members/",
            {
                "name": "Radha S",
                "mobile_no": "9876543210",
                "mpp": mpp.id,
                "aadhar_no": "1234 5678 9012",
            },
            format="json",
        )

        assert response.status_code == 400
        message = " ".join(response.json()["errors"]["aadhar_no"])
        # Named, because the Mait's next move is to find her in the roster — "this Aadhaar is
        # registered" would leave them guessing at which farmer.
        assert member.member_name in message
        assert member.member_code in message
        assert not NonMember.objects.filter(mobile_no="9876543210").exists()

    def test_the_check_reads_the_fingerprint_not_the_number(self, api_client, mait_user, mpp):
        """
        Ciphertext differs per row, so an equality match on the encrypted column finds nothing
        and the check silently passes everything. The hash column is what makes it work, and
        the importer fills it through `save()` — this is the assertion that it did.
        """
        member = Member.objects.create(
            mpp=mpp,
            member_code="M-9002",
            member_name="Sita Devi",
            mobile_no="9876500002",
            aadhar_no="999988887777",
        )
        assert member.aadhar_hash != ""
        assert "999988887777" not in member.aadhar_hash
        assert Member.objects.filter(aadhar_no="999988887777").first() is None
