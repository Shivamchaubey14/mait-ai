"""
A Sahayak is not a Mait (SRS §18.2, settled 2026-08-07).

``Sahyak.xlsx`` carries an MPP and the Sahayak who staffs it on one row. The importer used to
turn that column into a ``Mait``, which produced one pseudo-Mait per village — 3,110 of them,
each "covering" the single MPP they came from — while the 58 real Maits from the ZMAI vendor
export had no coverage at all.

A Sahayak runs one collection point and takes the milk in. A Mait is the AI technician who
covers many. These tests hold the two apart.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command

from apps.accounts.models import Role, User
from apps.masterdata.models import MPP, Mait
from apps.masterdata.tasks import _upsert_mpp_and_sahayak

pytestmark = pytest.mark.django_db


def sahayak_row(mpp_code="001302", vendor="5500000054", name="ROHIT KUMAR", mobile="9876543210"):
    """One row of Sahyak.xlsx, in the normalised shape the importer receives."""
    return {
        "mpp code": mpp_code,
        "mppname": "BAROLI",
        "district code": "048",
        "sahayak vendor": vendor,
        "sahayak name": name,
        "mobile no__2": mobile,
        "active": "X",
    }


class TestTheMasterMakesNoMaits:
    def test_importing_the_mpp_master_creates_no_mait(self, db):
        _upsert_mpp_and_sahayak(sahayak_row(), None)

        # The whole point. One row per village used to mean one Mait per village.
        assert not Mait.objects.exists()
        assert MPP.objects.filter(mpp_code="001302").exists()

    def test_the_sahayak_is_kept_as_the_mpp_contact(self, db):
        _upsert_mpp_and_sahayak(sahayak_row(), None)

        mpp = MPP.objects.get(mpp_code="001302")
        # Not discarded — they are the person at the collection point, and somebody has to be
        # able to ring them.
        assert mpp.sahayak_name == "ROHIT KUMAR"
        assert mpp.sahayak_vendor_code == "5500000054"
        assert mpp.sahayak_mobile_no == "9876543210"

    def test_a_master_refresh_leaves_coverage_alone(self, db, mait):
        _upsert_mpp_and_sahayak(sahayak_row(), None)
        mpp = MPP.objects.get(mpp_code="001302")
        mpp.mait = mait
        mpp.save(update_fields=["mait"])

        _upsert_mpp_and_sahayak(sahayak_row(name="SOMEONE ELSE"), None)

        # Coverage comes from the assignment sheet now. A master upload that silently
        # reassigned every MPP would undo a season's work in one click.
        mpp.refresh_from_db()
        assert mpp.mait_id == mait.id
        assert mpp.sahayak_name == "SOMEONE ELSE"

    def test_the_mpp_still_refreshes(self, db):
        _upsert_mpp_and_sahayak(sahayak_row(), None)

        _upsert_mpp_and_sahayak({**sahayak_row(), "mppname": "BAROLI EAST"}, None)

        assert MPP.objects.get(mpp_code="001302").mpp_name == "BAROLI EAST"

    def test_a_blank_mpp_code_is_still_refused(self, db):
        with pytest.raises(ValueError, match="blank"):
            _upsert_mpp_and_sahayak(sahayak_row(mpp_code=""), None)


class TestRetiring:
    """
    The clean-up for what the old behaviour left behind.

    Deactivation, never deletion: inventory, indents and AI events all point at these rows,
    and a Mait that vanishes takes the readability of that history with it.
    """

    def _sahayak_mait(self, code="5500000001", name="PSEUDO", with_mpp=True):
        mait = Mait.objects.create(sahayak_vendor_code=code, name=name, is_active=True)
        if with_mpp:
            MPP.objects.create(mpp_code=f"9{code[-5:]}", mpp_name="V", mait=mait)
        return mait

    def test_a_dry_run_changes_nothing(self, db):
        mait = self._sahayak_mait()

        call_command("retire_sahayak_maits")

        mait.refresh_from_db()
        assert mait.is_active is True
        assert mait.mpps.count() == 1

    def test_applying_deactivates_and_unassigns(self, db):
        mait = self._sahayak_mait()

        call_command("retire_sahayak_maits", "--apply")

        mait.refresh_from_db()
        assert mait.is_active is False
        assert mait.mpps.count() == 0
        # Still there to be read from an old AI event.
        assert Mait.objects.filter(pk=mait.pk).exists()

    def test_a_mait_with_a_login_is_left_alone(self, db):
        mait = self._sahayak_mait(code="5500000054", name="ROHIT KUMAR")
        mait.user = User.objects.create_user(username="rohit", full_name=mait.name, role=Role.MAIT)
        mait.save(update_fields=["user"])

        call_command("retire_sahayak_maits", "--apply")

        # Whatever their vendor code says, somebody is signing in as them. Deactivating that
        # locks a working field agent out mid-round.
        mait.refresh_from_db()
        assert mait.is_active is True
        assert mait.mpps.count() == 1

    def test_the_real_maits_are_untouched(self, db):
        real = Mait.objects.create(
            sahayak_vendor_code="9900000000", name="Mahandra Pratappal", is_active=True
        )
        covered = MPP.objects.create(mpp_code="001302", mpp_name="BAROLI", mait=real)

        call_command("retire_sahayak_maits", "--apply")

        real.refresh_from_db()
        covered.refresh_from_db()
        assert real.is_active is True
        assert covered.mait_id == real.id

    def test_running_it_twice_is_harmless(self, db):
        self._sahayak_mait()

        call_command("retire_sahayak_maits", "--apply")
        call_command("retire_sahayak_maits", "--apply")

        assert Mait.objects.filter(is_active=True).count() == 0


class TestTheRoster:
    """
    What the Maits screen counts.

    The banner reports the activation backlog. Counting 3,108 retired rows turns a roster of
    sixty-three into one of thousands and reports work nobody is ever going to do.
    """

    BASE = "/api/v1/admin/users/maits/"

    @pytest.fixture
    def admin_client(self, db):
        from rest_framework.test import APIClient
        from rest_framework_simplejwt.tokens import RefreshToken

        admin = User.objects.create_user(
            username="admin-roster",
            password="a-long-enough-password",
            full_name="Admin",
            role=Role.ADMIN,
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
        return client

    def _roster(self):
        Mait.objects.create(sahayak_vendor_code="9900000000", name="REAL MAIT", is_active=True)
        Mait.objects.create(sahayak_vendor_code="5500000001", name="RETIRED", is_active=False)

    def test_retired_records_are_left_out(self, admin_client):
        self._roster()

        body = admin_client.get(self.BASE).json()

        assert [row["name"] for row in body["results"]] == ["REAL MAIT"]
        assert body["summary"]["total"] == 1

    def test_the_banner_counts_what_the_table_shows(self, admin_client):
        self._roster()

        body = admin_client.get(self.BASE).json()

        # A backlog of 2,886 against a roster of 63 is the number that sent someone looking.
        assert body["summary"]["without_mobile"] == 1
        assert body["summary"]["total"] == body["count"]

    def test_they_can_still_be_asked_for(self, admin_client):
        self._roster()

        body = admin_client.get(self.BASE, {"include_retired": "true"}).json()

        # Kept, not deleted: an old AI event still has to name somebody.
        assert sorted(row["name"] for row in body["results"]) == ["REAL MAIT", "RETIRED"]
        assert body["summary"]["total"] == 2
