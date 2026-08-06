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

import pytest
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
