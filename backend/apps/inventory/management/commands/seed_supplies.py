"""
Issue consumables and equipment to a Mait for local testing.

The companion to ``seed_straws``. Stock normally arrives from Indent Easy reporting goods
issued (SRS §6.6.3), which is Phase 5 — until then a development handset shows empty
Consumables and Equipment sections, and it is impossible to tell "the screen is broken" from
"this Mait has none".

Goes through ``credit_stock`` like everything else, so the ledger stays summable to the
balance and ``/mait/inventory/check/`` keeps agreeing with itself.

    python manage.py seed_supplies --mait 5500000054
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.inventory.models import Consumable, MaitInventoryLedger, ProductType
from apps.inventory.services import credit_stock
from apps.masterdata.models import Mait

# What a Mait actually carries: consumables by the box, equipment one apiece.
DEFAULT_QUANTITIES = {
    "SHEATH": 32,
    "GLOVES": 14,
    "LN2": 6,
    "AI_GUN": 1,
    "EAR_TAG_APPLICATOR": 1,
    "THAWING_TRAY": 1,
    "THERMO_MONITOR": 1,
}


class Command(BaseCommand):
    help = "Issue consumables and equipment to a Mait (development data only)."

    def add_arguments(self, parser):
        parser.add_argument("--mait", required=True, help="Sahayak vendor code.")
        parser.add_argument(
            "--only",
            default="",
            help="Comma-separated product codes. Defaults to the whole catalogue.",
        )

    def handle(self, *args, **options):
        code = options["mait"]
        try:
            mait = Mait.objects.get(sahayak_vendor_code=code)
        except Mait.DoesNotExist as exc:
            raise CommandError(f"No Mait with vendor code {code}.") from exc

        wanted = [c.strip().upper() for c in options["only"].split(",") if c.strip()]
        products = Consumable.objects.filter(is_active=True)
        if wanted:
            products = products.filter(code__in=wanted)

        if not products.exists():
            raise CommandError("No matching products. Has the catalogue migration run?")

        for product in products:
            qty = DEFAULT_QUANTITIES.get(product.code, 1)
            credit_stock(
                mait=mait,
                product_type=ProductType.CONSUMABLE,
                product_ref_id=product.id,
                qty=qty,
                ref_type=MaitInventoryLedger.RefType.MANUAL,
                note="Seeded for local testing",
            )
            self.stdout.write(f"  {product.name:<24} +{qty} {product.unit}")

        self.stdout.write(self.style.SUCCESS(f"Issued to {mait.name} ({code})."))
