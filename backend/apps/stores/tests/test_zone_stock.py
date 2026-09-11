"""
Stock by zone: a zonal manager sees the Maits in their zone and the stores serving it.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.inventory.models import ProductType
from apps.masterdata.models import Zone, ZonePlant
from apps.stores.models import Store, StorePlant
from apps.stores.services import receive_stock
from conftest import MaitFactory, MPPFactory, SemenBatchFactory

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/inventory/"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def network(db):
    """Two zones, a Mait and a store in each, stock in both places."""
    from apps.inventory.models import MaitInventoryLedger
    from apps.inventory.services import credit_stock

    zones = {}
    for code, plant in (("MATHURA", "1101"), ("AGRA", "2202")):
        zone = Zone.objects.create(code=code, name=code.title())
        ZonePlant.objects.create(zone=zone, plant_code=plant, plant_name=f"{code} BMC")
        mait = MaitFactory(name=f"{code.title()} Mait")
        MPPFactory(mait=mait, plant_code=plant, plant_name=f"{code} BMC")
        straw = SemenBatchFactory(breed="MURRAH")
        credit_stock(
            mait=mait,
            product_type=ProductType.STRAW,
            product_ref_id=straw.id,
            qty=1,
            ref_type=MaitInventoryLedger.RefType.MANUAL,
        )
        store = Store.objects.create(code=code, name=f"{code.title()} depot", zone=zone)
        StorePlant.objects.create(store=store, plant_code=plant)
        receive_stock(store=store, product_type=ProductType.STRAW, breed="MURRAH", qty=40)
        zones[code] = zone
    return zones


def manager_of(zone):
    user = User.objects.create_user(
        username=f"manager-{zone.code}",
        password="a-long-enough-password",
        full_name=f"{zone.name} manager",
        role=Role.ADMIN,
        portal_sections=[PortalSection.INVENTORY],
    )
    user.zones.add(zone)
    return user


def head_office():
    return User.objects.create_user(
        username="head-office",
        password="a-long-enough-password",
        full_name="Head office",
        role=Role.ADMIN,
        portal_sections=[PortalSection.INVENTORY],
    )


class TestZoneStock:
    def test_a_zonal_manager_sees_their_zones_maits_and_stores(self, network):
        body = auth(manager_of(network["MATHURA"])).get(URL).json()

        assert [row["name"] for row in body["results"]] == ["Mathura Mait"]
        assert [store["name"] for store in body["stores"]] == ["Mathura depot"]
        assert body["summary"]["store_straws"] == 40
        assert body["scope"]["scoped"] is True

    def test_the_shelf_says_what_is_set_aside(self, network):
        body = auth(manager_of(network["AGRA"])).get(URL).json()
        line = body["stores"][0]["lines"][0]
        assert (line["item_name"], line["on_hand"], line["available"]) == ("Murrah", 40, 40)

    def test_head_office_sees_the_network_and_can_pick_a_zone(self, network):
        client = auth(head_office())
        everything = client.get(URL).json()
        assert {store["name"] for store in everything["stores"]} == {"Mathura depot", "Agra depot"}
        assert everything["summary"]["store_straws"] == 80

        agra = client.get(URL, {"zone": network["AGRA"].id}).json()
        assert [row["name"] for row in agra["results"]] == ["Agra Mait"]
        assert [store["name"] for store in agra["stores"]] == ["Agra depot"]
        assert agra["scope"]["zones"] == ["Agra"]

    def test_a_manager_cannot_pick_their_way_into_another_zone(self, network):
        client = auth(manager_of(network["MATHURA"]))
        body = client.get(URL, {"zone": network["AGRA"].id}).json()
        assert body["results"] == []
        assert body["stores"] == []

    def test_a_maits_detail_outside_the_zone_is_not_found(self, network):
        client = auth(manager_of(network["MATHURA"]))
        body = client.get(URL).json()
        mine = body["results"][0]["mait_id"]
        theirs = (
            auth(head_office())
            .get(URL, {"zone": network["AGRA"].id})
            .json()["results"][0]["mait_id"]
        )
        assert client.get(f"{URL}{mine}/").status_code == 200
        assert client.get(f"{URL}{theirs}/").status_code == 404
