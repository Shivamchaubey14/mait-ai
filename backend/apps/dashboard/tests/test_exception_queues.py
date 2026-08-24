"""
The exception queues, and the one number on them that was quietly wrong.

Each queue ships a bounded sample beside a full count: the count says how bad it is, the
sample says where to start. The screen then wrote "N more" underneath the sample, computed as
`count - len(rows)` — and that subtraction only means anything where a queue samples the same
thing it counts.

Exactly one of them does. The rest count events and sample the people or the categories behind
them, so the difference was two different units subtracted from each other:

  - failed OTPs counts failures and samples numbers — one number failing eleven times is one
    row and eleven towards the count;
  - low stock and stale indents both sample summary lines that already stand for every item
    behind them, so nothing is ever left out and the honest answer is always zero;
  - overdue checks counts checks and samples the Maits carrying them, which is where this was
    noticed: one Mait line covering two overdue checks rendered "1 more" underneath, implying
    a second Mait who did not exist.

So every queue now states its own `more`, and these tests pin it per queue rather than trusting
one shared subtraction to be right five times.
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
from apps.dashboard.views import MAX_EXCEPTION_ROWS
from apps.payments.models import OTPLog, Payment

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="queue-admin",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


def queues(client) -> dict:
    return client.get(f"{BASE}/dashboard/summary/").json()["exceptions"]


def test_every_queue_states_how_many_it_left_out(admin_client):
    """No queue may leave the screen to work it out by subtraction."""
    for name, queue in queues(admin_client).items():
        assert "more" in queue, f"{name} does not state `more`"
        assert queue["more"] >= 0


def test_failed_otps_counts_failures_but_leaves_out_numbers(admin_client):
    """
    One number failing repeatedly is one row and many towards the count.

    Four numbers with three sampled leaves one out — not `count - 3`, which with these
    failure counts would have claimed nine.
    """
    for n, mobile in enumerate(["9800000001", "9800000002", "9800000003", "9800000004"]):
        for _ in range(n + 1):
            OTPLog.objects.create(
                mobile_no=mobile,
                is_verified=False,
                attempt_count=1,
                expires_at=timezone.now() + timedelta(minutes=10),
            )

    queue = queues(admin_client)["failed_otps"]

    assert queue["count"] == 1 + 2 + 3 + 4
    assert len(queue["rows"]) == MAX_EXCEPTION_ROWS
    assert queue["more"] == 4 - MAX_EXCEPTION_ROWS


def test_pending_payments_samples_the_thing_it_counts(admin_client, ai_event_ready_to_complete):
    """The one queue where the old subtraction was right. Stated now so it stays right."""
    for _ in range(MAX_EXCEPTION_ROWS + 2):
        event, _straw = ai_event_ready_to_complete()
        Payment.objects.filter(ai_event=event).update(status=Payment.Status.PENDING)

    queue = queues(admin_client)["pending_payments"]

    assert queue["count"] == MAX_EXCEPTION_ROWS + 2
    assert len(queue["rows"]) == MAX_EXCEPTION_ROWS
    assert queue["more"] == 2


def test_summary_rows_never_leave_anything_out(admin_client, mait, stocked_mait):
    """
    Low stock and stale indents describe their whole queue in a line or two.

    A Mait at zero is inside "N Maits under the threshold" already, so there is no further
    row to go and see — `more` is zero however deep the count runs.
    """
    stocked_mait(1)

    low = queues(admin_client)["low_stock"]
    assert low["count"] >= 1
    assert low["more"] == 0

    assert queues(admin_client)["stale_indents"]["more"] == 0


def test_a_quiet_queue_says_nothing_is_hiding(admin_client):
    """Empty is empty: no count, no rows, and nothing left out."""
    for queue in queues(admin_client).values():
        if queue["count"] == 0:
            assert queue["rows"] == []
            assert queue["more"] == 0


def test_overdue_checks_counts_checks_and_samples_maits(
    admin_client, mait, mpp, member, animal, stocked_mait
):
    """
    Where this was noticed.

    Two overdue checks on one Mait is one row that accounts for both, and nothing more to see.
    """
    from apps.pregnancy.models import PregnancyCheck

    for days in (9, 4):
        # A completed event must carry the straw it used — `ai_event_completed_requires_straw`
        # refuses one without, which is the whole point of the constraint.
        straw = stocked_mait(1)[0]
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
            performed_at=timezone.now() - timedelta(days=90 + days),
            completed_at=timezone.now() - timedelta(days=90 + days),
        )
        PregnancyCheck.objects.create(
            ai_event=event, mait=mait, due_on=timezone.localdate() - timedelta(days=days)
        )

    queue = queues(admin_client)["overdue_checks"]

    assert queue["count"] == 2
    assert len(queue["rows"]) == 1
    assert queue["rows"][0]["meta"] == "2 check(s) overdue"
    assert queue["more"] == 0


def test_amounts_do_not_leak_into_the_count(admin_client, ai_event_ready_to_complete):
    """A pending payment's amount is on its row, never added into the queue's count."""
    event, _straw = ai_event_ready_to_complete()
    Payment.objects.filter(ai_event=event).update(
        status=Payment.Status.PENDING, amount=Decimal("250.00")
    )

    queue = queues(admin_client)["pending_payments"]
    assert queue["count"] == 1
    assert "250" in queue["rows"][0]["label"]
