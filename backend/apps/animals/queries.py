"""Reusable annotations for reading animals."""

from __future__ import annotations

from django.db.models import Count, Max, Prefetch, QuerySet

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
    return queryset.annotate(
        ai_event_count=Count("ai_events"),
        last_ai_at=Max("ai_events__performed_at"),
    )


def animals_with_history() -> Prefetch:
    """The same annotations, for the farmer-detail responses that nest their animals."""
    return Prefetch("animals", queryset=with_ai_history(Animal.objects.all()))
