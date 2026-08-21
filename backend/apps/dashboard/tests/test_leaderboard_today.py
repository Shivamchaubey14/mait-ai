"""
The leaderboard counts today's work (SRS §6.7.4).

It read `DailyAIAggregate` and nothing else. That table is written by an hourly job, so
today's slice does not exist until the first run after midnight and is up to an hour behind
after that — a Mait who had worked all morning showed yesterday's total, and on a dev
database with no worker at all the board simply stopped on whatever day the job last ran.

`trends` and `summary` had already been given a live reading of today for exactly this reason,
with a comment saying so; `mait_performance` never was. These tests are the difference, and
they fail against the aggregate-only implementation.

Events are written straight to `completed`. Reaching that legitimately needs a verified
payment (Phase 4); what is under test is the counting.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.ai_events.models import AIEvent
from apps.core.timeframe import end_of_day, start_of_day
from apps.dashboard.tasks import aggregate_daily_ai_counts
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

URL = "/api/v1/dashboard/mait-performance/"


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-board",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


@pytest.fixture
def event(db, mait, mpp, member, animal, stocked_mait):
    def _make(when=None, tag="LB"):
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
            status=AIEvent.Status.COMPLETED,
            performed_at=when,
            completed_at=when,
        )

    return _make


def row_for(body, mait_id):
    return next((r for r in body["results"] if r["mait_id"] == mait_id), None)


def test_todays_event_counts_before_the_aggregate_has_run(admin_client, event, mait):
    # The whole point. Nothing has aggregated anything, and the board still has to be right.
    event()
    event()

    body = admin_client.get(URL, {"days": 30}).json()

    assert row_for(body, mait.id)["ai_count"] == 2


def test_today_is_not_counted_twice_once_the_aggregate_catches_up(admin_client, event, mait):
    # The failure mode of a live overlay: the hourly job writes today's slice, and a board
    # that adds the live count on top of it doubles every Mait's morning.
    event()
    aggregate_daily_ai_counts()

    body = admin_client.get(URL, {"days": 30}).json()

    assert row_for(body, mait.id)["ai_count"] == 1


def test_settled_days_still_come_off_the_aggregate(admin_client, event, mait):
    # Yesterday's row is what the aggregate is *for*. Reading the whole window live would
    # undo the reason the table exists.
    yesterday = start_of_day(timezone.localdate()) - timedelta(hours=2)
    event(when=yesterday)
    aggregate_daily_ai_counts()
    event()

    body = admin_client.get(URL, {"days": 30}).json()

    assert row_for(body, mait.id)["ai_count"] == 2


def test_an_event_late_in_the_local_day_still_lands_on_today(admin_client, event, mait):
    # 23:30 local. Read in UTC this is tomorrow — how a day-boundary bug hides, by being
    # right until half past six in the evening.
    event(when=end_of_day(timezone.localdate()) - timedelta(minutes=30))

    body = admin_client.get(URL, {"days": 30}).json()

    assert row_for(body, mait.id)["ai_count"] == 1


def test_a_mait_who_only_worked_today_reaches_the_board(admin_client, event, mait):
    # They have no aggregate row at all, so an implementation that merged today's counts into
    # rows it already had would leave them off entirely.
    event()

    body = admin_client.get(URL, {"days": 30}).json()

    assert row_for(body, mait.id) is not None


def test_todays_verified_cash_is_counted(admin_client, event, mait):
    completed = event()
    Payment.objects.create(
        ai_event=completed,
        mode=Payment.Mode.COD,
        amount=Decimal("300.00"),
        status=Payment.Status.VERIFIED,
        # The model refuses a verified COD payment without both codes, and rightly: verified
        # cash with no confirmation from the farmer is the accusation this platform exists to
        # make impossible.
        cod_otp_verified=True,
        member_otp_verified=True,
    )

    row = row_for(admin_client.get(URL, {"days": 30}).json(), mait.id)

    assert Decimal(row["amount_collected"]) == Decimal("300.00")
    assert Decimal(row["cod_amount"]) == Decimal("300.00")
    assert Decimal(row["online_amount"]) == Decimal("0")


def test_an_unverified_payment_is_not_money_anybody_has_agreed_to(admin_client, event, mait):
    completed = event()
    Payment.objects.create(
        ai_event=completed,
        mode=Payment.Mode.COD,
        amount=Decimal("300.00"),
        status=Payment.Status.PENDING,
    )

    row = row_for(admin_client.get(URL, {"days": 30}).json(), mait.id)

    assert row["ai_count"] == 1
    assert Decimal(row["amount_collected"]) == Decimal("0")


def test_a_one_day_window_is_today_and_only_today(admin_client, event, mait):
    # `days=1` makes the window start today, so there are no settled days at all — the branch
    # where an off-by-one would either double today or drop it.
    event(when=start_of_day(timezone.localdate()) - timedelta(hours=1))
    event()

    body = admin_client.get(URL, {"days": 1}).json()

    assert row_for(body, mait.id)["ai_count"] == 1
