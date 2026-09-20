"""
Every insemination in the zone, a page at a time, narrowed by a range of dates.

The dashboard's feed is the last eight completed captures, which is a glance. This is the
list somebody opens when they are looking for one: the farmer who rang about last Tuesday,
the Mait whose week they want to see. So it carries every status, not only completed —
a capture stopped at payment is exactly the kind of row somebody comes looking for — and
each row names the farmer, whether they are on the roll, the collection point and the Mait
with the codes a manager would read back over the phone.

**Never "all of it".** The table behind this grows without bound, so there is always a page:
newest first, `limit` rows at a time, and `count` for the whole range so the screen can say
how many there are before anybody scrolls.

Filtered on `created_at` against local-day instants, never with a `__date` lookup — see
`apps.core.timeframe`, and the AI events filter on the portal, which reads the same column the
same way so the two screens cannot disagree about which events a day holds.
"""

from __future__ import annotations

from datetime import date

from apps.ai_events.models import AIEvent
from apps.core.timeframe import end_of_day, start_of_day

#: One page. A zone does tens of inseminations a day; a month is a few hundred rows.
DEFAULT_LIMIT = 30
MAX_LIMIT = 100


def _parse(value: str | None) -> date | None:
    """A `YYYY-MM-DD` from the wire, or nothing. A malformed date is no filter, not an error."""
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def build(
    codes: list[str] | None,
    *,
    date_from: str | None,
    date_to: str | None,
    limit: int,
    offset: int,
) -> dict:
    events = AIEvent.objects.select_related(
        "mait", "mpp", "animal", "member", "non_member", "semen_batch"
    )
    if codes is not None:
        events = events.filter(mpp__plant_code__in=codes)

    start, end = _parse(date_from), _parse(date_to)
    # A range picked back to front is the same range. Refusing it would be pedantry.
    if start and end and start > end:
        start, end = end, start
    if start:
        events = events.filter(created_at__gte=start_of_day(start))
    if end:
        events = events.filter(created_at__lt=end_of_day(end))

    count = events.count()
    page = events.order_by("-created_at", "-id")[offset : offset + limit]

    rows = []
    for event in page:
        owner = event.owner
        rows.append(
            {
                "id": event.id,
                "status": event.status,
                "status_display": event.get_status_display(),
                "owner_type": event.owner_type,
                "owner_name": getattr(owner, "member_name", None) or getattr(owner, "name", ""),
                "mpp_name": event.mpp.mpp_name or event.mpp.mpp_code,
                "mpp_code": event.mpp.mpp_code,
                "mait_name": event.mait.name,
                "mait_code": event.mait.sahayak_vendor_code or "",
                "breed": (
                    event.semen_batch.breed
                    if event.semen_batch_id
                    else (event.animal.breed if event.animal_id else "")
                ),
                "doses": event.doses,
                "created_at": event.created_at,
                "completed_at": event.completed_at,
            }
        )

    return {
        "count": count,
        "results": rows,
        "date_from": start.isoformat() if start else None,
        "date_to": end.isoformat() if end else None,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(rows) < count,
    }
