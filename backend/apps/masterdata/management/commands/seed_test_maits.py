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

Development only, and it says so twice: the command refuses to run unless the fixed-OTP
setting is on, and `config/settings/production.py` refuses to boot at all if that setting is
set. There is no arrangement in which this runs against production data.

    python manage.py seed_test_maits --numbers 9454143347,7310673523
    python manage.py seed_test_maits --file numbers.txt --mpps 3
"""

from __future__ import annotations

import pathlib

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.admin_serializers import MaitActivationSerializer
from apps.masterdata.models import MPP, Mait

CODE_PREFIX = "559000"


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
        if not out:
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

        self.report(made, skipped)

    def next_code(self, taken: set[str]) -> str:
        n = 1
        while True:
            code = f"{CODE_PREFIX}{n:04d}"
            if code not in taken:
                taken.add(code)
                return code
            n += 1

    def report(self, made, skipped) -> None:
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
        self.stdout.write(
            self.style.SUCCESS(
                f"\n{len(made)} login(s) created, {len(skipped)} skipped. "
                f"They sign in with the fixed OTP {settings.DEV_FIXED_OTP_CODE}."
            )
        )
