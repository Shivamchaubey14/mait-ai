"""
When an animal may be inseminated again — one straw, then 21 days, and never while pregnant.

The dairy's rule, as the Mait is told it: *एक पशु को सिर्फ एक सीमेन डालें। अगला सीमेन 21 दिन
बाद पड़ सकता है, अगर पशु ने गर्भ धारण न किया हो।* One semen per animal; the next can go in
21 days later, if she has not conceived.

So an animal is not ready for an AI when:

- **an AI on her is still open** (``open``) — started and not finished or cancelled. A second
  one would be a second straw on the same heat; the first is finished from Unfinished, or
  cancelled, before another is started;
- **her last AI was under 21 days ago** (``too_soon``) — her next heat comes round at about 21
  days, and a straw before it is a straw wasted;
- **a pregnancy check found her pregnant** and she has not calved yet (``pregnant``) — there is
  nothing to inseminate.

Worked out from three figures the animal list already annotates (``animals.queries``), so the
same answer reaches the capture flow, the offline pack the phone keeps, and the server's own
check on every AI it is asked to open. A cancelled AI does not count: it is a record the office
struck out, not a straw that went in.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from django.utils import timezone

#: Days between two inseminations of one animal: about one heat cycle.
REPEAT_AFTER_DAYS = 21


@dataclass(frozen=True)
class NextService:
    """Whether she may be served today, why not, and from which day."""

    #: '' when she may; else ``open``, ``too_soon`` or ``pregnant``.
    block: str = ""
    #: The first day she may be served, where that is known: 21 days after her last AI, or her
    #: calving date. None when nothing holds her back, or an open AI does.
    from_day: date | None = None
    last_served_on: date | None = None


def next_service(
    *,
    last_served_at,
    open_count: int,
    pregnant_until: date | None,
    today: date | None = None,
) -> NextService:
    """The answer, from the annotations on an animal row."""
    today = today or timezone.localdate()
    last_on = timezone.localtime(last_served_at).date() if last_served_at else None
    if open_count:
        return NextService(block="open", last_served_on=last_on)
    if pregnant_until and pregnant_until > today:
        return NextService(block="pregnant", from_day=pregnant_until, last_served_on=last_on)
    if last_on:
        again = last_on + timedelta(days=REPEAT_AFTER_DAYS)
        if again > today:
            return NextService(block="too_soon", from_day=again, last_served_on=last_on)
    return NextService(last_served_on=last_on)


def next_service_for(animal) -> NextService:
    """The same, for one animal read fresh — what the server checks before opening an AI."""
    from apps.animals.models import Animal
    from apps.animals.queries import with_ai_history

    row = with_ai_history(Animal.objects.filter(pk=animal.pk)).first()
    return next_service(
        last_served_at=row.last_served_at,
        open_count=row.open_ai_count,
        pregnant_until=row.pregnant_until,
    )


def refusal(service: NextService) -> str:
    """What the Mait is told when the server refuses the AI — the dairy's own rule, in words."""
    rule = (
        "Only one semen per animal. The next can be given 21 days after the last AI, if she "
        "has not conceived."
    )
    if service.block == "open":
        return (
            "An AI on this animal is already open. Finish it from Unfinished, or cancel it, "
            "before starting another. " + rule
        )
    if service.block == "pregnant":
        return (
            "A pregnancy check found this animal pregnant. No AI until she calves "
            f"(due {service.from_day:%d %b %Y})."
        )
    return (
        f"{rule} Her last AI was on {service.last_served_on:%d %b %Y}; the next can be given "
        f"from {service.from_day:%d %b %Y}."
    )
