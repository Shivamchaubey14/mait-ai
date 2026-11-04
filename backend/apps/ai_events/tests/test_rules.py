"""
One semen per animal, then 21 days, and never while she is pregnant (`ai_events.rules`).

The dairy's rule: *एक पशु को सिर्फ एक सीमेन डालें। अगला सीमेन 21 दिन बाद पड़ सकता है, अगर पशु
ने गर्भ धारण न किया हो।* What matters: a second straw in one visit is refused; a second AI on the
same animal is refused while one is open, and inside 21 days of the last, and while a check has
found her pregnant — each saying when she can be served; and the phone is told all of it with
every animal, so it can say so before a straw is drawn.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.ai_events.models import AIEvent
from apps.ai_events.rules import REPEAT_AFTER_DAYS
from apps.pregnancy.models import PregnancyCheck
from conftest import AnimalFactory, SemenBatchFactory

pytestmark = pytest.mark.django_db

BASE = "/api/v1/ai-events"


@pytest.fixture
def mait_client(mait):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.accounts.models import Role

    mait.user.role = Role.MAIT
    mait.user.save(update_fields=["role"])
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")
    return client


def open_ai(client, mpp, member, animal, **extra):
    return client.post(
        f"{BASE}/",
        {
            "client_uuid": str(uuid.uuid4()),
            "mpp_code": mpp.mpp_code,
            "member_code": member.member_code,
            "animal_id": animal.id,
            **extra,
        },
        format="json",
    )


def served(mait, mpp, member, animal, *, days_ago, status=AIEvent.Status.COMPLETED):
    """An AI already on her record, done `days_ago` days back."""
    at = timezone.now() - timedelta(days=days_ago)
    straw = SemenBatchFactory()
    return AIEvent.objects.create(
        semen_batch=straw,
        straw_unique_no=straw.unique_straw_no,
        client_uuid=uuid.uuid4(),
        mait=mait,
        mpp=mpp,
        owner_type=AIEvent.OwnerType.MEMBER,
        member=member,
        animal=animal,
        status=status,
        performed_at=at,
        completed_at=at if status == AIEvent.Status.COMPLETED else None,
    )


def refusal_of(response) -> str:
    assert response.status_code == 400, response.content
    return response.json()["errors"]["animal_id"][0]


class TestOneSemen:
    def test_a_second_straw_in_one_visit_is_refused_with_the_rule(
        self, mait_client, mpp, member, animal
    ):
        response = open_ai(mait_client, mpp, member, animal, doses=2)
        assert response.status_code == 400
        assert "Only one semen per animal" in response.json()["errors"]["doses"][0]


class TestTwentyOneDays:
    def test_a_second_ai_inside_21_days_is_refused_saying_when(
        self, mait_client, mait, mpp, member, animal
    ):
        served(mait, mpp, member, animal, days_ago=5)
        message = refusal_of(open_ai(mait_client, mpp, member, animal))

        assert "Only one semen per animal" in message
        again = timezone.localdate() - timedelta(days=5) + timedelta(days=REPEAT_AFTER_DAYS)
        assert f"{again:%d %b %Y}" in message

    def test_after_21_days_she_may_be_served_again(self, mait_client, mait, mpp, member, animal):
        served(mait, mpp, member, animal, days_ago=REPEAT_AFTER_DAYS)
        assert open_ai(mait_client, mpp, member, animal).status_code == 201

    def test_an_ai_the_office_cancelled_does_not_count(
        self, mait_client, mait, mpp, member, animal
    ):
        served(mait, mpp, member, animal, days_ago=2, status=AIEvent.Status.CANCELLED)
        assert open_ai(mait_client, mpp, member, animal).status_code == 201

    def test_an_ai_still_open_on_her_must_be_finished_first(self, mait_client, mpp, member, animal):
        assert open_ai(mait_client, mpp, member, animal).status_code == 201
        assert "already open" in refusal_of(open_ai(mait_client, mpp, member, animal))

    def test_a_retry_of_the_same_ai_is_not_refused(self, mait_client, mpp, member, animal):
        # The offline queue sends the same capture again; it is a replay, not a second AI.
        body = {
            "client_uuid": str(uuid.uuid4()),
            "mpp_code": mpp.mpp_code,
            "member_code": member.member_code,
            "animal_id": animal.id,
        }
        assert mait_client.post(f"{BASE}/", body, format="json").status_code == 201
        assert mait_client.post(f"{BASE}/", body, format="json").status_code == 200

    def test_another_animal_of_hers_is_not_held_back(self, mait_client, mait, mpp, member, animal):
        served(mait, mpp, member, animal, days_ago=1)
        assert open_ai(mait_client, mpp, member, AnimalFactory(member=member)).status_code == 201


class TestPregnant:
    def test_no_ai_until_she_calves(self, mait_client, mait, mpp, member, animal):
        last = served(mait, mpp, member, animal, days_ago=60)
        calving = timezone.localdate() + timedelta(days=220)
        PregnancyCheck.objects.create(
            ai_event=last,
            mait=mait,
            due_on=timezone.localdate() - timedelta(days=30),
            outcome=PregnancyCheck.Outcome.PREGNANT,
            checked_at=timezone.now() - timedelta(days=30),
            calving_due_on=calving,
        )

        message = refusal_of(open_ai(mait_client, mpp, member, animal))
        assert "pregnant" in message
        assert f"{calving:%d %b %Y}" in message

    def test_a_check_that_found_her_empty_does_not_hold_her_back(
        self, mait_client, mait, mpp, member, animal
    ):
        last = served(mait, mpp, member, animal, days_ago=60)
        PregnancyCheck.objects.create(
            ai_event=last,
            mait=mait,
            due_on=timezone.localdate() - timedelta(days=30),
            outcome=PregnancyCheck.Outcome.NOT_PREGNANT,
            checked_at=timezone.now() - timedelta(days=30),
        )
        assert open_ai(mait_client, mpp, member, animal).status_code == 201


class TestThePhoneIsTold:
    def test_every_animal_says_when_she_can_next_be_served(
        self, mait_client, mait, mpp, member, animal
    ):
        served(mait, mpp, member, animal, days_ago=5)
        free = AnimalFactory(member=member)

        body = mait_client.get(f"/api/v1/members/{member.member_code}/").json()
        rows = {row["id"]: row for row in body["animals"]}

        assert rows[animal.id]["next_ai_block"] == "too_soon"
        again = timezone.localdate() - timedelta(days=5) + timedelta(days=REPEAT_AFTER_DAYS)
        assert rows[animal.id]["next_ai_on"] == again.isoformat()
        assert rows[free.id]["next_ai_block"] == ""
        assert rows[free.id]["next_ai_on"] is None

    def test_and_the_offline_pack_carries_it(self, mait_client, mait, mpp, member, animal):
        served(mait, mpp, member, animal, days_ago=5)
        body = mait_client.get(f"/api/v1/mait/offline-pack/{mpp.mpp_code}/").json()
        animals = body["members"][0]["animals"]
        assert animals[0]["next_ai_block"] == "too_soon"
