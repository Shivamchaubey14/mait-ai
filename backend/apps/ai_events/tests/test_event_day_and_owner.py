"""
Two fixes the AI events screen needed (SRS §6.7, §9.6).

1. **The day an event belongs to.** The dashboard counts a completed event on its
   ``completed_at`` day; the list filtered by ``created_at`` alone, so a capture started before
   midnight and finished after it was counted by the dashboard on one day and shown by the list
   on the day before — the screen read six for a day the dashboard called seven. The list now
   dates an event the same way the dashboard does (``event_day_expr``).

2. **The farmer behind the event.** A non-member has no SAP record to look up, so the detail
   endpoint carries the details she registered with — her number, her Aadhaar (masked) — and
   the animal's ear tag, which were showing as missing because nothing exposed them.
"""

from __future__ import annotations

import uuid
from datetime import datetime, time, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.ai_events.models import AIEvent
from apps.masterdata.models import NonMember

pytestmark = pytest.mark.django_db

BASE = "/api/v1/ai-events"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-event-day",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


def _completed(mait, mpp, member, animal, straw, *, created, completed):
    """A completed event whose draft was created on one instant and finished on another."""
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
        completed_at=completed,
    )
    # auto_now_add wins over anything passed to create(), so created_at is set after.
    AIEvent.objects.filter(pk=event.pk).update(created_at=created)
    return event


class TestEventDay:
    def test_a_capture_is_dated_to_the_day_it_finished(
        self, admin_client, mait, mpp, member, animal, stocked_mait
    ):
        """
        Started at 23:50 on one day, finished at 00:05 the next. The dashboard counts it on the
        day it finished, so the list filtered to that day must return it — and the day before,
        when its draft row was created, must not.
        """
        now = timezone.localtime(timezone.now())
        finished_day = now.date()
        started = timezone.make_aware(
            datetime.combine(finished_day - timedelta(days=1), time(23, 50))
        )
        completed = timezone.make_aware(datetime.combine(finished_day, time(0, 5)))
        _completed(
            mait, mpp, member, animal, stocked_mait(1)[0], created=started, completed=completed
        )

        on_finish = admin_client.get(
            f"{BASE}/?date_from={finished_day}&date_to={finished_day}"
        ).json()
        day_before = (finished_day - timedelta(days=1)).isoformat()
        on_start = admin_client.get(f"{BASE}/?date_from={day_before}&date_to={day_before}").json()

        assert on_finish["count"] == 1
        assert on_start["count"] == 0

    def test_an_unfinished_capture_is_dated_to_when_it_started(
        self, admin_client, mait, mpp, member, animal
    ):
        """No completion instant yet, so it is dated by when it was started — all there is."""
        now = timezone.localtime(timezone.now())
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            status=AIEvent.Status.DRAFT,
        )
        AIEvent.objects.filter(pk=event.pk).update(created_at=now)
        today = now.date().isoformat()

        assert admin_client.get(f"{BASE}/?date_from={today}&date_to={today}").json()["count"] == 1


class TestStatusSummary:
    def test_the_list_carries_the_status_split(
        self, admin_client, mait, mpp, member, animal, stocked_mait
    ):
        """
        The breakdown is what reconciles this screen with the dashboard: the dashboard counts
        the completed, and the unfinished are the rest. Two completed and one still open → the
        list total is three, of which the dashboard would count two.
        """
        straws = stocked_mait(2)
        for straw in straws:
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
                completed_at=timezone.now(),
            )
        AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            status=AIEvent.Status.PHOTO_CAPTURED,
        )

        body = admin_client.get(f"{BASE}/").json()

        assert body["count"] == 3
        assert body["summary"] == {"completed": 2, "unfinished": 1, "cancelled": 0}


class TestOwnerDetail:
    def test_a_non_member_carries_her_details(
        self, admin_client, mait, mpp, animal, stocked_mait
    ):
        farmer = NonMember.objects.create(
            mpp=mpp,
            name="Not A Member",
            mobile_no="9000000001",
            aadhar_no="111122223333",
            address="Barsana",
            created_by_mait=mait,
        )
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.NON_MEMBER,
            non_member=farmer,
            animal=animal,
            semen_batch=stocked_mait(1)[0],
            straw_unique_no="NM-1",
            status=AIEvent.Status.STRAW_VERIFIED,
        )

        detail = admin_client.get(f"{BASE}/{event.id}/").json()
        owner = detail["owner_detail"]

        assert owner["type"] == "non_member"
        assert owner["name"] == "Not A Member"
        assert owner["mobile_no"] == "9000000001"
        assert owner["has_aadhar"] is True
        # Masked, never the full number — the full one lives behind the logged per-record read.
        assert "1111" not in owner["aadhar_masked"]
        assert "3333" in owner["aadhar_masked"]

    def test_the_ear_tag_is_on_the_event(
        self, admin_client, mait, mpp, member, animal, stocked_mait
    ):
        animal.ear_tag_no = "TAG-42"
        animal.save(update_fields=["ear_tag_no"])
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=stocked_mait(1)[0],
            straw_unique_no="TAGGED-1",
            status=AIEvent.Status.STRAW_VERIFIED,
        )

        assert admin_client.get(f"{BASE}/{event.id}/").json()["ear_tag_no"] == "TAG-42"


class TestExportEarTag:
    def test_the_export_carries_the_ear_tag(
        self, admin_client, mait, mpp, member, animal, stocked_mait
    ):
        animal.ear_tag_no = "TAG-99"
        animal.save(update_fields=["ear_tag_no"])
        AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=stocked_mait(1)[0],
            straw_unique_no="EXP-1",
            status=AIEvent.Status.STRAW_VERIFIED,
        )

        response = admin_client.get("/api/v1/reports/export/")
        text = b"".join(response.streaming_content).decode()
        header = text.splitlines()[0].split(",")
        row = next(line for line in text.splitlines()[1:] if "EXP-1" in line).split(",")

        assert "ear_tag" in header
        assert row[header.index("ear_tag")] == "TAG-99"
