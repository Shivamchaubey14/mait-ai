"""
Stand a store up for a Mait, so the handover can be tried on a handset.

    python manage.py seed_store --mait 5500000054 --keeper 9876500001:"Ramesh Yadav"
    python manage.py seed_store --mait 5500000054 --straws 40 --breeds MURRAH,HF --supplies 50

Serves every BMC/MCC the Mait's collection points report into that no other store serves yet,
gives it a keeper who signs in with the dev OTP, and puts stock on its shelf through
``receive_stock`` — the same path a keeper's own delivery takes, so the store's ledger stays
summable to its count.

The portal's Stores screen does all of this properly. This exists because trying the flow
otherwise means four screens and two logins before the first straw moves.
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Role, User
from apps.inventory.models import Consumable, ProductType
from apps.masterdata.models import MPP, Mait
from apps.stores.models import Store, StorePlant
from apps.stores.services import receive_stock


class Command(BaseCommand):
    help = "Create a store serving a Mait's BMC/MCCs, with a keeper and stock (development only)."

    def add_arguments(self, parser):
        parser.add_argument("--mait", required=True, help="The Mait's Sahayak vendor code.")
        parser.add_argument("--code", default="", help="Store code. Defaults to the plant's.")
        parser.add_argument("--name", default="", help="Store name. Defaults to '<plant> depot'.")
        parser.add_argument(
            "--keeper",
            default="",
            help="mobile:Name for the keeper's account, e.g. 9876500001:Ramesh Yadav.",
        )
        parser.add_argument("--straws", type=int, default=0, help="Straws of each breed.")
        parser.add_argument("--breeds", default="MURRAH", help="Comma-separated breed codes.")
        parser.add_argument(
            "--supplies", type=int, default=0, help="Units of each active consumable."
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if not getattr(settings, "DEV_FIXED_OTP_NUMBERS", []):
            raise CommandError(
                "DEV_FIXED_OTP_NUMBERS is empty, so this is not a development environment. "
                "A keeper made here would have no way to sign in."
            )

        mait = Mait.objects.filter(sahayak_vendor_code=options["mait"]).first()
        if mait is None:
            raise CommandError(f"No Mait with vendor code {options['mait']}.")

        plants = dict(
            MPP.objects.filter(mait=mait)
            .exclude(plant_code="")
            .values_list("plant_code", "plant_name")
            .distinct()
        )
        if not plants:
            raise CommandError(f"{mait.name} covers no MPP with a BMC/MCC on it.")

        first_code, first_name = next(iter(plants.items()))
        code = (options["code"] or first_name or first_code).strip().upper()[:20]
        store, created = Store.objects.get_or_create(
            code=code,
            defaults={"name": options["name"] or f"{(first_name or code).title()} depot"},
        )
        self.stdout.write(f"{'Created' if created else 'Using'} {store.name} [{store.code}]")

        for plant_code, plant_name in plants.items():
            held = StorePlant.objects.filter(plant_code=plant_code).select_related("store").first()
            if held and held.store_id != store.id:
                self.stdout.write(f"  {plant_name or plant_code}: already served by {held.store}")
                continue
            if not held:
                StorePlant.objects.create(store=store, plant_code=plant_code, plant_name=plant_name)
            self.stdout.write(f"  serves {plant_name or plant_code}")

        if options["keeper"]:
            mobile, _, name = options["keeper"].partition(":")
            mobile = mobile.strip()
            clash = User.objects.filter(mobile_no=mobile, is_active=True).exclude(store=store)
            if clash.exists() or Mait.objects.filter(mobile_no=mobile, is_active=True).exists():
                raise CommandError(f"{mobile} already signs in to another account.")
            keeper, made = User.objects.get_or_create(
                username=f"store-{mobile}",
                defaults={
                    "full_name": name.strip() or "Store keeper",
                    "mobile_no": mobile,
                    "role": Role.STORE,
                    "store": store,
                },
            )
            if made:
                keeper.set_unusable_password()
                keeper.save()
            self.stdout.write(f"  keeper {keeper.full_name} signs in with {mobile}")

        if options["straws"]:
            for breed in [b.strip().upper() for b in options["breeds"].split(",") if b.strip()]:
                receive_stock(
                    store=store,
                    product_type=ProductType.STRAW,
                    breed=breed,
                    qty=options["straws"],
                    note="seed_store",
                )
                self.stdout.write(f"  +{options['straws']} {breed}")

        if options["supplies"]:
            for product in Consumable.objects.filter(
                is_active=True, category=Consumable.Category.CONSUMABLE
            ):
                receive_stock(
                    store=store,
                    product_type=ProductType.CONSUMABLE,
                    product_ref_id=product.id,
                    qty=options["supplies"],
                    note="seed_store",
                )
            self.stdout.write(f"  +{options['supplies']} of each consumable")
