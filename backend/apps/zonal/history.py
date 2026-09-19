"""
Every decision this manager has taken, with the request behind it.

The audit trail is the source, and it has to be: approval is stamped on the indent
(`IndentRequest.approved_by`) but a **rejection is not** — `indents.services.reject_indent`
keeps the reason on the row and the actor only in the log. Counting the two from different
places is how a screen comes to show "9 approved, 2 rejected" beside a list of eleven that
holds ten.

So the rows come from `AuditLog` and the indents are joined back on for display. What that
buys is a history a manager actually recognises: not *"State change indent 20"* but *25
Murrah for Sunil Kumar, approved on Tuesday, and here is where it got to since*.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from apps.core.models import AuditLog
from apps.core.timeframe import start_of_day
from apps.indents.models import IndentRequest
from apps.stores.serializers import ItemNames
from apps.stores.services import item_of

#: The window the app opens on, and the ones it offers.
DEFAULT_DAYS = 30
MAX_DAYS = 365

#: One page. A manager's own decisions over a month are tens of rows, not thousands, but the
#: table behind this grows without bound and nothing here may ever answer "all of it".
DEFAULT_LIMIT = 50
MAX_LIMIT = 200

#: What an indent's current status means to somebody reading back their own decision. The
#: point of the column: *approved three weeks ago and still sitting at the depot* is the row
#: they are looking for.
WHERE_IT_GOT_TO = {
    IndentRequest.Status.REQUESTED: ("Back with the office", "waiting"),
    IndentRequest.Status.APPROVED: ("Waiting at the depot", "waiting"),
    IndentRequest.Status.ISSUED: ("Handed over", "good"),
    IndentRequest.Status.REJECTED: ("Rejected", "bad"),
}


def _decisions(user, since):
    """This manager's indent state changes, newest first."""
    return (
        AuditLog.objects.filter(
            actor=user, action=AuditLog.Action.STATE_CHANGE, entity_type="indent"
        )
        .filter(created_at__gte=since)
        .order_by("-created_at", "-id")
    )


def build(user, *, days: int, outcome: str, limit: int, offset: int) -> dict:
    """
    The history screen's whole answer.

    ``outcome`` is ``all``, ``approved`` or ``rejected`` — the filter the screen wears as a
    switch. The summary counts the window rather than the page, so the two figures at the top
    do not change as somebody scrolls.
    """
    since = start_of_day(timezone.localdate() - timedelta(days=days - 1))
    rows = list(
        _decisions(user, since).values("id", "entity_id", "meta_json", "created_at", "request_id")
    )

    decided = []
    counts = {"approved": 0, "rejected": 0}
    for row in rows:
        to = (row["meta_json"] or {}).get("to")
        if to not in counts:
            # A state change this manager did not make as a decision — issuing from the
            # portal, say. Not this screen's subject.
            continue
        counts[to] += 1
        if outcome in counts and to != outcome:
            continue
        decided.append((row, to))

    page = decided[offset : offset + limit]

    # The indents behind the page, in one query, and the catalogue in one more. A history of
    # fifty decisions must not be fifty round trips.
    indents = IndentRequest.objects.select_related("mait", "store").in_bulk(
        [int(row["entity_id"]) for row, _ in page if str(row["entity_id"]).isdigit()]
    )
    names = ItemNames()

    results = []
    for row, to in page:
        indent = indents.get(int(row["entity_id"])) if str(row["entity_id"]).isdigit() else None
        meta = row["meta_json"] or {}
        item = item_of(indent) if indent else None
        status, tone = (
            WHERE_IT_GOT_TO.get(indent.status, ("", "plain")) if indent else ("Gone", "plain")
        )
        results.append(
            {
                "id": row["id"],
                "when": row["created_at"],
                "outcome": to,
                "indent_id": int(row["entity_id"]) if str(row["entity_id"]).isdigit() else None,
                "mait_name": indent.mait.name if indent else "",
                "mait_code": (indent.mait.sahayak_vendor_code or "") if indent else "",
                "item_name": names.name(*item) if item else "",
                "item_name_hi": names.name_hi(item[0], item[1]) if item else "",
                "qty": indent.qty_requested if indent else meta.get("qty_requested", 0),
                # What the request was for, so the row can wear the item's glyph, and how much
                # of it has been handed over — the difference between "at the depot" and "done".
                "product_type": item[0] if item else "",
                "unit": names.unit(item[0], item[2]) if item else "",
                "qty_issued": indent.qty_issued if indent else 0,
                # Where the request has got to *since* the decision — the reason a manager
                # opens their own history rather than trusting they remember.
                "status": indent.status if indent else "",
                "status_label": status,
                "status_tone": tone,
                "store_name": (indent.store.name if indent and indent.store_id else ""),
                # The words they gave the Mait, read back. Only on a rejection, where it is
                # the whole of what the Mait was told.
                "reason": meta.get("reason", "") if to == "rejected" else "",
            }
        )

    return {
        "summary": {
            "days": days,
            "approved": counts["approved"],
            "rejected": counts["rejected"],
            "total": counts["approved"] + counts["rejected"],
            "last_signed_in": user.last_login_at,
        },
        "outcome": outcome,
        "count": len(decided),
        "results": results,
    }
