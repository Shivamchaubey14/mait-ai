"""
The straw seeder (`seed_straws`), and the breed spread.

One breed at a time was the original shape, and it is the wrong one for stocking a tester. A
straw only works on an animal of its own species, so a hundred MURRAH straws is a hundred a
Mait cannot use the moment the farmer brings out a cow — the app refuses at step 4 and the
tester reports it as a bug in the picker.

The other property held here is the one every seeder in this app shares: stock goes in through
`credit_stock`, so the ledger stays summable to the balance.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.inventory.models import MaitInventory, ProductType, SemenBatch
from apps.inventory.services import available_straw_count, reconcile_balance
from apps.masterdata.models import Mait

pytestmark = pytest.mark.django_db


@pytest.fixture
def mait(db):
    return Mait.objects.create(
        sahayak_vendor_code="5598888888", name="STRAW TEST", mobile_no="9000000002", is_active=True
    )


def breeds_held(mait) -> dict[str, int]:
    ids = MaitInventory.objects.filter(
        mait=mait, product_type=ProductType.STRAW, qty_available__gt=0
    ).values_list("product_ref_id", flat=True)
    counts: dict[str, int] = {}
    for breed in SemenBatch.objects.filter(id__in=ids).values_list("breed", flat=True):
        counts[breed] = counts.get(breed, 0) + 1
    return counts


class TestTheBreedSpread:
    def test_one_breed_is_still_the_default(self, mait):
        call_command("seed_straws", mait=mait.sahayak_vendor_code, count=6, verbosity=0)

        assert breeds_held(mait) == {"MURRAH": 6}

    def test_breeds_are_spread_evenly(self, mait):
        call_command(
            "seed_straws",
            mait=mait.sahayak_vendor_code,
            count=100,
            breeds="MURRAH,JAFRABADI,HF,JERSEY,GIR",
            verbosity=0,
        )

        assert breeds_held(mait) == {
            "MURRAH": 20,
            "JAFRABADI": 20,
            "HF": 20,
            "JERSEY": 20,
            "GIR": 20,
        }
        assert available_straw_count(mait) == 100

    def test_a_remainder_goes_to_the_breeds_listed_first(self, mait):
        """Whoever wrote the list put the ones they care about at the front."""
        call_command(
            "seed_straws",
            mait=mait.sahayak_vendor_code,
            count=7,
            breeds="MURRAH,HF,GIR",
            verbosity=0,
        )

        assert breeds_held(mait) == {"MURRAH": 3, "HF": 2, "GIR": 2}

    def test_it_refuses_a_count_too_small_to_split(self, mait):
        with pytest.raises(CommandError, match="cannot be spread"):
            call_command(
                "seed_straws", mait=mait.sahayak_vendor_code, count=2, breeds="A,B,C", verbosity=0
            )

    def test_straw_numbers_stay_unique_across_a_spread(self, mait):
        """
        `unique_straw_no` is what an operator reads off the AI event screen to settle a
        dispute. Two straws sharing one would make that unanswerable.
        """
        call_command(
            "seed_straws",
            mait=mait.sahayak_vendor_code,
            count=9,
            breeds="MURRAH,HF,GIR",
            verbosity=0,
        )
        call_command(
            "seed_straws",
            mait=mait.sahayak_vendor_code,
            count=9,
            breeds="MURRAH,HF,GIR",
            verbosity=0,
        )

        numbers = list(SemenBatch.objects.values_list("unique_straw_no", flat=True))
        assert len(numbers) == len(set(numbers))
        assert available_straw_count(mait) == 18


def test_the_ledger_still_sums_to_the_balance(mait):
    call_command(
        "seed_straws", mait=mait.sahayak_vendor_code, count=10, breeds="MURRAH,HF", verbosity=0
    )

    for row in MaitInventory.objects.filter(mait=mait):
        balance, ledger = reconcile_balance(row)
        assert balance == ledger


def test_an_unknown_vendor_code_is_refused(db):
    with pytest.raises(CommandError, match="No Mait"):
        call_command("seed_straws", mait="0000000000", count=1, verbosity=0)
