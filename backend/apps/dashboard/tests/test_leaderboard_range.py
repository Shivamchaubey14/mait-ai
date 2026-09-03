"""
The leaderboard's date range (W14).

The board answers "who is working", and that is only ever asked about a period — usually a
month somebody is closing rather than a rolling window. Three things have to hold for the
answer to be worth reading.

**It is ranked by the work.** AI count, highest first, with ties settled by something stable so
two Maits on the same count do not swap places between two loads of unchanged data.

**The range means what it says.** Inclusive on both ends, clamped rather than refused — a
leaderboard is a thing somebody scrubs a date picker across, and half-typed dates arrive
constantly.

**The recent days are counted live.** The hourly job rewrites the last `AGGREGATE_LOOKBACK_DAYS`
days wholesale, so anything inside that window is missing, an hour behind, or about to change.
Reading it off the aggregate is how a board stops moving when somebody works — and on the
no-Docker path, where no worker runs at all, how it reports zero forever.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.ai_events.models import AIEvent
from apps.dashboard.models import AGGREGATE_LOOKBACK_DAYS, DailyAIAggregate
from apps.inventory.models import SemenBatch

pytestmark = pytest.mark.django_db

URL = "/api/v1/dashboard/mait-performance/"


@pytest.fixture
def board_client(db):
    user = User.objects.create_user(
        username="board",
        password="pw-for-tests-only",
        full_name="Board",
        role=Role.ADMIN,
        portal_sections=[PortalSection.LEADERBOARD],
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def settled(mait, mpp, day, count, *, collected="0"):
    """A day the hourly job has finished with, written to the aggregate."""
    return DailyAIAggregate.objects.create(
        date=day,
        mpp=mpp,
        mait=mait,
        district_code=mpp.district_code,
        ai_count=count,
        amount_collected=Decimal(collected),
        cod_amount=Decimal("0"),
        online_amount=Decimal("0"),
    )


def worked(mait, mpp, animal, member, day, count=1):
    """`count` completed inseminations on a local day, as real events."""
    when = timezone.make_aware(timezone.datetime(day.year, day.month, day.day, 10, 0))
    for _ in range(count):
        # A completed event must carry the straw it consumed — the schema refuses one that
        # does not, because an insemination with nothing deducted is the leakage this platform
        # exists to stop.
        straw = SemenBatch.objects.create(
            unique_straw_no=uuid.uuid4().hex[:20], breed="MURRAH", is_consumed=True
        )
        AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=straw.unique_straw_no,
            status=AIEvent.Status.COMPLETED,
            performed_at=when,
            completed_at=when,
        )


def names(response):
    return [row["name"] for row in response.data["results"]]


def counts(response):
    return {row["name"]: row["ai_count"] for row in response.data["results"]}


# --------------------------------------------------------------------------------------
# Ranked, highest first
# --------------------------------------------------------------------------------------
def test_the_board_is_ranked_by_ai_count(board_client, mait_factory):
    quiet, quiet_mpp = mait_factory("QUIET")
    busy, busy_mpp = mait_factory("BUSY")
    middling, middling_mpp = mait_factory("MIDDLING")
    long_ago = timezone.localdate() - timedelta(days=20)
    settled(quiet, quiet_mpp, long_ago, 2)
    settled(busy, busy_mpp, long_ago, 40)
    settled(middling, middling_mpp, long_ago, 11)

    response = board_client.get(URL, {"days": 30})
    assert names(response) == ["BUSY", "MIDDLING", "QUIET"]


def test_a_tie_does_not_reshuffle_between_two_identical_loads(board_client, mait_factory):
    """
    Settled by vendor code, so an unchanged board reads the same twice.

    A ranking that reorders itself on refresh is one people stop trusting, and there is
    nothing to explain the change with.
    """
    first, first_mpp = mait_factory("ALPHA", code="5590000001")
    second, second_mpp = mait_factory("BETA", code="5590000002")
    long_ago = timezone.localdate() - timedelta(days=20)
    settled(first, first_mpp, long_ago, 7)
    settled(second, second_mpp, long_ago, 7)

    once = names(board_client.get(URL, {"days": 30}))
    twice = names(board_client.get(URL, {"days": 30}))
    assert once == twice == ["ALPHA", "BETA"]


# --------------------------------------------------------------------------------------
# The range
# --------------------------------------------------------------------------------------
def test_an_explicit_range_is_inclusive_at_both_ends(board_client, mait_factory):
    mait, mpp = mait_factory("RANGED")
    settled(mait, mpp, timezone.localdate() - timedelta(days=30), 5)  # before
    settled(mait, mpp, timezone.localdate() - timedelta(days=25), 7)  # first day
    settled(mait, mpp, timezone.localdate() - timedelta(days=20), 9)  # last day
    settled(mait, mpp, timezone.localdate() - timedelta(days=19), 11)  # after

    first = (timezone.localdate() - timedelta(days=25)).isoformat()
    last = (timezone.localdate() - timedelta(days=20)).isoformat()
    response = board_client.get(URL, {"date_from": first, "date_to": last})

    assert response.data["date_from"] == first
    assert response.data["date_to"] == last
    assert response.data["days"] == 6
    assert counts(response) == {"RANGED": 16}


def test_the_older_days_form_still_works(board_client, mait_factory):
    """`?days=` is what the screen used to send, and old links still carry it."""
    mait, mpp = mait_factory("ROLLING")
    settled(mait, mpp, timezone.localdate() - timedelta(days=3), 4)

    response = board_client.get(URL, {"days": 7})
    assert response.data["days"] == 7
    assert response.data["date_to"] == timezone.localdate().isoformat()
    assert counts(response) == {"ROLLING": 4}


def test_a_range_typed_backwards_is_read_the_way_it_was_meant(board_client, mait_factory):
    """
    Swapped rather than answered empty.

    Returning nothing would look like a fortnight in which nobody worked, which is a different
    and much more alarming answer than "you typed the dates the other way round".
    """
    mait, mpp = mait_factory("BACKWARDS")
    settled(mait, mpp, timezone.localdate() - timedelta(days=10), 3)

    early = (timezone.localdate() - timedelta(days=14)).isoformat()
    late = (timezone.localdate() - timedelta(days=7)).isoformat()
    response = board_client.get(URL, {"date_from": late, "date_to": early})

    assert response.data["date_from"] == early
    assert response.data["date_to"] == late
    assert counts(response) == {"BACKWARDS": 3}


def test_a_range_running_into_the_future_stops_at_today(board_client):
    """A week that has not happened reads as a quiet week rather than as no answer."""
    ahead = (timezone.localdate() + timedelta(days=30)).isoformat()
    response = board_client.get(
        URL, {"date_from": timezone.localdate().isoformat(), "date_to": ahead}
    )

    assert response.data["date_to"] == timezone.localdate().isoformat()


def test_a_half_typed_date_answers_for_something_sensible(board_client):
    """
    A date picker is scrubbed across, so nonsense arrives constantly. Clamping beats a 400
    that empties the screen mid-keystroke.
    """
    for params in ({"date_from": "2026-1"}, {"date_from": "yesterday"}, {"days": "lots"}):
        response = board_client.get(URL, params)
        assert response.status_code == 200
        assert response.data["days"] >= 1


def test_the_range_is_capped_at_a_year(board_client):
    response = board_client.get(URL, {"date_from": "2020-01-01"})
    assert response.data["days"] <= 365


# --------------------------------------------------------------------------------------
# The live tail
# --------------------------------------------------------------------------------------
def test_the_recent_days_are_counted_live_not_off_the_aggregate(
    board_client, mait_factory, member, animal
):
    """
    The bug this replaced: only *today* was overlaid, so yesterday was read off a table the
    hourly job was still rewriting — and on a deployment with no worker, off a table nobody
    had written at all.
    """
    mait, mpp = mait_factory("LIVE")
    yesterday = timezone.localdate() - timedelta(days=1)
    worked(mait, mpp, animal, member, yesterday, count=3)
    worked(mait, mpp, animal, member, timezone.localdate(), count=2)

    response = board_client.get(URL, {"days": 7})
    assert counts(response) == {"LIVE": 5}


def test_a_settled_day_is_not_counted_twice(board_client, mait_factory, member, animal):
    """
    The tail is live and everything before it comes off the aggregate. If the boundary were
    wrong in the other direction, a day would be counted from both and every figure on the
    board would be inflated.
    """
    mait, mpp = mait_factory("BOUNDARY")
    settled_day = timezone.localdate() - timedelta(days=AGGREGATE_LOOKBACK_DAYS + 1)
    settled(mait, mpp, settled_day, 4)
    # Real events on the same settled day, which the aggregate already accounts for.
    worked(mait, mpp, animal, member, settled_day, count=4)

    response = board_client.get(URL, {"days": 30})
    assert counts(response) == {"BOUNDARY": 4}


def test_a_range_that_ends_before_the_tail_takes_nothing_live(
    board_client, mait_factory, member, animal
):
    """Those days have settled; reading events for them would double what the aggregate holds."""
    mait, mpp = mait_factory("HISTORY")
    old_day = timezone.localdate() - timedelta(days=40)
    settled(mait, mpp, old_day, 6)
    worked(mait, mpp, animal, member, timezone.localdate(), count=99)

    response = board_client.get(
        URL,
        {
            "date_from": (old_day - timedelta(days=2)).isoformat(),
            "date_to": (old_day + timedelta(days=2)).isoformat(),
        },
    )
    assert counts(response) == {"HISTORY": 6}


# --------------------------------------------------------------------------------------
# What the range holds
# --------------------------------------------------------------------------------------
def test_the_totals_describe_the_range_not_the_page(board_client, mait_factory):
    mait_a, mpp_a = mait_factory("ONE")
    mait_b, mpp_b = mait_factory("TWO")
    long_ago = timezone.localdate() - timedelta(days=20)
    settled(mait_a, mpp_a, long_ago, 8, collected="800")
    settled(mait_b, mpp_b, long_ago, 5, collected="500")

    data = board_client.get(URL, {"days": 30}).data
    assert data["count"] == 2
    assert data["totals"]["ai_count"] == 13
    assert Decimal(data["totals"]["amount_collected"]) == Decimal("1300")


def test_an_empty_range_answers_zero_rather_than_failing(board_client):
    data = board_client.get(URL, {"days": 7}).data
    assert data["count"] == 0
    assert data["totals"]["ai_count"] == 0
    assert data["results"] == []


def test_an_account_without_the_leaderboard_section_is_refused(db):
    user = User.objects.create_user(
        username="clerk",
        password="pw-for-tests-only",
        full_name="Rate clerk",
        role=Role.ADMIN,
        portal_sections=[PortalSection.RATES],
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")

    assert client.get(URL).status_code == 403


@pytest.fixture
def mait_factory(db):
    """A Mait with one MPP, named so the ranking assertions read as sentences."""
    from conftest import MaitFactory, MPPFactory

    def _make(name, code=None):
        mait = MaitFactory(name=name, **({"sahayak_vendor_code": code} if code else {}))
        return mait, MPPFactory(mait=mait)

    return _make
