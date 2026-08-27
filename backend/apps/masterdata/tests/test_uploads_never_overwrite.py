"""
A master upload inserts. It never overwrites (SRS §6.1.4).

SAP is where a record is born, not the authority on it forever afterwards. By the time a
master is re-uploaded the office has corrected mobile numbers over the phone, fixed spellings
on the Maits screen and moved coverage on Assignment — and an upsert would silently undo all
of it while the file reported a clean import.

These tests are written from the operator's side: make a correction, re-upload the file that
contradicts it, and check the correction survived.
"""

from __future__ import annotations

import pytest

from apps.masterdata.models import MPP, Mait, Member
from apps.masterdata.tasks import (
    CREATED,
    SKIPPED,
    ImportContext,
    _insert_member,
    _insert_mpp_and_sahayak,
    _insert_vendor,
)

pytestmark = pytest.mark.django_db


def context(upload_type: str) -> ImportContext:
    ctx = ImportContext(upload_type)
    if upload_type == "member":
        ctx.load_mpp_map()
    ctx.load_existing_keys()
    return ctx


def vendor_row(code="9900000001", name="MAHENDRA", mobile="9876543210", **extra):
    """One row of the vendor export, under headers `columns.VENDOR` actually recognises."""
    return {
        "vendor": code,
        "vendor name": name,
        "contact number": mobile,
        **extra,
    }


def mpp_row(mpp_code="001302", name="BAROLI", sahayak="ROHIT KUMAR"):
    return {
        "mpp code": mpp_code,
        "mppname": name,
        "district code": "048",
        "sahayak vendor": "5500000054",
        "sahayak name": sahayak,
        "mobile no__2": "9876543210",
        "active": "X",
    }


def member_row(code="MEM0001", mpp_code="001302", name="ANITA DEVI", mobile="9876500001"):
    return {
        "member code": code,
        "mpp code": mpp_code,
        "member name": name,
        "mobile no": mobile,
    }


class TestTheMaitRoster:
    """The strongest case: this number is the only way into the app."""

    def test_a_corrected_mobile_survives_a_re_upload(self, db):
        _insert_vendor(vendor_row(mobile="9876543210"), context("mait"))

        # The office rings the Sahayak and fixes the number on the Maits screen.
        mait = Mait.objects.get(sahayak_vendor_code="9900000001")
        assert mait.mobile_no == "9876543210", "the file's own value never landed"
        mait.mobile_no = "9812345678"
        mait.save(update_fields=["mobile_no"])

        outcome = _insert_vendor(vendor_row(mobile="9876543210"), context("mait"))

        mait.refresh_from_db()
        assert outcome == SKIPPED
        assert mait.mobile_no == "9812345678"

    def test_a_corrected_name_survives_a_re_upload(self, db):
        _insert_vendor(vendor_row(name="MAHENDRA"), context("mait"))
        assert Mait.objects.get(sahayak_vendor_code="9900000001").name == "MAHENDRA"
        Mait.objects.filter(sahayak_vendor_code="9900000001").update(name="Mahendra Pratappal")

        _insert_vendor(vendor_row(name="MAHENDRA"), context("mait"))

        assert Mait.objects.get(sahayak_vendor_code="9900000001").name == "Mahendra Pratappal"

    def test_a_deactivated_mait_is_not_quietly_reactivated(self, db):
        """
        Retiring a record is a decision somebody made on a screen.

        The old importer set `is_active=True` on every row it touched, so the next upload of
        the same export brought every retired Sahayak back onto the roster.
        """
        _insert_vendor(vendor_row(), context("mait"))
        Mait.objects.filter(sahayak_vendor_code="9900000001").update(is_active=False)

        _insert_vendor(vendor_row(), context("mait"))

        assert Mait.objects.get(sahayak_vendor_code="9900000001").is_active is False

    def test_a_genuinely_new_vendor_is_still_added(self, db):
        _insert_vendor(vendor_row(code="9900000001"), context("mait"))

        outcome = _insert_vendor(vendor_row(code="9900000002", name="SURESH"), context("mait"))

        assert outcome == CREATED
        assert Mait.objects.count() == 2


class TestCollectionPoints:
    def test_an_existing_mpp_is_left_exactly_as_it_was(self, db):
        _insert_mpp_and_sahayak(mpp_row(name="BAROLI"), context("mpp"))

        outcome = _insert_mpp_and_sahayak(
            mpp_row(name="BAROLI EAST", sahayak="SOMEONE ELSE"), context("mpp")
        )

        mpp = MPP.objects.get(mpp_code="001302")
        assert outcome == SKIPPED
        assert mpp.mpp_name == "BAROLI"
        assert mpp.sahayak_name == "ROHIT KUMAR"

    def test_a_new_collection_point_is_added(self, db):
        _insert_mpp_and_sahayak(mpp_row(mpp_code="001302"), context("mpp"))

        outcome = _insert_mpp_and_sahayak(mpp_row(mpp_code="001308"), context("mpp"))

        assert outcome == CREATED
        assert MPP.objects.count() == 2


class TestMembers:
    @pytest.fixture
    def collection_point(self, db):
        return MPP.objects.create(mpp_code="001302", mpp_name="BAROLI", district_code="048")

    def test_an_existing_member_is_not_rewritten(self, collection_point):
        _insert_member(member_row(name="ANITA DEVI"), context("member"))
        Member.objects.filter(member_code="MEM0001").update(mobile_no="9812345678")

        outcome = _insert_member(
            member_row(name="ANITA D.", mobile="9876500001"), context("member")
        )

        member = Member.objects.get(member_code="MEM0001")
        assert outcome == SKIPPED
        assert member.member_name == "ANITA DEVI"
        assert member.mobile_no == "9812345678"

    def test_a_new_member_is_added(self, collection_point):
        _insert_member(member_row(code="MEM0001"), context("member"))

        outcome = _insert_member(member_row(code="MEM0002", name="RUBI"), context("member"))

        assert outcome == CREATED
        assert Member.objects.count() == 2

    def test_a_broken_file_is_still_reported_on_a_re_upload(self, collection_point):
        """
        The collection point is resolved before the skip is decided.

        Otherwise a re-upload of a file naming an MPP that does not exist would report a clean
        run — every row skipped — and nobody would find out the file was wrong.
        """
        _insert_member(member_row(code="MEM0001"), context("member"))

        with pytest.raises(ValueError, match="not found"):
            _insert_member(member_row(code="MEM0001", mpp_code="999999"), context("member"))


class TestConcurrency:
    """
    The key set is a snapshot. What it cannot see is caught by the unique constraint.

    This is the case that matters when a master is uploaded in the middle of a working day:
    a record created after the run began — an admin activating a Mait, a second import — must
    read as "already on record", not as a crash and not as a failed row.
    """

    def test_a_record_created_after_the_run_began_is_skipped_not_failed(self, db):
        ctx = context("mait")  # snapshot taken here: empty

        Mait.objects.create(sahayak_vendor_code="9900000001", name="ARRIVED MEANWHILE")

        outcome = _insert_vendor(vendor_row(code="9900000001", name="FROM THE FILE"), ctx)

        assert outcome == SKIPPED
        assert Mait.objects.get(sahayak_vendor_code="9900000001").name == "ARRIVED MEANWHILE"

    def test_the_row_it_lost_the_race_to_is_left_intact(self, db):
        ctx = context("member")
        MPP.objects.create(mpp_code="001302", mpp_name="BAROLI", district_code="048")
        ctx.load_mpp_map()
        Member.objects.create(
            member_code="MEM0001", mpp=MPP.objects.get(mpp_code="001302"), member_name="THEIRS"
        )

        outcome = _insert_member(member_row(code="MEM0001", name="MINE"), ctx)

        assert outcome == SKIPPED
        assert Member.objects.get(member_code="MEM0001").member_name == "THEIRS"
