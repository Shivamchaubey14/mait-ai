"""
Animal registry API tests (SRS §6.3 step 3, §9.4).

The cases that matter are the ones that would let a Mait register an animal against someone
else's member, or let the breed field turn into free text.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.animals.models import Animal, AnimalType, BreedConfig
from apps.masterdata.models import MPP, Mait, Member

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


def a_photo(name="animal.jpg", size=(40, 40)):
    """A real JPEG — ImageField opens it, so a handful of bytes will not do."""
    buffer = io.BytesIO()
    Image.new("RGB", size, (90, 140, 110)).save(buffer, format="JPEG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")


@pytest.fixture
def breeds(db):
    BreedConfig.objects.create(animal_type=AnimalType.COW, code="GIR", name="Gir")
    BreedConfig.objects.create(animal_type=AnimalType.BUFFALO, code="MURRAH", name="Murrah")
    BreedConfig.objects.create(
        animal_type=AnimalType.COW, code="RETIRED", name="Retired", is_active=False
    )


@pytest.fixture
def mait_client(api_client, mait, db):
    user = User.objects.create_user(username="mait-animals", full_name="M", role=Role.MAIT)
    mait.user = user
    mait.save(update_fields=["user"])
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api_client


class TestBreedConfig:
    def test_lists_active_breeds(self, mait_client, breeds):
        response = mait_client.get(f"{BASE}/config/breeds/")
        codes = [row["code"] for row in response.json()]

        assert response.status_code == 200
        assert "GIR" in codes
        # A breed the admin has retired must not reappear in the picker.
        assert "RETIRED" not in codes

    def test_filters_by_animal_type(self, mait_client, breeds):
        response = mait_client.get(f"{BASE}/config/breeds/?animal_type=BUFF")
        assert [row["code"] for row in response.json()] == ["MURRAH"]

    def test_is_unpaginated(self, mait_client, breeds):
        """The app caches the whole list at login so the picker works offline (SRS §6.3.2)."""
        assert isinstance(mait_client.get(f"{BASE}/config/breeds/").json(), list)


class TestAnimalCreation:
    def test_registers_an_animal_for_a_member(self, mait_client, breeds, member):
        response = mait_client.post(
            f"{BASE}/animals/",
            {
                "member_code": member.member_code,
                "animal_type": AnimalType.COW,
                "breed": "GIR",
                "ear_tag_no": "IN123456",
            },
            format="json",
        )
        assert response.status_code == 201, response.json()
        assert response.json()["owner_name"] == member.member_name
        assert Animal.objects.count() == 1

    def test_rejects_a_member_at_another_maits_mpp(self, mait_client, breeds, db):
        """SRS §16 — a Mait may only act at their own MPPs."""
        stranger = Mait.objects.create(sahayak_vendor_code="SAH-OTHER", name="Other")
        other_mpp = MPP.objects.create(mpp_code="MPP-OTHER", mpp_name="Far", mait=stranger)
        other_member = Member.objects.create(
            member_code="MEM-OTHER", member_name="Not Yours", mpp=other_mpp
        )

        response = mait_client.post(
            f"{BASE}/animals/",
            {
                "member_code": other_member.member_code,
                "animal_type": AnimalType.COW,
                "breed": "GIR",
            },
            format="json",
        )
        assert response.status_code == 400
        assert "member_code" in response.json()["errors"]
        assert not Animal.objects.exists()

    def test_requires_exactly_one_owner(self, mait_client, breeds, member):
        response = mait_client.post(
            f"{BASE}/animals/",
            {"animal_type": AnimalType.COW, "breed": "GIR"},
            format="json",
        )
        assert response.status_code == 400

    def test_rejects_a_breed_that_is_not_configured(self, mait_client, breeds, member):
        """
        Free text here would make the dashboard's breed breakdown meaningless within a
        month — Gir, gir and GIR would all be counted separately.
        """
        response = mait_client.post(
            f"{BASE}/animals/",
            {
                "member_code": member.member_code,
                "animal_type": AnimalType.COW,
                "breed": "Whatever I typed",
            },
            format="json",
        )
        assert response.status_code == 400
        assert "breed" in response.json()["errors"]

    def test_normalises_breed_case(self, mait_client, breeds, member):
        response = mait_client.post(
            f"{BASE}/animals/",
            {"member_code": member.member_code, "animal_type": AnimalType.COW, "breed": "gir"},
            format="json",
        )
        assert response.status_code == 201
        assert Animal.objects.get().breed == "GIR"

    def test_breed_is_optional(self, mait_client, breeds, member):
        """
        Step 4 of the capture flow registers what a Mait can see: cow or buffalo, and the tag
        if she carries one. Her breed is a judgement they often cannot make, and requiring it
        would fill the column with guesses — so it is recorded blank and can be corrected
        later. The breed asked for further down the flow is the straw's, not hers.
        """
        response = mait_client.post(
            f"{BASE}/animals/",
            {"member_code": member.member_code, "animal_type": AnimalType.COW},
            format="json",
        )

        assert response.status_code == 201
        assert Animal.objects.get().breed == ""

    def test_a_breed_that_is_given_is_still_checked(self, mait_client, breeds, member):
        """Optional is not free text: a breed supplied has to be one the admin configured."""
        response = mait_client.post(
            f"{BASE}/animals/",
            {"member_code": member.member_code, "animal_type": AnimalType.COW, "breed": "Jersey"},
            format="json",
        )

        assert response.status_code == 400
        assert not Animal.objects.exists()

    def test_ear_tag_is_optional(self, mait_client, breeds, member):
        response = mait_client.post(
            f"{BASE}/animals/",
            {"member_code": member.member_code, "animal_type": AnimalType.COW, "breed": "GIR"},
            format="json",
        )
        assert response.status_code == 201
        assert Animal.objects.get().ear_tag_no is None

    def test_attaches_her_portrait(self, mait_client, breeds, member, animal):
        """
        Registration and the photo are two calls on purpose: the animal has to exist even if
        the upload dies on a village connection, because the capture flow is already standing
        on her id by then.
        """
        response = mait_client.patch(
            f"{BASE}/animals/{animal.id}/photo/",
            {"photo": a_photo()},
            format="multipart",
        )

        assert response.status_code == 200, response.json()
        assert response.json()["photo_url"]
        animal.refresh_from_db()
        assert animal.photo_url.startswith("/media/animal-photos/")

    def test_will_not_take_a_photo_of_another_maits_animal(self, api_client, animal, db):
        other = User.objects.create_user(username="other-mait", full_name="O", role=Role.MAIT)
        Mait.objects.create(user=other, name="OTHER", sahayak_vendor_code="9999")
        api_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(other).access_token}"
        )

        response = api_client.patch(
            f"{BASE}/animals/{animal.id}/photo/", {"photo": a_photo()}, format="multipart"
        )

        assert response.status_code == 404
        animal.refresh_from_db()
        assert animal.photo_url == ""

    def test_ear_tag_must_be_unique_when_given(self, mait_client, breeds, member, animal):
        animal.ear_tag_no = "IN999999"
        animal.save(update_fields=["ear_tag_no"])

        response = mait_client.post(
            f"{BASE}/animals/",
            {
                "member_code": member.member_code,
                "animal_type": AnimalType.COW,
                "breed": "GIR",
                "ear_tag_no": "IN999999",
            },
            format="json",
        )
        assert response.status_code == 400
        assert "already registered" in str(response.json())

    def test_two_animals_may_both_have_no_tag(self, mait_client, breeds, member):
        """Null is not a duplicate — most animals in the field carry no tag at all."""
        for _ in range(2):
            response = mait_client.post(
                f"{BASE}/animals/",
                {"member_code": member.member_code, "animal_type": AnimalType.COW, "breed": "GIR"},
                format="json",
            )
            assert response.status_code == 201
        assert Animal.objects.count() == 2


class TestAnimalAccess:
    def test_admin_cannot_register_an_animal(self, api_client, breeds, member, db):
        """Registration happens in the field, by the Mait standing with the animal."""
        admin = User.objects.create_user(
            username="admin-animals",
            password="a-long-enough-password",
            full_name="Admin",
            role=Role.ADMIN,
        )
        api_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}"
        )
        response = api_client.post(
            f"{BASE}/animals/",
            {"member_code": member.member_code, "animal_type": AnimalType.COW, "breed": "GIR"},
            format="json",
        )
        assert response.status_code == 403

    def test_anonymous_is_rejected(self, api_client):
        assert api_client.get(f"{BASE}/config/breeds/").status_code == 401

    def test_mait_cannot_read_another_maits_animal(self, mait_client, breeds, db):
        stranger = Mait.objects.create(sahayak_vendor_code="SAH-X", name="X")
        other_mpp = MPP.objects.create(mpp_code="MPP-X", mpp_name="X", mait=stranger)
        other_member = Member.objects.create(member_code="MEM-X", member_name="X", mpp=other_mpp)
        hidden = Animal.objects.create(
            owner_type=Animal.OwnerType.MEMBER,
            member=other_member,
            animal_type=AnimalType.COW,
            breed="GIR",
        )
        assert mait_client.get(f"{BASE}/animals/{hidden.id}/").status_code == 404
