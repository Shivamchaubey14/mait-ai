"""
Retire the Mait records that were never Maits (SRS §18.2).

``Sahyak.xlsx`` carries an MPP and the Sahayak who staffs it on one row, and the importer used
to turn that Sahayak column into a ``Mait``. The result was one pseudo-Mait per village — 3,110
of them, each "covering" the single MPP they came from — sitting in the roster alongside the
58 real Maits from the ZMAI vendor export, who had no coverage at all.

A Sahayak runs one collection point and takes the milk in. A Mait is the AI technician who
covers many. They are different people doing different jobs, and the importer no longer
conflates them — see ``_upsert_mpp_and_sahayak``. This command clears up what the old
behaviour left behind.

Nothing is deleted. These rows are referenced by inventory, indents and AI events, and a Mait
row that vanishes takes the readability of that history with it. They are deactivated, which
takes them out of the roster, the pickers and the assignment screen.

    python manage.py retire_sahayak_maits            # report only, changes nothing
    python manage.py retire_sahayak_maits --apply
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.masterdata.models import MPP, Mait

# The Sahayak vendor range from Sahyak.xlsx. The real Maits are 9900000000+, and the two
# spaces have never overlapped — which is the only reason this is safely separable.
SAHAYAK_PREFIX = "55"


class Command(BaseCommand):
    help = "Deactivate Mait records created from the Sahayak column of the MPP master."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually make the change. Without it the command only reports.",
        )
        parser.add_argument(
            "--prefix",
            default=SAHAYAK_PREFIX,
            help=f"Vendor-code prefix identifying the Sahayak range (default {SAHAYAK_PREFIX}).",
        )

    def handle(self, *args, **options):
        prefix = options["prefix"]
        apply_changes = options["apply"]

        candidates = Mait.objects.filter(sahayak_vendor_code__startswith=prefix, is_active=True)

        # An activated Mait has a login somebody is using. Whatever their vendor code says,
        # deactivating them locks a working field agent out mid-round — so they are left
        # alone and reported, for a human to decide about.
        signed_in = candidates.filter(user__isnull=False)
        retiring = candidates.filter(user__isnull=True)

        retiring_count = retiring.count()
        mpps_held = MPP.objects.filter(mait__in=retiring).count()

        self.stdout.write(f"Sahayak-range Mait records active:  {candidates.count()}")
        self.stdout.write(f"  to retire (no login):            {retiring_count}")
        self.stdout.write(f"  MPPs they hold, to unassign:     {mpps_held}")
        self.stdout.write(f"  kept because they have a login:  {signed_in.count()}")

        for mait in signed_in.select_related("user")[:20]:
            held = mait.mpps.count()
            self.stdout.write(
                f"    keeping {mait.sahayak_vendor_code} {mait.name} "
                f"({mait.user.username}, {held} MPP(s))"
            )

        real = Mait.objects.filter(is_active=True).exclude(sahayak_vendor_code__startswith=prefix)
        self.stdout.write(f"Maits left active outside that range: {real.count()}")

        if not apply_changes:
            self.stdout.write(
                self.style.WARNING("\nReport only. Re-run with --apply to make the change.")
            )
            return

        with transaction.atomic():
            # Unassign first. Doing it after would leave the MPPs pointing at rows that no
            # longer appear anywhere, which reads as coverage nobody can see or change.
            unassigned = MPP.objects.filter(mait__in=retiring).update(mait=None)
            retired = retiring.update(is_active=False)

        self.stdout.write(
            self.style.SUCCESS(
                f"\nRetired {retired} Mait record(s) and unassigned {unassigned} MPP(s).\n"
                "Assign coverage to the real Maits from the assignment sheet on the "
                "portal's Assignment screen."
            )
        )
