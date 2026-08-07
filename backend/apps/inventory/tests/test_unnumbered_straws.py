"""
Claiming an unnumbered straw (SRS §6.3 step 4, §6.6.3).

Stock issued as "25 MURRAH" arrives with no numbers: the depot hands over a bundle, and the
number that matters is the one printed on whichever straw gets used. The Mait names it at the
AI step, which claims one row out of their balance.

The invariant is unchanged and is what these tests guard: one number, one animal. Naming a
straw writes onto a row the Mait already holds, so the count cannot grow, and the unique
constraint still means the same number can never be recorded twice.
"""

from __future__ import annotations

import pytest

from apps.core.exceptions import BreedRequired, InsufficientStock, StrawAlreadyConsumed
from apps.inventory.models import MaitInventory, ProductType, SemenBatch
from apps.inventory.services import (
    available_straw_count,
    get_straw_for_mait,
    unnumbered_breeds,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def unnumbered(db, mait):
    """Give the Mait a bundle of unnumbered straws, as a quantity-issued indent would."""

    def _make(count: int = 3, breed: str = "MURRAH"):
        straws = []
        for index in range(count):
            straw = SemenBatch.objects.create(
                unique_straw_no=f"BUNDLE-{breed}-{index}",
                breed=breed,
                is_unnumbered=True,
            )
            MaitInventory.objects.create(
                mait=mait,
                product_type=ProductType.STRAW,
                product_ref_id=straw.id,
                qty_available=1,
            )
            straws.append(straw)
        return straws

    return _make


class TestClaiming:
    def test_a_new_number_claims_one_from_the_bundle(self, mait, unnumbered):
        unnumbered(3)

        straw = get_straw_for_mait(mait, "3391027744", claim=True)

        assert straw.unique_straw_no == "3391027744"
        assert straw.is_unnumbered is False
        assert straw.breed == "MURRAH"

    def test_claiming_does_not_change_the_count(self, mait, unnumbered):
        unnumbered(3)

        get_straw_for_mait(mait, "3391027744", claim=True)

        # Naming a straw is not receiving one. The bundle had three before and has three now.
        assert available_straw_count(mait) == 3

    def test_naming_the_same_number_again_finds_the_same_straw(self, mait, unnumbered):
        straws = unnumbered(3)
        first = get_straw_for_mait(mait, "3391027744", claim=True)

        again = get_straw_for_mait(mait, "3391027744", claim=True)

        # Re-reading the number off the straw still in their hand is not a second straw. It
        # resolves to the one already named, and does not eat another from the bundle.
        assert again.id == first.id
        assert SemenBatch.objects.filter(id__in=[s.id for s in straws]).count() == 3
        assert available_straw_count(mait) == 3

    def test_a_number_belonging_to_someone_else_is_refused(self, mait, unnumbered):
        unnumbered(1)
        SemenBatch.objects.create(unique_straw_no="3391027744", breed="MURRAH", is_consumed=True)

        # The number is taken and used. The Mait's own bundle is untouched — they have simply
        # read the wrong number, or a straw that should never have reached them.
        with pytest.raises(StrawAlreadyConsumed):
            get_straw_for_mait(mait, "3391027744", claim=True)
        assert SemenBatch.objects.filter(is_unnumbered=True).count() == 1

    def test_previewing_does_not_write_the_number(self, mait, unnumbered):
        unnumbered(2)

        get_straw_for_mait(mait, "3391027744")

        # The validation endpoint is a GET. It must not rename anything — the claim belongs
        # to the event that actually uses the straw.
        assert not SemenBatch.objects.filter(unique_straw_no="3391027744").exists()
        assert SemenBatch.objects.filter(is_unnumbered=True).count() == 2

    def test_a_mait_with_no_bundle_is_still_refused(self, mait):
        with pytest.raises(InsufficientStock):
            get_straw_for_mait(mait, "3391027744", claim=True)

    def test_an_exhausted_bundle_is_refused(self, mait, unnumbered):
        unnumbered(1)
        get_straw_for_mait(mait, "FIRST-ONE", claim=True)

        with pytest.raises(InsufficientStock):
            get_straw_for_mait(mait, "SECOND-ONE", claim=True)


class TestBreed:
    def test_one_breed_needs_no_saying(self, mait, unnumbered):
        unnumbered(2, breed="MURRAH")

        straw = get_straw_for_mait(mait, "3391027744", claim=True)

        assert straw.breed == "MURRAH"

    def test_two_breeds_must_be_told_apart(self, mait, unnumbered):
        unnumbered(2, breed="MURRAH")
        unnumbered(2, breed="GIR")

        # Guessing would record the wrong bull against the animal, and nothing downstream
        # would ever catch it.
        with pytest.raises(BreedRequired):
            get_straw_for_mait(mait, "3391027744", claim=True)

    def test_naming_the_breed_settles_it(self, mait, unnumbered):
        unnumbered(2, breed="MURRAH")
        unnumbered(2, breed="GIR")

        straw = get_straw_for_mait(mait, "3391027744", breed="GIR", claim=True)

        assert straw.breed == "GIR"

    def test_the_choices_are_offered(self, mait, unnumbered):
        unnumbered(1, breed="MURRAH")
        unnumbered(1, breed="GIR")

        assert unnumbered_breeds(mait) == ["GIR", "MURRAH"]

    def test_numbered_stock_is_not_offered_as_a_choice(self, mait, stocked_mait):
        stocked_mait(2)

        # Straws that already carry their real number need no disambiguation.
        assert unnumbered_breeds(mait) == []


class TestNumberedStockUnaffected:
    def test_a_known_number_resolves_as_before(self, mait, stocked_mait):
        straw = stocked_mait(1)[0]

        found = get_straw_for_mait(mait, straw.unique_straw_no, claim=True)

        assert found.id == straw.id

    def test_a_consumed_straw_is_still_refused(self, mait, stocked_mait):
        straw = stocked_mait(1)[0]
        SemenBatch.objects.filter(pk=straw.pk).update(is_consumed=True)

        with pytest.raises(StrawAlreadyConsumed):
            get_straw_for_mait(mait, straw.unique_straw_no, claim=True)
