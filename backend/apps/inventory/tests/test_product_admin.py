"""
Catalogue maintenance (SRS §6.6.1, §9.5).

The catalogue is what names an indent. A request raised against a product that is not in it
comes out as "25 × Consumable" on every screen, which tells a depot nothing about what to
pack — so this is the screen that keeps the rest of the indent flow legible.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.indents.models import IndentRequest
from apps.inventory.models import Consumable, MaitInventory, ProductType

pytestmark = pytest.mark.django_db

BASE = "/api/v1/admin/products"


def auth(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-catalogue",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


class TestAdding:
    def test_an_admin_adds_a_product(self, admin_client):
        response = admin_client.post(
            f"{BASE}/",
            {
                "code": "sheath",
                "name": "AI sheaths",
                "category": "consumable",
                "unit": "piece",
                "rate": "3.50",
            },
            format="json",
        )

        assert response.status_code == 201, response.json()
        product = Consumable.objects.get(code="SHEATH")
        assert product.name == "AI sheaths"
        assert product.rate == Decimal("3.50")

    def test_the_code_is_normalised(self, admin_client):
        admin_client.post(
            f"{BASE}/",
            {"code": "  ln2  ", "name": "Liquid nitrogen", "category": "consumable"},
            format="json",
        )

        # Indents, uploads and the app all key on this. Case drift would fork the product.
        assert Consumable.objects.filter(code="LN2").exists()

    def test_a_duplicate_code_is_refused(self, admin_client):
        Consumable.objects.create(code="GLOVES", name="Gloves")

        response = admin_client.post(
            f"{BASE}/", {"code": "gloves", "name": "Nitrile gloves"}, format="json"
        )

        assert response.status_code == 400
        assert "code" in response.json()["errors"]

    def test_a_rate_is_optional(self, admin_client):
        response = admin_client.post(
            f"{BASE}/", {"code": "TRAY", "name": "Thawing tray", "category": "asset"}, format="json"
        )

        # Zero rather than a refusal: the catalogue is filled in by hand over time, and an
        # unpriced product still has to be requestable.
        assert response.status_code == 201, response.json()
        assert Consumable.objects.get(code="TRAY").rate == Decimal("0")


class TestEditing:
    def test_the_name_and_rate_can_be_corrected(self, admin_client):
        product = Consumable.objects.create(code="SHEATH", name="Sheats", rate=Decimal("3.00"))

        response = admin_client.patch(
            f"{BASE}/{product.id}/", {"name": "AI sheaths", "rate": "4.25"}, format="json"
        )

        assert response.status_code == 200, response.json()
        product.refresh_from_db()
        assert product.name == "AI sheaths"
        assert product.rate == Decimal("4.25")

    def test_the_code_never_changes(self, admin_client):
        product = Consumable.objects.create(code="SHEATH", name="AI sheaths")

        admin_client.patch(f"{BASE}/{product.id}/", {"code": "SHEATH2"}, format="json")

        # Renaming it would orphan every indent already raised against it.
        product.refresh_from_db()
        assert product.code == "SHEATH"

    def test_retiring_a_product_hides_it_from_the_app(self, admin_client):
        product = Consumable.objects.create(code="OLD", name="Old kit")

        admin_client.patch(f"{BASE}/{product.id}/", {"is_active": False}, format="json")

        catalogue = admin_client.get("/api/v1/config/products/").json()
        assert all(row["code"] != "OLD" for row in catalogue)
        # Deactivated, not deleted: stock and indents still point at it by id.
        assert Consumable.objects.filter(code="OLD").exists()

    def test_an_unused_product_can_be_deleted(self, admin_client):
        product = Consumable.objects.create(code="TYPO", name="Added by mistake")

        response = admin_client.delete(f"{BASE}/{product.id}/")

        # What delete is actually for. Nothing points at it yet.
        assert response.status_code == 204
        assert not Consumable.objects.filter(code="TYPO").exists()

    def test_a_product_on_an_indent_cannot_be_deleted(self, admin_client, mait):
        product = Consumable.objects.create(code="SHEATH", name="AI sheaths")
        IndentRequest.objects.create(
            mait=mait,
            product_type=ProductType.CONSUMABLE,
            product_ref_id=product.id,
            qty_requested=10,
        )

        response = admin_client.delete(f"{BASE}/{product.id}/")

        # The indent names it by id and keeps no copy of the name — deleting would leave the
        # request reading as a quantity of something.
        assert response.status_code == 409
        assert Consumable.objects.filter(code="SHEATH").exists()

    def test_a_product_in_stock_cannot_be_deleted(self, admin_client, mait):
        product = Consumable.objects.create(code="GLOVES", name="Gloves")
        MaitInventory.objects.create(
            mait=mait,
            product_type=ProductType.CONSUMABLE,
            product_ref_id=product.id,
            qty_available=6,
        )

        response = admin_client.delete(f"{BASE}/{product.id}/")

        assert response.status_code == 409


class TestAccess:
    def test_a_mait_cannot_edit_the_catalogue(self, mait):
        product = Consumable.objects.create(code="SHEATH", name="AI sheaths")

        response = auth(mait.user).patch(f"{BASE}/{product.id}/", {"rate": "99.00"}, format="json")

        assert response.status_code == 403

    def test_a_mait_can_still_read_the_catalogue(self, mait):
        Consumable.objects.create(code="SHEATH", name="AI sheaths")

        response = auth(mait.user).get("/api/v1/config/products/")

        # They have to be able to ask for it, which means seeing it on the request form.
        assert response.status_code == 200
        assert response.json()[0]["code"] == "SHEATH"
