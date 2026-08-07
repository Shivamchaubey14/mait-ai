"""
The stock summary a Mait's app gates on (SRS §6.4.1, §9.5).

`total_straws` is the number that decides whether a Mait can work at all, and the app shows
it as the headline on the Stock tab. It has to agree with what they are actually carrying —
reading high is worse than reading low, because it sends them out to a farmer for an
insemination they cannot complete.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.inventory.models import Consumable, MaitInventory, ProductType, SemenBatch
from apps.inventory.services import available_straw_count

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-summary",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


@pytest.fixture
def mait_client(mait):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")
    return client


def test_consumables_are_not_counted_as_straws(mait_client, mait, stocked_mait):
    straws = stocked_mait(2)

    # A consumable whose id collides with a straw id. Both are stored in `product_ref_id`,
    # which means one column holding two id spaces — so this is ordinary, not contrived.
    sheaths = Consumable.objects.create(code="SHEATH", name="Sheaths", unit="piece")
    Consumable.objects.filter(pk=sheaths.pk).update(id=straws[0].id)
    MaitInventory.objects.create(
        mait=mait,
        product_type=ProductType.CONSUMABLE,
        product_ref_id=straws[0].id,
        qty_available=40,
    )

    body = mait_client.get("/api/v1/mait/inventory/").json()

    assert body["total_straws"] == 2
    assert sum(body["by_breed"].values()) == 2
    assert body["total_straws"] == available_straw_count(mait)


def test_the_headline_agrees_with_the_breed_breakdown(mait_client, mait, stocked_mait):
    stocked_mait(3)
    SemenBatch.objects.filter(is_consumed=False).update(breed="MURRAH")

    body = mait_client.get("/api/v1/mait/inventory/").json()

    assert body["total_straws"] == sum(body["by_breed"].values()) == 3


def test_an_empty_flask_reads_zero(mait_client):
    body = mait_client.get("/api/v1/mait/inventory/").json()

    assert body["total_straws"] == 0
    assert body["by_breed"] == {}


class TestAdminDetail:
    """
    The per-Mait view behind the oversight list.

    An admin opening a Mait's row is usually answering a phone call, so the numbers here have
    to be the same ones the Mait is reading off their own screen.
    """

    def test_an_admin_sees_the_same_breakdown_the_mait_does(
        self, admin_client, mait_client, mait, stocked_mait
    ):
        stocked_mait(3)

        theirs = mait_client.get("/api/v1/mait/inventory/").json()
        ours = admin_client.get(f"/api/v1/admin/inventory/{mait.id}/").json()

        assert ours["total_straws"] == theirs["total_straws"] == 3
        assert ours["by_breed"] == theirs["by_breed"]

    def test_it_names_the_mait_being_looked_at(self, admin_client, mait):
        body = admin_client.get(f"/api/v1/admin/inventory/{mait.id}/").json()

        # The list row that was clicked is off-screen by the time the panel opens.
        assert body["mait_name"] == mait.name
        assert body["sahayak_vendor_code"] == mait.sahayak_vendor_code

    def test_consumables_and_equipment_come_through_split(self, admin_client, mait):
        sheaths = Consumable.objects.create(code="SHEATH", name="Sheaths", unit="piece")
        gun = Consumable.objects.create(code="AI_GUN", name="AI gun", category="asset")
        for product, qty in ((sheaths, 40), (gun, 1)):
            MaitInventory.objects.create(
                mait=mait,
                product_type=ProductType.CONSUMABLE,
                product_ref_id=product.id,
                qty_available=qty,
            )

        body = admin_client.get(f"/api/v1/admin/inventory/{mait.id}/").json()

        # A Mait restocks them differently, so they are never one list.
        assert [row["name"] for row in body["consumables"]] == ["Sheaths"]
        assert [row["name"] for row in body["assets"]] == ["AI gun"]

    def test_a_mait_cannot_read_another_mait(self, mait_client, mait):
        response = mait_client.get(f"/api/v1/admin/inventory/{mait.id}/")

        assert response.status_code == 403

    def test_an_unknown_mait_is_a_404(self, admin_client):
        assert admin_client.get("/api/v1/admin/inventory/999999/").status_code == 404
