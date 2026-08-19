"""
AI event API tests (SRS §6.3, §9.6, §11).

Two things are being defended here. One is the boundary: a Mait must not be able to open a
capture at someone else's MPP, for someone else's animal, or against a straw they do not
hold. The other is the retry: the offline queue resends blindly, and a resend that creates a
second event would put two inseminations on one animal in the reports and, at completion,
take two straws out of stock for one service.
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
from apps.animals.models import Animal, AnimalType
from apps.inventory.services import available_straw_count
from apps.masterdata.models import MPP, Mait, Member

pytestmark = pytest.mark.django_db

BASE = "/api/v1/ai-events"


def auth(user) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.fixture
def mait_client(mait):
    return auth(mait.user)


@pytest.fixture
def admin_client(db):
    admin = User.objects.create_user(
        username="admin-ai-events",
        password="a-long-enough-password",
        full_name="Admin",
        role=Role.ADMIN,
    )
    return auth(admin)


@pytest.fixture
def payload(mpp, member, animal):
    """A complete, valid capture for the shared Mait — minus the straw."""

    def _make(**overrides):
        body = {
            "client_uuid": str(uuid.uuid4()),
            "mpp_code": mpp.mpp_code,
            "member_code": member.member_code,
            "animal_id": animal.id,
        }
        body.update(overrides)
        return body

    return _make


@pytest.fixture
def other_mait(db):
    """A second Mait with their own MPP, member and animal — the boundary to test against."""
    stranger = Mait.objects.create(sahayak_vendor_code="SAH-OTHER", name="Other")
    other_mpp = MPP.objects.create(mpp_code="MPP-OTHER", mpp_name="Far", mait=stranger)
    other_member = Member.objects.create(
        member_code="MEM-OTHER", member_name="Not Yours", mpp=other_mpp
    )
    other_animal = Animal.objects.create(
        owner_type=Animal.OwnerType.MEMBER,
        member=other_member,
        animal_type=AnimalType.COW,
        breed="GIR",
    )
    return stranger, other_mpp, other_member, other_animal


class TestCreate:
    def test_starts_a_draft_when_no_straw_is_scanned(self, mait_client, payload):
        """A Mait can open the capture before reaching the flask and come back to it."""
        response = mait_client.post(f"{BASE}/", payload(), format="json")

        assert response.status_code == 201, response.json()
        body = response.json()
        assert body["status"] == AIEvent.Status.DRAFT
        assert body["straw_unique_no"] == ""

    def test_records_the_start_on_the_timeline(self, mait_client, payload):
        event_id = mait_client.post(f"{BASE}/", payload(), format="json").json()["id"]

        entries = mait_client.get(f"{BASE}/{event_id}/timeline/").json()
        assert [entry["to_status"] for entry in entries] == [AIEvent.Status.DRAFT]

    def test_a_scanned_straw_advances_to_straw_verified(self, mait_client, payload, stocked_mait):
        straw = stocked_mait(1)[0]

        response = mait_client.post(
            f"{BASE}/", payload(straw_unique_no=straw.unique_straw_no), format="json"
        )

        assert response.status_code == 201, response.json()
        assert response.json()["status"] == AIEvent.Status.STRAW_VERIFIED
        assert response.json()["straw_unique_no"] == straw.unique_straw_no

    def test_verifying_a_straw_deducts_nothing(self, mait_client, payload, stocked_mait, mait):
        """
        Stock moves at completion, never here (SRS §6.4.3).

        A Mait who scans and then walks away from a difficult animal must not lose a straw
        for an insemination that never happened.
        """
        straw = stocked_mait(1)[0]
        mait_client.post(f"{BASE}/", payload(straw_unique_no=straw.unique_straw_no), format="json")

        assert available_straw_count(mait) == 1

    def test_advances_through_both_states_on_the_timeline(self, mait_client, payload, stocked_mait):
        straw = stocked_mait(1)[0]
        event_id = mait_client.post(
            f"{BASE}/", payload(straw_unique_no=straw.unique_straw_no), format="json"
        ).json()["id"]

        entries = mait_client.get(f"{BASE}/{event_id}/timeline/").json()
        assert [entry["to_status"] for entry in entries] == [
            AIEvent.Status.DRAFT,
            AIEvent.Status.STRAW_VERIFIED,
        ]

    def test_rejects_a_straw_the_mait_does_not_hold(self, mait_client, payload):
        response = mait_client.post(
            f"{BASE}/", payload(straw_unique_no="STRAW-NOT-MINE"), format="json"
        )

        assert response.status_code == 409
        assert response.json()["type"].endswith("/insufficient-stock")

    def test_a_failed_scan_leaves_no_half_started_event(self, mait_client, payload):
        """
        Otherwise every mis-scan would litter the Mait's list with drafts they cannot tell
        apart from the ones they meant to keep.
        """
        mait_client.post(f"{BASE}/", payload(straw_unique_no="STRAW-NOT-MINE"), format="json")

        assert not AIEvent.objects.exists()

    def test_rejects_a_straw_already_used(self, mait_client, payload, stocked_mait):
        straw = stocked_mait(1)[0]
        straw.is_consumed = True
        straw.save(update_fields=["is_consumed"])

        response = mait_client.post(
            f"{BASE}/", payload(straw_unique_no=straw.unique_straw_no), format="json"
        )

        # Kept distinct from "not in stock": this one is a data problem to report, not an
        # indent to raise.
        assert response.status_code == 409
        assert response.json()["type"].endswith("/straw-already-consumed")


class TestBoundaries:
    def test_rejects_an_mpp_belonging_to_another_mait(self, mait_client, payload, other_mait):
        _, other_mpp, other_member, other_animal = other_mait

        response = mait_client.post(
            f"{BASE}/",
            payload(
                mpp_code=other_mpp.mpp_code,
                member_code=other_member.member_code,
                animal_id=other_animal.id,
            ),
            format="json",
        )

        assert response.status_code == 400
        assert "mpp_code" in response.json()["errors"]

    def test_rejects_a_member_who_is_not_at_that_mpp(self, mait_client, payload, other_mait):
        *_, other_member, _ = other_mait

        response = mait_client.post(
            f"{BASE}/", payload(member_code=other_member.member_code), format="json"
        )

        assert response.status_code == 400
        assert "member_code" in response.json()["errors"]

    def test_rejects_an_animal_registered_to_someone_else(self, mait_client, payload, member, mpp):
        """
        The animal id comes from a list the app may have cached before the animal changed
        hands, so it is checked against the farmer being served rather than trusted.
        """
        neighbour = Member.objects.create(
            member_code="MEM-NEIGHBOUR", member_name="Neighbour", mpp=mpp
        )
        their_animal = Animal.objects.create(
            owner_type=Animal.OwnerType.MEMBER,
            member=neighbour,
            animal_type=AnimalType.COW,
            breed="GIR",
        )

        response = mait_client.post(f"{BASE}/", payload(animal_id=their_animal.id), format="json")

        assert response.status_code == 400
        assert "animal_id" in response.json()["errors"]

    def test_requires_exactly_one_owner(self, mait_client, payload, member):
        both = payload(non_member_id=1)
        response = mait_client.post(f"{BASE}/", both, format="json")
        assert response.status_code == 400

        neither = payload()
        neither.pop("member_code")
        assert mait_client.post(f"{BASE}/", neither, format="json").status_code == 400

    def test_an_admin_cannot_start_a_capture(self, admin_client, payload):
        """Capture happens in the field, by the Mait standing with the animal."""
        assert admin_client.post(f"{BASE}/", payload(), format="json").status_code == 403

    def test_anonymous_is_rejected(self):
        assert APIClient().get(f"{BASE}/").status_code == 401


class TestRetry:
    def test_the_same_client_uuid_returns_the_first_event(self, mait_client, payload):
        """
        The offline queue cannot tell "never arrived" from "arrived, response lost", so it
        resends. The answer must be the event that already exists (ADR 0003).
        """
        body = payload()
        first = mait_client.post(f"{BASE}/", body, format="json")
        second = mait_client.post(f"{BASE}/", body, format="json")

        assert first.status_code == 201
        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]
        assert AIEvent.objects.count() == 1

    def test_a_retry_does_not_re_verify_the_straw(self, mait_client, payload, stocked_mait):
        """
        A resend that arrives after the straw was consumed must still succeed. Re-running the
        scan would reject it as already used and strand an event that is perfectly valid.
        """
        straw = stocked_mait(1)[0]
        body = payload(straw_unique_no=straw.unique_straw_no)
        first = mait_client.post(f"{BASE}/", body, format="json")

        straw.is_consumed = True
        straw.save(update_fields=["is_consumed"])

        second = mait_client.post(f"{BASE}/", body, format="json")
        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]

    def test_another_maits_client_uuid_is_refused(self, mait_client, payload, other_mait, mpp):
        stranger, other_mpp, other_member, other_animal = other_mait
        stranger_user = User.objects.create_user(
            username="mait-stranger", full_name="Stranger", role=Role.MAIT
        )
        stranger.user = stranger_user
        stranger.save(update_fields=["user"])

        shared_uuid = str(uuid.uuid4())
        auth(stranger_user).post(
            f"{BASE}/",
            {
                "client_uuid": shared_uuid,
                "mpp_code": other_mpp.mpp_code,
                "member_code": other_member.member_code,
                "animal_id": other_animal.id,
            },
            format="json",
        )

        response = mait_client.post(f"{BASE}/", payload(client_uuid=shared_uuid), format="json")

        # A collision here is a client bug, and replaying someone else's event would answer
        # one Mait with another's capture.
        assert response.status_code == 400
        assert "client_uuid" in response.json()["errors"]


class TestReading:
    def test_a_mait_sees_only_their_own_captures(
        self, mait_client, payload, other_mait, mpp, member, animal
    ):
        stranger, other_mpp, other_member, other_animal = other_mait
        mait_client.post(f"{BASE}/", payload(), format="json")
        AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=stranger,
            mpp=other_mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=other_member,
            animal=other_animal,
        )

        results = mait_client.get(f"{BASE}/").json()["results"]
        assert len(results) == 1
        assert results[0]["mpp_code"] == mpp.mpp_code

    def test_an_admin_sees_every_maits_captures(self, mait_client, admin_client, payload):
        mait_client.post(f"{BASE}/", payload(), format="json")
        assert admin_client.get(f"{BASE}/").json()["count"] == 1

    def test_a_mait_cannot_read_another_maits_event(self, mait_client, other_mait):
        stranger, other_mpp, other_member, other_animal = other_mait
        hidden = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=stranger,
            mpp=other_mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=other_member,
            animal=other_animal,
        )

        assert mait_client.get(f"{BASE}/{hidden.id}/").status_code == 404

    def test_filters_by_status(self, mait_client, payload, stocked_mait):
        straw = stocked_mait(1)[0]
        mait_client.post(f"{BASE}/", payload(), format="json")
        mait_client.post(f"{BASE}/", payload(straw_unique_no=straw.unique_straw_no), format="json")

        verified = mait_client.get(f"{BASE}/?status=straw_verified").json()["results"]
        assert [row["status"] for row in verified] == [AIEvent.Status.STRAW_VERIFIED]

    def test_carries_the_names_the_offline_list_renders(self, mait_client, payload, member):
        """A cached row holding only foreign keys would render blank with no signal."""
        event_id = mait_client.post(f"{BASE}/", payload(), format="json").json()["id"]

        body = mait_client.get(f"{BASE}/{event_id}/").json()
        assert body["owner_name"] == member.member_name
        assert body["breed"] == "GIR"


class TestDateWindow:
    """
    The filter that answered zero on a month full of events.

    `created_at__date__gte` compiles to a CONVERT_TZ on an aware column, and on a MySQL whose
    `mysql.time_zone*` tables were never loaded that returns NULL. A NULL comparison matches
    nothing, so every date-filtered request — the app's own month figure, the admin list, the
    CSV export — came back empty and said nothing about why. Nothing tested it, which is how
    it shipped.

    These run against the same MySQL the app does, so a return to `__date` fails here.
    """

    def _event(self, mait, mpp, member, animal, straw, when):
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
            completed_at=when,
        )
        # `auto_now_add` wins over anything passed to create(), so the stamp is set after.
        AIEvent.objects.filter(pk=event.pk).update(created_at=when)
        return event

    def test_todays_events_come_back_for_todays_date(
        self, mait_client, mait, mpp, member, animal, stocked_mait
    ):
        now = timezone.now()
        self._event(mait, mpp, member, animal, stocked_mait(1)[0], now)
        today = timezone.localtime(now).date().isoformat()

        response = mait_client.get(f"{BASE}/?date_from={today}&date_to={today}")

        assert response.status_code == 200
        assert response.json()["count"] == 1

    def test_the_window_includes_its_last_day_to_the_last_second(
        self, mait_client, mait, mpp, member, animal, stocked_mait
    ):
        # Late enough that a half-open window built on the wrong day would drop it, which is
        # the off-by-one this filter is written to avoid.
        now = timezone.localtime(timezone.now())
        late = now.replace(hour=23, minute=59, second=30, microsecond=0)
        self._event(mait, mpp, member, animal, stocked_mait(1)[0], late)
        day = late.date().isoformat()

        assert mait_client.get(f"{BASE}/?date_to={day}").json()["count"] == 1

    def test_an_older_event_is_left_out(self, mait_client, mait, mpp, member, animal, stocked_mait):
        now = timezone.now()
        self._event(mait, mpp, member, animal, stocked_mait(1)[0], now - timedelta(days=40))
        today = timezone.localtime(now).date().isoformat()

        assert mait_client.get(f"{BASE}/?date_from={today}").json()["count"] == 0

    def test_the_month_figure_the_app_asks_for(
        self, mait_client, mait, mpp, member, animal, stocked_mait
    ):
        """Exactly the request Profile makes: this month's completions, counted server-side."""
        now = timezone.localtime(timezone.now())
        straws = stocked_mait(2)
        self._event(mait, mpp, member, animal, straws[0], now)
        self._event(mait, mpp, member, animal, straws[1], now - timedelta(days=40))
        month_start = now.replace(day=1).date().isoformat()

        response = mait_client.get(f"{BASE}/?status=completed&date_from={month_start}")

        assert response.json()["count"] == 1


class TestUnfinished:
    """
    The captures that still need something from the Mait who started them (C13).

    The app used to surface one of them — a straw verified today whose photo never arrived —
    and every other abandoned capture was invisible. For work already done that is the worst
    kind of missing record: the animal was served and a straw was spent, and nothing on the
    handset admitted it.

    Which statuses count is decided here rather than by each screen sending its own list, so
    the app can ask the question without also having to hold the answer.
    """

    @pytest.fixture
    def events(self, mait, mpp, member, animal):
        from django.utils import timezone

        from conftest import SemenBatchFactory

        def make(status):
            # A completed event carries a straw and a completion time — the database refuses
            # one without them (`ai_event_completed_requires_straw`), which is the invariant
            # that stops a service being recorded with nothing taken out of stock.
            done = status == AIEvent.Status.COMPLETED
            return AIEvent.objects.create(
                client_uuid=uuid.uuid4(),
                mait=mait,
                mpp=mpp,
                owner_type=AIEvent.OwnerType.MEMBER,
                member=member,
                animal=animal,
                status=status,
                semen_batch=SemenBatchFactory() if done else None,
                completed_at=timezone.now() if done else None,
            )

        return make

    def test_lists_every_state_that_still_needs_something(self, mait_client, events):
        for status in AIEvent.UNFINISHED_STATUSES:
            events(status)
        events(AIEvent.Status.COMPLETED)
        events(AIEvent.Status.CANCELLED)

        response = mait_client.get(f"{BASE}/", {"unfinished": "true"})

        assert response.status_code == 200, response.json()
        returned = {row["status"] for row in response.json()["results"]}
        assert returned == set(AIEvent.UNFINISHED_STATUSES)

    def test_a_completed_capture_needs_nothing(self, mait_client, events):
        """Terminal by definition — it is done, and a cancelled one is over."""
        events(AIEvent.Status.COMPLETED)
        events(AIEvent.Status.CANCELLED)

        response = mait_client.get(f"{BASE}/", {"unfinished": "true"})

        assert response.json()["count"] == 0

    def test_the_inverse_returns_only_the_finished_ones(self, mait_client, events):
        events(AIEvent.Status.STRAW_VERIFIED)
        events(AIEvent.Status.COMPLETED)

        response = mait_client.get(f"{BASE}/", {"unfinished": "false"})

        assert [row["status"] for row in response.json()["results"]] == ["completed"]

    def test_a_row_carries_the_member_code_the_app_names_her_by(self, mait_client, events, member):
        """
        Without it a capture picked back up holds a row id no other screen speaks, and the
        resume cannot re-fetch the farmer it belongs to.
        """
        events(AIEvent.Status.PHOTO_CAPTURED)

        row = mait_client.get(f"{BASE}/", {"unfinished": "true"}).json()["results"][0]

        assert row["member_code"] == member.member_code

    def test_another_maits_unfinished_work_is_not_listed(self, mait_client, other_mait, events):
        """SRS §16 — the list is a Mait's own, like every other read in the app."""
        events(AIEvent.Status.STRAW_VERIFIED)
        stranger, other_mpp, other_member, other_animal = other_mait
        AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=stranger,
            mpp=other_mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=other_member,
            animal=other_animal,
            status=AIEvent.Status.STRAW_VERIFIED,
        )

        response = mait_client.get(f"{BASE}/", {"unfinished": "true"})

        assert response.json()["count"] == 1
