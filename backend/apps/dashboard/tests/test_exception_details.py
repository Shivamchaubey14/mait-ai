"""
The detail behind every Exceptions card (W16).

Two properties carry all five queues, and both fail silently.

**A card and its dialog count the same thing.** They go through one predicate, and the test
that matters asserts the *shared function* rather than two numbers that happen to agree today
— the failure mode is a card saying four above a dialog showing eleven with nothing on screen
saying which is lying.

**The cause is worked out correctly.** Each of these queues has several causes wearing one
status, and the cause is what decides who gets rung: a payment waiting on a farmer's
authorisation and one waiting on a Mait's screenshot are the same row on the card and two
different phone calls. Getting that wrong sends somebody to the wrong person, politely and
with confidence.
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
from apps.dashboard.exception_details import (
    declined_checks,
    low_stock_maits,
    overdue_checks,
    pending_payments,
    stale_indents,
)
from apps.indents.models import STALE_AFTER_DAYS, IndentRequest
from apps.inventory.models import Consumable, MaitInventory, ProductType
from apps.payments.models import Payment
from apps.pregnancy.models import PregnancyCheck

pytestmark = pytest.mark.django_db

BASE = "/api/v1"


def url(queue: str) -> str:
    return f"{BASE}/admin/exceptions/{queue}/"


@pytest.fixture
def admin_client(db):
    user = User.objects.create_user(
        username="triage",
        password="pw-for-tests-only",
        full_name="Triage",
        role=Role.ADMIN,
        portal_sections=[PortalSection.EXCEPTIONS],
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def rows_of(response):
    return response.data["results"]


def buckets_of(response):
    return {b["key"]: b["count"] for b in response.data["buckets"]}


# --------------------------------------------------------------------------------------
# The shape every queue answers in
# --------------------------------------------------------------------------------------
QUEUE_KEYS = [
    "pending-payments",
    "low-stock",
    "stale-indents",
    "overdue-checks",
    "declined-checks",
]


@pytest.mark.parametrize("queue", QUEUE_KEYS)
def test_every_queue_answers_in_the_same_shape(admin_client, queue):
    """One dialog reads all five, so all five must speak the same way — even when empty."""
    response = admin_client.get(url(queue))

    assert response.status_code == 200
    for key in ("queue", "title", "subtitle", "count", "shown", "buckets", "results"):
        assert key in response.data, key
    assert response.data["queue"] == queue
    assert response.data["title"]


def test_an_unknown_queue_is_refused_rather_than_answered_empty(admin_client):
    """An empty list for a name nobody implements reads as a queue with nothing in it."""
    assert admin_client.get(url("made-up")).status_code == 404


def test_an_account_without_the_exceptions_section_is_refused(db):
    user = User.objects.create_user(
        username="clerk",
        password="pw-for-tests-only",
        full_name="Rate clerk",
        role=Role.ADMIN,
        portal_sections=[PortalSection.RATES],
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")

    assert client.get(url("stale-indents")).status_code == 403


# --------------------------------------------------------------------------------------
# Pending payments
# --------------------------------------------------------------------------------------
def a_pending_payment(mait, mpp, member, animal, *, mode, **fields):
    event = AIEvent.objects.create(
        client_uuid=uuid.uuid4(),
        mait=mait,
        mpp=mpp,
        owner_type=AIEvent.OwnerType.MEMBER,
        member=member,
        animal=animal,
        status=AIEvent.Status.PAYMENT_PENDING,
        performed_at=timezone.now(),
    )
    return Payment.objects.create(
        ai_event=event,
        amount=Decimal("300"),
        mode=mode,
        status=Payment.Status.PENDING,
        **fields,
    )


def test_the_card_and_the_dialog_count_the_same_payments(admin_client, mait, mpp, member, animal):
    a_pending_payment(mait, mpp, member, animal, mode=Payment.Mode.COD)
    a_pending_payment(mait, mpp, member, animal, mode=Payment.Mode.ONLINE)

    assert pending_payments().count() == 2
    assert admin_client.get(url("pending-payments")).data["count"] == 2


@pytest.mark.parametrize(
    ("mode", "fields", "bucket"),
    [
        # Nothing authorised: the call is to her.
        (Payment.Mode.COD, {}, "not_authorised"),
        # Authorised online, no proof uploaded: the call is to the Mait.
        (
            Payment.Mode.ONLINE,
            {"member_otp_verified": True},
            "awaiting_proof",
        ),
        # Authorised, cash not confirmed: also the Mait, and a different question.
        (
            Payment.Mode.COD,
            {"member_otp_verified": True},
            "awaiting_cash",
        ),
        # Everything collected and still pending: nobody on the ground can fix this.
        (
            Payment.Mode.ONLINE,
            {
                "member_otp_verified": True,
                "utr_number": "UTR123",
                "payment_screenshot_url": "/x.jpg",
            },
            "ready",
        ),
    ],
)
def test_a_pending_payment_says_which_of_the_four_it_is(
    admin_client, mait, mpp, member, animal, mode, fields, bucket
):
    a_pending_payment(mait, mpp, member, animal, mode=mode, **fields)

    row = rows_of(admin_client.get(url("pending-payments")))[0]
    assert row["bucket"] == bucket
    # And says what to do about it, which is the whole point of splitting them.
    assert len(row["guidance"]) > 30
    assert row["link"]["href"].startswith("ai-event.html?id=")


def test_a_payment_names_the_farmer_and_the_amount(admin_client, mait, mpp, member, animal):
    a_pending_payment(mait, mpp, member, animal, mode=Payment.Mode.COD)

    row = rows_of(admin_client.get(url("pending-payments")))[0]
    assert row["title"] == member.member_name
    assert member.member_code in row["subtitle"]
    assert row["metric"] == "₹300"


def test_payments_can_be_narrowed_to_one_cause(admin_client, mait, mpp, member, animal):
    a_pending_payment(mait, mpp, member, animal, mode=Payment.Mode.COD)
    a_pending_payment(mait, mpp, member, animal, mode=Payment.Mode.COD, member_otp_verified=True)

    response = admin_client.get(url("pending-payments"), {"filter": "awaiting_cash"})
    assert len(rows_of(response)) == 1
    # The tally still describes the whole queue, so a chip can say what it will show.
    assert buckets_of(response)["not_authorised"] == 1


# --------------------------------------------------------------------------------------
# Low stock
# --------------------------------------------------------------------------------------
def test_zero_and_low_are_told_apart(admin_client, mait, settings):
    settings.LOW_STOCK_THRESHOLD = 5
    MaitInventory.objects.create(
        mait=mait, product_type=ProductType.STRAW, product_ref_id=1, qty_available=0
    )

    row = rows_of(admin_client.get(url("low-stock")))[0]
    assert row["bucket"] == "at_zero"
    # A Mait at zero cannot record anything at all, which is a different problem from one who
    # will run out later in the round.
    assert "at all" in row["guidance"]
    assert low_stock_maits().count() == 1


def test_straws_are_summed_across_breeds(admin_client, mait, settings):
    """
    One Mait, one row. Three breeds each under the threshold is one restock, and three rows
    for it is three times the noise.
    """
    settings.LOW_STOCK_THRESHOLD = 10
    for ref in (1, 2, 3):
        MaitInventory.objects.create(
            mait=mait, product_type=ProductType.STRAW, product_ref_id=ref, qty_available=2
        )

    rows = rows_of(admin_client.get(url("low-stock")))
    assert len(rows) == 1
    assert rows[0]["metric"] == "6 left"


# --------------------------------------------------------------------------------------
# Stale indents
# --------------------------------------------------------------------------------------
def an_indent(mait, **fields):
    indent = IndentRequest.objects.create(mait=mait, qty_requested=25, **fields)
    IndentRequest.objects.filter(pk=indent.pk).update(
        requested_at=timezone.now() - timedelta(days=STALE_AFTER_DAYS + 2)
    )
    indent.refresh_from_db()
    return indent


def test_the_card_and_the_dialog_count_the_same_indents(admin_client, mait):
    an_indent(mait, product_type=ProductType.STRAW, breed="MURRAH")
    an_indent(mait, product_type=ProductType.STRAW, breed="GIR")

    assert stale_indents().count() == 2
    assert admin_client.get(url("stale-indents")).data["count"] == 2


@pytest.mark.parametrize(
    ("fields", "bucket"),
    [
        ({"status": IndentRequest.Status.REQUESTED}, "awaiting_approval"),
        ({"status": IndentRequest.Status.APPROVED}, "approved_not_issued"),
        (
            {
                "status": IndentRequest.Status.REQUESTED,
                "sync_status": IndentRequest.SyncStatus.FAILED,
            },
            "never_pushed",
        ),
    ],
)
def test_an_indent_says_where_it_is_stuck(admin_client, mait, fields, bucket):
    """
    Three different desks. Awaiting approval is this office's; approved-not-issued is the
    depot's; a failed push never left this platform and is ours.
    """
    an_indent(mait, product_type=ProductType.STRAW, breed="MURRAH", **fields)

    row = rows_of(admin_client.get(url("stale-indents")))[0]
    assert row["bucket"] == bucket


def test_a_failed_push_carries_the_error_that_caused_it(admin_client, mait):
    """The field that turns "never reached Indent Easy" into something actionable."""
    an_indent(
        mait,
        product_type=ProductType.STRAW,
        breed="MURRAH",
        sync_status=IndentRequest.SyncStatus.FAILED,
        last_sync_error="502 from Indent Easy",
    )

    row = rows_of(admin_client.get(url("stale-indents")))[0]
    facts = {f["label"]: f["value"] for f in row["facts"]}
    assert facts["Last push error"] == "502 from Indent Easy"


def test_a_request_names_what_was_asked_for(admin_client, mait):
    gloves = Consumable.objects.create(code="GLOVES-T", name="Gloves", rate=3)
    an_indent(mait, product_type=ProductType.CONSUMABLE, product_ref_id=gloves.id)

    row = rows_of(admin_client.get(url("stale-indents")))[0]
    assert row["detail"] == "25 × Gloves"


def test_a_request_with_no_product_on_it_says_so(admin_client, mait):
    """
    Rather than reading as an ordinary consumable request.

    "25 × Consumable" tells a depot nothing about what to pack, and collapsing an unnamed
    product into that word hides a request nobody can fulfil behind one that looks fine.
    """
    an_indent(mait, product_type=ProductType.CONSUMABLE, product_ref_id=None)

    row = rows_of(admin_client.get(url("stale-indents")))[0]
    assert row["detail"] == "25 × Product not named"


# --------------------------------------------------------------------------------------
# Overdue and refused checks
# --------------------------------------------------------------------------------------
def a_check(mait, mpp, member, animal, *, due_days_ago, outcome="", checked=None):
    event = AIEvent.objects.create(
        client_uuid=uuid.uuid4(),
        mait=mait,
        mpp=mpp,
        owner_type=AIEvent.OwnerType.MEMBER,
        member=member,
        animal=animal,
        status=AIEvent.Status.PAYMENT_PENDING,
        performed_at=timezone.now(),
    )
    return PregnancyCheck.objects.create(
        ai_event=event,
        mait=mait,
        due_on=timezone.localdate() - timedelta(days=due_days_ago),
        outcome=outcome,
        checked_at=checked,
    )


def test_overdue_checks_are_grouped_by_mait_but_counted_as_checks(
    admin_client, mait, mpp, member, animal
):
    """
    The card counts checks and the dialog rows are Maits — one round is one conversation, not
    nineteen ear tags. The count must still be the card's, or the two disagree on screen.
    """
    for _ in range(3):
        a_check(mait, mpp, member, animal, due_days_ago=10)

    response = admin_client.get(url("overdue-checks"))
    assert overdue_checks().count() == 3
    assert response.data["count"] == 3
    rows = rows_of(response)
    assert len(rows) == 1
    assert rows[0]["title"] == mait.name
    assert rows[0]["metric"] == "3 overdue"


def test_a_round_a_month_adrift_is_drawn_as_worse(admin_client, mait, mpp, member, animal):
    a_check(mait, mpp, member, animal, due_days_ago=45)

    row = rows_of(admin_client.get(url("overdue-checks")))[0]
    assert row["state"]["tone"] == "bad"
    assert row["state"]["label"] == "45 days behind"


def test_refusals_are_grouped_by_village_not_by_mait(admin_client, mait, mpp, member, animal):
    """
    Repeated refusals in one village are a conversation with that collection point. Naming the
    Mait would point it at the wrong person — they cannot fix it on their round.
    """
    for _ in range(3):
        a_check(
            mait,
            mpp,
            member,
            animal,
            due_days_ago=5,
            outcome=PregnancyCheck.Outcome.DECLINED,
            checked=timezone.now(),
        )

    response = admin_client.get(url("declined-checks"))
    assert declined_checks().count() == 3
    rows = rows_of(response)
    assert len(rows) == 1
    assert rows[0]["title"] == mpp.mpp_name
    assert rows[0]["metric"] == "3 refused"
    # Three in one village is the pattern worth acting on; one or two is not.
    assert rows[0]["bucket"] == "repeated"


def test_refusals_outside_the_window_are_not_counted(admin_client, mait, mpp, member, animal):
    a_check(
        mait,
        mpp,
        member,
        animal,
        due_days_ago=200,
        outcome=PregnancyCheck.Outcome.DECLINED,
        checked=timezone.now() - timedelta(days=120),
    )

    assert admin_client.get(url("declined-checks")).data["count"] == 0
    assert admin_client.get(url("declined-checks"), {"days": 365}).data["count"] == 1
