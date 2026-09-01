"""
Issue straws to a Mait so the capture flow can be walked end to end locally.

Stock normally arrives from Indent Easy reporting goods issued (SRS §6.6.3), which is not
wired up until Phase 5. Until then there is no way to reach step 4 on a development machine
without inventing rows by hand — and a hand-written row is exactly the thing that breaks the
guarantee this platform sells, because it credits a balance without a matching ledger entry.

So this goes through ``credit_stock`` like everything else. The ledger stays summable to the
balance, and ``/mait/inventory/ledger/balance-check/`` keeps agreeing with itself.

    python manage.py seed_straws --mait 5500000054 --count 10 --breed MURRAH
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.inventory.models import MaitInventoryLedger, ProductType, SemenBatch
from apps.inventory.services import available_straw_count, credit_stock
from apps.masterdata.models import Mait


class Command(BaseCommand):
    help = "Issue straws to a Mait for local testing (development data only)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--mait",
            required=True,
            help="Sahayak vendor code of the Mait to issue to.",
        )
        parser.add_argument("--count", type=int, default=10, help="How many straws.")
        parser.add_argument("--breed", default="MURRAH", help="Breed code stamped on them.")
        parser.add_argument(
            "--breeds",
            default="",
            help=(
                "Comma-separated breed codes to spread --count evenly across. A straw only "
                "works on an animal of its own species, so a hundred of one buffalo breed is "
                "a hundred straws nobody can use on a cow."
            ),
        )
        parser.add_argument(
            "--prefix",
            default="",
            help="Optional straw number prefix. Empty by default — see the note in handle().",
        )

    def handle(self, *args, **options):
        code = options["mait"]
        count = options["count"]

        if count < 1:
            raise CommandError("--count must be at least 1.")

        breeds = [b.strip().upper() for b in options["breeds"].split(",") if b.strip()]
        if not breeds:
            breeds = [options["breed"].upper()]
        if len(breeds) > count:
            raise CommandError(f"--count {count} cannot be spread across {len(breeds)} breeds.")

        try:
            mait = Mait.objects.get(sahayak_vendor_code=code)
        except Mait.DoesNotExist as exc:
            raise CommandError(f"No Mait with vendor code {code}.") from exc

        # Split as evenly as the count allows, remainder to the breeds listed first. Whoever
        # wrote the list put the ones they care about at the front.
        per, over = divmod(count, len(breeds))
        shares = [per + (1 if i < over else 0) for i in range(len(breeds))]

        # No marker in the number by default. `unique_straw_no` is the number printed on the
        # straw and the one an operator reads off the AI event screen when settling a dispute,
        # so a word stuck on the front of it reads as part of the number rather than as a note
        # about the row. What the row is stays recorded where it belongs and where it cannot
        # be mistaken for evidence: `semen_station` says Development, and the ledger entry
        # says it was seeded. Pass --prefix to put one back.
        prefix = options["prefix"]
        issued = []

        for breed, share in zip(breeds, shares, strict=True):
            stem = f"{prefix}-{breed}-" if prefix else f"{breed}-"

            # Numbered from wherever the last seeded straw left off, so running this twice
            # does not collide on the unique straw number.
            existing = SemenBatch.objects.filter(unique_straw_no__startswith=stem).count()

            for index in range(share):
                straw = SemenBatch.objects.create(
                    unique_straw_no=f"{stem}{existing + index + 1:04d}",
                    breed=breed,
                    bull_id=f"{breed}-BULL",
                    semen_station="Development",
                    received_date=timezone.localdate(),
                )
                credit_stock(
                    mait=mait,
                    product_type=ProductType.STRAW,
                    product_ref_id=straw.id,
                    qty=1,
                    ref_type=MaitInventoryLedger.RefType.MANUAL,
                    note="Seeded for local testing",
                )
                issued.append(straw.unique_straw_no)

        self.stdout.write(self.style.SUCCESS(f"Issued {count} straws to {mait.name} ({code}):"))
        for breed, share in zip(breeds, shares, strict=True):
            self.stdout.write(f"  {breed:<20} {share}")
        self.stdout.write(f"Total straws now held: {available_straw_count(mait)}")
