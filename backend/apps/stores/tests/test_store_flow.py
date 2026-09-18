"""
The store's side of an indent (apps/stores), walked over real HTTP.

A Mait raises it, the zonal manager approves it on the portal, the keeper at the Mait's store
hands it over from the app, and the Mait types the keeper's code to collect. The tests worth
having are the ones about what each step refuses: stock promised twice, a count that moves
before the Mait is at the counter, a code the Mait's own handset already knew, or a keeper who
can read more of the platform than their own shelf.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.animals.models import BreedConfig
from apps.indents.models import IndentHandover, IndentRequest
from apps.inventory.models import (
    Consumable,
    MaitInventory,
    MaitInventoryLedger,
    ProductType,
    SemenBatch,
)
from apps.inventory.services import available_straw_count, reconcile_balance
from apps.masterdata.models import Zone, ZonePlant
from apps.stores.models import Store, StoreLedger, StorePlant, StoreStock
from apps.stores.services import receive_stock
from conftest import MaitFactory, MPPFactory

pytestmark = pytest.mark.django_db

PLANT = "1101"
ELSEWHERE = "2202"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


# --------------------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------------------
@pytest.fixture
def breeds(db):
    BreedConfig.objects.get_or_create(
        animal_type="BUFF", code="MURRAH", defaults={"name": "Murrah", "rate": 0}
    )


@pytest.fixture
def mait(db):
    mait = MaitFactory()
    MPPFactory(mait=mait, plant_code=PLANT, plant_name="BARSANA BMC")
    return mait


@pytest.fixture
def store(db):
    store = Store.objects.create(code="BARSANA", name="Barsana depot")
    StorePlant.objects.create(store=store, plant_code=PLANT, plant_name="BARSANA BMC")
    return store


@pytest.fixture
def keeper(db, store):
    return User.objects.create_user(
        username="keeper-barsana",
        full_name="Ramesh Store",
        mobile_no="9123400001",
        role=Role.STORE,
        store=store,
    )


@pytest.fixture
def zone(db):
    zone = Zone.objects.create(code="MATHURA", name="Mathura")
    ZonePlant.objects.create(zone=zone, plant_code=PLANT, plant_name="BARSANA BMC")
    return zone


@pytest.fixture
def manager(db, zone):
    user = User.objects.create_user(
        username="zonal-mathura",
        password="a-long-enough-password",
        full_name="Zonal manager",
        role=Role.ADMIN,
        portal_sections=[PortalSection.INDENTS],
    )
    user.zones.add(zone)
    return user


@pytest.fixture
def raised(db, mait, store, breeds):
    """An indent raised through the API, the way the app raises one."""

    def _raise(qty=25, breed="MURRAH"):
        response = auth(mait.user).post(
            "/api/v1/indents/",
            {"product_type": "straw", "breed": breed, "qty_requested": qty},
            format="json",
        )
        assert response.status_code == 201, response.content
        return IndentRequest.objects.get(pk=response.json()["id"])

    return _raise


@pytest.fixture
def approved(raised, manager):
    def _approve(qty=25):
        indent = raised(qty)
        response = auth(manager).post(f"/api/v1/indents/{indent.id}/approve/")
        assert response.status_code == 200, response.content
        indent.refresh_from_db()
        return indent

    return _approve


def stock(store, qty, breed="MURRAH"):
    receive_stock(store=store, product_type=ProductType.STRAW, breed=breed, qty=qty)


def issue(keeper, indent, qty, flask=True):
    return auth(keeper).post(
        f"/api/v1/store/indents/{indent.id}/issue/",
        {"qty": qty, "flask_checked": flask},
        format="json",
    )


def collect(mait, indent, code):
    return auth(mait.user).post(
        f"/api/v1/indents/{indent.id}/confirm-collection/", {"code": code}, format="json"
    )


def wrong(code: str) -> str:
    return "0000" if code != "0000" else "1111"


# --------------------------------------------------------------------------------------
# Routing and approval
# --------------------------------------------------------------------------------------
class TestRouting:
    def test_an_indent_is_routed_to_the_store_serving_the_mait(self, raised, store):
        assert raised().store_id == store.id

    def test_no_store_serving_them_leaves_it_unrouted(self, breeds, store):
        stranger = MaitFactory()
        MPPFactory(mait=stranger, plant_code=ELSEWHERE)
        response = auth(stranger.user).post(
            "/api/v1/indents/",
            {"product_type": "straw", "breed": "MURRAH", "qty_requested": 5},
            format="json",
        )
        assert response.json()["store"] is None

    def test_approval_says_who_approved_it_and_from_which_zone(self, approved, manager):
        indent = approved()
        assert indent.approved_by == manager
        assert indent.approved_at is not None

        row = auth(indent.mait.user).get(f"/api/v1/indents/{indent.id}/").json()
        assert row["approved_by_name"] == "Zonal manager"
        assert row["approved_by_zone"] == "Mathura"
        assert row["store_name"] == "Barsana depot"

    def test_approval_routes_an_indent_raised_before_the_store_existed(self, mait, manager):
        indent = IndentRequest.objects.create(
            mait=mait, product_type=ProductType.STRAW, breed="MURRAH", qty_requested=5
        )
        store = Store.objects.create(code="LATE", name="Late depot")
        StorePlant.objects.create(store=store, plant_code=PLANT)

        auth(manager).post(f"/api/v1/indents/{indent.id}/approve/")
        indent.refresh_from_db()
        assert indent.store_id == store.id


class TestZonalManager:
    def test_sees_only_their_own_zone(self, raised, manager, breeds):
        mine = raised(5)
        outsider = MaitFactory()
        MPPFactory(mait=outsider, plant_code=ELSEWHERE)
        theirs = IndentRequest.objects.create(
            mait=outsider, product_type=ProductType.STRAW, breed="MURRAH", qty_requested=5
        )

        ids = [row["id"] for row in auth(manager).get("/api/v1/indents/").json()["results"]]
        assert mine.id in ids
        assert theirs.id not in ids

    def test_cannot_approve_outside_it(self, manager, breeds):
        outsider = MaitFactory()
        MPPFactory(mait=outsider, plant_code=ELSEWHERE)
        theirs = IndentRequest.objects.create(
            mait=outsider, product_type=ProductType.STRAW, breed="MURRAH", qty_requested=5
        )
        response = auth(manager).post(f"/api/v1/indents/{theirs.id}/approve/")
        assert response.status_code == 404
        theirs.refresh_from_db()
        assert theirs.status == IndentRequest.Status.REQUESTED


# --------------------------------------------------------------------------------------
# The keeper's queue
# --------------------------------------------------------------------------------------
class TestQueue:
    def test_only_approved_indents_wait_at_the_counter(self, raised, approved, keeper):
        waiting = approved(5)
        not_yet = raised(5)
        ids = [row["id"] for row in auth(keeper).get("/api/v1/store/indents/").json()]
        assert waiting.id in ids
        assert not_yet.id not in ids

    def test_another_stores_indents_are_not_in_it(self, approved, breeds):
        indent = approved(5)
        other = Store.objects.create(code="OTHER", name="Other depot")
        stranger = User.objects.create_user(
            username="keeper-other", full_name="Other", role=Role.STORE, store=other
        )
        assert auth(stranger).get("/api/v1/store/indents/").json() == []
        assert issue(stranger, indent, 1).status_code == 404

    def test_the_row_says_what_the_shelf_can_do(self, approved, keeper, store):
        indent = approved(25)
        row = lambda: auth(keeper).get(f"/api/v1/store/indents/{indent.id}/").json()  # noqa: E731

        assert row()["readiness"] == "waiting"
        stock(store, 18)
        assert (row()["readiness"], row()["in_store"], row()["short_by"]) == ("short", 18, 7)
        stock(store, 10)
        assert row()["readiness"] == "ready"
        assert row()["item_name"] == "Murrah"

    def test_found_by_its_number_or_the_mait(self, approved, keeper):
        indent = approved(5)
        for term in (f"IND-{indent.id}", str(indent.id), indent.mait.name[:4]):
            found = auth(keeper).get("/api/v1/store/indents/", {"search": term}).json()
            assert [row["id"] for row in found] == [indent.id], term

    def test_the_home_figures(self, approved, keeper, store):
        stock(store, 18)
        approved(25)
        approved(5)
        home = auth(keeper).get("/api/v1/store/").json()
        assert home["store"]["name"] == "Barsana depot"
        assert (home["waiting"], home["short"], home["ready"]) == (2, 1, 1)


# --------------------------------------------------------------------------------------
# Handing over
# --------------------------------------------------------------------------------------
class TestIssue:
    def test_part_of_it_goes_and_the_rest_stays_open(self, approved, keeper, store):
        stock(store, 18)
        indent = approved(25)

        response = issue(keeper, indent, 18)
        assert response.status_code == 201, response.content
        handover = response.json()
        assert handover["qty"] == 18
        assert handover["qty_open"] == 7
        assert len(handover["collection_code"]) == 4

        indent.refresh_from_db()
        assert indent.status == IndentRequest.Status.APPROVED
        assert (indent.qty_issued, indent.qty_open) == (18, 7)
        # Still in the queue: the Mait does not raise the rest again.
        assert [row["id"] for row in auth(keeper).get("/api/v1/store/indents/").json()] == [
            indent.id
        ]

    def test_issuing_moves_neither_count(self, approved, keeper, store, mait):
        stock(store, 18)
        indent = approved(25)
        issue(keeper, indent, 18)

        assert available_straw_count(mait) == 0
        assert StoreStock.objects.get(store=store).qty_on_hand == 18
        shelf = auth(keeper).get("/api/v1/store/stock/").json()
        assert (shelf[0]["on_hand"], shelf[0]["set_aside"], shelf[0]["available"]) == (18, 18, 0)

    def test_stock_set_aside_for_one_mait_cannot_be_promised_to_another(
        self, approved, keeper, store
    ):
        stock(store, 18)
        first, second = approved(18), approved(5)
        assert issue(keeper, first, 18).status_code == 201

        response = issue(keeper, second, 1)
        assert response.status_code == 409
        assert response.json()["type"].endswith("store-stock-short")

    def test_more_than_the_shelf_holds_is_refused(self, approved, keeper, store):
        stock(store, 3)
        response = issue(keeper, approved(25), 4)
        assert response.status_code == 409
        assert "3" in response.json()["detail"]

    def test_more_than_is_owed_is_refused(self, approved, keeper, store):
        stock(store, 50)
        assert issue(keeper, approved(5), 6).status_code == 400

    def test_straws_wait_for_the_flask_check(self, approved, keeper, store):
        stock(store, 5)
        response = issue(keeper, approved(5), 5, flask=False)
        assert response.status_code == 400
        assert "flask_checked" in response.json()["errors"]

    def test_the_last_of_it_closes_the_indent(self, approved, keeper, store):
        stock(store, 25)
        indent = approved(25)
        issue(keeper, indent, 18)
        issue(keeper, indent, 7)
        indent.refresh_from_db()
        assert indent.status == IndentRequest.Status.ISSUED

    def test_the_portal_does_not_issue_what_a_store_hands_over(self, approved, manager):
        indent = approved(5)
        response = auth(manager).post(f"/api/v1/indents/{indent.id}/issue/", {"qty": 5})
        assert response.status_code == 409
        assert "Barsana depot" in response.json()["detail"]

    def test_a_part_issued_indent_cannot_be_rejected(self, approved, keeper, store, manager):
        stock(store, 5)
        indent = approved(25)
        issue(keeper, indent, 5)
        response = auth(manager).post(
            f"/api/v1/indents/{indent.id}/reject/", {"reason": "none left"}, format="json"
        )
        assert response.status_code == 409

    def test_a_repeated_tap_hands_over_once(self, approved, keeper, store):
        stock(store, 25)
        indent = approved(25)
        client = auth(keeper)
        for _ in range(2):
            client.post(
                f"/api/v1/store/indents/{indent.id}/issue/",
                {"qty": 10, "flask_checked": True},
                format="json",
                HTTP_IDEMPOTENCY_KEY="tap-once",
            )
        assert IndentHandover.objects.filter(indent=indent).count() == 1


# --------------------------------------------------------------------------------------
# Collecting
# --------------------------------------------------------------------------------------
class TestCollection:
    def test_the_right_code_moves_the_stock(self, approved, keeper, store, mait):
        stock(store, 18)
        indent = approved(25)
        code = issue(keeper, indent, 18).json()["collection_code"]

        response = collect(mait, indent, code)
        assert response.status_code == 200, response.content
        assert available_straw_count(mait) == 18
        assert StoreStock.objects.get(store=store).qty_on_hand == 0
        # Seven are still owed, so the indent is not received — only this handover is.
        assert response.json()["received_at"] is None
        assert response.json()["qty_open"] == 7

    def test_both_ledgers_add_up_afterwards(self, approved, keeper, store, mait):
        stock(store, 18)
        indent = approved(18)
        collect(mait, indent, issue(keeper, indent, 18).json()["collection_code"])

        for balance in MaitInventory.objects.filter(mait=mait):
            stored, summed = reconcile_balance(balance)
            assert stored == summed
        shelf = StoreStock.objects.get(store=store)
        assert sum(StoreLedger.objects.filter(stock=shelf).values_list("qty", flat=True)) == 0

    def test_no_code_is_refused(self, approved, keeper, store, mait):
        stock(store, 5)
        indent = approved(5)
        issue(keeper, indent, 5)
        response = auth(mait.user).post(f"/api/v1/indents/{indent.id}/confirm-collection/")
        assert response.status_code == 400
        assert response.json()["type"].endswith("collection-code-invalid")
        assert available_straw_count(mait) == 0

    def test_a_wrong_code_is_refused_and_counted(self, approved, keeper, store, mait):
        stock(store, 5)
        indent = approved(5)
        code = issue(keeper, indent, 5).json()["collection_code"]

        response = collect(mait, indent, wrong(code))
        assert response.status_code == 400
        assert response.json()["type"].endswith("collection-code-invalid")
        assert IndentHandover.objects.get(indent=indent).code_attempts == 1
        assert available_straw_count(mait) == 0

    def test_too_many_wrong_codes_lock_it_until_the_keeper_reads_a_new_one(
        self, approved, keeper, store, mait
    ):
        stock(store, 5)
        indent = approved(5)
        handover = issue(keeper, indent, 5).json()
        code = handover["collection_code"]

        for _ in range(IndentHandover.MAX_CODE_ATTEMPTS):
            collect(mait, indent, wrong(code))
        # Locked: even the right code is refused now.
        refused = collect(mait, indent, code)
        assert refused.status_code == 429
        assert refused.json()["type"].endswith("collection-code-locked")

        fresh = auth(keeper).post(f"/api/v1/store/handovers/{handover['id']}/new-code/").json()
        assert collect(mait, indent, fresh["collection_code"]).status_code == 200

    def test_the_maits_app_is_never_sent_the_code(self, approved, keeper, store, mait):
        stock(store, 5)
        indent = approved(5)
        code = issue(keeper, indent, 5).json()["collection_code"]

        body = auth(mait.user).get(f"/api/v1/indents/{indent.id}/").content.decode()
        assert code not in body
        row = auth(mait.user).get(f"/api/v1/indents/{indent.id}/").json()
        assert (row["qty_to_collect"], row["needs_code"]) == (5, True)

    def test_two_batches_collected_separately(self, approved, keeper, store, mait):
        stock(store, 18)
        indent = approved(25)
        collect(mait, indent, issue(keeper, indent, 18).json()["collection_code"])

        stock(store, 7)
        response = collect(mait, indent, issue(keeper, indent, 7).json()["collection_code"])
        assert response.status_code == 200, response.content
        assert response.json()["received_at"] is not None
        assert available_straw_count(mait) == 25
        # Two handovers' worth of placeholder numbers, and none of them collided.
        assert SemenBatch.objects.filter(unique_straw_no__startswith=f"IND{indent.id}-H").count()
        assert SemenBatch.objects.filter(is_unnumbered=True).count() == 25
        # Each ledger row says which trip it came on, so the Mait's ledger answers "2 or 5".
        notes = set(
            MaitInventoryLedger.objects.filter(ref_id=indent.id).values_list("note", flat=True)
        )
        assert notes == {
            f"IND-{indent.id} · 18 MURRAH from Barsana depot",
            f"IND-{indent.id} · 7 MURRAH from Barsana depot",
        }

    def test_a_keeper_cannot_collect_for_the_mait(self, approved, keeper, store):
        stock(store, 5)
        indent = approved(5)
        code = issue(keeper, indent, 5).json()["collection_code"]
        response = auth(keeper).post(
            f"/api/v1/indents/{indent.id}/confirm-collection/", {"code": code}, format="json"
        )
        assert response.status_code == 403

    def test_consumables_are_collected_the_same_way(self, keeper, store, mait, manager):
        gloves = Consumable.objects.create(code="GLOVES", name="Gloves", unit="pair")
        receive_stock(
            store=store, product_type=ProductType.CONSUMABLE, product_ref_id=gloves.id, qty=40
        )
        indent = IndentRequest.objects.create(
            mait=mait,
            product_type=ProductType.CONSUMABLE,
            product_ref_id=gloves.id,
            qty_requested=20,
            store=store,
        )
        auth(manager).post(f"/api/v1/indents/{indent.id}/approve/")
        code = issue(keeper, indent, 20, flask=False).json()["collection_code"]
        assert collect(mait, indent, code).status_code == 200
        assert MaitInventory.objects.get(mait=mait, product_ref_id=gloves.id).qty_available == 20


class TestCodeReadOutAgain:
    """A Mait who lost the code comes back to the counter, and the keeper can still find it."""

    def test_the_indent_carries_the_code_still_waiting(self, approved, keeper, store):
        stock(store, 18)
        indent = approved(25)
        code = issue(keeper, indent, 18).json()["collection_code"]

        row = auth(keeper).get(f"/api/v1/store/indents/{indent.id}/").json()
        assert [(h["qty"], h["collection_code"]) for h in row["waiting_handovers"]] == [(18, code)]

    def test_the_waiting_list_carries_it_after_the_screen_is_gone(self, approved, keeper, store):
        stock(store, 25)
        indent = approved(25)
        code = issue(keeper, indent, 25).json()["collection_code"]

        # Fully issued, so it has left the queue — the waiting list is where it lives now.
        assert auth(keeper).get("/api/v1/store/indents/").json() == []
        waiting = auth(keeper).get("/api/v1/store/handovers/", {"state": "waiting"}).json()
        assert [h["collection_code"] for h in waiting] == [code]

    def test_a_collected_one_stops_being_offered(self, approved, keeper, store, mait):
        stock(store, 18)
        indent = approved(25)
        code = issue(keeper, indent, 18).json()["collection_code"]
        collect(mait, indent, code)

        row = auth(keeper).get(f"/api/v1/store/indents/{indent.id}/").json()
        assert row["waiting_handovers"] == []
        assert auth(keeper).get("/api/v1/store/handovers/", {"state": "waiting"}).json() == []


class TestHistory:
    """What went over the counter, and when — the keeper's own record of their day."""

    def test_every_handover_newest_first_with_its_state(self, approved, keeper, store, mait):
        stock(store, 30)
        first, second = approved(5), approved(5)
        code = issue(keeper, first, 5).json()["collection_code"]
        collect(mait, first, code)
        issue(keeper, second, 3)

        rows = auth(keeper).get("/api/v1/store/handovers/").json()
        assert [(row["indent_id"], row["qty"], row["state"]) for row in rows] == [
            (second.id, 3, "waiting"),
            (first.id, 5, "collected"),
        ]

    def test_narrowed_by_day(self, approved, keeper, store):
        from datetime import timedelta

        from django.utils import timezone

        stock(store, 10)
        indent = approved(5)
        old = issue(keeper, indent, 2).json()["id"]
        IndentHandover.objects.filter(pk=old).update(issued_at=timezone.now() - timedelta(days=10))
        issue(keeper, indent, 3)

        today = timezone.localdate().isoformat()
        rows = auth(keeper).get("/api/v1/store/handovers/", {"from": today, "to": today}).json()
        assert [row["qty"] for row in rows] == [3]
        everything = auth(keeper).get("/api/v1/store/handovers/").json()
        assert sorted(row["qty"] for row in everything) == [2, 3]

    def test_found_by_the_mait_or_the_indent(self, approved, keeper, store):
        stock(store, 10)
        indent = approved(5)
        issue(keeper, indent, 2)
        for term in (f"IND-{indent.id}", indent.mait.name[:4]):
            rows = auth(keeper).get("/api/v1/store/handovers/", {"search": term}).json()
            assert [row["indent_id"] for row in rows] == [indent.id], term
        assert auth(keeper).get("/api/v1/store/handovers/", {"search": "nobody"}).json() == []

    def test_only_this_stores(self, approved, keeper, store):
        stock(store, 10)
        issue(keeper, approved(5), 2)
        other = Store.objects.create(code="OTHER", name="Other depot")
        stranger = User.objects.create_user(
            username="keeper-other-history", full_name="Other", role=Role.STORE, store=other
        )
        assert auth(stranger).get("/api/v1/store/handovers/").json() == []


class TestCancel:
    def test_putting_it_back_reopens_the_quantity(self, approved, keeper, store, mait):
        stock(store, 25)
        indent = approved(25)
        handover = issue(keeper, indent, 25).json()
        indent.refresh_from_db()
        assert indent.status == IndentRequest.Status.ISSUED

        response = auth(keeper).post(f"/api/v1/store/handovers/{handover['id']}/cancel/")
        assert response.json()["state"] == "cancelled"
        indent.refresh_from_db()
        assert (indent.status, indent.qty_open) == (IndentRequest.Status.APPROVED, 25)
        # The code dies with it.
        assert collect(mait, indent, handover["collection_code"]).status_code == 409


# --------------------------------------------------------------------------------------
# What a keeper can reach
# --------------------------------------------------------------------------------------
class TestKeeperReach:
    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/indents/",
            "/api/v1/ai-events/",
            "/api/v1/mpp/",
            "/api/v1/members/",
            "/api/v1/mait/inventory/",
            "/api/v1/non-members/",
            "/api/v1/pregnancy-checks/",
            "/api/v1/admin/stores/",
            "/api/v1/config/breeds/",
        ],
    )
    def test_nothing_but_their_own_store(self, keeper, path):
        assert auth(keeper).get(path).status_code == 403, path

    def test_a_closed_store_answers_nothing(self, keeper, store):
        store.is_active = False
        store.save()
        assert auth(keeper).get("/api/v1/store/").status_code == 403

    def test_signs_in_with_an_otp(self, keeper, settings):
        settings.DEV_FIXED_OTP_NUMBERS = [keeper.mobile_no]
        client = APIClient()
        client.post("/api/v1/auth/otp/send/", {"mobile_no": keeper.mobile_no}, format="json")
        response = client.post(
            "/api/v1/auth/otp/verify/",
            {"mobile_no": keeper.mobile_no, "otp": settings.DEV_FIXED_OTP_CODE},
            format="json",
        )
        assert response.status_code == 200, response.content

        client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['access']}")
        me = client.get("/api/v1/auth/me/").json()
        assert me["role"] == "store"
        assert me["store"]["name"] == "Barsana depot"

    def test_records_a_delivery(self, keeper, store, breeds):
        response = auth(keeper).post(
            "/api/v1/store/stock/receive/",
            {"product_type": "straw", "breed": "murrah", "qty": 30, "note": "Van 12"},
            format="json",
        )
        assert response.status_code == 201, response.content
        assert response.json()[0]["on_hand"] == 30
        assert StoreStock.objects.get(store=store, breed="MURRAH").qty_on_hand == 30


# --------------------------------------------------------------------------------------
# The portal's Stores screen
# --------------------------------------------------------------------------------------
@pytest.fixture
def office(db):
    user = User.objects.create_user(
        username="office-stores",
        password="a-long-enough-password",
        full_name="Office",
        role=Role.ADMIN,
        portal_sections=[PortalSection.STORES],
    )
    return auth(user)


class TestSetup:
    def test_a_store_is_made_with_its_bmcs(self, office, mait):
        response = office.post(
            "/api/v1/admin/stores/",
            {"code": "barsana", "name": "Barsana depot", "plants": [PLANT]},
            format="json",
        )
        assert response.status_code == 201, response.content
        assert response.json()["code"] == "BARSANA"
        assert response.json()["plants"] == [PLANT]

    def test_a_bmc_collects_from_one_store(self, office, store, mait):
        response = office.post(
            "/api/v1/admin/stores/",
            {"code": "SECOND", "name": "Second depot", "plants": [PLANT]},
            format="json",
        )
        assert response.status_code == 400
        assert "Barsana depot" in str(response.json())

    def test_a_keeper_is_given_to_a_store(self, office, store):
        response = office.post(
            f"/api/v1/admin/stores/{store.id}/keepers/",
            {"full_name": "Ramesh Yadav", "mobile_no": "9123400009"},
            format="json",
        )
        assert response.status_code == 201, response.content
        keeper = User.objects.get(mobile_no="9123400009")
        assert (keeper.role, keeper.store_id) == (Role.STORE, store.id)

    def test_a_maits_number_cannot_be_a_keepers(self, office, store, mait):
        response = office.post(
            f"/api/v1/admin/stores/{store.id}/keepers/",
            {"full_name": "Somebody", "mobile_no": mait.mobile_no},
            format="json",
        )
        assert response.status_code == 400

    def test_a_store_with_history_is_closed_rather_than_deleted(self, office, approved, store):
        approved(5)
        assert office.delete(f"/api/v1/admin/stores/{store.id}/").status_code == 409

    def test_without_the_section_there_is_no_screen(self, manager):
        assert auth(manager).get("/api/v1/admin/stores/").status_code == 403


# --------------------------------------------------------------------------------------
# The catalogue a delivery is recorded from
# --------------------------------------------------------------------------------------
class TestCatalogue:
    """
    What the keeper picks from when stock lands.

    It is the office's list: a breed added on the portal has to reach the counter, or the
    keeper cannot record a delivery of something the portal says exists.
    """

    def test_it_carries_every_active_breed_with_its_animal(self, keeper):
        BreedConfig.objects.create(animal_type="COW", code="GIR", name="Gir", display_order=1)
        BreedConfig.objects.create(
            animal_type="BUFF", code="MURRAH", name="Murrah", display_order=2
        )

        body = auth(keeper).get("/api/v1/store/catalogue/").json()

        assert [(b["animal_type"], b["code"]) for b in body["breeds"]] == [
            ("BUFF", "MURRAH"),
            ("COW", "GIR"),
        ]

    def test_a_breed_added_today_is_pickable_today(self, keeper):
        """No cached list to invalidate: the keeper's next open asks the office's own table."""
        before = auth(keeper).get("/api/v1/store/catalogue/").json()["breeds"]
        BreedConfig.objects.create(animal_type="COW", code="SAHIWAL", name="Sahiwal")

        after = auth(keeper).get("/api/v1/store/catalogue/").json()["breeds"]

        assert len(after) == len(before) + 1
        assert "SAHIWAL" in [b["code"] for b in after]

    def test_the_same_code_under_both_animals_keeps_both(self, keeper):
        """
        The bug this replaced: the list was deduped by code alone, so the second one never
        reached the keeper. They are one line on the shelf — which keys on the code — but two
        rows in the office's list, and the keeper picks from the office's list.
        """
        BreedConfig.objects.create(animal_type="COW", code="CROSS", name="Cross (cow)")
        BreedConfig.objects.create(animal_type="BUFF", code="CROSS", name="Cross (buffalo)")

        breeds = auth(keeper).get("/api/v1/store/catalogue/").json()["breeds"]

        assert sorted(b["animal_type"] for b in breeds if b["code"] == "CROSS") == ["BUFF", "COW"]

    def test_an_inactive_breed_is_left_out(self, keeper):
        BreedConfig.objects.create(
            animal_type="COW", code="RETIRED", name="Retired", is_active=False
        )

        breeds = auth(keeper).get("/api/v1/store/catalogue/").json()["breeds"]

        assert "RETIRED" not in [b["code"] for b in breeds]
