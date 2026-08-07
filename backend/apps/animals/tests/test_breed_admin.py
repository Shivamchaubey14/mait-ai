"""
Semen list maintenance (SRS §6.3 step 3, §6.6.1, §18.2).

The straw half of the catalogue: the breeds a Mait can be issued, can ask for, and can record
an animal against. Straws themselves are never typed in here — they arrive by being issued
against an indent — so what this screen owns is the list, its labels in both languages, and
the rate per straw.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.animals.models import BreedConfig
from apps.indents.models import IndentRequest
from apps.inventory.models import ProductType, SemenBatch

pytestmark = pytest.mark.django_db

BASE = "/api/v1/admin/breeds"


def auth(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-breeds",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


class TestAdding:
    def test_an_admin_adds_a_breed(self, admin_client):
        response = admin_client.post(
            f"{BASE}/",
            {
                "code": "murrah",
                "name": "Murrah",
                "name_hi": "मुर्रा",
                "animal_type": "BUFF",
                "rate": "250.00",
            },
            format="json",
        )

        assert response.status_code == 201, response.json()
        breed = BreedConfig.objects.get(code="MURRAH")
        assert breed.name_hi == "मुर्रा"
        assert breed.rate == Decimal("250.00")

    def test_the_same_breed_can_exist_for_both_animals(self, admin_client):
        admin_client.post(
            f"{BASE}/", {"code": "GIR", "name": "Gir", "animal_type": "COW"}, format="json"
        )

        response = admin_client.post(
            f"{BASE}/", {"code": "GIR", "name": "Gir", "animal_type": "BUFF"}, format="json"
        )

        # The key is the pair, not the code — the same word can name a cow and a buffalo.
        assert response.status_code == 201, response.json()

    def test_a_duplicate_for_one_animal_is_refused(self, admin_client):
        BreedConfig.objects.create(code="GIR", name="Gir", animal_type="COW")

        response = admin_client.post(
            f"{BASE}/", {"code": "gir", "name": "Gir", "animal_type": "COW"}, format="json"
        )

        assert response.status_code == 400


class TestEditing:
    def test_labels_and_rate_are_editable(self, admin_client):
        breed = BreedConfig.objects.create(code="HF", name="HF", animal_type="COW")

        response = admin_client.patch(
            f"{BASE}/{breed.id}/",
            {"name": "Holstein Friesian", "name_hi": "एचएफ", "rate": "180.00"},
            format="json",
        )

        assert response.status_code == 200, response.json()
        breed.refresh_from_db()
        assert breed.name == "Holstein Friesian"
        assert breed.rate == Decimal("180.00")

    def test_the_key_never_changes(self, admin_client):
        breed = BreedConfig.objects.create(code="HF", name="HF", animal_type="COW")

        admin_client.patch(
            f"{BASE}/{breed.id}/", {"code": "HF2", "animal_type": "BUFF"}, format="json"
        )

        # Straws, animals and indents all reference the pair. Re-keying would orphan them.
        breed.refresh_from_db()
        assert (breed.code, breed.animal_type) == ("HF", "COW")

    def test_retiring_takes_it_off_the_app(self, admin_client):
        breed = BreedConfig.objects.create(code="OLD", name="Old breed", animal_type="COW")

        admin_client.patch(f"{BASE}/{breed.id}/", {"is_active": False}, format="json")

        listed = admin_client.get("/api/v1/config/breeds/").json()
        assert all(row["code"] != "OLD" for row in listed)
        assert BreedConfig.objects.filter(code="OLD").exists()


class TestDeleting:
    def test_an_unused_breed_can_be_deleted(self, admin_client):
        breed = BreedConfig.objects.create(code="TYPO", name="Mistake", animal_type="COW")

        response = admin_client.delete(f"{BASE}/{breed.id}/")

        assert response.status_code == 204
        assert not BreedConfig.objects.filter(code="TYPO").exists()

    def test_a_breed_with_straws_cannot_be_deleted(self, admin_client):
        breed = BreedConfig.objects.create(code="MURRAH", name="Murrah", animal_type="BUFF")
        SemenBatch.objects.create(unique_straw_no="MUR-1", breed="MURRAH")

        response = admin_client.delete(f"{BASE}/{breed.id}/")

        # The straw names the breed by code and keeps no copy of the label.
        assert response.status_code == 409
        assert BreedConfig.objects.filter(code="MURRAH").exists()

    def test_a_breed_on_an_animal_cannot_be_deleted(self, admin_client, animal):
        breed = BreedConfig.objects.create(code=animal.breed, name="In use", animal_type="COW")

        response = admin_client.delete(f"{BASE}/{breed.id}/")

        assert response.status_code == 409

    def test_a_breed_on_an_indent_cannot_be_deleted(self, admin_client, mait):
        breed = BreedConfig.objects.create(code="SAHIWAL", name="Sahiwal", animal_type="COW")
        IndentRequest.objects.create(
            mait=mait, product_type=ProductType.STRAW, breed="SAHIWAL", qty_requested=10
        )

        response = admin_client.delete(f"{BASE}/{breed.id}/")

        assert response.status_code == 409


class TestAccess:
    def test_a_mait_cannot_edit_the_list(self, mait):
        breed = BreedConfig.objects.create(code="GIR", name="Gir", animal_type="COW")

        response = auth(mait.user).patch(f"{BASE}/{breed.id}/", {"rate": "1.00"}, format="json")

        assert response.status_code == 403

    def test_a_mait_can_still_read_the_list(self, mait):
        BreedConfig.objects.create(code="GIR", name="Gir", animal_type="COW")

        response = auth(mait.user).get("/api/v1/config/breeds/")

        # They pick from it at step 3 and on the request form.
        assert response.status_code == 200
        assert response.json()[0]["code"] == "GIR"
