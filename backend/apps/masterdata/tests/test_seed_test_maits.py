"""
The test-login seeder (`seed_test_maits`).

Development tooling, tested for the same reason the stock seeder is: it is the only thing that
mints a field login without a Sahayak behind it, and that is a rule worth being deliberate
about breaking. The properties held here are the ones that keep the exception contained — the
guard that stops it running anywhere OTP is real, the prefix that marks what it made, and the
fact that it goes through the real activation rather than writing a User row itself.

The MPP case is the one with teeth. A seeder that grabbed any collection point would quietly
take one — and every member at it — off a Mait who was already covering it. The bank details
are the second: a tester's inseminations are real and reach the Mait payment report as real
rows, so the accounts need details to be payable — and inventing them for a Mait the dairy has
an actual record of is the one thing that must never happen.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import Role, User
from apps.masterdata.management.commands.seed_test_maits import (
    TEST_IFSC,
    minted_bank_details,
)
from apps.masterdata.models import Mait
from conftest import MPPFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def dev_otp(settings):
    """
    The test settings ship with the fixed OTP off, the same as production.

    That is correct — it is what makes `TestItStaysOutOfProduction` meaningful — but it also
    means the command's own guard fires in every other test here, so the development
    conditions are put back for the cases that are about what it does rather than where it
    will run.
    """
    settings.DEV_FIXED_OTP_NUMBERS = ["*"]
    settings.DEV_FIXED_OTP_CODE = "123456"


@pytest.fixture
def spare_mpps(db):
    """Unassigned collection points for the command to draw on."""
    return [MPPFactory(mait=None) for _ in range(6)]


class TestTheLoginsItMakes:
    def test_it_creates_a_mait_with_a_login(self, spare_mpps):
        call_command("seed_test_maits", numbers="9000000001:Radha", mpps=1, verbosity=0)

        mait = Mait.objects.get(mobile_no="9000000001")
        assert mait.name == "Radha"
        assert mait.user is not None
        assert mait.user.role == Role.MAIT

    def test_the_account_has_no_usable_password(self, spare_mpps):
        """OTP stays the only way into a field login, seeded or not."""
        call_command("seed_test_maits", numbers="9000000001", mpps=1, verbosity=0)

        assert not Mait.objects.get(mobile_no="9000000001").user.has_usable_password()

    def test_minted_codes_are_marked_as_made_up(self, spare_mpps):
        """
        The prefix is the whole safety story. It is outside every range the real roster uses,
        so the Maits screen says at a glance which rows were invented for a test.
        """
        call_command("seed_test_maits", numbers="9000000001,9000000002", mpps=1, verbosity=0)

        codes = list(
            Mait.objects.filter(mobile_no__startswith="90000000").values_list(
                "sahayak_vendor_code", flat=True
            )
        )
        assert all(code.startswith("559000") for code in codes), codes

    def test_a_missing_name_gets_a_placeholder_rather_than_a_blank(self, spare_mpps):
        call_command("seed_test_maits", numbers="9000000001", mpps=1, verbosity=0)

        assert Mait.objects.get(mobile_no="9000000001").name.strip() != ""

    def test_a_number_already_in_use_is_skipped_not_duplicated(self, spare_mpps):
        call_command("seed_test_maits", numbers="9000000001", mpps=1, verbosity=0)
        call_command("seed_test_maits", numbers="9000000001", mpps=1, verbosity=0)

        # Two Maits on one number would make the login OTP ambiguous — whoever asked first
        # would get a code that signs in as the wrong person.
        assert Mait.objects.filter(mobile_no="9000000001").count() == 1


class TestItTakesNothingFromAnybody:
    def test_it_only_uses_unassigned_collection_points(self, spare_mpps):
        covered = MPPFactory(
            mait=Mait.objects.create(
                sahayak_vendor_code="5500000099", name="WORKING MAIT", mobile_no="9111111111"
            )
        )

        call_command("seed_test_maits", numbers="9000000001", mpps=2, verbosity=0)

        covered.refresh_from_db()
        assert covered.mait.sahayak_vendor_code == "5500000099"

    def test_it_refuses_rather_than_half_finishing(self, db):
        """Not enough spare MPPs is a reason to stop, not to hand out some of what was asked."""
        MPPFactory(mait=None)

        with pytest.raises(CommandError, match="unassigned MPP"):
            call_command("seed_test_maits", numbers="9000000001,9000000002", mpps=2, verbosity=0)

        assert not Mait.objects.filter(mobile_no="9000000001").exists()

    def test_zero_mpps_is_allowed(self, db):
        call_command("seed_test_maits", numbers="9000000001", mpps=0, verbosity=0)

        mait = Mait.objects.get(mobile_no="9000000001")
        assert mait.mpps.count() == 0


class TestItStaysOutOfProduction:
    def test_it_refuses_where_the_fixed_otp_is_off(self, db, settings):
        """
        The guard. Production refuses to boot with the fixed OTP set, so an environment where
        this runs is one where OTP is already not secured — and where it is secured, these
        accounts would be logins nobody could ever sign in to.
        """
        settings.DEV_FIXED_OTP_NUMBERS = []

        with pytest.raises(CommandError, match="not a development environment"):
            call_command("seed_test_maits", numbers="9000000001", verbosity=0)

        assert not Mait.objects.filter(mobile_no="9000000001").exists()


def test_it_asks_for_numbers_rather_than_doing_nothing(db):
    with pytest.raises(CommandError, match="Give me some numbers"):
        call_command("seed_test_maits", verbosity=0)


def test_numbers_can_come_from_a_file(db, tmp_path):
    listing = tmp_path / "numbers.txt"
    listing.write_text("# testers\n9000000001:Radha\n\n9000000002\n", encoding="utf-8")

    call_command("seed_test_maits", file=str(listing), mpps=0, verbosity=0)

    assert Mait.objects.get(mobile_no="9000000001").name == "Radha"
    assert Mait.objects.filter(mobile_no="9000000002").exists()
    assert User.objects.filter(mobile_no="9000000002").exists()


# --------------------------------------------------------------------------------------
# The minted bank details
# --------------------------------------------------------------------------------------
class TestTheBankDetailsItMints:
    """
    Shaped like the real thing, and unmistakably not it.

    The payment report writes these into a workbook somebody may hand to a bank, so the shape
    has to be right — a malformed PAN would be caught by whatever reads the file rather than
    by anybody here — and every one of them says TEST so no row can be taken for a real payee.
    """

    def test_details_are_the_right_shape_and_obviously_invented(self):
        details = minted_bank_details("5590000007")

        # Five letters, four digits, a letter.
        assert details["pan_no"] == "TESTM0007T"
        assert len(details["pan_no"]) == 10
        # Four letters, a zero, six more — the shape a bank parses, naming a bank that is not
        # one, so a payment built from these fails at the bank rather than reaching an account.
        assert details["ifsc_code"] == TEST_IFSC
        assert len(TEST_IFSC) == 11 and TEST_IFSC[4] == "0"
        assert all("TEST" in value for value in details.values())

    def test_the_same_tester_gets_the_same_details_every_run(self):
        """A report downloaded twice must not appear to have changed somebody's account."""
        assert minted_bank_details("5590000003") == minted_bank_details("5590000003")
        assert minted_bank_details("5590000003") != minted_bank_details("5590000004")

    def test_a_new_account_arrives_with_them(self):
        call_command("seed_test_maits", numbers="9000000055", mpps=0, verbosity=0)

        mait = Mait.objects.get(mobile_no="9000000055")
        assert mait.bank_account_no == f"TEST{mait.sahayak_vendor_code}"
        assert mait.ifsc_code == TEST_IFSC

    def test_backfill_reaches_testers_that_predate_them(self):
        tester = Mait.objects.create(
            sahayak_vendor_code="5590000042", name="Tester", mobile_no="9000000042"
        )

        call_command("seed_test_maits", backfill_bank=True, verbosity=0)

        tester.refresh_from_db()
        assert tester.bank_account_no == "TEST5590000042"
        assert tester.pan_no == "TESTM0042T"

    def test_it_never_touches_a_mait_the_dairy_has_a_record_of(self):
        """
        The `559000` range only.

        A real Sahayak with no bank details on file is a gap for the back office to fill from
        the SAP master. Filling it with something invented would put a fabricated account
        number into a payment file and give nobody any reason to doubt it.
        """
        real = Mait.objects.create(
            sahayak_vendor_code="9900000042", name="Real Mait", mobile_no="9000000043"
        )

        call_command("seed_test_maits", backfill_bank=True, verbosity=0)

        real.refresh_from_db()
        assert real.bank_account_no == ""
        assert real.pan_no == ""

    def test_it_never_overwrites_details_already_on_file(self):
        mait = Mait.objects.create(
            sahayak_vendor_code="5590000043",
            name="Already banked",
            mobile_no="9000000044",
            bank_account_no="12345678901",
            ifsc_code="SBIN0012497",
            pan_no="FNFPS6713H",
        )

        call_command("seed_test_maits", backfill_bank=True, verbosity=0)

        mait.refresh_from_db()
        assert mait.bank_account_no == "12345678901"
        assert mait.ifsc_code == "SBIN0012497"
