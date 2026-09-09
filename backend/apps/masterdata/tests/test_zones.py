"""
Zones, and the scoping they cause.

Two halves, and the second is the one that matters. The first is ordinary CRUD: a zone holds
chilling centres, one centre cannot be in two zones, a zone somebody depends on is not
deleted out from under them. The second is a security boundary — an account given a zone must
not be able to read another zone's members, events or exports, by any route including the
ones nobody thought to hide.

The tests are written against the API rather than against the queryset helpers on purpose. A
scope that holds in `apply_scope` and is never called from a view is a scope that does not
exist, and that is precisely the failure mode: it fails *open*, silently, and looks correct
in every unit test of the helper itself.
"""

from __future__ import annotations

import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.ai_events.models import AIEvent
from apps.masterdata.models import Zone, ZonePlant
from conftest import AnimalFactory, MaitFactory, MemberFactory, MPPFactory, SemenBatchFactory

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


def _as(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _admin(**extra) -> User:
    return User.objects.create_user(
        username=extra.pop("username", f"admin-{uuid.uuid4().hex[:6]}"),
        password="a-long-enough-password",
        full_name=extra.pop("full_name", "Office Admin"),
        role=Role.ADMIN,
        portal_sections=list(PortalSection.values),
        **extra,
    )


@pytest.fixture
def network(db):
    """
    Two chilling centres with an insemination apiece, and nothing else.

    Deliberately small and deliberately symmetric: every assertion below is "this account
    sees one of these two", so a scope that leaks shows up as a count of 2 rather than as a
    subtle difference in a long list.
    """

    def make(plant_code, plant_name):
        mait = MaitFactory()
        mpp = MPPFactory(mait=mait, plant_code=plant_code, plant_name=plant_name)
        member = MemberFactory(mpp=mpp)
        animal = AnimalFactory(member=member)
        # A completed event carries the straw that served it — `ai_event_completed_requires_straw`
        # is a database constraint, not a convention, and it is the one that stops an
        # insemination being recorded without the thing it was recorded about.
        straw = SemenBatchFactory()
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=straw.unique_straw_no,
            status=AIEvent.Status.COMPLETED,
            completed_at=timezone.now(),
        )
        return {"mpp": mpp, "member": member, "event": event, "mait": mait}

    return {
        "bahraich": make("2002", "BAHRAICH"),
        "pratapgarh": make("2004", "PRATAPGARH"),
    }


@pytest.fixture
def bahraich_zone(db, network):
    zone = Zone.objects.create(code="ZONE1", name="Bahraich Zone")
    ZonePlant.objects.create(zone=zone, plant_code="2002", plant_name="BAHRAICH")
    return zone


# --------------------------------------------------------------------------------------
# Setting zones up
# --------------------------------------------------------------------------------------
def test_a_zone_is_created_with_its_chilling_centres(network):
    client = _as(_admin())
    response = client.post(
        f"{BASE}/admin/zones/",
        {"code": "zone1", "name": "Bahraich Zone", "plants": ["2002"]},
        format="json",
    )
    assert response.status_code == 201, response.data
    # Upper-cased on the way in, so a code typed in either case is the same zone.
    assert response.data["code"] == "ZONE1"
    assert response.data["plants"] == ["2002"]
    # The counts are what make the setup screen readable — a zone is its members, not its name.
    assert response.data["mpp_count"] == 1
    assert response.data["member_count"] == 1


def test_a_chilling_centre_cannot_be_in_two_zones(network, bahraich_zone):
    """
    The rule the whole table shape exists to enforce, refused by name rather than by 500.

    A plant in two zones double-counts on every dashboard that adds zones up, and the person
    who would notice is whoever reconciles the total against the tile above it — months later.
    """
    client = _as(_admin())
    response = client.post(
        f"{BASE}/admin/zones/",
        {"code": "ZONE2", "name": "Second Zone", "plants": ["2002"]},
        format="json",
    )
    assert response.status_code == 400
    message = str(response.data)
    assert "BAHRAICH" in message and "Bahraich Zone" in message


def test_a_code_the_masters_do_not_have_is_refused(network):
    client = _as(_admin())
    response = client.post(
        f"{BASE}/admin/zones/",
        {"code": "ZONE9", "name": "Typo Zone", "plants": ["9999"]},
        format="json",
    )
    assert response.status_code == 400
    assert "9999" in str(response.data)


def test_saving_a_zone_replaces_its_centres_rather_than_adding_to_them(network, bahraich_zone):
    """Unticking a box and pressing save has to take the centre out."""
    client = _as(_admin())
    response = client.patch(
        f"{BASE}/admin/zones/{bahraich_zone.id}/",
        {"plants": ["2004"]},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["plants"] == ["2004"]
    assert not ZonePlant.objects.filter(plant_code="2002").exists()


def test_a_zone_somebody_depends_on_is_not_deleted(network, bahraich_zone):
    """
    Deleting it would widen its holders to the whole network — failing open, silently.

    The refusal names them, because "in use" without saying by whom leaves an operator
    clicking delete on each zone in turn to find out.
    """
    manager = _admin(full_name="Zone Manager")
    manager.zones.set([bahraich_zone])

    response = _as(_admin()).delete(f"{BASE}/admin/zones/{bahraich_zone.id}/")
    assert response.status_code == 409, response.data
    assert "Zone Manager" in str(response.data)
    assert Zone.objects.filter(id=bahraich_zone.id).exists()


def test_the_plant_list_offers_every_centre_with_its_size(network, bahraich_zone):
    response = _as(_admin()).get(f"{BASE}/admin/zones/plants/")
    assert response.status_code == 200
    rows = {row["plant_code"]: row for row in response.data["results"]}
    assert rows["2002"]["zone_name"] == "Bahraich Zone"
    # An unassigned centre is the point of the screen, not an error.
    assert rows["2004"]["zone_code"] == ""
    assert response.data["unassigned"] == 1
    assert rows["2002"]["mpp_count"] == 1


def test_only_an_account_holding_the_zones_section_may_set_them_up(network):
    """The section gate, on the screen that hands out reach."""
    outsider = _admin(username="no-zones")
    outsider.portal_sections = [PortalSection.DASHBOARD]
    outsider.save()
    assert _as(outsider).get(f"{BASE}/admin/zones/").status_code == 403


# --------------------------------------------------------------------------------------
# What a zone account can see
# --------------------------------------------------------------------------------------
@pytest.fixture
def zone_admin(db, bahraich_zone):
    user = _admin(username="bahraich-manager", full_name="Bahraich Manager")
    user.zones.set([bahraich_zone])
    return user


def test_an_unzoned_admin_still_sees_the_whole_network(network):
    """The default, and what every account that exists today keeps."""
    response = _as(_admin()).get(f"{BASE}/dashboard/summary/")
    assert response.status_code == 200
    assert response.data["lifetime"] == 2
    assert response.data["scope"]["scoped"] is False


def test_a_zone_admin_counts_only_their_own_zone(zone_admin):
    response = _as(zone_admin).get(f"{BASE}/dashboard/summary/")
    assert response.status_code == 200
    assert response.data["lifetime"] == 1
    assert response.data["scope"]["scoped"] is True
    assert response.data["scope"]["zones"] == ["Bahraich Zone"]


def test_the_all_time_highs_are_withheld_from_a_zone_account(zone_admin, network):
    """
    A network milestone under a zone figure reads as that zone's record. It is not.

    Rather than compute a per-zone high nobody asked for, the footnote is simply absent.
    """
    from apps.dashboard.models import PlatformMilestone

    PlatformMilestone.objects.create(
        kind=PlatformMilestone.Kind.HIGHEST_DAY, value=32006, label="12 Mar 2026"
    )
    assert _as(zone_admin).get(f"{BASE}/dashboard/summary/").data["highest_day"] is None
    assert _as(_admin()).get(f"{BASE}/dashboard/summary/").data["highest_day"]["value"] == 32006


def test_the_trend_chart_is_scoped(zone_admin):
    response = _as(zone_admin).get(f"{BASE}/dashboard/trends/?days=7")
    assert response.status_code == 200
    assert sum(row["completed"] for row in response.data["results"]) == 1
    assert response.data["scope"]["scoped"] is True


@pytest.mark.parametrize(
    "path,count_at",
    [
        ("/ai-events/", "count"),
        ("/members/", "count"),
        ("/mpp/", "count"),
    ],
)
def test_the_list_screens_are_scoped(zone_admin, path, count_at):
    response = _as(zone_admin).get(f"{BASE}{path}")
    assert response.status_code == 200
    assert response.data[count_at] == 1, f"{path} leaked another zone"


def test_a_row_from_another_zone_is_not_reachable_by_its_own_url(zone_admin, network):
    """
    The check that matters most, and the one a list-only filter would fail.

    A scope enforced on the list and not on the detail is a scope an operator walks around by
    reading an id off a report and typing it into the address bar.
    """
    other = network["pratapgarh"]["event"]
    assert _as(zone_admin).get(f"{BASE}/ai-events/{other.id}/").status_code == 404

    mine = network["bahraich"]["event"]
    assert _as(zone_admin).get(f"{BASE}/ai-events/{mine.id}/").status_code == 200


def test_the_export_carries_only_the_zone(zone_admin):
    """An export is the easiest way around a screen's scope, so it is narrowed at the source."""
    response = _as(zone_admin).get(f"{BASE}/reports/export/")
    assert response.status_code == 200
    body = b"".join(response.streaming_content).decode()
    # Header plus exactly one event.
    assert len([line for line in body.splitlines() if line.strip()]) == 2


def test_the_exception_queues_are_deliberately_not_scoped(zone_admin, network):
    """
    The one thing a zone account still sees whole, and it is a decision rather than an
    oversight: a payment stuck in Pratapgarh is somebody's job whoever is looking at it, and
    a zone view that hid it would leave it for a colleague who never opens that screen.
    """
    response = _as(zone_admin).get(f"{BASE}/dashboard/summary/")
    assert "exceptions" in response.data
    assert response.data["scope"]["scoped"] is True


def test_a_zone_holding_nothing_shows_nothing_rather_than_everything(db, network):
    """
    The failure that would matter most, and the reason `zone_scope` separates None from [].

    A zone still being set up holds no chilling centres. Reading that as "no restriction"
    would hand anyone assigned to it the whole network, and nothing on the screen would say so.
    """
    empty = Zone.objects.create(code="ZONE0", name="Not Set Up Yet")
    user = _admin(username="new-manager")
    user.zones.set([empty])

    response = _as(user).get(f"{BASE}/dashboard/summary/")
    assert response.data["lifetime"] == 0
    assert response.data["scope"]["scoped"] is True


def test_a_super_admin_is_never_scoped(db, bahraich_zone, network):
    """They hand out zones; an account that could restrict its own view is one bad save from
    nobody being able to see the network."""
    boss = User.objects.create_superuser("boss", "a-long-enough-password", full_name="Boss")
    boss.zones.set([bahraich_zone])
    assert _as(boss).get(f"{BASE}/dashboard/summary/").data["lifetime"] == 2


# --------------------------------------------------------------------------------------
# The comparison panel
# --------------------------------------------------------------------------------------
def test_zones_are_ranked_with_what_is_in_no_zone_reported_separately(db, network, bahraich_zone):
    """
    A panel that quietly dropped the unassigned centres could not be reconciled against the
    tile above it — the rows would add up to less than the network total for no stated reason.
    """
    from apps.dashboard.tasks import aggregate_daily_ai_counts

    aggregate_daily_ai_counts()

    response = _as(_admin()).get(f"{BASE}/dashboard/zones/?days=30")
    assert response.status_code == 200
    assert [row["name"] for row in response.data["results"]] == ["Bahraich Zone"]
    assert response.data["results"][0]["events"] == 1
    assert response.data["unassigned_events"] == 1
    assert response.data["unassigned_plants"] == 1


def test_todays_work_is_counted_before_the_hourly_job_has_seen_it(db, network, bahraich_zone):
    """
    The panel sits under a chart that overlays the recent tail live, and the two read the same
    window. Trusting the aggregate all the way to today left the chart drawing this morning's
    events above a zone row that did not count them — and on the dev path, where no worker
    runs at all, the panel showed nothing at all on a database full of inseminations.

    No aggregation is run here on purpose: that is the state this panel has to be right in.
    """
    from apps.dashboard.models import DailyAIAggregate

    assert not DailyAIAggregate.objects.exists()

    response = _as(_admin()).get(f"{BASE}/dashboard/zones/?days=30")
    assert response.status_code == 200
    assert response.data["results"][0]["events"] == 1
    assert response.data["total"] == 1
    assert response.data["unassigned_events"] == 1


def test_a_settled_day_is_not_counted_twice(db, network, bahraich_zone):
    """
    The aggregate covers the settled days and the events cover the tail, and the boundary
    between them is half-open. Overlapping by a day would double every figure in the panel,
    which reads as the app recording each insemination twice.
    """
    from apps.dashboard.tasks import aggregate_daily_ai_counts

    aggregate_daily_ai_counts()

    response = _as(_admin()).get(f"{BASE}/dashboard/zones/?days=30")
    assert response.data["results"][0]["events"] == 1
    assert response.data["total"] == 1


def test_a_zone_account_compares_only_its_own_zones(zone_admin, network, bahraich_zone):
    """The panel is a comparison, not a way around the scope."""
    from apps.dashboard.tasks import aggregate_daily_ai_counts

    aggregate_daily_ai_counts()

    response = _as(zone_admin).get(f"{BASE}/dashboard/zones/")
    assert [row["name"] for row in response.data["results"]] == ["Bahraich Zone"]
    assert response.data["unassigned_events"] == 0


def test_the_aggregate_carries_the_plant_so_zone_reads_need_no_join(network):
    """`plant_code` is denormalised for the zone dashboard; if the job stops writing it, every
    zone figure silently becomes zero."""
    from apps.dashboard.models import DailyAIAggregate
    from apps.dashboard.tasks import aggregate_daily_ai_counts

    aggregate_daily_ai_counts()
    assert set(DailyAIAggregate.objects.values_list("plant_code", flat=True)) == {"2002", "2004"}


def test_nobody_widens_their_own_view(bahraich_zone, network):
    """
    An account editing its own zones would simply untick them all and read the network.

    The same rule portal access already follows, and the sharper case of it: sections decide
    which screens somebody opens, zones decide how much they see through them.
    """
    manager = _admin(username="self-editor")
    manager.zones.set([bahraich_zone])

    response = _as(manager).patch(f"{BASE}/admin/users/{manager.id}/", {"zones": []}, format="json")
    assert response.status_code == 400
    assert "your own zones" in str(response.data)
    assert manager.zones.count() == 1

    # Somebody else may do it, which is the whole point of the refusal.
    other = _as(_admin()).patch(f"{BASE}/admin/users/{manager.id}/", {"zones": []}, format="json")
    assert other.status_code == 200, other.data
    assert manager.zones.count() == 0


def test_a_zone_change_is_recorded_in_the_trail(bahraich_zone, network):
    """ "Their numbers changed last Tuesday" has to have an answer."""
    from apps.core.models import AuditLog

    target = _admin(username="moved-region")
    _as(_admin()).patch(f"{BASE}/admin/users/{target.id}/", {"zones": ["ZONE1"]}, format="json")

    entry = AuditLog.objects.filter(entity_type="user", entity_id=str(target.id)).first()
    assert entry.meta_json["before"]["zones"] == []
    assert entry.meta_json["after"]["zones"] == ["ZONE1"]


def test_setting_a_zone_up_is_recorded_too(network):
    from apps.core.models import AuditLog

    client = _as(_admin())
    created = client.post(
        f"{BASE}/admin/zones/",
        {"code": "ZONE7", "name": "Audited Zone", "plants": ["2002"]},
        format="json",
    )
    client.patch(f"{BASE}/admin/zones/{created.data['id']}/", {"plants": ["2004"]}, format="json")

    entries = list(AuditLog.objects.filter(entity_type="zone").order_by("created_at"))
    assert [e.action for e in entries] == ["create", "update"]
    # The membership change is recorded both ways round: a chilling centre quietly moving
    # zone changes what several people's dashboards report.
    assert entries[1].meta_json["plants"] == {"before": ["2002"], "after": ["2004"]}
