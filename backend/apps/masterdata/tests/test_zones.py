"""
Setting zones up.

Ordinary CRUD, with one rule doing most of the work: a chilling centre belongs to exactly one
zone. That is what makes this a partition rather than a set of independent lists, and it is
enforced twice on purpose — uniquely in the database, so it cannot be wrong, and by name in
the serializer, so the operator gets a sentence rather than a 500.

The scoping these zones cause is tested alongside the commit that applies it.
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
