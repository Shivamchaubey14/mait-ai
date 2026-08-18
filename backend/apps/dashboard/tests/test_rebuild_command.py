"""
Backfilling the dashboard aggregates (SRS §6.7).

The hourly job looks back a couple of days on purpose — it has to be cheap enough to repeat
every hour — and its docstring has always said that going further back is a management
command's job. There was no such command, so two situations had no answer at all: a
development or staging database with no Celery worker, where nothing has ever filled the
table and every dashboard reads zero on a database full of events; and a production worker
that was down longer than the hourly lookback, leaving a hole no later run goes back for.

What is under test is the window, because that is the part that decides whether old events are
reached. Events are written straight to `completed`, as the sibling tests do — reaching it
legitimately needs a verified payment, and what matters here is the counting.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.ai_events.models import AIEvent
from apps.dashboard.models import DailyAIAggregate

pytestmark = pytest.mark.django_db


@pytest.fixture
def completed(mait, mpp, member, animal):
    """One completed insemination, on a day of the caller's choosing."""

    def make(days_ago: int):
        from conftest import SemenBatchFactory

        when = timezone.now() - timedelta(days=days_ago)
        return AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            status=AIEvent.Status.COMPLETED,
            semen_batch=SemenBatchFactory(),
            completed_at=when,
        )

    return make


def run(*args) -> str:
    out = StringIO()
    call_command("rebuild_ai_aggregates", *args, stdout=out)
    return out.getvalue()


def test_reaches_events_older_than_the_hourly_job_ever_would(completed):
    """
    The whole reason the command exists.

    `aggregate_daily_ai_counts` defaults to two days. An event from a fortnight ago is
    invisible to it however many times it runs.
    """
    completed(days_ago=14)

    run()

    assert DailyAIAggregate.objects.count() == 1
    assert DailyAIAggregate.objects.get().ai_count == 1


def test_the_window_is_worked_out_from_the_oldest_event(completed):
    """Nobody has to know how far back to go, which is how a day gets missed."""
    completed(days_ago=40)
    completed(days_ago=1)

    output = run()

    assert DailyAIAggregate.objects.count() == 2
    assert "41 day(s)" in output


def test_days_bounds_the_work_when_it_is_given(completed):
    completed(days_ago=20)
    completed(days_ago=1)

    run("--days", "3")

    # Only the recent one is inside the window; the older event is left for a wider run.
    assert DailyAIAggregate.objects.count() == 1


def test_running_it_twice_writes_the_same_numbers(completed):
    """
    Safe to repeat, because an operator who is unsure will run it again.

    The task recomputes each slice wholesale with `update_or_create` rather than incrementing
    counters, so a second pass must not double anything.
    """
    completed(days_ago=3)

    run()
    run()

    assert DailyAIAggregate.objects.count() == 1
    assert DailyAIAggregate.objects.get().ai_count == 1


def test_an_empty_database_says_so_rather_than_failing(db):
    output = run()

    assert "nothing to aggregate" in output.lower()
    assert DailyAIAggregate.objects.count() == 0


def test_a_meaningless_window_is_refused(completed):
    completed(days_ago=1)

    with pytest.raises(CommandError):
        run("--days", "0")
