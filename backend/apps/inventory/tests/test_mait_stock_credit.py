"""
Adding stock to a Mait from the office (SRS §6.7.6).

The oversight screen's one write: a manual credit for stock that never came through an indent
— an opening balance, straws carried by hand, a correction. It is an exception to the ordinary
path (a store hands an approved indent over the counter), so it is recorded as an `adjustment`
against `manual` and audited, and the ledger it writes must still sum to the balance.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.animals.models import AnimalType, BreedConfig
from apps.core.models import AuditLog
from apps.inventory.models import (
    Consumable,
    MaitInventory,
    MaitInventoryLedger,
    ProductType,
    SemenBatch,
)

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


def auth(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-stock",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


@pytest.fixture
def gir(db):
    # get_or_create, not create: a data migration already seeds a COW/GIR breed, and a second
    # one would collide on the per-animal-type unique constraint.
    breed, _ = BreedConfig.objects.get_or_create(
        animal_type=AnimalType.COW, code="GIR", defaults={"name": "Gir"}
    )
    if not breed.is_active:
        breed.is_active = True
        breed.save(update_fields=["is_active"])
    return breed


@pytest.fixture
def gloves(db):
    product, _ = Consumable.objects.get_or_create(
        code="TEST-GLOVE",
        defaults={
            "name": "Gloves",
            "category": Consumable.Category.CONSUMABLE,
            "unit": "box",
        },
    )
    return product


class TestAddStraws:
    def test_credits_straws_by_breed(self, admin_client, mait, gir):
        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 5},
            format="json",
        )

        assert body.status_code == 201
        assert body.json()["by_breed"] == {"GIR": 5}
        assert body.json()["total_straws"] == 5

    def test_one_row_per_straw_as_unnumbered_placeholders(self, admin_client, mait, gir):
        admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 3},
            format="json",
        )

        straws = SemenBatch.objects.filter(unique_straw_no__startswith="ADJ-", breed="GIR")
        assert straws.count() == 3
        # They carry no real number yet — the Mait supplies it at the AI step, which claims the
        # row they already hold.
        assert all(straw.is_unnumbered for straw in straws)

    def test_the_credit_is_an_audited_manual_adjustment(self, admin_client, mait, gir):
        admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 2, "note": "Opening balance"},
            format="json",
        )

        entries = MaitInventoryLedger.objects.filter(inventory__mait=mait)
        assert entries.count() == 2
        assert all(e.txn_type == MaitInventoryLedger.TxnType.ADJUSTMENT for e in entries)
        assert all(e.ref_type == MaitInventoryLedger.RefType.MANUAL for e in entries)
        assert AuditLog.objects.filter(entity_type="mait_stock", entity_id=mait.id).exists()

    def test_ledger_still_sums_to_the_balance(self, admin_client, mait, gir):
        admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 4},
            format="json",
        )

        for inventory in MaitInventory.objects.filter(mait=mait):
            ledger_sum = sum(e.qty for e in inventory.ledger_entries.all())
            assert ledger_sum == inventory.qty_available

    def test_adds_to_what_is_already_held(self, admin_client, mait, gir, stocked_mait):
        stocked_mait(2)  # two GIR straws already

        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 3},
            format="json",
        )

        assert body.json()["by_breed"]["GIR"] == 5

    def test_an_unknown_breed_is_refused(self, admin_client, mait, gir):
        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "NOPE", "qty": 1},
            format="json",
        )
        assert body.status_code == 400

    def test_a_long_breed_code_still_fits_the_straw_number(self, admin_client, mait):
        """
        Regression: the placeholder number used to be breed + Mait id + clock strung together,
        which ran past `unique_straw_no`'s 30 characters for a long code and failed the write
        with "Data too long" — the office saw only "Something went wrong".
        """
        BreedConfig.objects.get_or_create(
            animal_type=AnimalType.BUFFALO,
            code="SEX_SORTED_SEMEN",  # 16 chars — the code that broke it
            defaults={"name": "Sex-sorted semen"},
        )

        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "SEX_SORTED_SEMEN", "qty": 3},
            format="json",
        )

        assert body.status_code == 201, body.json()
        assert body.json()["by_breed"]["SEX_SORTED_SEMEN"] == 3
        straws = SemenBatch.objects.filter(breed="SEX_SORTED_SEMEN")
        assert straws.count() == 3
        # The number is unique and comfortably inside the column, whatever the breed is called.
        numbers = list(straws.values_list("unique_straw_no", flat=True))
        assert len(set(numbers)) == 3
        assert all(len(n) <= 30 for n in numbers)


class TestAddConsumables:
    def test_credits_a_catalogue_product(self, admin_client, mait, gloves):
        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "consumable", "product_ref_id": gloves.id, "qty": 6},
            format="json",
        )

        assert body.status_code == 201
        line = MaitInventory.objects.get(
            mait=mait, product_type=ProductType.CONSUMABLE, product_ref_id=gloves.id
        )
        assert line.qty_available == 6
        assert body.json()["consumables"][0]["qty"] == 6

    def test_a_product_not_on_the_catalogue_is_refused(self, admin_client, mait):
        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "consumable", "product_ref_id": 999999, "qty": 1},
            format="json",
        )
        assert body.status_code == 400


class TestRemoveStock:
    """
    The mirror of a credit: a quantity taken off a Mait when a count was entered too high, or
    stock was recorded against the wrong person. Recorded as a negative `adjustment` against
    `manual`, so the ledger still sums to the balance and the audit trail still names who did it.
    """

    def _credit(self, admin_client, mait, body):
        return admin_client.post(f"{BASE}/admin/inventory/{mait.id}/", body, format="json")

    def test_removes_straws_by_breed(self, admin_client, mait, gir):
        self._credit(admin_client, mait, {"product_type": "straw", "breed": "GIR", "qty": 5})

        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 2, "direction": "remove"},
            format="json",
        )

        assert body.status_code == 200
        assert body.json()["by_breed"]["GIR"] == 3

    def test_removing_more_straws_than_held_is_refused(self, admin_client, mait, gir):
        self._credit(admin_client, mait, {"product_type": "straw", "breed": "GIR", "qty": 2})

        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 5, "direction": "remove"},
            format="json",
        )

        assert body.status_code == 400
        # Nothing was taken off on a refusal.
        assert admin_client.get(f"{BASE}/admin/inventory/{mait.id}/").json()["by_breed"]["GIR"] == 2

    def test_removal_is_a_negative_audited_adjustment_that_still_sums(self, admin_client, mait, gir):
        self._credit(admin_client, mait, {"product_type": "straw", "breed": "GIR", "qty": 3})
        admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 1, "direction": "remove"},
            format="json",
        )

        debit = MaitInventoryLedger.objects.filter(inventory__mait=mait, qty__lt=0)
        assert debit.count() == 1
        entry = debit.first()
        assert entry.txn_type == MaitInventoryLedger.TxnType.ADJUSTMENT
        assert entry.ref_type == MaitInventoryLedger.RefType.MANUAL
        # The balance and the ledger behind it still agree, which is the whole discipline here.
        for inventory in MaitInventory.objects.filter(mait=mait):
            assert sum(e.qty for e in inventory.ledger_entries.all()) == inventory.qty_available
        logged = AuditLog.objects.get(
            entity_type="mait_stock", entity_id=mait.id, action=AuditLog.Action.UPDATE
        )
        assert logged.meta_json["qty"] == -1

    def test_removes_a_consumable_quantity(self, admin_client, mait, gloves):
        self._credit(
            admin_client, mait, {"product_type": "consumable", "product_ref_id": gloves.id, "qty": 6}
        )

        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {
                "product_type": "consumable",
                "product_ref_id": gloves.id,
                "qty": 4,
                "direction": "remove",
            },
            format="json",
        )

        assert body.status_code == 200
        line = MaitInventory.objects.get(
            mait=mait, product_type=ProductType.CONSUMABLE, product_ref_id=gloves.id
        )
        assert line.qty_available == 2

    def test_removing_more_consumable_than_held_is_refused(self, admin_client, mait, gloves):
        self._credit(
            admin_client, mait, {"product_type": "consumable", "product_ref_id": gloves.id, "qty": 3}
        )

        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {
                "product_type": "consumable",
                "product_ref_id": gloves.id,
                "qty": 9,
                "direction": "remove",
            },
            format="json",
        )
        assert body.status_code == 400

    def test_a_straw_held_by_an_unfinished_capture_is_not_removed(self, admin_client, mait, gir, mpp, member, animal):
        import uuid

        from apps.ai_events.models import AIEvent, AIEventStraw

        self._credit(admin_client, mait, {"product_type": "straw", "breed": "GIR", "qty": 2})
        held = SemenBatch.objects.filter(breed="GIR").first()
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            status=AIEvent.Status.STRAW_VERIFIED,
            semen_batch=held,
        )
        AIEventStraw.objects.create(ai_event=event, semen_batch=held)

        # Both cannot go — one is standing under an open capture — so the whole removal is refused.
        refused = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 2, "direction": "remove"},
            format="json",
        )
        assert refused.status_code == 400

        # The free one still comes off cleanly.
        ok = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 1, "direction": "remove"},
            format="json",
        )
        assert ok.status_code == 200
        assert ok.json()["by_breed"]["GIR"] == 1

    def test_a_mait_cannot_remove_stock(self, mait, gir):
        auth_mait = auth(mait.user)
        body = auth_mait.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 1, "direction": "remove"},
            format="json",
        )
        assert body.status_code == 403


class TestGuards:
    def test_catalogue_is_returned_for_the_form(self, admin_client, mait, gir, gloves):
        body = admin_client.get(f"{BASE}/admin/inventory/{mait.id}/").json()

        assert "GIR" in [b["code"] for b in body["catalogue"]["breeds"]]
        assert "TEST-GLOVE" in [p["code"] for p in body["catalogue"]["products"]]

    def test_a_quantity_of_zero_is_refused(self, admin_client, mait, gir):
        body = admin_client.post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 0},
            format="json",
        )
        assert body.status_code == 400

    def test_a_mait_cannot_credit_stock(self, mait, gir):
        body = auth(mait.user).post(
            f"{BASE}/admin/inventory/{mait.id}/",
            {"product_type": "straw", "breed": "GIR", "qty": 1},
            format="json",
        )
        assert body.status_code == 403
