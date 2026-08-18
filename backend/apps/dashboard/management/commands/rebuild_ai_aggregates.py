"""
Rebuild the daily aggregate slices the dashboards read (SRS §6.7).

``aggregate_daily_ai_counts`` runs hourly and deliberately looks back only a couple of days:
it has to be cheap enough to repeat every hour, and its own docstring says that backfilling
further is a management command rather than a scheduled job. This is that command, which
until now did not exist.

Two situations need it. A development or staging database has no Celery worker, so nothing
has ever filled the table and every dashboard reads zero on a database full of events — which
looks exactly like the app not recording anything. And in production, a worker that was down
for longer than the hourly job's lookback leaves a hole no later run will go back for.

Safe to repeat. The task recomputes each slice wholesale with ``update_or_create`` rather than
incrementing counters, so running it twice writes the same numbers.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.ai_events.models import AIEvent
from apps.dashboard.models import DailyAIAggregate
from apps.dashboard.tasks import aggregate_daily_ai_counts


class Command(BaseCommand):
    help = "Rebuild the dashboard's daily AI aggregates for a window, or for all history."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=None,
            help=(
                "How far back to rebuild, in days. Omitted, the window is worked out from the "
                "oldest completed event, so the whole history is covered."
            ),
        )

    def handle(self, *args, **options):
        days = options["days"]

        if days is None:
            # Everything. The window is derived rather than guessed, so a database with two
            # years of events is covered without anyone having to know that.
            oldest = (
                AIEvent.objects.filter(status=AIEvent.Status.COMPLETED)
                .order_by("completed_at")
                .values_list("completed_at", flat=True)
                .first()
            )
            if oldest is None:
                self.stdout.write("No completed AI events — nothing to aggregate.")
                return
            days = (timezone.localdate() - timezone.localtime(oldest).date()).days + 1

        if days < 1:
            raise CommandError("--days must be at least 1.")

        before = DailyAIAggregate.objects.count()
        # Through the task itself, not a copy of its logic. Two implementations of how a day
        # is sliced would drift, and the hourly job is the one that has to stay right.
        written = aggregate_daily_ai_counts(lookback_days=days)
        after = DailyAIAggregate.objects.count()

        self.stdout.write(
            self.style.SUCCESS(
                f"Rebuilt {written} slice(s) over the last {days} day(s). "
                f"Aggregate rows: {before} -> {after}."
            )
        )
