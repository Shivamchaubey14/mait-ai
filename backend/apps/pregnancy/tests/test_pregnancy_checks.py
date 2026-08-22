"""
Pregnancy diagnosis.

Ninety days after an insemination somebody has to find out whether it took, and until that
happens the platform knows what it sold rather than what it achieved. The rules under test are
the ones that decide what happens to an animal, and every one of them has a cost attached:

  - a check has to *exist*, booked when the event completes, or nobody ever goes;
  - overdue must never fall off the list, or an animal is quietly dropped from the round and
    the conception rate is computed over the visits that happened to be convenient;
  - a calving date counts from the insemination, not from the visit, or a Mait who is a week
    late tells a farmer the wrong month;
  - "not pregnant" needs a photograph, because it is the outcome that costs somebody money;
  - and a result already recorded is not written twice, however many times a handset with no
    signal retries it.

Events are completed through `complete_ai_event`, so the booking is exercised where it
actually happens rather than by creating checks by hand.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.ai_events.models import AIEvent
from apps.animals.models import AnimalType
from apps.core.timeframe import local_day
from apps.pregnancy.models import (
    ALERT_WINDOW_DAYS,
    DAYS_TO_CHECK,
    GESTATION_DAYS,
    RECHECK_AFTER_DAYS,
    PregnancyCheck,
)
from apps.pregnancy.services import (
    CheckAlreadyRecorded,
    PhotoRequired,
    record_check,
    schedule_check,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def mait_client(db, mait):
    """Signed in as the Mait the checks belong to."""
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")
    return client


@pytest.fixture
def served(db, mait, mpp, member, animal, stocked_mait):
    """A completed insemination, performed whenever the case needs."""

    def _make(days_ago: int = 0, animal_type: str = AnimalType.COW):
        animal.animal_type = animal_type
        animal.save(update_fields=["animal_type"])
        when = timezone.now() - timedelta(days=days_ago)
        straw = stocked_mait(1)[0]
        return AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=f"PD-{uuid.uuid4().hex[:6]}",
            status=AIEvent.Status.COMPLETED,
            performed_at=when,
            completed_at=when,
        )

    return _make


# --- booking ---------------------------------------------------------------------------


def test_a_completed_insemination_books_a_check(served):
    event = served()

    check = schedule_check(event)

    assert check is not None
    assert check.due_on == local_day(event.performed_at) + timedelta(days=DAYS_TO_CHECK)
    assert check.mait_id == event.mait_id
    assert not check.is_recorded


def test_booking_twice_does_not_book_twice(served):
    # Completion is retryable from the offline queue, so this runs more than once for one
    # event. Two checks would mean two visits booked for one animal.
    event = served()

    first = schedule_check(event)
    second = schedule_check(event)

    assert first.id == second.id
    assert event.pregnancy_checks.count() == 1


def test_a_check_is_booked_where_completion_actually_happens(ai_event_ready_to_complete):
    # Through the real service rather than by calling `schedule_check` directly: a booking
    # that only happens when a test asks for it is a booking that never happens in the field.
    from apps.ai_events.services import complete_ai_event

    event, _straw = ai_event_ready_to_complete()
    event = complete_ai_event(event)

    assert event.pregnancy_checks.count() == 1


# --- the list a Mait works from -------------------------------------------------------


def test_the_list_holds_what_is_due_this_week(mait_client, served):
    schedule_check(served(days_ago=DAYS_TO_CHECK - 3))  # due in 3 days
    schedule_check(served(days_ago=DAYS_TO_CHECK - 40))  # due in 40 days

    body = mait_client.get("/api/v1/pregnancy-checks/").json()

    assert body["count"] == 1
    assert body["due_this_week"] == 1


def test_overdue_never_falls_off_the_list(mait_client, served):
    # The one that matters. A check nobody did does not stop mattering, and an animal quietly
    # dropped from the round is a conception rate computed over the convenient visits.
    schedule_check(served(days_ago=DAYS_TO_CHECK + 30))

    body = mait_client.get("/api/v1/pregnancy-checks/").json()

    assert body["count"] == 1
    assert body["overdue"] == 1
    assert body["results"][0]["days_until"] == -30


def test_a_check_far_out_is_not_in_the_week(mait_client, served):
    schedule_check(served(days_ago=0))

    body = mait_client.get("/api/v1/pregnancy-checks/").json()

    assert body["count"] == 0
    assert body["due_this_week"] == 0


def test_the_row_carries_what_it_takes_to_find_the_yard(mait_client, served, member, mpp):
    schedule_check(served(days_ago=DAYS_TO_CHECK))

    row = mait_client.get("/api/v1/pregnancy-checks/").json()["results"][0]

    assert row["owner_name"] == member.member_name
    assert row["mpp_name"] == mpp.mpp_name
    assert row["days_until"] == 0
    assert row["days_since_ai"] == DAYS_TO_CHECK


def test_another_maits_checks_are_not_mine(mait_client, served, django_user_model):
    from apps.masterdata.models import Mait

    other_user = django_user_model.objects.create_user(
        username="other-mait", password="a-long-enough-password", full_name="Other", role="mait"
    )
    other = Mait.objects.create(name="OTHER", sahayak_vendor_code="5500009999", user=other_user)
    check = schedule_check(served(days_ago=DAYS_TO_CHECK))
    check.mait = other
    check.save(update_fields=["mait"])

    assert mait_client.get("/api/v1/pregnancy-checks/").json()["count"] == 0


# --- recording ------------------------------------------------------------------------


def test_pregnant_sets_a_calving_date_counted_from_the_insemination(served):
    # Counted from the service, not from the visit. A Mait who is a fortnight late must not
    # move a farmer's calving month a fortnight with them.
    event = served(days_ago=DAYS_TO_CHECK + 14)
    check = schedule_check(event)

    record_check(check, outcome=PregnancyCheck.Outcome.PREGNANT)

    expected = local_day(event.performed_at) + timedelta(days=GESTATION_DAYS[AnimalType.COW])
    assert check.calving_due_on == expected


def test_a_buffalo_carries_longer_than_a_cow(served):
    cow = schedule_check(served(days_ago=DAYS_TO_CHECK, animal_type=AnimalType.COW))
    record_check(cow, outcome=PregnancyCheck.Outcome.PREGNANT)
    cow_days = (cow.calving_due_on - local_day(cow.ai_event.performed_at)).days

    assert cow_days == GESTATION_DAYS[AnimalType.COW]
    assert GESTATION_DAYS[AnimalType.BUFFALO] > GESTATION_DAYS[AnimalType.COW]


def test_not_sure_books_another_visit(served):
    check = schedule_check(served(days_ago=DAYS_TO_CHECK))

    record_check(check, outcome=PregnancyCheck.Outcome.UNSURE)

    recheck = PregnancyCheck.objects.filter(rechecks=check).get()
    assert recheck.due_on == local_day(check.checked_at) + timedelta(days=RECHECK_AFTER_DAYS)
    assert not recheck.is_recorded
    assert recheck.ai_event_id == check.ai_event_id


def test_not_pregnant_needs_a_photograph(served):
    # The outcome that costs somebody money and the one a farmer disputes. A photo is cheap;
    # an argument six months later with nothing on the record is not.
    check = schedule_check(served(days_ago=DAYS_TO_CHECK))

    with pytest.raises(PhotoRequired):
        record_check(check, outcome=PregnancyCheck.Outcome.NOT_PREGNANT)

    check.refresh_from_db()
    assert not check.is_recorded


def test_a_photo_is_optional_for_the_other_two(served):
    pregnant = schedule_check(served(days_ago=DAYS_TO_CHECK))
    record_check(pregnant, outcome=PregnancyCheck.Outcome.PREGNANT)

    unsure = schedule_check(served(days_ago=DAYS_TO_CHECK))
    record_check(unsure, outcome=PregnancyCheck.Outcome.UNSURE)

    assert pregnant.is_recorded and unsure.is_recorded


def test_a_result_is_not_rewritten(served):
    check = schedule_check(served(days_ago=DAYS_TO_CHECK))
    record_check(check, outcome=PregnancyCheck.Outcome.PREGNANT)

    with pytest.raises(CheckAlreadyRecorded):
        record_check(check, outcome=PregnancyCheck.Outcome.NOT_PREGNANT, photo_url="/x.jpg")


def test_no_calving_date_on_anything_but_pregnant(served):
    check = schedule_check(served(days_ago=DAYS_TO_CHECK))

    record_check(check, outcome=PregnancyCheck.Outcome.UNSURE)

    assert check.calving_due_on is None


# --- recording over HTTP --------------------------------------------------------------


def test_the_handset_records_a_result(mait_client, served):
    check = schedule_check(served(days_ago=DAYS_TO_CHECK))

    response = mait_client.post(
        f"/api/v1/pregnancy-checks/{check.id}/record/",
        {"outcome": "pregnant", "client_uuid": str(uuid.uuid4())},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["outcome"] == "pregnant"
    assert response.json()["calving_due_on"]


def test_a_replayed_result_is_written_once(mait_client, served):
    # A check is done in a yard with no signal as often as not, so this request arrives twice.
    # The second must not book a second recheck or overwrite the first answer.
    check = schedule_check(served(days_ago=DAYS_TO_CHECK))
    key = str(uuid.uuid4())
    payload = {"outcome": "unsure", "client_uuid": key}

    first = mait_client.post(f"/api/v1/pregnancy-checks/{check.id}/record/", payload, format="json")
    second = mait_client.post(
        f"/api/v1/pregnancy-checks/{check.id}/record/", payload, format="json"
    )

    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert PregnancyCheck.objects.filter(rechecks=check).count() == 1


def test_the_server_refuses_not_pregnant_without_a_photo(mait_client, served):
    check = schedule_check(served(days_ago=DAYS_TO_CHECK))

    response = mait_client.post(
        f"/api/v1/pregnancy-checks/{check.id}/record/",
        {"outcome": "not_pregnant"},
        format="json",
    )

    assert response.status_code == 400


def test_done_lists_what_has_been_found(mait_client, served):
    check = schedule_check(served(days_ago=DAYS_TO_CHECK))
    record_check(check, outcome=PregnancyCheck.Outcome.PREGNANT)

    body = mait_client.get("/api/v1/pregnancy-checks/?window=done").json()

    assert body["count"] == 1
    assert body["results"][0]["outcome"] == "pregnant"


def test_the_alert_window_is_a_week(mait_client, served):
    # Named so the number is a decision rather than an accident of a test fixture.
    schedule_check(served(days_ago=DAYS_TO_CHECK - ALERT_WINDOW_DAYS))

    assert mait_client.get("/api/v1/pregnancy-checks/").json()["count"] == 1
