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
