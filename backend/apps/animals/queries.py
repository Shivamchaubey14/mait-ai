"""Reusable annotations for reading animals."""

from __future__ import annotations

from django.db.models import Count, Max, Prefetch, Q, QuerySet
from django.db.models.functions import Coalesce

from .models import Animal


def with_ai_history(queryset: QuerySet[Animal]) -> QuerySet[Animal]:
    """
    Attach how many times this animal has been served, and when it last was.

    Step 4 of the capture flow shows both on the row, because the question a Mait is actually
    answering is not "which of these animals exists" but "which one am I standing in front
    of". An untagged cow is told apart from the untagged cow beside her by when she was last
    served, and by nothing else the app holds.

    ``performed_at`` rather than ``created_at``: it is stamped at photo capture, so an event
    that sat in the offline queue for two days still reports the day the insemination happened.
    Cancelled events are counted too — the straw went into the animal whatever the record
    later became, and a Mait reading "last AI 3 days ago" is asking about the animal, not
    about the paperwork.
    """
    from apps.ai_events.models import AIEvent

    struck_out = Q(ai_events__status=AIEvent.Status.CANCELLED)
    return queryset.annotate(
        # Distinct: the pregnancy checks below join in too, and would count an event once per
        # check otherwise.
        ai_event_count=Count("ai_events", distinct=True),
        last_ai_at=Max("ai_events__performed_at"),
        # The three `ai_events.rules` decides from — whether she may be served again today.
        # Her last AI that the office has not struck out, dated by when it was done or, before
        # its photo, by when it was started.
        last_served_at=Max(
            Coalesce("ai_events__performed_at", "ai_events__created_at"), filter=~struck_out
        ),
        open_ai_count=Count(
            "ai_events",
            filter=Q(ai_events__status__in=AIEvent.UNFINISHED_STATUSES),
            distinct=True,
        ),
        pregnant_until=Max(
            "ai_events__pregnancy_checks__calving_due_on",
            filter=Q(ai_events__pregnancy_checks__outcome="pregnant") & ~struck_out,
        ),
    )


def animals_with_history() -> Prefetch:
    """The same annotations, for the farmer-detail responses that nest their animals."""
    return Prefetch("animals", queryset=with_ai_history(Animal.objects.all()))
