"""
Pregnancy diagnosis as an admin reads it.

The Mait-facing endpoints scope themselves to `request.user.mait_profile`. An admin has none,
so the portal calling them gets an empty list rather than an error — a screen that looks like
it works and reports nothing. These tests pin the separate admin surface that exists instead,
and the two things it is for:

  - **is anybody's round being dropped** — overdue by Mait, with the worst first, and every
    active Mait on the list including the ones holding no checks at all;
  - **is any of this working** — conception rate, counted over settled *inseminations* rather
    than over checks, because an unsure result books a recheck and an event whose second check
    came back pregnant did not fail.

The last one is the number this platform is ultimately judged on, so the arithmetic is tested
against chains built deliberately: one that conceived on the recheck, one that failed, and one
still waiting for a visit that has not happened.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.ai_events.models import AIEvent
from apps.masterdata.models import Mait
from apps.pregnancy.models import ALERT_WINDOW_DAYS, PregnancyCheck
from apps.pregnancy.services import record_check

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="pd-admin",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


@pytest.fixture
def mait_client(db, mait):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")
    return client


@pytest.fixture
def insemination(db, mait, mpp, member, animal, stocked_mait):
    """A completed insemination and the check it books, dated wherever the case needs."""

    def _make(due_in_days: int):
        straw = stocked_mait(1)[0]
        when = timezone.now() - timedelta(days=90 - due_in_days)
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=f"PD-{uuid.uuid4().hex[:6]}",
            status=AIEvent.Status.COMPLETED,
            performed_at=when,
            completed_at=when,
        )
        check = PregnancyCheck.objects.create(
            ai_event=event,
            mait=mait,
            due_on=timezone.localdate() + timedelta(days=due_in_days),
        )
        return event, check

    return _make


def test_mait_cannot_reach_the_admin_surface(mait_client, mait):
    """The split is the point: these are the portal's, and a handset has its own."""
    assert mait_client.get("/api/v1/admin/pregnancy/").status_code == 403
    assert mait_client.get(f"/api/v1/admin/pregnancy/{mait.id}/").status_code == 403


def test_overdue_leads_and_idle_maits_still_appear(admin_client, mait, insemination):
    """
    A Mait with nothing booked is not the same as a Mait ignoring everything.

    Both read as "no overdue" on a list built from check rows alone, which is exactly the
    confusion the screen exists to remove — so every active Mait is on it.
    """
    insemination(due_in_days=-12)
    insemination(due_in_days=-3)
    insemination(due_in_days=2)
    idle = Mait.objects.create(sahayak_vendor_code="SAH-IDLE", name="Idle")

    body = admin_client.get("/api/v1/admin/pregnancy/").json()

    assert body["summary"]["overdue"] == 2
    assert body["summary"]["open"] == 3
    # `due_this_week` counts the overdue ones too, the same way the app's own list does.
    assert body["summary"]["due_this_week"] == 3
    assert body["summary"]["alert_window_days"] == ALERT_WINDOW_DAYS

    rows = {row["mait_id"]: row for row in body["results"]}
    assert set(rows) == {mait.id, idle.id}
    assert rows[mait.id]["overdue"] == 2
    assert rows[idle.id]["overdue"] == 0
    assert rows[idle.id]["open"] == 0
    assert rows[idle.id]["conception_rate"] is None

    # Worst first — the screen is opened to find the round nobody is walking.
    assert body["results"][0]["mait_id"] == mait.id


def test_conception_rate_counts_inseminations_not_checks(admin_client, mait, insemination):
    """
    Four chains, and only two of them have an answer.

    The unsure-then-pregnant chain is two checks and one success; counting checks would score
    it as half a failure and quietly depress every rate on the screen.
    """
    # Conceived, on the recheck an unsure booked.
    _, first = insemination(due_in_days=-30)
    record_check(first, outcome=PregnancyCheck.Outcome.UNSURE)
    recheck = PregnancyCheck.objects.get(rechecks=first)
    record_check(recheck, outcome=PregnancyCheck.Outcome.PREGNANT)

    # Did not take.
    _, failed = insemination(due_in_days=-20)
    record_check(failed, outcome=PregnancyCheck.Outcome.NOT_PREGNANT, photo_url="/media/x.jpg")

    # Still unsure, recheck not yet walked — no answer either way.
    _, waiting = insemination(due_in_days=-10)
    record_check(waiting, outcome=PregnancyCheck.Outcome.UNSURE)

    # Never visited at all.
    insemination(due_in_days=5)

    summary = admin_client.get("/api/v1/admin/pregnancy/").json()["summary"]

    # Two settled inseminations out of four, one of them carrying.
    assert summary["decided"] == 2
    assert summary["conceived"] == 1
    assert summary["conception_rate"] == 50.0


def test_no_rate_at_all_before_anything_settles(admin_client, insemination):
    """
    Null, not zero.

    0.0% is a platform that is failing; no rate is a platform whose first checks are not due
    yet, and a tile rendering them the same way raises a false alarm in its first ninety days.
    """
    insemination(due_in_days=6)

    summary = admin_client.get("/api/v1/admin/pregnancy/").json()["summary"]
    assert summary["decided"] == 0
    assert summary["conception_rate"] is None


def test_drill_down_lists_the_oldest_first(admin_client, mait, insemination):
    """
    The app sorts soonest-first to plan a round.

    This screen is read to find the dropped ones, and soonest-first buries them at the bottom.
    """
    insemination(due_in_days=-40)
    insemination(due_in_days=-2)
    _, done = insemination(due_in_days=-15)
    record_check(done, outcome=PregnancyCheck.Outcome.PREGNANT)

    body = admin_client.get(f"/api/v1/admin/pregnancy/{mait.id}/").json()

    assert body["mait"]["mait_id"] == mait.id
    assert body["summary"]["open"] == 2
    assert body["summary"]["recorded"] == 1
    days = [row["days_until"] for row in body["results"]]
    assert days == sorted(days)
    assert days[0] == -40

    recorded = admin_client.get(f"/api/v1/admin/pregnancy/{mait.id}/?window=done").json()
    assert [row["outcome"] for row in recorded["results"]] == ["pregnant"]
    assert recorded["results"][0]["calving_due_on"]

    everything = admin_client.get(f"/api/v1/admin/pregnancy/{mait.id}/?window=all").json()
    assert len(everything["results"]) == 3


def test_drill_down_shows_only_that_maits_checks(admin_client, mait, insemination):
    """Denormalised onto the check for exactly this reason — no join, and no leakage."""
    insemination(due_in_days=-5)
    other = Mait.objects.create(sahayak_vendor_code="SAH-OTHER", name="Other")

    body = admin_client.get(f"/api/v1/admin/pregnancy/{other.id}/").json()
    assert body["results"] == []
    assert body["summary"]["open"] == 0


def test_dashboard_carries_the_same_figures(admin_client, mait, insemination):
    """
    One arithmetic, two screens.

    A tile that disagrees with the screen it links to is worse than no tile.
    """
    _, took = insemination(due_in_days=-25)
    record_check(took, outcome=PregnancyCheck.Outcome.PREGNANT)
    insemination(due_in_days=-4)

    summary = admin_client.get("/api/v1/dashboard/summary/").json()
    oversight = admin_client.get("/api/v1/admin/pregnancy/").json()["summary"]

    assert summary["pregnancy"]["conception_rate"] == oversight["conception_rate"]
    assert summary["pregnancy"]["overdue"] == oversight["overdue"] == 1
    queue = summary["exceptions"]["overdue_checks"]
    assert queue["count"] == 1
    assert queue["rows"][0]["label"] == mait.name
    # Stated, not inferred. This queue counts checks and samples the Maits carrying them, so
    # the screen cannot subtract one from the other: a single row accounting for every overdue
    # check on the platform rendered "1 more" underneath it.
    assert queue["more"] == 0


def test_the_overdue_queue_says_how_many_maits_it_left_out(admin_client, mait, insemination):
    """Two overdue checks on one Mait is one row and nothing omitted, however deep the count."""
    insemination(due_in_days=-9)
    insemination(due_in_days=-4)

    queue = admin_client.get("/api/v1/dashboard/summary/").json()["exceptions"]["overdue_checks"]

    assert queue["count"] == 2
    assert len(queue["rows"]) == 1
    assert queue["rows"][0]["meta"] == "2 check(s) overdue"
    assert queue["more"] == 0


def test_event_detail_carries_the_chain(admin_client, insemination):
    """The screen a dispute is settled from should say whether the insemination worked."""
    event, check = insemination(due_in_days=-30)
    record_check(check, outcome=PregnancyCheck.Outcome.UNSURE)

    body = admin_client.get(f"/api/v1/ai-events/{event.id}/").json()

    chain = body["pregnancy_checks"]
    assert [c["outcome"] for c in chain] == ["unsure", ""]

    # The list is not asked to carry it — 25 rows would be 25 extra queries for a column no
    # table has room for.
    listed = admin_client.get("/api/v1/ai-events/").json()["results"][0]
    assert "pregnancy_checks" not in listed
