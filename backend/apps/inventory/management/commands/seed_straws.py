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
            "--prefix",
            default="DEMO",
            help="Straw number prefix, so seeded stock is obvious in the data.",
        )

    def handle(self, *args, **options):
        code = options["mait"]
        count = options["count"]
        breed = options["breed"].upper()

        if count < 1:
            raise CommandError("--count must be at least 1.")

        try:
            mait = Mait.objects.get(sahayak_vendor_code=code)
        except Mait.DoesNotExist as exc:
            raise CommandError(f"No Mait with vendor code {code}.") from exc

        # Numbered from wherever the last seeded straw left off, so running this twice does
        # not collide on the unique straw number.
        existing = SemenBatch.objects.filter(
            unique_straw_no__startswith=f"{options['prefix']}-{breed}-"
        ).count()

        issued = []
        for index in range(count):
            straw = SemenBatch.objects.create(
                unique_straw_no=f"{options['prefix']}-{breed}-{existing + index + 1:04d}",
                breed=breed,
                bull_id="DEMO-BULL",
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
        for number in issued:
            self.stdout.write(f"  {number}")
        self.stdout.write(f"Total straws now held: {available_straw_count(mait)}")
