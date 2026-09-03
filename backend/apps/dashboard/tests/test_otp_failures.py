"""
Who is stuck at an OTP, and why (W16 detail).

Two properties carry this screen, and both are the kind that fail silently.

**The queue is one definition.** The Exceptions card counts it and this endpoint lists it, and
if the two ever write their own filter, a card saying three sits above a screen showing eleven
and nobody can tell which is lying.

**The four outcomes must be told apart correctly.** They are not cosmetic labels: one sends an
admin to ring a person, one sends them to the SMS gateway, and one is not a failure at all.
Asking for a second code expires the first, so an ordinary resend leaves behind a row that
looks exactly like a message that never arrived — on the development database that is half of
them, and getting it wrong would send somebody to debug a gateway that is working.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.dashboard.otp_failures import failed_otp_queue
from apps.payments.models import OTPLog

pytestmark = pytest.mark.django_db

BASE = "/api/v1"
URL = f"{BASE}/admin/otp-failures/"


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


def an_otp(
    *,
    mobile="9876500001",
    purpose=OTPLog.Purpose.LOGIN,
    attempts=1,
    sent_minutes_ago=30,
    lifetime_seconds=300,
    verified=False,
):
    """One OTP, placed in the past. `created_at` is auto, so it is moved afterwards."""
    sent = timezone.now() - timedelta(minutes=sent_minutes_ago)
    entry = OTPLog.objects.create(
        purpose=purpose,
        mobile_no=mobile,
        otp_code_hash="x" * 64,
        attempt_count=attempts,
        is_verified=verified,
        expires_at=sent + timedelta(seconds=lifetime_seconds),
        sent_via="sms",
    )
    OTPLog.objects.filter(pk=entry.pk).update(created_at=sent)
    entry.refresh_from_db()
    return entry


def outcomes(response):
    return {row["id"]: row["outcome"] for row in response.data["results"]}


# --------------------------------------------------------------------------------------
# One definition of the queue
# --------------------------------------------------------------------------------------
def test_the_card_and_the_screen_count_the_same_rows(admin_client):
    """
    Both go through `failed_otp_queue`. The assertion is deliberately about the *shared*
    function rather than about two numbers that happen to agree today.
    """
    an_otp(mobile="9876500001", attempts=2)
    an_otp(mobile="9876500002", attempts=1)
    an_otp(mobile="9876500003", attempts=0)  # nobody typed into it — outside the card
    an_otp(mobile="9876500004", attempts=3, verified=True)  # got through, not a failure

    assert failed_otp_queue().count() == 2
    assert admin_client.get(URL).data["count"] == 2


def test_a_verified_code_is_not_a_failure(admin_client):
    an_otp(attempts=2, verified=True)
    assert admin_client.get(URL).data["count"] == 0


def test_the_default_window_survives_a_weekend(admin_client):
    """
    A week, not a day.

    Somebody stuck at six on Friday evening is still stuck on Monday morning, and a one-day
    window had thrown their row away overnight — an office arriving to a card reading zero,
    over a database holding fourteen failures, reasonably concluded the screen was broken.
    """
    an_otp(mobile="9876500001", sent_minutes_ago=30)
    an_otp(mobile="9876500002", sent_minutes_ago=60 * 24 * 3)

    assert admin_client.get(URL).data["window_days"] == 7
    assert admin_client.get(URL).data["count"] == 2


def test_the_window_still_ends(admin_client):
    """A queue that never empties is one people stop reading."""
    an_otp(mobile="9876500003", sent_minutes_ago=60 * 24 * 20)

    assert admin_client.get(URL).data["count"] == 0
    assert admin_client.get(URL, {"days": 30}).data["count"] == 1


def test_a_nonsense_window_answers_for_something_sensible(admin_client):
    """Capped rather than refused, so a stray parameter never empties the screen."""
    assert admin_client.get(URL, {"days": 9000}).data["window_days"] == 30
    assert admin_client.get(URL, {"days": "yesterday"}).data["window_days"] == 7


# --------------------------------------------------------------------------------------
# Telling the four apart
# --------------------------------------------------------------------------------------
def test_attempts_used_up_beats_expiry(admin_client):
    """
    A code that ran out of attempts and *then* expired is an exhausted one. Telling the person
    their code expired sends them off to re-request instead of explaining why the last three
    were refused.
    """
    entry = an_otp(attempts=3, sent_minutes_ago=60)
    assert outcomes(admin_client.get(URL))[entry.id] == "attempts_exhausted"


def test_a_code_nobody_typed_into_is_never_entered(admin_client):
    """The outcome that means the SMS probably did not arrive."""
    entry = an_otp(attempts=0, sent_minutes_ago=60)

    response = admin_client.get(URL, {"include_unattempted": "true"})
    assert outcomes(response)[entry.id] == "never_attempted"
    # The advice points at the gateway, not at the person. That is the whole distinction.
    guidance = {row["id"]: row["guidance"] for row in response.data["results"]}
    assert "gateway" in guidance[entry.id]


def test_a_replaced_code_is_not_reported_as_undelivered(admin_client):
    """
    The one this screen exists to get right.

    Asking for a second code expires the first, so an ordinary resend leaves a row that has
    expired with nothing typed into it — identical on the columns to a message that never
    arrived. Reported as `never_attempted`, it would send an admin to debug a working gateway.
    """
    # Sent, then replaced a minute later: cut short well inside its five minutes.
    replaced = an_otp(attempts=0, sent_minutes_ago=60, lifetime_seconds=60)
    successor = an_otp(attempts=0, sent_minutes_ago=59)

    found = outcomes(admin_client.get(URL, {"include_unattempted": "true"}))
    assert found[replaced.id] == "superseded"
    # The one that replaced it ran its full five minutes and nobody typed into that either.
    assert found[successor.id] == "never_attempted"


def test_a_short_code_with_no_successor_is_not_called_replaced(admin_client):
    """
    Both conditions, not either. Cut short alone would mislabel anything that ever shortens an
    expiry for another reason.
    """
    entry = an_otp(attempts=0, sent_minutes_ago=60, lifetime_seconds=30, mobile="9876500009")
    assert outcomes(admin_client.get(URL, {"include_unattempted": "true"}))[entry.id] == (
        "never_attempted"
    )


def test_a_wrong_entry_before_a_resend_stays_a_real_failure(admin_client):
    """
    Replaced only counts where nothing was typed. Somebody who entered a wrong code and then
    asked for another one did fail, and hiding that would hide the person having trouble.
    """
    entry = an_otp(attempts=1, sent_minutes_ago=60, lifetime_seconds=60)
    an_otp(attempts=0, sent_minutes_ago=59)

    assert outcomes(admin_client.get(URL))[entry.id] == "expired"


def test_a_live_code_is_open_rather_than_failed(admin_client):
    entry = an_otp(attempts=1, sent_minutes_ago=1)
    assert outcomes(admin_client.get(URL))[entry.id] == "open"


def test_the_tally_counts_the_queue_not_the_page(admin_client):
    for n in range(4):
        an_otp(mobile=f"987650100{n}", attempts=3, sent_minutes_ago=60)
    an_otp(mobile="9876502000", attempts=1, sent_minutes_ago=1)

    data = admin_client.get(URL, {"limit": 2}).data
    assert len(data["results"]) == 2
    assert data["by_outcome"]["attempts_exhausted"] == 4
    assert data["by_outcome"]["open"] == 1
    # People, not codes: the number somebody acts on.
    assert data["people"] == 5


def test_outcome_filters(admin_client):
    an_otp(mobile="9876500001", attempts=3, sent_minutes_ago=60)
    an_otp(mobile="9876500002", attempts=1, sent_minutes_ago=1)

    exhausted = admin_client.get(URL, {"outcome": "attempts_exhausted"}).data
    assert [row["mobile_no"] for row in exhausted["results"]] == ["9876500001"]


# --------------------------------------------------------------------------------------
# Who it belongs to
# --------------------------------------------------------------------------------------
def test_a_login_code_names_the_mait_behind_the_number(admin_client, mait):
    entry = an_otp(mobile=mait.mobile_no, purpose=OTPLog.Purpose.LOGIN, attempts=3)

    row = next(r for r in admin_client.get(URL).data["results"] if r["id"] == entry.id)
    assert row["who"]["kind"] == "mait"
    assert row["who"]["name"] == mait.name
    assert mait.sahayak_vendor_code in row["who"]["detail"]


def test_a_number_on_no_roster_says_so_rather_than_coming_back_blank(admin_client):
    entry = an_otp(mobile="9000099999", attempts=3)

    row = next(r for r in admin_client.get(URL).data["results"] if r["id"] == entry.id)
    assert row["who"]["kind"] == "unknown"
    assert row["who"]["name"] == "Not on any roster"


def test_a_payment_code_names_the_farmer_and_what_it_is_holding_up(
    admin_client, ai_event_ready_to_complete
):
    """
    Resolved through the payment rather than by matching the number, because that is a foreign
    key and therefore an answer — two people share a phone often enough that the number cannot
    say which of them was standing there.
    """
    event, _straw = ai_event_ready_to_complete()
    entry = an_otp(purpose=OTPLog.Purpose.PAYMENT_COD, attempts=3)
    OTPLog.objects.filter(pk=entry.pk).update(payment=event.payment)

    row = next(r for r in admin_client.get(URL).data["results"] if r["id"] == entry.id)
    assert row["who"]["name"] == event.member.member_name
    assert row["blocking"]["ai_event_id"] == event.id
    assert row["blocking"]["amount"] == "250.00"


def test_the_number_comes_back_in_full(admin_client, mait):
    """
    Unmasked, as on every other admin endpoint. This screen exists to be acted on, and acting
    on it means ringing the number — the card's masked prefix is what made it useless.
    """
    an_otp(mobile=mait.mobile_no, attempts=3)
    assert admin_client.get(URL).data["results"][0]["mobile_no"] == mait.mobile_no


# --------------------------------------------------------------------------------------
# Access
# --------------------------------------------------------------------------------------
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

    assert client.get(URL).status_code == 403
