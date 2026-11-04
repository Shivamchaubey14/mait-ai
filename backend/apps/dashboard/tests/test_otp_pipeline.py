"""
The OTP pipeline (W23).

What has to hold: a code is only ever called "arrived" on proof (somebody typed into it), a
resend is never mistaken for a lost SMS, a code passed on the office's code is said so, and an
ask's verdict reads the SMS as it stood when the ask was made — for information, never a rule.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, SuperOTP, User
from apps.payments.models import OTPLog

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/otp-pipeline/"


def client_for(sections):
    user = User.objects.create_user(
        username=f"office{len(sections)}",
        password="pw-for-tests-only",
        full_name="Office",
        role=Role.ADMIN,
        portal_sections=sections,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def office():
    return client_for([PortalSection.OTP_PIPELINE])


def a_code(
    *,
    mobile="9876500001",
    purpose=OTPLog.Purpose.LOGIN,
    minutes_ago=30,
    lifetime=300,
    sent_via="sms",
    attempts=0,
    verified=False,
):
    sent = timezone.now() - timedelta(minutes=minutes_ago)
    row = OTPLog.objects.create(
        purpose=purpose,
        mobile_no=mobile,
        otp_code_hash="x",
        expires_at=sent + timedelta(seconds=lifetime),
        sent_via=sent_via,
        attempt_count=attempts,
        is_verified=verified,
        verified_at=sent + timedelta(minutes=1) if verified else None,
    )
    OTPLog.objects.filter(pk=row.pk).update(created_at=sent)
    row.refresh_from_db()
    return row


def an_ask(*, mobile="9876500001", purpose="login", minutes_ago=10, status="requested"):
    user = User.objects.create_user(
        username=f"mait{SuperOTP.objects.count()}",
        password=None,
        full_name="Sunil Kumar",
        role=Role.MAIT,
        mobile_no=mobile,
    )
    return SuperOTP.objects.create(
        user=user,
        purpose=purpose,
        mobile_no=mobile,
        status=status,
        requested_at=timezone.now() - timedelta(minutes=minutes_ago),
        request_count=1,
    )


def by_id(body):
    return {row["id"]: row for row in body["results"]}


def test_needs_its_own_section():
    assert client_for([PortalSection.SUPER_OTP]).get(URL).status_code == 403


def test_each_code_is_read_back_through_its_stages(office):
    verified = a_code(mobile="9000000001", attempts=1, verified=True)
    never_left = a_code(mobile="9000000002", sent_via="")
    sending = a_code(mobile="9000000003", sent_via="", minutes_ago=0)
    awaiting = a_code(mobile="9000000004", minutes_ago=1)
    wrong = a_code(mobile="9000000005", minutes_ago=1, attempts=1)
    locked = a_code(mobile="9000000006", attempts=3)
    lost = a_code(mobile="9000000007")

    rows = by_id(office.get(URL).json())

    assert rows[verified.id]["stage"] == "verified"
    assert rows[verified.id]["arrived"] == "yes"
    assert [s["state"] for s in rows[verified.id]["steps"]] == ["done", "done", "done", "done"]
    assert rows[never_left.id]["stage"] == "not_sent"
    assert rows[never_left.id]["arrived"] == "no"
    assert rows[never_left.id]["steps"][1]["state"] == "failed"
    assert rows[sending.id]["stage"] == "sending"
    assert rows[awaiting.id]["stage"] == "awaiting"
    assert rows[awaiting.id]["arrived"] == "unknown"
    # Typed into, so it reached the phone — whatever was typed.
    assert rows[wrong.id]["stage"] == "wrong_code"
    assert rows[wrong.id]["arrived"] == "yes"
    assert rows[locked.id]["stage"] == "locked"
    assert rows[lost.id]["stage"] == "likely_lost"
    assert rows[lost.id]["steps"][2]["state"] == "failed"


def test_a_resend_is_not_a_lost_sms(office):
    # Asking again cuts the first code short; it was replaced, not lost.
    first = a_code(minutes_ago=30, lifetime=60)
    a_code(minutes_ago=29)

    rows = by_id(office.get(URL).json())

    assert rows[first.id]["stage"] == "superseded"
    assert rows[first.id]["arrived"] == "unknown"


def test_a_code_passed_on_the_office_code_says_so(office):
    sms = a_code(attempts=0, verified=True)
    ask = an_ask(status="used")
    SuperOTP.objects.filter(pk=ask.pk).update(used_at=sms.verified_at)

    row = by_id(office.get(URL).json())[sms.id]

    assert row["stage"] == "office"
    assert row["steps"][3]["label"] == "Passed on office code"


def test_the_summary_counts_proof_not_acceptance(office):
    a_code(mobile="9000000001", attempts=1, verified=True)
    a_code(mobile="9000000002")  # likely lost
    a_code(mobile="9000000003", sent_via="")  # never left
    a_code(mobile="9000000004", minutes_ago=1)  # still open: neither side of the rate

    body = office.get(URL).json()

    assert body["summary"]["funnel"] == {"made": 4, "accepted": 3, "arrived": 1, "verified": 1}
    # One proven arrival of the three whose fate is known.
    assert body["summary"]["arrival_rate"] == pytest.approx(33.3)
    assert body["summary"]["likely_lost"] == 1
    assert body["summary"]["never_left"] == 1
    assert body["gateway"]["checked"] == 4
    assert body["gateway"]["accepted"] == 3
    assert body["gateway"]["tone"] == "warn"


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        (None, "not_tried"),
        ({"sent_via": "", "minutes_ago": 20}, "justified"),
        ({"minutes_ago": 20}, "justified"),
        ({"minutes_ago": 12, "lifetime": 600}, "early"),
        ({"minutes_ago": 20, "attempts": 3}, "arrived"),
        ({"minutes_ago": 20, "attempts": 1, "verified": True}, "not_needed"),
    ],
)
def test_an_ask_is_judged_on_the_sms_before_it(office, code, expected):
    if code:
        a_code(**code)
    ask = an_ask(minutes_ago=10)

    body = office.get(URL).json()
    row = next(row for row in body["asks"] if row["id"] == ask.id)

    assert row["verdict"]["key"] == expected
    assert row["verdict"]["note"] == "For information. The office can still give them a code."


def test_an_sms_for_another_step_does_not_count(office):
    a_code(purpose=OTPLog.Purpose.FARMER_VERIFY, minutes_ago=20)
    ask = an_ask(minutes_ago=10)

    row = next(row for row in office.get(URL).json()["asks"] if row["id"] == ask.id)

    assert row["verdict"]["key"] == "not_tried"


def test_filters_by_stage_purpose_and_number(office):
    a_code(mobile="9111100001")
    a_code(mobile="9222200002", purpose=OTPLog.Purpose.PAYMENT_COD, attempts=1, verified=True)

    lost = office.get(URL, {"stage": "likely_lost"}).json()
    assert [row["mobile_no"] for row in lost["results"]] == ["9111100001"]
    # The chips still count everything, so each says what clicking it would show.
    assert {s["key"]: s["count"] for s in lost["stages"]}["verified"] == 1

    cash = office.get(URL, {"purpose": "payment_cod"}).json()
    assert [row["step"] for row in cash["results"]] == ["Cash payment"]

    found = office.get(URL, {"search": "22220"}).json()
    assert [row["mobile_no"] for row in found["results"]] == ["9222200002"]


def test_window_is_one_of_the_offered_three(office):
    a_code(minutes_ago=60 * 24 * 3)

    assert office.get(URL, {"days": 1}).json()["count"] == 0
    assert office.get(URL, {"days": 7}).json()["count"] == 1
    assert office.get(URL, {"days": 5}).json()["window_days"] == 7


def test_an_sms_closed_by_the_office_code_is_not_called_used(office):
    # The office code marks the pending SMS verified as it is used; that is not the SMS
    # getting them through, and the ask must not read as though it had.
    sms = a_code(minutes_ago=12, lifetime=600, verified=True)
    # Used five minutes after the ask, as an office code is: somebody had to phone first.
    used = timezone.now() - timedelta(minutes=6)
    OTPLog.objects.filter(pk=sms.pk).update(verified_at=used)
    ask = an_ask(minutes_ago=11, status="used")
    SuperOTP.objects.filter(pk=ask.pk).update(used_at=used)

    row = next(row for row in office.get(URL).json()["asks"] if row["id"] == ask.id)

    assert row["sms"]["verified"] is False
    assert row["sms"]["by_office"] is True
    assert row["through_by_sms_after"] is False
    assert row["verdict"]["key"] == "early"
