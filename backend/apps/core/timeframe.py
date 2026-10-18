"""
Local-day arithmetic for datetime columns.

Django compiles ``__date`` and ``TruncDate`` on an aware ``DateTimeField`` into
``CONVERT_TZ(col, 'UTC', 'Asia/Kolkata')``. On MySQL that needs the ``mysql.time_zone*``
tables to have been loaded with ``mysql_tzinfo_to_sql``; on an installation where they were
not, CONVERT_TZ returns NULL — and a NULL comparison is neither true nor false, it simply
matches nothing. The query then answers zero on a day full of events, and nothing in the
answer says the filter was the problem rather than the data.

So no query in this codebase asks the database what local day a timestamp falls on. Filters
compare against instants, which needs no conversion and can use an index on the column;
grouping by day is done in Python, where the timezone is settled and the row count is bounded
by the window rather than by the table.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.db.models import DateTimeField
from django.db.models.functions import Coalesce
from django.utils import timezone


def event_day_expr(completed: str = "completed_at", created: str = "created_at") -> Coalesce:
    """
    The instant an AI event is dated to: its completion for a finished capture, and the moment
    it was started while it is still unfinished and has no completion instant yet.

    This is the same day the dashboard counts a completed event on (`apps.dashboard.views`
    filters `completed_at`), so a list or an export filtered by a date describes the same
    events the dashboard figure for that date does. Dating by `created_at` alone drifted by
    one whenever a capture was started before midnight and finished after it — the screen then
    showed six for a day the dashboard counted seven.

    An expression, not a `__date` lookup: it is compared against the instants
    `start_of_day`/`end_of_day` return, so it never compiles to the CONVERT_TZ this module
    exists to avoid, and an index on `completed_at` can still serve the common case.
    """
    return Coalesce(completed, created, output_field=DateTimeField())


def start_of_day(day: date) -> datetime:
    """The instant a local day begins, as an aware datetime."""
    return timezone.make_aware(datetime.combine(day, time.min))


def end_of_day(day: date) -> datetime:
    """
    The instant after a local day ends.

    Half-open on purpose: ``__lt end_of_day(d)`` includes every microsecond of ``d`` without
    the off-by-one that ``__lte`` on a truncated day invites.
    """
    return start_of_day(day + timedelta(days=1))


def local_day(moment: datetime) -> date:
    """Which local day an instant falls on — the answer `__date` was being asked for."""
    return timezone.localtime(moment).date()
