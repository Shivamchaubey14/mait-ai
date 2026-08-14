"""
A renamed Mait is renamed everywhere they are named (SRS §6.2, §9.6).

`User.full_name` was copied from `Mait.name` once, at activation, and never again. Screens
naming the Mait read one; screens naming who did something read the other. The AI event detail
screen shows both, so a Mait renamed after activation appeared on it as two different people.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import Role, User
from apps.masterdata.models import Mait

pytestmark = pytest.mark.django_db


@pytest.fixture
def activated():
    """A Mait with a login account, the way admin activation leaves it."""
    user = User.objects.create_user(
        username="mait-sync",
        full_name="OLD NAME",
        mobile_no="9000000001",
        role=Role.MAIT,
    )
    mait = Mait.objects.create(
        sahayak_vendor_code="5500009999",
        name="OLD NAME",
        mobile_no="9000000001",
        user=user,
        is_active=True,
    )
    return mait, user


def test_renaming_a_mait_renames_their_login(activated):
    mait, user = activated

    mait.name = "NEW NAME"
    mait.save(update_fields=["name", "updated_at"])

    user.refresh_from_db()
    assert user.full_name == "NEW NAME"


def test_a_plain_save_still_syncs(activated):
    """The Django admin saves the whole instance, with no `update_fields`."""
    mait, user = activated

    mait.name = "ADMIN EDIT"
    mait.save()

    user.refresh_from_db()
    assert user.full_name == "ADMIN EDIT"


def test_saving_something_else_leaves_the_name_alone(activated):
    mait, user = activated
    user.full_name = "SET BY HAND"
    user.save(update_fields=["full_name"])

    mait.mobile_no = "9000000002"
    mait.save(update_fields=["mobile_no", "updated_at"])

    user.refresh_from_db()
    assert user.full_name == "SET BY HAND"


def test_a_blank_name_is_not_propagated(activated):
    """An empty cell in the sheet means no opinion, not "clear the name"."""
    mait, user = activated

    mait.name = ""
    mait.save(update_fields=["name", "updated_at"])

    user.refresh_from_db()
    assert user.full_name == "OLD NAME"


def test_a_mait_with_no_login_yet_is_fine():
    """93% of the roster has no account. Renaming one must not raise."""
    mait = Mait.objects.create(sahayak_vendor_code="5500009998", name="NO LOGIN", is_active=True)

    mait.name = "STILL NO LOGIN"
    mait.save(update_fields=["name", "updated_at"])

    mait.refresh_from_db()
    assert mait.user is None
    assert mait.name == "STILL NO LOGIN"
