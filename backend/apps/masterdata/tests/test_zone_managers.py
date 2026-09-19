"""
Who runs a zone, what their number is, and what they have done with it (W20).

The Zones screen used to answer only the first half of "who runs Bahraich" — a count of
accounts in a table cell. These three endpoints answer the rest, and the rules worth holding
still are:

* the number is what gives somebody the app, so it is settable from the screen where the
  zone is decided, and it must be **free** — sign-in resolves an account by its number;
* approvals and rejections are both counted from the audit trail, because only one of the
  two is stamped on the indent;
* a caller who is themselves scoped sees the managers of their own zones and no others.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.indents.models import IndentRequest
from apps.inventory.models import ProductType
from apps.masterdata.models import Zone, ZonePlant
from conftest import MaitFactory, MPPFactory

pytestmark = pytest.mark.django_db

MANAGERS = "/api/v1/admin/zones/managers/"
ACTIVITY = "/api/v1/admin/zones/activity/"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def account(username, *, zone=None, mobile_no="", sections=None) -> User:
    user = User.objects.create_user(
        username=username,
        password="a-long-enough-password",
        full_name=username.replace("-", " ").title(),
        role=Role.ADMIN,
        mobile_no=mobile_no,
        portal_sections=(
            sections if sections is not None else [PortalSection.ZONES, PortalSection.INDENTS]
        ),
    )
    if zone is not None:
        user.zones.add(zone)
    return user


@pytest.fixture
def zones(db):
    built = {}
    for code, plant in (("AYODHYA", "1101"), ("BAHRAICH", "2202")):
        zone = Zone.objects.create(code=code, name=f"{code.title()} Zone")
        ZonePlant.objects.create(zone=zone, plant_code=plant, plant_name=f"{code} BMC")
        mait = MaitFactory(name=f"{code.title()} Mait")
        MPPFactory(mait=mait, plant_code=plant, plant_name=f"{code} BMC")
        built[code] = {"zone": zone, "mait": mait}
    return built


class TestTheManagersPanel:
    def test_it_lists_the_accounts_a_zone_is_run_by(self, zones):
        account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"], mobile_no="9811100001")
        office = account("head-office")

        body = auth(office).get(MANAGERS).json()
        assert body["count"] == 1
        row = body["results"][0]
        assert row["username"] == "zonal-ayodhya"
        assert row["mobile_no"] == "9811100001"
        assert row["zone_names"] == ["Ayodhya Zone"]
        assert row["app_access"] is True
        assert row["maits"] == 1

    def test_a_head_office_admin_is_not_a_zones_manager(self, zones):
        office = account("head-office")
        body = auth(office).get(MANAGERS).json()
        assert [row["username"] for row in body["results"]] == []

    def test_no_number_means_no_app_and_is_counted(self, zones):
        account("zonal-quiet", zone=zones["AYODHYA"]["zone"])
        body = auth(account("head-office")).get(MANAGERS).json()
        assert body["results"][0]["app_access"] is False
        assert body["without_mobile"] == 1

    def test_a_switched_off_zone_is_named_rather_than_hidden(self, zones):
        zone = zones["AYODHYA"]["zone"]
        account("zonal-ayodhya", zone=zone, mobile_no="9811100001")
        zone.is_active = False
        zone.save(update_fields=["is_active"])

        row = auth(account("head-office")).get(MANAGERS).json()["results"][0]
        assert row["zone_names"] == []
        assert row["inactive_zones"] == ["Ayodhya Zone"]
        assert row["app_access"] is False

    def test_a_scoped_caller_sees_only_their_own_zones_managers(self, zones):
        account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"])
        account("zonal-bahraich", zone=zones["BAHRAICH"]["zone"])

        mine = account("zonal-ayodhya-2", zone=zones["AYODHYA"]["zone"])
        body = auth(mine).get(MANAGERS).json()
        assert {row["username"] for row in body["results"]} == {
            "zonal-ayodhya",
            "zonal-ayodhya-2",
        }


class TestSettingTheNumber:
    def test_the_number_can_be_set_from_the_zones_screen(self, zones):
        manager = account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"])
        office = account("head-office")

        answer = auth(office).patch(
            f"{MANAGERS}{manager.id}/", {"mobile_no": "9811100009"}, format="json"
        )
        assert answer.status_code == 200
        assert answer.data["mobile_no"] == "9811100009"
        assert answer.data["app_access"] is True
        manager.refresh_from_db()
        assert manager.mobile_no == "9811100009"

    def test_a_number_a_mait_signs_in_with_is_refused(self, zones):
        mait = zones["AYODHYA"]["mait"]
        mait.mobile_no = "9811100010"
        mait.save(update_fields=["mobile_no"])

        manager = account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"])
        refused = auth(account("head-office")).patch(
            f"{MANAGERS}{manager.id}/", {"mobile_no": "9811100010"}, format="json"
        )
        assert refused.status_code == 400

    def test_a_number_another_account_uses_is_refused(self, zones):
        account("zonal-bahraich", zone=zones["BAHRAICH"]["zone"], mobile_no="9811100011")
        manager = account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"])

        refused = auth(account("head-office")).patch(
            f"{MANAGERS}{manager.id}/", {"mobile_no": "9811100011"}, format="json"
        )
        assert refused.status_code == 400

    def test_blank_takes_the_app_away_without_touching_the_portal_login(self, zones):
        manager = account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"], mobile_no="9811100012")
        answer = auth(account("head-office")).patch(
            f"{MANAGERS}{manager.id}/", {"mobile_no": ""}, format="json"
        )
        assert answer.status_code == 200
        assert answer.data["app_access"] is False
        manager.refresh_from_db()
        assert manager.mobile_no == ""
        assert manager.has_usable_password()

    def test_a_scoped_caller_cannot_reach_the_next_zone_along(self, zones):
        theirs = account("zonal-bahraich", zone=zones["BAHRAICH"]["zone"])
        mine = account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"])

        refused = auth(mine).patch(
            f"{MANAGERS}{theirs.id}/", {"mobile_no": "9811100013"}, format="json"
        )
        assert refused.status_code == 404

    def test_the_change_is_audited(self, zones):
        from apps.core.models import AuditLog

        manager = account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"])
        auth(account("head-office")).patch(
            f"{MANAGERS}{manager.id}/", {"mobile_no": "9811100014"}, format="json"
        )
        row = AuditLog.objects.filter(entity_type="user", entity_id=str(manager.id)).latest(
            "created_at"
        )
        assert row.meta_json["after"]["mobile_no"] == "9811100014"


class TestTheActivityFeed:
    def _indent(self, mait):
        return IndentRequest.objects.create(
            mait=mait, product_type=ProductType.STRAW, breed="MURRAH", qty_requested=5
        )

    def test_it_reads_as_sentences_and_counts_both_decisions(self, zones):
        manager = account(
            "zonal-ayodhya",
            zone=zones["AYODHYA"]["zone"],
            sections=[PortalSection.ZONES, PortalSection.INDENTS],
        )
        approved = self._indent(zones["AYODHYA"]["mait"])
        rejected = self._indent(zones["AYODHYA"]["mait"])

        auth(manager).post(f"/api/v1/indents/{approved.id}/approve/")
        auth(manager).post(
            f"/api/v1/indents/{rejected.id}/reject/", {"reason": "Nothing on the shelf"}
        )

        body = auth(account("head-office")).get(ACTIVITY).json()
        summaries = [row["summary"] for row in body["results"]]
        assert any(summary.startswith("Approved indent") for summary in summaries)
        assert any(summary.startswith("Rejected indent") for summary in summaries)

        panel = auth(account("head-office-2")).get(MANAGERS).json()["results"][0]
        assert panel["activity"]["approved"] == 1
        assert panel["activity"]["rejected"] == 1
        assert panel["activity"]["actions"] >= 2

    def test_sign_ins_are_left_out_unless_they_are_asked_for(self, zones):
        """
        The default is the decisions.

        A manager who works in the portal signs in and out several times a day, so the
        unfiltered trail is ninety sign-ins with the two approvals somebody came to read
        buried inside them — a feed nobody scrolls twice.
        """
        manager = account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"])
        indent = self._indent(zones["AYODHYA"]["mait"])
        # Signing in writes a LOGIN row of its own.
        auth(manager).post(f"/api/v1/indents/{indent.id}/approve/")
        APIClient().post(
            "/api/v1/auth/login/",
            {"username": "zonal-ayodhya", "password": "a-long-enough-password"},
        )

        office = auth(account("head-office"))
        default = office.get(ACTIVITY).json()
        assert all(row["action"] != "login" for row in default["results"])
        assert any(row["summary"].startswith("Approved indent") for row in default["results"])

        everything = office.get(ACTIVITY, {"kind": "all"}).json()
        assert any(row["action"] == "login" for row in everything["results"])
        assert everything["count"] > default["count"]

    def test_it_can_be_narrowed_to_one_manager(self, zones):
        mine = account("zonal-ayodhya", zone=zones["AYODHYA"]["zone"])
        theirs = account("zonal-bahraich", zone=zones["BAHRAICH"]["zone"])
        auth(mine).post(f"/api/v1/indents/{self._indent(zones['AYODHYA']['mait']).id}/approve/")
        auth(theirs).post(f"/api/v1/indents/{self._indent(zones['BAHRAICH']['mait']).id}/approve/")

        body = auth(account("head-office")).get(ACTIVITY, {"manager": mine.id}).json()
        assert body["results"]
        assert all(row["actor"]["username"] == "zonal-ayodhya" for row in body["results"])

    def test_an_account_without_the_zones_section_is_refused(self, zones):
        nobody = account("rate-clerk", sections=[PortalSection.RATES])
        assert auth(nobody).get(MANAGERS).status_code == 403
        assert auth(nobody).get(ACTIVITY).status_code == 403
