"""
MPP coverage (SRS §6.7.5).

Three things this endpoint has to get right, because a wrong answer here looks exactly like a
right one. The window has to be applied — a period selector that changes nothing is worse than
no selector, because the operator believes the number they compared. The summary has to speak
for the network rather than for the rows it happened to return. And a village at zero has to
say which of the three causes it is, since each one is somebody else's job to fix.

Events are written straight to `completed` here. Reaching it legitimately needs a verified
payment (Phase 4), and what is under test is the reporting, not the state machine.
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

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-coverage",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


@pytest.fixture
def complete_event(db, mait, mpp, member, animal, stocked_mait):
    """One completed insemination for `member`, dated however many days ago."""

    def _make(days_ago: int):
        straw = stocked_mait(1)[0]
        when = timezone.now() - timedelta(days=days_ago)
        return AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=f"COV-{days_ago:03d}",
            status=AIEvent.Status.COMPLETED,
            performed_at=when,
            completed_at=when,
        )

    return _make


def coverage(client, **params):
    return client.get("/api/v1/dashboard/mpp-coverage/", params).json()


def test_an_event_inside_the_window_counts(admin_client, complete_event):
    complete_event(days_ago=3)

    body = coverage(admin_client, days=30)

    assert body["days"] == 30
    assert body["summary"]["members_served"] == 1
    assert body["summary"]["mpps_at_zero"] == 0


def test_an_event_outside_the_window_does_not(admin_client, complete_event):
    complete_event(days_ago=60)

    # The bug this pins: `days` used to be accepted and ignored, so 30 and 90 returned the
    # same numbers and the selector on the coverage screen was decoration.
    assert coverage(admin_client, days=30)["summary"]["members_served"] == 0
    assert coverage(admin_client, days=90)["summary"]["members_served"] == 1


def test_the_same_member_twice_is_one_member_served(admin_client, complete_event):
    complete_event(days_ago=1)
    complete_event(days_ago=2)

    # Coverage is reach, not volume. Two inseminations for one farmer is one member served,
    # or one heavy user makes a village look covered.
    body = coverage(admin_client, days=30)
    assert body["summary"]["members_served"] == 1
    assert body["results"][0]["members_served"] == 1


def test_a_village_at_zero_names_its_cause(admin_client, mpp, member, mait):
    row = coverage(admin_client, days=30)["results"][0]

    # The Mait is assigned and has a login, so this village is simply unvisited — not the
    # "Mait inactive" the screen used to report for every zero, having been given nothing to
    # tell them apart with.
    assert row["mait_code"] == mait.sahayak_vendor_code
    assert row["mait_activated"] is (mait.user_id is not None)


def test_an_unassigned_village_says_so(admin_client, mpp, member):
    mpp.mait = None
    mpp.save(update_fields=["mait"])

    row = coverage(admin_client, days=30)["results"][0]

    assert row["mait_code"] == ""
    assert row["mait_activated"] is False


def test_the_summary_is_the_network_not_the_rows(admin_client, mpp, member):
    body = coverage(admin_client, days=30)

    # `rows_shown` exists so the screen can say what its table is: the largest villages, not
    # the network. Totalling `results` describes only the rows returned.
    assert body["summary"]["mpps"] >= body["rows_shown"]
    assert body["summary"]["members"] >= sum(r["total_members"] for r in body["results"])


def test_a_silly_window_is_clamped_not_rejected(admin_client, member):
    assert coverage(admin_client, days="not-a-number")["days"] == 30
    assert coverage(admin_client, days=0)["days"] == 1
    assert coverage(admin_client, days=9999)["days"] == 365
