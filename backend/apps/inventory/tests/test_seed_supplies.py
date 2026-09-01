"""
The local stock seeder (`seed_supplies`).

Development tooling, but it earns tests for one reason: it is the only thing that credits
stock outside the real goods-issued path, and it is the thing most likely to be reached for
when somebody needs a lot of stock quickly. The two properties worth holding are that it goes
through `credit_stock` — so every unit it issues has a ledger entry behind it and the balance
check keeps agreeing with itself — and that `--qty` does not apply to equipment.

That second one is a judgement encoded in the command rather than left to the caller. The
catalogue calls an AI gun a "consumable" because it is issued to a Mait like one, but a Mait
carries one of them. `--qty 100` is asking for a hundred sheaths, not a hundred AI guns, and
a stock screen showing the latter reads as a bug in the product.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command

from apps.inventory.models import Consumable, MaitInventory, MaitInventoryLedger, ProductType
from apps.inventory.services import reconcile_balance
from apps.masterdata.models import Mait

pytestmark = pytest.mark.django_db


def held(mait, code: str) -> int:
    product = Consumable.objects.get(code=code)
    row = MaitInventory.objects.filter(
        mait=mait, product_type=ProductType.CONSUMABLE, product_ref_id=product.id
    ).first()
    return row.qty_available if row else 0


@pytest.fixture
def catalogue(db):
    """
    The products the command issues.

    Built here rather than leaned on from the `0003_seed_products` data migration: the suite
    runs with `--reuse-db`, so whether a data migration's rows are present depends on when the
    test database happened to be created. A fixture that makes what it needs is the same
    either way.
    """
    made = []
    for code, name, unit, order in [
        ("SHEATH", "AI sheaths", "", 10),
        ("GLOVES", "Gloves", "pair", 20),
        ("LN2", "Liquid nitrogen", "litre", 30),
    ]:
        made.append(
            Consumable.objects.get_or_create(
                code=code,
                defaults={
                    "name": name,
                    "unit": unit,
                    "display_order": order,
                    "category": Consumable.Category.CONSUMABLE,
                },
            )[0]
        )
    for code, name, order in [
        ("AI_GUN", "AI gun", 10),
        ("CRYO_CONTAINER", "Cryo container", 15),
        ("EAR_TAG_APPLICATOR", "Ear tag applicator", 20),
        ("THAWING_TRAY", "Thawing tray", 30),
        ("THERMO_MONITOR", "Thermo monitor", 40),
    ]:
        made.append(
            Consumable.objects.get_or_create(
                code=code,
                defaults={
                    "name": name,
                    "unit": "piece",
                    "display_order": order,
                    "category": Consumable.Category.ASSET,
                },
            )[0]
        )
    return made


@pytest.fixture
def mait(db, catalogue):
    return Mait.objects.create(
        sahayak_vendor_code="5599999999", name="SEED TEST", mobile_no="9000000001", is_active=True
    )


class TestQuantities:
    def test_it_issues_the_catalogue_defaults(self, mait):
        call_command("seed_supplies", mait=mait.sahayak_vendor_code, verbosity=0)

        assert held(mait, "SHEATH") == 32
        assert held(mait, "GLOVES") == 14
        assert held(mait, "AI_GUN") == 1

    def test_qty_overrides_the_consumables(self, mait):
        call_command("seed_supplies", mait=mait.sahayak_vendor_code, qty=100, verbosity=0)

        assert held(mait, "SHEATH") == 100
        assert held(mait, "GLOVES") == 100
        assert held(mait, "LN2") == 100

    def test_qty_leaves_equipment_alone(self, mait):
        """
        The point of the flag being consumables-only. A Mait carries one AI gun; a hundred is
        not a bigger test, it is a wrong one, and it is the stock screen that has to show it.
        """
        call_command("seed_supplies", mait=mait.sahayak_vendor_code, qty=100, verbosity=0)

        for code in ("AI_GUN", "CRYO_CONTAINER", "EAR_TAG_APPLICATOR", "THAWING_TRAY"):
            assert held(mait, code) == 1, code

    def test_only_narrows_what_is_issued(self, mait):
        call_command("seed_supplies", mait=mait.sahayak_vendor_code, only="SHEATH", verbosity=0)

        assert held(mait, "SHEATH") == 32
        assert held(mait, "GLOVES") == 0


class TestTheLedgerStaysHonest:
    def test_every_unit_issued_has_a_ledger_entry_behind_it(self, mait):
        """
        The guarantee the whole inventory gate rests on. A seeder that wrote balances directly
        would leave `/mait/inventory/ledger/balance-check/` disagreeing with itself, which is
        the one failure nobody would notice until an audit.
        """
        call_command("seed_supplies", mait=mait.sahayak_vendor_code, qty=100, verbosity=0)

        rows = MaitInventory.objects.filter(mait=mait)
        assert rows.exists()
        for row in rows:
            balance, ledger = reconcile_balance(row)
            assert balance == ledger, f"product {row.product_ref_id}: {balance} vs {ledger}"

    def test_the_entries_say_where_the_stock_came_from(self, mait):
        call_command("seed_supplies", mait=mait.sahayak_vendor_code, verbosity=0)

        entry = MaitInventoryLedger.objects.filter(inventory__mait=mait).first()
        assert entry is not None
        # Manual, not an indent: nothing was actually issued by a store, and a seeded row that
        # claimed otherwise would be a lie in the audit trail.
        assert entry.ref_type == MaitInventoryLedger.RefType.MANUAL

    def test_running_it_twice_adds_rather_than_resets(self, mait):
        call_command("seed_supplies", mait=mait.sahayak_vendor_code, qty=10, verbosity=0)
        call_command("seed_supplies", mait=mait.sahayak_vendor_code, qty=10, verbosity=0)

        assert held(mait, "SHEATH") == 20
        row = MaitInventory.objects.get(
            mait=mait,
            product_type=ProductType.CONSUMABLE,
            product_ref_id=Consumable.objects.get(code="SHEATH").id,
        )
        balance, ledger = reconcile_balance(row)
        assert balance == ledger


def test_an_unknown_vendor_code_is_refused(db):
    from django.core.management.base import CommandError

    with pytest.raises(CommandError, match="No Mait"):
        call_command("seed_supplies", mait="0000000000", verbosity=0)
