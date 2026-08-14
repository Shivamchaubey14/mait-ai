"""
The dashboard counts what happened today (SRS §6.7.1, §6.7.3).

Written because every one of these numbers was zero on a database full of events, and nothing
about a zero says whether it is the data or the filter. `completed_at__date` compiles to
CONVERT_TZ, which is NULL on a MySQL whose timezone tables were never loaded, and a NULL
comparison matches nothing — so the headline counts, the trend chart and the aggregation job
that feeds both were all reporting on an empty filter (`apps.core.timeframe`).

These tests fail against the old implementation on exactly such a database and pass on one
where the tables are loaded, which is the point: the behaviour must not depend on that.

Events are written straight to `completed`. Reaching it legitimately needs a verified payment
(Phase 4); what is under test is the counting.
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
from apps.core.timeframe import end_of_day, local_day, start_of_day
from apps.dashboard.models import DailyAIAggregate
from apps.dashboard.tasks import aggregate_daily_ai_counts

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-days",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


@pytest.fixture
def event(db, mait, mpp, member, animal, stocked_mait):
    def _make(status=AIEvent.Status.COMPLETED, when=None, tag="EV"):
        when = when or timezone.now()
        straw = stocked_mait(1)[0]
        return AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=f"{tag}-{uuid.uuid4().hex[:6]}",
            status=status,
            performed_at=when,
            completed_at=when if status == AIEvent.Status.COMPLETED else None,
        )

    return _make


# --- the helper itself ----------------------------------------------------------------------


def test_a_local_day_starts_at_local_midnight():
    today = timezone.localdate()
    start = start_of_day(today)

    assert timezone.localtime(start).hour == 0
    assert local_day(start) == today
    # Half-open: the last microsecond of today is inside, the first of tomorrow is not.
    assert local_day(end_of_day(today) - timedelta(microseconds=1)) == today
    assert local_day(end_of_day(today)) == today + timedelta(days=1)


# --- headline counts ------------------------------------------------------------------------


def test_todays_event_is_counted_today(admin_client, event):
    event()

    body = admin_client.get("/api/v1/dashboard/summary/").json()

    assert body["today"] == 1
    assert body["this_week"] == 1
    assert body["this_month"] == 1
    assert body["lifetime"] == 1


def test_an_event_late_in_the_local_day_still_lands_on_it(admin_client, event):
    # 23:30 local. Read in UTC this is tomorrow, which is how a day-boundary bug shows itself:
    # the count is right for most of the day and wrong for the last five and a half hours.
    late = end_of_day(timezone.localdate()) - timedelta(minutes=30)
    event(when=late)

    assert admin_client.get("/api/v1/dashboard/summary/").json()["today"] == 1


def test_yesterdays_event_is_not_todays(admin_client, event):
    event(when=start_of_day(timezone.localdate()) - timedelta(hours=1))

    body = admin_client.get("/api/v1/dashboard/summary/").json()

    assert body["today"] == 0
    assert body["lifetime"] == 1


# --- trend series ---------------------------------------------------------------------------


def test_a_pending_payment_lands_on_its_own_day(admin_client, event):
    event(status=AIEvent.Status.PAYMENT_PENDING)

    body = admin_client.get("/api/v1/dashboard/trends/", {"days": 7}).json()
    today = timezone.localdate().isoformat()

    assert len(body["results"]) == 7
    assert [row["pending"] for row in body["results"] if row["date"] == today] == [1]
    assert sum(row["pending"] for row in body["results"]) == 1


def _bar(body, day=None):
    """The completed count the chart would draw for a day."""
    wanted = (day or timezone.localdate()).isoformat()
    return next(row["completed"] for row in body["results"] if row["date"] == wanted)


def test_todays_event_is_on_the_chart_before_the_aggregator_has_run(admin_client, event):
    """
    The chart and the tile above it must not contradict each other.

    The aggregate is written hourly, so between an insemination and the next run there is no
    slice for today at all. Reading the chart from the aggregate alone drew a flat line under
    a tile that said one event today, and the operator has no way to tell which is lying.
    """
    event()

    trends = admin_client.get("/api/v1/dashboard/trends/", {"days": 7}).json()
    summary = admin_client.get("/api/v1/dashboard/summary/").json()

    assert DailyAIAggregate.objects.count() == 0, "the job has deliberately not run"
    assert _bar(trends) == 1
    assert _bar(trends) == summary["today"]


def test_the_chart_does_not_double_todays_events_once_aggregated(admin_client, event):
    event()
    event()
    aggregate_daily_ai_counts()

    body = admin_client.get("/api/v1/dashboard/trends/", {"days": 7}).json()

    # Counted live *and* present in the aggregate: the live figure replaces the slice rather
    # than adding to it.
    assert _bar(body) == 2


def test_settled_days_still_come_from_the_aggregate(admin_client, event):
    yesterday = timezone.localdate() - timedelta(days=1)
    event(when=start_of_day(yesterday) + timedelta(hours=9))
    aggregate_daily_ai_counts(lookback_days=2)

    body = admin_client.get("/api/v1/dashboard/trends/", {"days": 7}).json()

    assert _bar(body, yesterday) == 1
    assert _bar(body) == 0


# --- the aggregation job the trend chart reads ----------------------------------------------


def test_the_aggregator_writes_a_slice_for_today(event, mpp, mait):
    event()
    event()

    written = aggregate_daily_ai_counts()

    assert written == 1
    slice_ = DailyAIAggregate.objects.get(date=timezone.localdate(), mpp=mpp, mait=mait)
    assert slice_.ai_count == 2
    # Two events for one member: two inseminations, one member served.
    assert slice_.member_ai_count == 2
    assert slice_.distinct_members_served == 1
    assert slice_.district_code == mpp.district_code


def test_the_aggregator_is_safe_to_run_again(event):
    event()

    aggregate_daily_ai_counts()
    aggregate_daily_ai_counts()

    # Runs hourly and recomputes wholesale, so a second pass must not double anything.
    assert DailyAIAggregate.objects.count() == 1
    assert DailyAIAggregate.objects.get().ai_count == 1


def test_the_aggregator_keeps_days_apart(event):
    event()
    event(when=start_of_day(timezone.localdate()) - timedelta(hours=2))

    aggregate_daily_ai_counts(lookback_days=2)

    assert sorted(DailyAIAggregate.objects.values_list("date", flat=True)) == [
        timezone.localdate() - timedelta(days=1),
        timezone.localdate(),
    ]
