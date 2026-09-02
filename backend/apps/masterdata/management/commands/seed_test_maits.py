"""
Create Mait logins for a list of numbers, for testing on real handsets.

A field login normally traces back to a real Sahayak: `MaitActivationSerializer` refuses a
number that has no `sahayak_vendor_code` behind it, and that is the right rule — it is what
stops a login existing for somebody the dairy has no record of. But handing a build to a room
of testers means fourteen people who are not in any SAP export yet, and the alternative to
this is somebody typing rows into a database by hand.

So the codes are **minted, and marked**. Everything created here carries the `559000` prefix,
which is outside every range the real roster uses, so a glance at the Maits screen says which
rows were made up. A real Mait-master upload will not recognise them.

**Their bank details are minted too, and marked the same way.** A tester's inseminations are
real — they are performed on a handset against real straws — so they reach the Mait payment
report as real rows, and a row with no account number is one the report cannot finish: it
reads as a Mait the dairy is unable to pay rather than as a test account. So each gets a
PAN, an account number and an IFSC that are correctly *shaped* and unmistakably invented, all
three built from the vendor code and all three carrying `TEST`. Nothing here is a real
person's banking detail, and no bank would accept any of it.

Development only, and it says so twice: the command refuses to run unless the fixed-OTP
setting is on, and `config/settings/production.py` refuses to boot at all if that setting is
set. There is no arrangement in which this runs against production data.

    python manage.py seed_test_maits --numbers 9454143347,7310673523
    python manage.py seed_test_maits --file numbers.txt --mpps 3

`--backfill-bank` fills in the minted bank details of any test account still missing them and
creates nothing, which is how testers handed a build before this existed become payable rows on
the report. An ordinary seeding run does it too:

    python manage.py seed_test_maits --backfill-bank
"""

from __future__ import annotations

import pathlib

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.admin_serializers import MaitActivationSerializer
from apps.masterdata.models import MPP, Mait

CODE_PREFIX = "559000"

#: The bank of nowhere. A real IFSC is four letters, a zero, then six characters identifying a
#: branch; this is the right shape and no such bank exists, so a payment file built from these
#: rows fails at the bank rather than reaching somebody's account by accident.
TEST_IFSC = "TEST0000001"


def minted_bank_details(vendor_code: str) -> dict:
    """
    Minted account, IFSC and PAN for one test account, derived from its vendor code.

    Not named `test_...`, deliberately: pytest collects anything by that name out of any
    module it imports, and this would have been run as a test with `vendor_code` treated as a
    fixture it could not find.

    Derived rather than random so the same tester gets the same details every run — a report
    downloaded twice a week apart should not appear to have changed somebody's bank account.
    All three carry `TEST` and the shapes are real: a PAN is five letters, four digits and a
    letter, and the report writes every one of these cells as text, so a leading zero or a
    long account number has to survive the round trip the same way a real one would.
    """
    tail = vendor_code[-4:].rjust(4, "0")
    return {
        "bank_account_no": f"TEST{vendor_code}",
        "ifsc_code": TEST_IFSC,
        "pan_no": f"TESTM{tail}T",
    }


class Command(BaseCommand):
    help = "Create Mait logins for a list of mobile numbers (development data only)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--numbers",
            default="",
            help="Comma-separated 10-digit mobile numbers, optionally as number:Name.",
        )
        parser.add_argument(
            "--file",
            default="",
            help="A file of the same, one per line. Combined with --numbers if both are given.",
        )
        parser.add_argument(
            "--backfill-bank",
            action="store_true",
            help=(
                "Fill in minted bank details for test accounts that predate them, and nothing "
                "else. The one way to run this command without numbers — it is how testers "
                "already carrying a build become payable rows on the Mait payment report."
            ),
        )
        parser.add_argument(
            "--mpps",
            type=int,
            default=3,
            help=(
                "Collection points to give each account, taken only from the unassigned pool. "
                "0 leaves them with none, which is a login that cannot reach the capture flow."
            ),
        )

    def entries(self, options) -> list[tuple[str, str]]:
        """`(mobile, name)` pairs, from either source. A missing name is filled in later."""
        raw: list[str] = [c for c in options["numbers"].split(",") if c.strip()]
        if options["file"]:
            path = pathlib.Path(options["file"])
            if not path.exists():
                raise CommandError(f"No such file: {path}")
            raw += path.read_text(encoding="utf-8").splitlines()

        out = []
        for line in raw:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            mobile, _, name = line.partition(":")
            out.append((mobile.strip(), name.strip()))
        # Still an error rather than a silent no-op — a command that quietly does nothing is
        # how somebody concludes the testers were created when they were not. The one way to
        # run without numbers is to ask for the backfill explicitly.
        if not out and not options["backfill_bank"]:
            raise CommandError("Give me some numbers — use --numbers or --file.")
        return out

    def handle(self, *args, **options):
        # The guard that makes this safe to ship. Production refuses to boot with the fixed
        # OTP set, so an environment where this runs is one where OTP is already not secured.
        if not getattr(settings, "DEV_FIXED_OTP_NUMBERS", []):
            raise CommandError(
                "DEV_FIXED_OTP_NUMBERS is empty, so this is not a development environment. "
                "These accounts would be created with no way to sign in to them."
            )

        entries = self.entries(options)
        taken = set(Mait.objects.values_list("sahayak_vendor_code", flat=True))
        spare = list(
            MPP.objects.filter(mait__isnull=True).order_by("mpp_code").values_list("id", flat=True)
        )
        wanted = options["mpps"] * len(entries)
        if len(spare) < wanted:
            raise CommandError(f"only {len(spare)} unassigned MPPs, need {wanted}")
        pool = iter(spare)

        made, skipped = [], []
        for index, (mobile, name) in enumerate(entries, start=1):
            existing = Mait.objects.filter(mobile_no=mobile).first()
            if existing is not None:
                skipped.append((mobile, existing.sahayak_vendor_code))
                continue

            with transaction.atomic():
                code = self.next_code(taken)
                mait = Mait.objects.create(
                    sahayak_vendor_code=code,
                    name=name or f"Test Mait {index}",
                    # Set by the activation below, which is the step that checks it is not
                    # already in use by another Mait.
                    mobile_no="",
                    is_active=True,
                    **minted_bank_details(code),
                )
                serializer = MaitActivationSerializer(
                    data={"sahayak_vendor_code": code, "mobile_no": mobile}
                )
                if not serializer.is_valid():
                    raise CommandError(f"{mobile}: {serializer.errors}")
                user = serializer.save()

                codes = []
                if options["mpps"]:
                    ids = [next(pool) for _ in range(options["mpps"])]
                    MPP.objects.filter(id__in=ids).update(mait=mait)
                    codes = list(
                        MPP.objects.filter(id__in=ids)
                        .order_by("mpp_code")
                        .values_list("mpp_code", flat=True)
                    )

            made.append((mait.name, mobile, code, user.username, codes))

        # Run on an ordinary seeding pass too, not only when asked for: the accounts that need
        # it are the ones already handed out, and somebody adding a fifteenth tester should not
        # have to know there is a second command to run for the other fourteen.
        self.report(made, skipped, self.backfill_bank_details())

    def backfill_bank_details(self) -> list[str]:
        """
        Give minted bank details to any test account that predates them.

        Only ever touches the `559000` range and only ever fills a blank: an account that
        already has details, real or minted, is left exactly as it is. That second rule is
        what makes it safe to run on every pass — inventing banking details for a Mait the
        dairy has a real record of is the one thing this must never do.
        """
        filled = []
        for mait in Mait.objects.filter(sahayak_vendor_code__startswith=CODE_PREFIX):
            if mait.bank_account_no and mait.ifsc_code and mait.pan_no:
                continue
            details = minted_bank_details(mait.sahayak_vendor_code)
            for field, value in details.items():
                if not getattr(mait, field):
                    setattr(mait, field, value)
            mait.save(update_fields=list(details))
            filled.append(f"{mait.name} [{mait.sahayak_vendor_code}]")
        return filled

    def next_code(self, taken: set[str]) -> str:
        n = 1
        while True:
            code = f"{CODE_PREFIX}{n:04d}"
            if code not in taken:
                taken.add(code)
                return code
            n += 1

    def report(self, made, skipped, filled) -> None:
        if made:
            self.stdout.write("")
            self.stdout.write(
                f"{'Name':<18} {'Mobile':<12} {'Vendor code':<12} {'Username':<18} MPPs"
            )
            self.stdout.write("-" * 88)
        for name, mobile, code, username, codes in made:
            self.stdout.write(
                f"{name:<18} {mobile:<12} {code:<12} {username:<18} {', '.join(codes)}"
            )
        for mobile, code in skipped:
            self.stdout.write(self.style.WARNING(f"skipped {mobile} — already on {code}"))
        for who in filled:
            self.stdout.write(f"filled in test bank details for {who}")
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{len(made)} login(s) created, {len(skipped)} skipped, "
                f"{len(filled)} given test bank details. "
                f"They sign in with the fixed OTP {settings.DEV_FIXED_OTP_CODE}."
            )
        )
