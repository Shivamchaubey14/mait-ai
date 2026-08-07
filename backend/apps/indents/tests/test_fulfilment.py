"""
Admin fulfilment of an indent (SRS §6.6, §9.8).

These endpoints are the manual stand-in for the Indent Easy GRN callback, so they are the
only place outside that webhook where stock appears from nowhere. The tests worth having are
therefore about what they refuse: a straw issued twice would put one physical object in two
Maits' stock and let both scan it, which is the single invariant this platform exists to
protect (ADR 0002).
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.indents.models import IndentRequest
from apps.inventory.models import (
    Consumable,
    MaitInventory,
    MaitInventoryLedger,
    ProductType,
    SemenBatch,
)
from apps.inventory.services import available_straw_count, reconcile_balance

pytestmark = pytest.mark.django_db

BASE = "/api/v1/indents"


def auth(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-fulfilment",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


@pytest.fixture
def straw_indent(db, mait):
    def _make(status=IndentRequest.Status.REQUESTED, qty=3, breed="MURRAH"):
        return IndentRequest.objects.create(
            mait=mait,
            product_type=ProductType.STRAW,
            breed=breed,
            qty_requested=qty,
            status=status,
        )

    return _make


@pytest.fixture
def consumable_indent(db, mait):
    def _make(status=IndentRequest.Status.APPROVED, qty=10):
        product = Consumable.objects.create(code="SHEATH", name="Sheaths", unit="piece")
        return IndentRequest.objects.create(
            mait=mait,
            product_type=ProductType.CONSUMABLE,
            product_ref_id=product.id,
            qty_requested=qty,
            status=status,
        )

    return _make


class TestApproval:
    def test_an_admin_approves(self, admin_client, straw_indent):
        indent = straw_indent()

        response = admin_client.post(f"{BASE}/{indent.id}/approve/", format="json")

        assert response.status_code == 200, response.json()
        assert response.json()["status"] == IndentRequest.Status.APPROVED

    def test_approval_moves_no_stock(self, admin_client, straw_indent, mait):
        indent = straw_indent()

        admin_client.post(f"{BASE}/{indent.id}/approve/", format="json")

        # Agreeing to a request is not the same as handing anything over.
        assert available_straw_count(mait) == 0

    def test_a_mait_cannot_approve_their_own_request(self, mait, straw_indent):
        indent = straw_indent()

        response = auth(mait.user).post(f"{BASE}/{indent.id}/approve/", format="json")

        # Enforced at the API, not by hiding the button: a Mait who could approve their own
        # request could credit themselves stock.
        assert response.status_code == 403

    def test_approving_twice_is_refused(self, admin_client, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.APPROVED)

        response = admin_client.post(f"{BASE}/{indent.id}/approve/", format="json")

        assert response.status_code == 409

    def test_rejection_keeps_the_reason_where_the_mait_reads_it(self, admin_client, straw_indent):
        indent = straw_indent()

        response = admin_client.post(
            f"{BASE}/{indent.id}/reject/",
            {"reason": "No Murrah stock at the depot"},
            format="json",
        )

        assert response.status_code == 200, response.json()
        indent.refresh_from_db()
        assert indent.status == IndentRequest.Status.REJECTED
        assert "No Murrah stock at the depot" in indent.note

    def test_an_approved_indent_can_still_be_rejected(self, admin_client, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.APPROVED)

        response = admin_client.post(
            f"{BASE}/{indent.id}/reject/", {"reason": "Depot ran out"}, format="json"
        )

        # Approval is the office agreeing, not the depot packing. Stock runs out between the
        # two, and an approved request nobody can fulfil looks like stock on its way.
        assert response.status_code == 200, response.json()
        indent.refresh_from_db()
        assert indent.status == IndentRequest.Status.REJECTED

    def test_issued_stock_is_past_rejecting(self, admin_client, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)
        admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0200"]}, format="json"
        )

        response = admin_client.post(f"{BASE}/{indent.id}/reject/", {}, format="json")

        # Straws have been set aside against it by now.
        assert response.status_code == 409


class TestIssuing:
    def test_straws_are_issued_by_number(self, admin_client, straw_indent, mait):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=3)

        response = admin_client.post(
            f"{BASE}/{indent.id}/issue/",
            {"straw_numbers": ["MUR-0001", "MUR-0002", "MUR-0003"]},
            format="json",
        )

        assert response.status_code == 200, response.json()
        body = response.json()
        assert body["status"] == IndentRequest.Status.ISSUED
        assert body["qty_issued"] == 3
        # Each straw is a row of its own, scannable by the number printed on it.
        assert SemenBatch.objects.filter(unique_straw_no="MUR-0002", breed="MURRAH").exists()

    def test_issuing_sets_aside_rather_than_credits(self, admin_client, straw_indent, mait):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=3)

        admin_client.post(
            f"{BASE}/{indent.id}/issue/",
            {"straw_numbers": ["MUR-0002", "MUR-0003"]},
            format="json",
        )

        # The straws are at the depot until collected. A balance counting them would tell the
        # Mait they can start an AI whose straw is miles away.
        assert available_straw_count(mait) == 0
        indent.refresh_from_db()
        assert indent.issued_straw_numbers == ["MUR-0002", "MUR-0003"]

    def test_a_straw_set_aside_for_another_indent_is_refused(
        self, admin_client, straw_indent, mait
    ):
        first = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)
        admin_client.post(
            f"{BASE}/{first.id}/issue/", {"straw_numbers": ["MUR-0005"]}, format="json"
        )
        second = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)

        response = admin_client.post(
            f"{BASE}/{second.id}/issue/", {"straw_numbers": ["MUR-0005"]}, format="json"
        )

        # Otherwise two Maits are sent to the depot for the same physical straw, and the
        # second finds it gone having been told it was theirs.
        assert response.status_code == 409

    def test_the_ledger_sums_to_the_balance_after_collection(
        self, admin_client, straw_indent, mait
    ):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=2)
        admin_client.post(
            f"{BASE}/{indent.id}/issue/",
            {"straw_numbers": ["MUR-0010", "MUR-0011"]},
            format="json",
        )
        auth(mait.user).post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        for inventory in MaitInventory.objects.all():
            balance, ledger_sum = reconcile_balance(inventory)
            assert balance == ledger_sum

    def test_the_movement_names_the_indent_it_came_from(self, admin_client, straw_indent, mait):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)
        admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0020"]}, format="json"
        )
        auth(mait.user).post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        entry = MaitInventoryLedger.objects.get()
        assert entry.ref_type == MaitInventoryLedger.RefType.INDENT
        assert entry.ref_id == indent.id
        assert entry.created_by is not None

    def test_a_straw_another_mait_holds_is_refused(self, admin_client, straw_indent, mait):
        other = SemenBatch.objects.create(unique_straw_no="MUR-0030", breed="MURRAH")
        holder = IndentRequest.objects.create(  # a second Mait, via their own indent
            mait=mait, product_type=ProductType.STRAW, breed="MURRAH", qty_requested=1
        )
        MaitInventory.objects.create(
            mait=holder.mait,
            product_type=ProductType.STRAW,
            product_ref_id=other.id,
            qty_available=1,
        )
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)

        response = admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0030"]}, format="json"
        )

        # One physical straw cannot be in two stocks. This is the invariant, not a nicety.
        assert response.status_code == 409
        assert "already held" in response.json()["detail"]

    def test_a_consumed_straw_cannot_be_reissued(self, admin_client, straw_indent):
        SemenBatch.objects.create(unique_straw_no="MUR-0040", breed="MURRAH", is_consumed=True)
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)

        response = admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0040"]}, format="json"
        )

        assert response.status_code == 409

    def test_a_straw_of_the_wrong_breed_is_refused(self, admin_client, straw_indent):
        SemenBatch.objects.create(unique_straw_no="GIR-0001", breed="GIR")
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1, breed="MURRAH")

        response = admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["GIR-0001"]}, format="json"
        )

        # Otherwise the app counts a breed the Mait is not carrying, and they find out with a
        # farmer waiting.
        assert response.status_code == 400

    def test_more_straws_than_were_asked_for_are_refused(self, admin_client, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=2)

        response = admin_client.post(
            f"{BASE}/{indent.id}/issue/",
            {"straw_numbers": ["MUR-0050", "MUR-0051", "MUR-0052"]},
            format="json",
        )

        assert response.status_code == 400

    def test_the_same_number_twice_is_refused(self, admin_client, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=2)

        response = admin_client.post(
            f"{BASE}/{indent.id}/issue/",
            {
                "straw_numbers": ["MUR-0060", "mur-0060"],
            },
            format="json",
        )

        assert response.status_code == 400

    def test_straws_can_be_issued_as_a_quantity(self, admin_client, straw_indent, mait):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=25)

        response = admin_client.post(f"{BASE}/{indent.id}/issue/", {"qty": 25}, format="json")

        assert response.status_code == 200, response.json()
        assert response.json()["qty_issued"] == 25

        auth(mait.user).post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        # Still one row per straw — a straw is one physical object one animal gets. They just
        # have no numbers until a Mait reads one off.
        assert available_straw_count(mait) == 25
        assert SemenBatch.objects.filter(is_unnumbered=True, breed="MURRAH").count() == 25

    def test_a_quantity_over_the_request_is_refused(self, admin_client, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=3)

        response = admin_client.post(f"{BASE}/{indent.id}/issue/", {"qty": 4}, format="json")

        assert response.status_code == 400

    def test_only_an_approved_indent_can_be_issued(self, admin_client, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.REQUESTED, qty=1)

        response = admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0070"]}, format="json"
        )

        assert response.status_code == 409

    def test_issuing_twice_is_refused(self, admin_client, straw_indent, mait):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)
        admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0080"]}, format="json"
        )

        response = admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0081"]}, format="json"
        )

        assert response.status_code == 409
        indent.refresh_from_db()
        assert indent.issued_straw_numbers == ["MUR-0080"]

    def test_fewer_than_requested_closes_the_indent(self, admin_client, straw_indent, mait):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=5)

        response = admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0090", "MUR-0091"]}, format="json"
        )

        # No partial state exists, and an indent left open would read as stock still coming.
        assert response.status_code == 200, response.json()
        assert response.json()["qty_issued"] == 2
        assert response.json()["status"] == IndentRequest.Status.ISSUED

        auth(mait.user).post(f"{BASE}/{indent.id}/confirm-collection/", format="json")
        assert available_straw_count(mait) == 2

    def test_a_mait_cannot_issue_to_themselves(self, mait, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)

        response = auth(mait.user).post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0100"]}, format="json"
        )

        assert response.status_code == 403


class TestCollection:
    """The last step, and the only one the Mait owns."""

    def test_a_mait_confirms_collection_of_issued_stock(self, admin_client, straw_indent, mait):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)
        admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0110"]}, format="json"
        )

        response = auth(mait.user).post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        assert response.status_code == 200, response.json()
        assert response.json()["received_at"] is not None

    def test_confirming_is_what_credits_the_stock(self, admin_client, straw_indent, mait):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)
        admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0120"]}, format="json"
        )
        assert available_straw_count(mait) == 0

        auth(mait.user).post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        # Set aside at issue, theirs at collection. Until then the straw is at the depot.
        assert available_straw_count(mait) == 1

    def test_a_straw_consumed_between_issue_and_collection_is_refused(
        self, admin_client, straw_indent, mait
    ):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)
        admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0125"]}, format="json"
        )
        SemenBatch.objects.filter(unique_straw_no="MUR-0125").update(is_consumed=True)

        response = auth(mait.user).post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        # Days can pass between the two, which is why the check runs again rather than
        # trusting what was true when it was set aside.
        assert response.status_code == 409
        assert available_straw_count(mait) == 0

    def test_stock_not_yet_issued_cannot_be_collected(self, mait, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)

        response = auth(mait.user).post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        assert response.status_code == 409

    def test_confirming_twice_is_refused(self, admin_client, straw_indent, mait):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)
        admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0130"]}, format="json"
        )
        client = auth(mait.user)
        client.post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        response = client.post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        assert response.status_code == 409

    def test_an_admin_cannot_confirm_on_a_maits_behalf(self, admin_client, straw_indent):
        indent = straw_indent(status=IndentRequest.Status.APPROVED, qty=1)
        admin_client.post(
            f"{BASE}/{indent.id}/issue/", {"straw_numbers": ["MUR-0140"]}, format="json"
        )

        response = admin_client.post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        # Someone signing for goods they did not receive is the thing this step exists to
        # rule out.
        assert response.status_code == 403


class TestConsumables:
    def test_the_item_names_the_product(self, admin_client, consumable_indent):
        indent = consumable_indent(qty=10)

        response = admin_client.get(f"{BASE}/{indent.id}/")

        # "10 × Consumable" tells nobody whether the sheaths or the gloves are coming, and
        # this string is the whole description of the request on both screens.
        assert response.json()["item"] == "10 × Sheaths"

    def test_an_older_indent_is_named_from_its_note(self, admin_client, mait):
        Consumable.objects.create(code="GLOVES", name="Gloves", unit="pair")
        # Raised before the app sent product_ref_id: it put the product code in the note.
        legacy = IndentRequest.objects.create(
            mait=mait,
            product_type=ProductType.CONSUMABLE,
            product_ref_id=None,
            qty_requested=4,
            note="GLOVES",
        )

        response = admin_client.get(f"{BASE}/{legacy.id}/")

        assert response.json()["item"] == "4 × Gloves"

    def test_an_unnameable_product_falls_back_rather_than_breaking(self, admin_client, mait):
        orphan = IndentRequest.objects.create(
            mait=mait,
            product_type=ProductType.CONSUMABLE,
            product_ref_id=None,
            qty_requested=2,
            note="",
        )

        response = admin_client.get(f"{BASE}/{orphan.id}/")

        assert response.json()["item"] == "2 × Consumable"

    def test_consumables_are_issued_by_quantity(self, admin_client, consumable_indent, mait):
        indent = consumable_indent(qty=10)

        response = admin_client.post(f"{BASE}/{indent.id}/issue/", {"qty": 10}, format="json")

        assert response.status_code == 200, response.json()
        # Set aside, like straws. Sheaths sitting at the depot are no more usable than a
        # straw sitting at the depot.
        assert not MaitInventory.objects.filter(mait=mait).exists()

        auth(mait.user).post(f"{BASE}/{indent.id}/confirm-collection/", format="json")

        holding = MaitInventory.objects.get(
            mait=mait, product_type=ProductType.CONSUMABLE, product_ref_id=indent.product_ref_id
        )
        assert holding.qty_available == 10

    def test_the_full_request_is_the_default(self, admin_client, consumable_indent):
        indent = consumable_indent(qty=6)

        response = admin_client.post(f"{BASE}/{indent.id}/issue/", {}, format="json")

        assert response.status_code == 200, response.json()
        assert response.json()["qty_issued"] == 6

    def test_more_than_requested_is_refused(self, admin_client, consumable_indent):
        indent = consumable_indent(qty=6)

        response = admin_client.post(f"{BASE}/{indent.id}/issue/", {"qty": 7}, format="json")

        assert response.status_code == 400
