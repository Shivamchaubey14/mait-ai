"""
CSV export filtering (SRS §9.9).

A report is defined by the filters that produced it. The export shares its search predicate
with the list rather than reimplementing one, because an export quietly dropping a filter
hands back a file disagreeing with the screen it was taken from — and nothing on either the
screen or the file would say so.
"""

from __future__ import annotations

import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.ai_events.models import AIEvent

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-reports",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


@pytest.fixture
def two_events(db, mait, mpp, member, animal, stocked_mait):
    def _event(straw_no):
        straw = stocked_mait(1)[0]
        return AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=straw_no,
            # Not completed: a completed event needs a verified payment behind it, and what
            # is under test here is the filtering, not the state machine.
            status=AIEvent.Status.STRAW_VERIFIED,
        )

    return _event("FINDME-001"), _event("OTHER-002")


def body_of(response) -> str:
    return b"".join(response.streaming_content).decode()


def test_the_export_honours_the_search(admin_client, two_events):
    response = admin_client.get("/api/v1/reports/export/", {"search": "FINDME"})

    text = body_of(response)
    assert "FINDME-001" in text
    assert "OTHER-002" not in text


def test_the_export_searches_the_farmer_too(admin_client, two_events, member):
    response = admin_client.get("/api/v1/reports/export/", {"search": member.member_name})

    # The same three things the list searches: a straw number off a complaint, a farmer's
    # name off a phone call, a Mait's name off a roster.
    assert "FINDME-001" in body_of(response)


def test_no_search_exports_everything(admin_client, two_events):
    text = body_of(admin_client.get("/api/v1/reports/export/"))

    assert "FINDME-001" in text
    assert "OTHER-002" in text


def test_the_export_carries_the_member_code(admin_client, two_events, member):
    """
    A name identifies a farmer to a person; a code identifies her to the dairy.

    The file gets reconciled against milk payments and looked up in SAP, and neither of those
    keys on "AKANKSHA" — of whom there are several. So the code travels beside the name rather
    than instead of it.
    """
    text = body_of(admin_client.get("/api/v1/reports/export/"))

    header = text.splitlines()[0].split(",")
    assert "member_code" in header
    # Beside the name, so a reader scanning the sheet finds them together.
    assert header.index("member_code") == header.index("farmer_name") + 1

    column = header.index("member_code")
    assert all(
        line.split(",")[column] == member.member_code for line in text.splitlines()[1:] if line
    )


def test_a_non_member_has_no_code_to_give(admin_client, mait, mpp, animal, stocked_mait, db):
    # Empty rather than absent, and honest: a non-member has no membership number, and
    # `farmer_type` on the same row already says so.
    from apps.masterdata.models import NonMember

    farmer = NonMember.objects.create(
        mpp=mpp,
        name="Not A Member",
        mobile_no="9000000001",
        aadhar_no="111122223333",
        created_by_mait=mait,
    )
    AIEvent.objects.create(
        client_uuid=uuid.uuid4(),
        mait=mait,
        mpp=mpp,
        owner_type=AIEvent.OwnerType.NON_MEMBER,
        non_member=farmer,
        animal=animal,
        semen_batch=stocked_mait(1)[0],
        straw_unique_no="NONMEMBER-001",
        status=AIEvent.Status.STRAW_VERIFIED,
    )

    text = body_of(admin_client.get("/api/v1/reports/export/"))
    header = text.splitlines()[0].split(",")
    row = next(line for line in text.splitlines()[1:] if "NONMEMBER-001" in line).split(",")

    assert row[header.index("member_code")] == ""
    assert row[header.index("farmer_type")] == "non_member"
