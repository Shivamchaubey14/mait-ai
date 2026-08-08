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

from django.utils import timezone


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
