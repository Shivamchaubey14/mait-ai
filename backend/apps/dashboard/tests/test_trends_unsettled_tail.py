"""
The trend chart counts the days the hourly job has not settled (SRS §6.7.3).

`trends` read `DailyAIAggregate` for every day but today. That table is rewritten hourly for
the last `AGGREGATE_LOOKBACK_DAYS` days, so yesterday's slice is missing until the first run
after midnight, is up to an hour behind after that, and on the no-Docker dev path — where no
worker runs at all — is whatever `rebuild_ai_aggregates` last left there.

The visible symptom was one screen disagreeing with itself: `summary` counts today *and*
yesterday live to work out the "on yesterday" delta on the tile directly above the chart, so
the tile reported a rise over a yesterday the chart drew as a flat line.

Events are written straight to `completed`. Reaching that legitimately needs a verified
payment (Phase 4); what is under test is the counting.
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
from apps.core.timeframe import end_of_day, start_of_day
from apps.dashboard.models import AGGREGATE_LOOKBACK_DAYS
from apps.dashboard.tasks import aggregate_daily_ai_counts

pytestmark = pytest.mark.django_db

URL = "/api/v1/dashboard/trends/"


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-trends",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


@pytest.fixture
def event(db, mait, mpp, member, animal, stocked_mait):
    def _make(when=None, status=AIEvent.Status.COMPLETED):
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
            straw_unique_no=f"TR-{uuid.uuid4().hex[:6]}",
            status=status,
            performed_at=when,
            completed_at=when if status == AIEvent.Status.COMPLETED else None,
        )

    return _make


def day_in(body, day):
    return next(r for r in body["results"] if r["date"] == day.isoformat())


def noon(day):
    """Mid-afternoon local, far from either boundary."""
    return start_of_day(day) + timedelta(hours=14)


def test_yesterdays_events_count_before_the_aggregate_has_run(admin_client, event):
    # The reported bug: two inseminations yesterday, nothing aggregated, a flat bar.
    yesterday = timezone.localdate() - timedelta(days=1)
    event(when=noon(yesterday))
    event(when=noon(yesterday))

    body = admin_client.get(URL, {"days": 30}).json()

    assert day_in(body, yesterday)["completed"] == 2


def test_the_chart_agrees_with_the_tile_above_it(admin_client, event):
    # `summary` is what the "on yesterday" delta is computed from. The two endpoints have to
    # report the same yesterday or the dashboard contradicts itself in one glance.
    yesterday = timezone.localdate() - timedelta(days=1)
    event(when=noon(yesterday))
    event(when=noon(yesterday))
    event()

    trend = admin_client.get(URL, {"days": 30}).json()
    summary = admin_client.get("/api/v1/dashboard/summary/").json()

    assert day_in(trend, yesterday)["completed"] == 2
    assert summary["today"] == 1
    # +1 over 2 yesterday is a 50% fall, and the chart now draws the 2 it is measured against.
    assert summary["today_delta_percent"] == -50.0


def test_the_tail_is_not_counted_twice_once_the_aggregate_catches_up(admin_client, event):
    # The failure mode of a live overlay: the job writes yesterday's slice, and a reader that
    # adds the live count on top of it doubles the day.
    yesterday = timezone.localdate() - timedelta(days=1)
    event(when=noon(yesterday))
    aggregate_daily_ai_counts()

    body = admin_client.get(URL, {"days": 30}).json()

    assert day_in(body, yesterday)["completed"] == 1


def test_settled_days_still_come_off_the_aggregate(admin_client, event):
    # Older days are what the aggregate is *for*. Reading the whole window live would undo the
    # reason the table exists, so a settled day must survive its events being deleted.
    settled = timezone.localdate() - timedelta(days=AGGREGATE_LOOKBACK_DAYS + 3)
    event(when=noon(settled))
    aggregate_daily_ai_counts(lookback_days=AGGREGATE_LOOKBACK_DAYS + 4)
    AIEvent.objects.all().delete()

    body = admin_client.get(URL, {"days": 30}).json()

    assert day_in(body, settled)["completed"] == 1


def test_a_day_inside_the_window_is_read_live_not_from_a_stale_slice(admin_client, event):
    # A slice the job wrote an hour ago, then a late arrival landing on the same day. The
    # aggregate still says 1; the day is inside the look-back, so the chart must say 2.
    yesterday = timezone.localdate() - timedelta(days=1)
    event(when=noon(yesterday))
    aggregate_daily_ai_counts()
    event(when=noon(yesterday))

    body = admin_client.get(URL, {"days": 30}).json()

    assert day_in(body, yesterday)["completed"] == 2


def test_an_event_late_in_the_local_day_stays_on_that_day(admin_client, event):
    # 23:30 local. Read in UTC this is the next day — how a day-boundary bug hides, by being
    # right until half past six in the evening.
    yesterday = timezone.localdate() - timedelta(days=1)
    event(when=end_of_day(yesterday) - timedelta(minutes=30))

    body = admin_client.get(URL, {"days": 30}).json()

    assert day_in(body, yesterday)["completed"] == 1
    assert day_in(body, timezone.localdate())["completed"] == 0


def test_a_one_day_window_is_today_and_only_today(admin_client, event):
    # `days=1` makes the window start today, so the live tail is clamped to it — the branch
    # where an off-by-one would drag yesterday's events onto today's bar.
    event(when=noon(timezone.localdate() - timedelta(days=1)))
    event()

    body = admin_client.get(URL, {"days": 1}).json()

    assert len(body["results"]) == 1
    assert day_in(body, timezone.localdate())["completed"] == 1


def test_pending_payments_are_still_reported_separately(admin_client, event):
    # The two series are counted from different columns — completions from `completed_at`,
    # pending from `created_at` — and must not bleed into each other now that both are live.
    # A payment-pending event has no `completed_at` at all, so it is nobody's completion.
    event(status=AIEvent.Status.PAYMENT_PENDING)

    row = day_in(admin_client.get(URL, {"days": 30}).json(), timezone.localdate())

    assert row["completed"] == 0
    assert row["pending"] == 1
