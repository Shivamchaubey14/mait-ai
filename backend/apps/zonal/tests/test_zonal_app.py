"""
The zonal manager's app: who gets in, what they see, and what they cannot see.

Three things are worth holding still here, and each has cost somebody an afternoon
somewhere in this codebase already:

1. **Who the OTP door admits.** An office Admin has a password. Opening the handset door to
   the role wholesale would put the account that runs the SAP imports behind a six-digit code
   sent to whatever number happened to be on the row. A live zone *and* a number are both
   required, and a head-office Admin is refused.
2. **The zone is the whole scope.** Every figure and every row is narrowed by it, and a
   manager asking about the next zone along gets their own.
3. **There is no second write path.** Approve and reject stay on ``/indents/``.
"""

from __future__ import annotations

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.ai_events.models import AIEvent
from apps.indents.models import IndentRequest
from apps.inventory.models import ProductType
from apps.masterdata.models import Zone, ZonePlant
from apps.payments.models import OTPLog
from apps.stores.models import Store, StorePlant
from apps.stores.services import receive_stock
from conftest import MaitFactory, MPPFactory

pytestmark = pytest.mark.django_db

HOME = "/api/v1/zonal/"
DASHBOARD = "/api/v1/zonal/dashboard/"
APPROVALS = "/api/v1/zonal/approvals/"
STOCK = "/api/v1/zonal/stock/"
HISTORY = "/api/v1/zonal/history/"
EVENTS = "/api/v1/zonal/events/"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def office_account(username, *, zone=None, mobile_no="", sections=None) -> User:
    user = User.objects.create_user(
        username=username,
        password="a-long-enough-password",
        full_name=username.replace("-", " ").title(),
        role=Role.ADMIN,
        mobile_no=mobile_no,
        portal_sections=(
            sections if sections is not None else [PortalSection.INDENTS, PortalSection.INVENTORY]
        ),
    )
    if zone is not None:
        user.zones.add(zone)
    return user


@pytest.fixture
def network(db):
    """Two zones, a Mait and a depot in each, and an indent waiting in the first."""
    built = {}
    for code, plant in (("AYODHYA", "1101"), ("BAHRAICH", "2202")):
        zone = Zone.objects.create(code=code, name=f"{code.title()} Zone")
        ZonePlant.objects.create(zone=zone, plant_code=plant, plant_name=f"{code} BMC")
        mait = MaitFactory(name=f"{code.title()} Mait")
        MPPFactory(mait=mait, plant_code=plant, plant_name=f"{code} BMC")
        store = Store.objects.create(code=code, name=f"{code.title()} depot", zone=zone)
        StorePlant.objects.create(store=store, plant_code=plant)
        receive_stock(store=store, product_type=ProductType.STRAW, breed="MURRAH", qty=40)
        indent = IndentRequest.objects.create(
            mait=mait,
            store=store,
            product_type=ProductType.STRAW,
            breed="MURRAH",
            qty_requested=25,
        )
        built[code] = {"zone": zone, "mait": mait, "store": store, "indent": indent}
    return built


@pytest.fixture
def ai_events(db, network):
    """Two completed inseminations in Ayodhya today, one in Bahraich."""
    import uuid

    from conftest import AnimalFactory, MemberFactory, SemenBatchFactory

    for code, count in (("AYODHYA", 2), ("BAHRAICH", 1)):
        mait = network[code]["mait"]
        mpp = mait.mpps.first()
        member = MemberFactory(mpp=mpp)
        for _ in range(count):
            animal = AnimalFactory(member=member, breed="MURRAH")
            # A completed event must carry the straw it used — `ai_event_completed_requires
            # _straw`, which is the constraint that stops an insemination being recorded with
            # no stock deducted.
            batch = SemenBatchFactory(breed="MURRAH")
            AIEvent.objects.create(
                client_uuid=uuid.uuid4(),
                mait=mait,
                mpp=mpp,
                owner_type=AIEvent.OwnerType.MEMBER,
                member=member,
                animal=animal,
                semen_batch=batch,
                straw_unique_no=batch.unique_straw_no,
                status=AIEvent.Status.COMPLETED,
                completed_at=timezone.now(),
            )
    return network


@pytest.fixture
def stocked(db, network):
    """Straws with the Ayodhya Mait, so the location rows have something to sum."""
    from apps.inventory.models import MaitInventoryLedger
    from apps.inventory.services import credit_stock
    from conftest import SemenBatchFactory

    straw = SemenBatchFactory(breed="MURRAH")
    credit_stock(
        mait=network["AYODHYA"]["mait"],
        product_type=ProductType.STRAW,
        product_ref_id=straw.id,
        qty=6,
        ref_type=MaitInventoryLedger.RefType.MANUAL,
    )
    return network


# --------------------------------------------------------------------------------------
# Who gets in
# --------------------------------------------------------------------------------------
class TestSigningIn:
    def test_a_zonal_manager_signs_in_with_an_otp(self, network, settings):
        settings.DEV_FIXED_OTP_NUMBERS = ["9811100001"]
        office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"], mobile_no="9811100001")

        client = APIClient()
        sent = client.post("/api/v1/auth/otp/send/", {"mobile_no": "9811100001"})
        assert sent.status_code == 200

        code = OTPLog.objects.filter(mobile_no="9811100001").latest("created_at")
        assert code is not None
        verified = client.post(
            "/api/v1/auth/otp/verify/", {"mobile_no": "9811100001", "otp": "123456"}
        )
        assert verified.status_code == 200, verified.data
        assert verified.data["access"]

    def test_a_head_office_admin_has_no_app(self, db):
        """No zone, no handset. They have a desk, a browser and a password."""
        office_account("head-office", mobile_no="9811100002")

        client = APIClient()
        verified = client.post(
            "/api/v1/auth/otp/verify/", {"mobile_no": "9811100002", "otp": "123456"}
        )
        # Refused at the lookup, not at the code: there is no account behind that number as
        # far as sign-in is concerned.
        assert verified.status_code >= 400

    def test_an_account_with_no_number_cannot_be_reached(self, network):
        manager = office_account("zonal-quiet", zone=network["AYODHYA"]["zone"])
        assert manager.is_zonal_manager is True
        from apps.accounts.views import OTPSendView

        assert OTPSendView._resolve_field_user("") is None

    def test_a_deactivated_zone_takes_the_app_with_it(self, network):
        zone = network["AYODHYA"]["zone"]
        manager = office_account("zonal-ayodhya", zone=zone, mobile_no="9811100003")
        assert manager.is_zonal_manager is True

        zone.is_active = False
        zone.save(update_fields=["is_active"])
        manager.refresh_from_db()
        assert manager.is_zonal_manager is False


# --------------------------------------------------------------------------------------
# What they see
# --------------------------------------------------------------------------------------
class TestHome:
    def test_the_figures_cover_the_managers_own_zone(self, network):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(HOME).json()

        assert body["waiting"] == 1
        assert body["maits"] == 1
        assert body["stores"] == 1
        assert body["scope"]["scoped"] is True
        assert body["scope"]["zones"] == ["Ayodhya Zone"]
        assert body["manager"]["zones"] == ["Ayodhya Zone"]

    def test_the_other_zones_indent_is_not_counted(self, network):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(HOME).json()
        assert body["waiting"] == 1  # not 2, though two exist

    def test_a_head_office_admin_is_refused(self, network):
        assert auth(office_account("head-office")).get(HOME).status_code == 403

    def test_a_mait_is_refused(self, network):
        assert auth(network["AYODHYA"]["mait"].user).get(HOME).status_code == 403


class TestApprovals:
    def test_each_row_carries_what_the_decision_turns_on(self, network):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(APPROVALS).json()

        assert body["count"] == 1
        row = body["results"][0]
        assert row["id"] == network["AYODHYA"]["indent"].id
        assert row["qty_requested"] == 25
        # The depot has 40 against a request for 25, so approving it can be met in full.
        assert row["in_store"] == 40
        assert row["coverage"] == "ready"
        assert row["mait_holds"] == 0
        assert row["store_name"] == "Ayodhya depot"

    def test_a_short_shelf_says_so(self, network):
        store = network["AYODHYA"]["store"]
        indent = network["AYODHYA"]["indent"]
        indent.qty_requested = 100
        indent.save(update_fields=["qty_requested"])

        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        row = auth(manager).get(APPROVALS).json()["results"][0]
        assert row["in_store"] == 40
        assert row["coverage"] == "short"
        assert store.is_active

    def test_no_store_is_not_the_same_as_an_empty_one(self, network):
        indent = network["AYODHYA"]["indent"]
        indent.store = None
        indent.save(update_fields=["store"])

        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        row = auth(manager).get(APPROVALS).json()["results"][0]
        assert row["in_store"] == -1
        assert row["coverage"] == "no-store"

    def test_only_this_zones_queue(self, network):
        manager = office_account("zonal-bahraich", zone=network["BAHRAICH"]["zone"])
        body = auth(manager).get(APPROVALS).json()
        assert [row["id"] for row in body["results"]] == [network["BAHRAICH"]["indent"].id]

    def test_the_decision_is_still_taken_on_the_indents_endpoint(self, network):
        """No second write path. The app posts where the state machine already lives."""
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        indent = network["AYODHYA"]["indent"]

        approved = auth(manager).post(f"/api/v1/indents/{indent.id}/approve/")
        assert approved.status_code == 200
        indent.refresh_from_db()
        assert indent.status == IndentRequest.Status.APPROVED
        assert indent.approved_by_id == manager.id

        # And it leaves the queue.
        assert auth(manager).get(APPROVALS).json()["count"] == 0

    def test_a_manager_cannot_approve_the_next_zone_along(self, network):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        other = network["BAHRAICH"]["indent"]
        refused = auth(manager).post(f"/api/v1/indents/{other.id}/approve/")
        assert refused.status_code == 404


class TestDashboard:
    """
    The zone's work, live.

    Counted off the events rather than `DailyAIAggregate` on purpose: the hourly job that
    fills that table does not run on the no-Docker dev path, so a dashboard reading it would
    report zero on a database full of events. These tests write no aggregate rows, which is
    exactly the case that used to be silently blank.
    """

    def test_it_counts_todays_work_in_this_zone_only(self, network, ai_events):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(DASHBOARD).json()

        assert body["today"] == 2
        assert body["week"] == 2
        assert body["maits_working_today"] == 1
        # The other zone's event is not counted, though one exists.
        assert body["scope"]["zones"] == ["Ayodhya Zone"]

    def test_the_trend_carries_every_day_including_the_empty_ones(self, network, ai_events):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(DASHBOARD, {"days": 7}).json()

        assert len(body["trend"]) == 7
        assert body["trend"][-1]["completed"] == 2
        assert body["trend"][0]["completed"] == 0
        assert body["best_day"]["completed"] == 2

    def test_it_names_who_and_where_the_work_came_from(self, network, ai_events):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(DASHBOARD).json()

        assert [row["name"] for row in body["busiest_maits"]] == ["Ayodhya Mait"]
        assert body["busiest_maits"][0]["events"] == 2
        assert body["busiest_villages"][0]["events"] == 2
        # The feed that makes the zone feel live, newest first.
        assert len(body["happening"]) == 2
        assert body["happening"][0]["mait_name"] == "Ayodhya Mait"

    def test_a_head_office_admin_is_refused(self, network):
        assert auth(office_account("head-office")).get(DASHBOARD).status_code == 403


class TestEveryEvent:
    """
    The list opened from Profile: the zone's inseminations, a page at a time, by date.

    Held still: it is the zone's and nobody else's, it is never the whole table, and a range
    of dates is honoured on both ends.
    """

    def test_it_lists_this_zones_events_only_newest_first(self, network, ai_events):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(EVENTS).json()

        assert body["count"] == 2
        assert {row["mait_name"] for row in body["results"]} == {"Ayodhya Mait"}
        row = body["results"][0]
        # Everything the row names somebody by, with the codes read back over the phone.
        assert row["owner_type"] == "member"
        assert row["owner_name"]
        assert row["mpp_code"] and row["mait_code"]
        assert row["status"] == "completed"
        ids = [row["id"] for row in body["results"]]
        assert ids == sorted(ids, reverse=True)

    def test_it_pages_rather_than_answering_all_of_it(self, network, ai_events):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        client = auth(manager)

        first = client.get(EVENTS, {"limit": 1}).json()
        assert len(first["results"]) == 1
        assert first["has_more"] is True
        second = client.get(EVENTS, {"limit": 1, "offset": 1}).json()
        assert second["has_more"] is False
        assert first["results"][0]["id"] != second["results"][0]["id"]

    def test_a_range_of_dates_is_honoured(self, network, ai_events):
        from datetime import timedelta

        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        client = auth(manager)
        today = timezone.localdate()
        last_week = today - timedelta(days=7)

        assert client.get(EVENTS, {"date_from": today.isoformat()}).json()["count"] == 2
        before = client.get(
            EVENTS, {"date_from": last_week.isoformat(), "date_to": last_week.isoformat()}
        ).json()
        assert before["count"] == 0
        # A range picked back to front is the same range.
        swapped = client.get(
            EVENTS, {"date_from": today.isoformat(), "date_to": last_week.isoformat()}
        ).json()
        assert swapped["count"] == 2

    def test_a_head_office_admin_is_refused(self, network):
        assert auth(office_account("head-office")).get(EVENTS).status_code == 403


class TestOneEvent:
    """
    The record a dispute is settled from, opened from the zone's feed.

    Two things are worth holding still: it carries the whole record in one answer — photo,
    straw, money, place, trail — and a manager cannot open one outside their zone. That last
    one is a 404 rather than a 403 on purpose: whether a record exists elsewhere in the
    network is not this account's to learn.
    """

    def _url(self, event):
        return f"/api/v1/zonal/events/{event.id}/"

    def test_it_carries_the_whole_record_in_one_answer(self, network, ai_events):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        event = AIEvent.objects.filter(mait=network["AYODHYA"]["mait"]).first()

        body = auth(manager).get(self._url(event)).json()
        assert body["id"] == event.id
        assert body["mait_name"] == "Ayodhya Mait"
        assert body["mpp_name"]
        assert body["straw_unique_no"]
        assert body["status"] == "completed"
        # The three panels the portal's detail screen draws, all in the one response.
        assert "consumables" in body
        assert "pregnancy_checks" in body
        assert isinstance(body["timeline"], list)

    def test_an_event_in_another_zone_is_not_found(self, network, ai_events):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        theirs = AIEvent.objects.filter(mait=network["BAHRAICH"]["mait"]).first()

        assert auth(manager).get(self._url(theirs)).status_code == 404

    def test_a_head_office_admin_has_no_zonal_app(self, network, ai_events):
        event = AIEvent.objects.first()
        assert auth(office_account("head-office")).get(self._url(event)).status_code == 403


class TestStockByProduct:
    """
    The same zone, by product: straws, consumables and equipment, each with where it is and
    what is on its way. Held still: every active catalogue product is listed even at zero, and
    an indent waiting on the manager counts as coming, not as held.
    """

    def test_it_groups_every_item_by_category(self, network, stocked):
        from apps.inventory.models import Consumable

        Consumable.objects.create(code="GLOVES", name="Gloves", unit="pair")
        Consumable.objects.create(code="AI_GUN", name="AI gun", category="asset")
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        products = auth(manager).get(STOCK).json()["products"]

        assert set(products) >= {"straw", "consumable", "asset"}
        murrah = next(row for row in products["straw"] if row["key"] == "straw:MURRAH")
        assert murrah["with_maits"] == 6
        assert murrah["maits_holding"] == 1
        assert murrah["at_depots"] == 40
        assert murrah["free"] == 40
        # The fixture's indent is waiting on the manager: coming, not yet agreed.
        assert murrah["requested"] == 25
        assert murrah["approved"] == 0
        # Nobody holds gloves yet, and that is exactly the line worth seeing.
        gloves = next(row for row in products["consumable"] if row["name"] == "Gloves")
        assert gloves["with_maits"] == 0 and gloves["unit"] == "pair"
        assert [row["name"] for row in products["asset"]] == ["AI gun"]

    def test_the_other_zones_depot_and_indents_are_not_counted(self, network, stocked):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        products = auth(manager).get(STOCK).json()["products"]
        murrah = next(row for row in products["straw"] if row["key"] == "straw:MURRAH")
        # Bahraich has its own depot of 40 and its own indent of 25; neither is Ayodhya's.
        assert murrah["at_depots"] == 40
        assert murrah["requested"] == 25


class TestStockByLocation:
    def test_it_groups_the_zones_stock_by_chilling_centre(self, network):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(STOCK).json()

        assert [place["name"] for place in body["locations"]] == ["AYODHYA BMC"]
        place = body["locations"][0]
        assert place["maits"] == 1
        assert place["at_zero"] == 1
        assert place["stores"][0]["straws_available"] == 40

    def test_the_locations_sum_to_the_tile_above_them(self, network, stocked):
        """
        A Mait is counted at one centre, never two.

        Counting a Mait who straddles the boundary under both centres would make the rows add
        up to more than the zone total, and a screen whose rows do not reconcile with the
        figure above them is one nobody trusts twice.
        """
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(STOCK).json()

        assert (
            sum(place["straws"] for place in body["locations"]) == body["summary"]["total_straws"]
        )
        assert sum(place["maits"] for place in body["locations"]) == body["summary"]["maits"]

    def test_a_mait_holding_nothing_is_still_placed(self, network):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        body = auth(manager).get(STOCK).json()

        row = body["maits"][0]
        assert row["state"] == "at_zero"
        assert row["plant_name"] == "AYODHYA BMC"
        assert body["summary"]["at_zero"] == 1

    def test_only_this_zones_places(self, network):
        manager = office_account("zonal-bahraich", zone=network["BAHRAICH"]["zone"])
        body = auth(manager).get(STOCK).json()
        assert [place["name"] for place in body["locations"]] == ["BAHRAICH BMC"]


class TestHistory:
    def test_it_reports_what_this_manager_decided_and_nothing_else(self, network):
        mine = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        theirs = office_account("zonal-bahraich", zone=network["BAHRAICH"]["zone"])

        auth(mine).post(f"/api/v1/indents/{network['AYODHYA']['indent'].id}/approve/")
        auth(theirs).post(
            f"/api/v1/indents/{network['BAHRAICH']['indent'].id}/reject/",
            {"reason": "Nothing on the shelf"},
        )

        body = auth(mine).get(HISTORY).json()
        assert body["summary"]["approved"] == 1
        assert body["summary"]["rejected"] == 0
        assert len(body["results"]) == 1
        assert body["results"][0]["outcome"] == "approved"
        assert body["results"][0]["indent_id"] == network["AYODHYA"]["indent"].id

    def test_each_row_carries_the_request_behind_it(self, network):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        auth(manager).post(f"/api/v1/indents/{network['AYODHYA']['indent'].id}/approve/")

        row = auth(manager).get(HISTORY).json()["results"][0]
        assert row["mait_name"] == "Ayodhya Mait"
        assert row["qty"] == 25
        assert row["item_name"]
        # Where it got to since — the reason somebody opens their own history.
        assert row["status"] == "approved"
        assert row["status_label"] == "Waiting at the depot"
        assert row["store_name"] == "Ayodhya depot"
        # What it was for, and how much of it has been handed over since.
        assert (row["product_type"], row["unit"], row["qty_issued"]) == ("straw", "straw", 0)

    def test_a_rejection_reads_back_the_reason_the_mait_was_given(self, network):
        manager = office_account("zonal-bahraich", zone=network["BAHRAICH"]["zone"])
        auth(manager).post(
            f"/api/v1/indents/{network['BAHRAICH']['indent'].id}/reject/",
            {"reason": "Out of stock until Friday"},
        )

        body = auth(manager).get(HISTORY).json()
        assert body["summary"]["rejected"] == 1
        row = body["results"][0]
        assert row["outcome"] == "rejected"
        assert row["reason"] == "Out of stock until Friday"
        assert row["status_tone"] == "bad"

    def test_it_can_be_narrowed_to_one_outcome(self, network):
        manager = office_account("zonal-ayodhya", zone=network["AYODHYA"]["zone"])
        second = IndentRequest.objects.create(
            mait=network["AYODHYA"]["mait"],
            product_type=ProductType.STRAW,
            breed="MURRAH",
            qty_requested=5,
        )
        auth(manager).post(f"/api/v1/indents/{network['AYODHYA']['indent'].id}/approve/")
        auth(manager).post(f"/api/v1/indents/{second.id}/reject/", {"reason": "Too soon"})

        approved = auth(manager).get(HISTORY, {"outcome": "approved"}).json()
        assert [row["outcome"] for row in approved["results"]] == ["approved"]
        # The summary counts the window, not the page, so the two figures at the top do not
        # move as somebody filters.
        assert approved["summary"]["approved"] == 1
        assert approved["summary"]["rejected"] == 1
