"""
The audit trail, read (W19).

Every consequential action in this platform has been written to `AuditLog` since the first
commit — 36 call sites, and nothing but a Django admin page to read them through. SRS §7 asks
for auditability and §16 for a record of who read personal data; both were satisfied by a
table nobody outside a shell could look at, which satisfies an auditor and nobody else.

**A raw row is not readable and this is where that gets fixed.**
`state_change ai_event#64 {"to": "completed", "straw": "T0001-HF-0002", ...}` is a fact in a
shape only somebody who wrote the emitting code can parse. `describe` turns each row into a
sentence — *"Completed AI event 64"* — and hands the metadata over separately as labelled
facts. That is the whole difference between a log table and a log people use.

**The `pii_access` rows are what this exists for.** Everything else here is convenience; a
record of who opened a farmer's Aadhaar card, and who took a workbook full of bank account
numbers out of the building, is the obligation. So that action is never folded into a generic
"read" and the screen counts it on its own.

**Read-only, and not by accident.** There is no create, update or delete path anywhere near
this — an audit trail that can be edited is not one. The model has said so since it was
written; this endpoint keeps the promise on the way out.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from django.db.models import Count, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.models import PortalSection
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin, in_section
from apps.core.timeframe import end_of_day, start_of_day

#: One page, and the ceiling on one. The trail grows without bound by design, so nothing here
#: may ever answer "all of it".
DEFAULT_LIMIT = 50
MAX_LIMIT = 200

#: How far back the summary tiles count. A working signal rather than a lifetime total, which
#: on an append-only table would only ever grow.
SUMMARY_DAYS = 30


# --------------------------------------------------------------------------------------
# How each action reads
# --------------------------------------------------------------------------------------
#: `(label, tone)` per action. The tone is the portal's pill vocabulary.
#:
#: `pii_access` is the only red one, and it is red whether or not anything went wrong: it
#: marks somebody reading a farmer's identity document or taking bank details out of the
#: building, which is the row an auditor scrolls looking for. Everything else is ordinary
#: work — a Mait completing a capture is not an alarm — so it is drawn as ordinary work.
ACTIONS = {
    AuditLog.Action.CREATE: ("Created", "good"),
    AuditLog.Action.UPDATE: ("Updated", "info"),
    AuditLog.Action.DELETE: ("Deleted", "bad"),
    AuditLog.Action.LOGIN: ("Signed in", None),
    AuditLog.Action.LOGOUT: ("Signed out", None),
    AuditLog.Action.STATE_CHANGE: ("State change", "info"),
    AuditLog.Action.PII_ACCESS: ("Personal data read", "bad"),
    AuditLog.Action.UPLOAD: ("Upload", "warn"),
}

#: What each `entity_type` is called in the words the portal uses elsewhere. The raw values
#: are table names, and a screen that prints `data_upload_log` is asking its reader to know
#: the schema.
ENTITIES = {
    "ai_event": "AI event",
    "animal": "Animal",
    "data_upload_log": "SAP upload",
    "indent": "Indent",
    "mait": "Mait",
    "mait_payout_scheme": "Mait payout scheme",
    "master_snapshot": "Master snapshot",
    "member": "Member",
    "mpp": "MPP",
    "non_member": "Non-member",
    "payment": "Payment",
    "pregnancy_check": "Pregnancy check",
    "pregnancy_rate": "Pregnancy rate",
    "report": "Report",
    "semen_batch": "Straw",
    "user": "Account",
}

#: Metadata keys whose raw names read badly beside a value.
FIELD_LABELS = {
    "ai_event_id": "AI event",
    "aadhaar_card_viewed": "Aadhaar card opened",
    "amount_charged": "Amount charged",
    "calving_due_on": "Calving due",
    "carries": "Carries",
    "due_on": "Due on",
    "farmer_verified": "Farmer verified",
    "file_name": "File",
    "mpp_code": "MPP",
    "mpp_id": "MPP",
    "mait_id": "Mait",
    "net_payable": "Net payable",
    "recheck_id": "Recheck",
    "stock_deducted": "Stock deducted",
    "upload_type": "Upload type",
    "user_id": "Account",
}

#: Keys that carry a status the row is *about*, in the order they should be looked for. A
#: state change says where it went, and that belongs in the sentence rather than in the facts.
STATE_KEYS = ("to", "status", "outcome", "mode")


def entity_label(entity_type: str) -> str:
    return ENTITIES.get(entity_type, entity_type.replace("_", " ").capitalize())


def entity_phrase(entity_type: str) -> str:
    """
    The label as it reads mid-sentence.

    Lowercased, except where the first word is an acronym — "Completed ai event 64" is what
    a naive `.lower()` produces, and this platform is full of them: AI, MPP, SAP. Two capitals
    at the front is the test, which is crude and correct for every label here.
    """
    label = entity_label(entity_type)
    if len(label) > 1 and label[0].isupper() and label[1].isupper():
        return label
    return label[0].lower() + label[1:] if label else label


def field_label(key: str) -> str:
    return FIELD_LABELS.get(key, key.replace("_", " ").capitalize())


def _readable(value):
    """One metadata value, in the shapes a person reads rather than the ones JSON stores."""
    if value is None or value == "":
        return ""
    if value is True:
        return "Yes"
    if value is False:
        return "No"
    if isinstance(value, list | tuple):
        return ", ".join(str(item) for item in value)
    if isinstance(value, dict):
        # A nested object in a log row is almost always a before/after pair, which `changes`
        # renders properly. Anything else is summarised rather than dumped.
        return ", ".join(f"{field_label(k)} {v}" for k, v in list(value.items())[:4])
    return str(value)


def describe(entry: AuditLog) -> str:
    """
    One line saying what happened, in the words somebody would use out loud.

    Built from the action, the entity and whichever metadata key carries the outcome — so
    `state_change` on an `ai_event` with `to: completed` reads "Completed AI event 64" rather
    than making the reader assemble that from three columns and a JSON blob.
    """
    thing = entity_phrase(entry.entity_type)
    meta = entry.meta_json or {}
    state = next((meta[key] for key in STATE_KEYS if meta.get(key)), None)

    if entry.action == AuditLog.Action.LOGIN:
        method = meta.get("method")
        return f"Signed in{f' by {method}' if method else ''}"
    if entry.action == AuditLog.Action.LOGOUT:
        return "Signed out"
    if entry.action == AuditLog.Action.UPLOAD:
        name = meta.get("file_name")
        return f"Uploaded {name}" if name else f"Uploaded {thing}"
    if entry.action == AuditLog.Action.PII_ACCESS:
        # Named as plainly as possible. This is the line an auditor reads.
        if meta.get("aadhaar_card_viewed"):
            return f"Opened the Aadhaar card on {thing} {entry.entity_id}"
        if entry.entity_type == "report":
            return f"Exported {entry.entity_id.replace('_', ' ')}"
        return f"Read personal data on {thing} {entry.entity_id}"
    if entry.action == AuditLog.Action.STATE_CHANGE and state:
        return f"{str(state).replace('_', ' ').capitalize()} {thing} {entry.entity_id}"

    verb = ACTIONS.get(entry.action, ("Changed", None))[0]
    return f"{verb} {thing} {entry.entity_id}"


def _changes(meta: dict) -> list[dict]:
    """
    A real before/after diff, where the call site recorded one.

    Only some do — the payout scheme editor is the clearest — and the rest carry loose
    key/value context. Both are worth showing and they are not the same thing, so they are
    returned separately rather than flattened into one list a reader has to interpret.
    """
    before, after = meta.get("before"), meta.get("after")
    if not isinstance(before, dict) or not isinstance(after, dict):
        return []
    return [
        {
            "field": field_label(key),
            "from": _readable(before.get(key)),
            "to": _readable(after.get(key)),
        }
        for key in after
        if before.get(key) != after.get(key)
    ]


#: Bytes, in the units somebody reads. A file size is the one number in this metadata that
#: arrives in a unit nobody thinks in.
def _bytes(value) -> str:
    try:
        size = float(value)
    except (TypeError, ValueError):
        return str(value)
    for unit in ("bytes", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:,.0f} {unit}" if unit == "bytes" else f"{size:,.1f} {unit}"
        size /= 1024
    return str(value)


def _facts(meta: dict, spoken: set[str]) -> list[dict]:
    """
    Everything else in the metadata, labelled.

    `spoken` is the keys the sentence already used. A detail panel that repeats the line above
    it — "Completed AI event 64" with "To: completed" underneath — is a panel people stop
    opening, so those are dropped rather than shown twice. Empty values go too: a log row is
    read for what happened, and a column of "Not recorded" is noise here in a way it is not on
    a record somebody has to complete.
    """
    facts = []
    for key, value in (meta or {}).items():
        if key in ("before", "after") or key in spoken:
            continue
        text = _bytes(value) if key == "size" else _readable(value)
        if text == "":
            continue
        facts.append({"label": field_label(key), "value": text})
    return facts


def spoken_keys(entry: AuditLog) -> set[str]:
    """Which metadata keys `describe` has already put into words."""
    meta = entry.meta_json or {}
    if entry.action == AuditLog.Action.LOGIN:
        return {"method"}
    if entry.action == AuditLog.Action.UPLOAD:
        return {"file_name"} if meta.get("file_name") else set()
    if entry.action == AuditLog.Action.PII_ACCESS and meta.get("aadhaar_card_viewed"):
        return {"aadhaar_card_viewed"}
    if entry.action == AuditLog.Action.STATE_CHANGE:
        used = next((key for key in STATE_KEYS if meta.get(key)), None)
        return {used} if used else set()
    return set()


def _actor(entry: AuditLog) -> dict:
    """
    Who did it, or the fact that nobody did.

    A null actor is a scheduled job — the hourly aggregate rebuild, a webhook — and saying
    "System" is more honest than leaving the cell blank, which reads as data that went missing.
    """
    if entry.actor is None:
        return {"name": "System", "username": "", "role": "", "initials": "SY", "system": True}
    name = entry.actor.full_name or entry.actor.username
    parts = [word for word in name.split() if word]
    initials = "".join(word[0] for word in parts[:2]).upper() or name[:2].upper()
    return {
        "name": name,
        "username": entry.actor.username,
        "role": entry.actor.get_role_display(),
        "initials": initials,
        "system": False,
    }


def serialise(entry: AuditLog) -> dict:
    label, tone = ACTIONS.get(entry.action, (entry.action, None))
    meta = entry.meta_json or {}
    return {
        "id": entry.id,
        "when": entry.created_at.isoformat(),
        "action": entry.action,
        "action_label": label,
        "tone": tone,
        "entity_type": entry.entity_type,
        "entity_label": entity_label(entry.entity_type),
        "entity_id": entry.entity_id,
        "summary": describe(entry),
        "actor": _actor(entry),
        "changes": _changes(meta),
        "facts": _facts(meta, spoken_keys(entry)),
        "ip_address": entry.ip_address or "",
        # The thread that ties one action's rows together. Two entries sharing it happened in
        # the same request, which is how a state change and the payment behind it are shown to
        # be one act rather than two.
        "request_id": entry.request_id or "",
    }


def _parse_day(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _filtered(params, *, skip: str = ""):
    """
    The trail, narrowed. Every filter is optional and none of them is trusted to be sane.

    ``skip`` leaves one dimension out, which is what the facet counts need. A facet built from
    the fully filtered set collapses the moment its own filter is applied — pick "Signed in"
    and the only chip left is "Signed in", with no way back to the others. Each facet is
    therefore counted against everything *except* itself, which is what makes its number an
    answer to "what would I get if I clicked this" rather than "what am I looking at".
    """
    queryset = AuditLog.objects.select_related("actor").order_by("-created_at", "-id")

    action = params.get("action")
    if action and skip != "action":
        queryset = queryset.filter(action=action)
    entity_type = params.get("entity_type")
    if entity_type and skip != "entity_type":
        queryset = queryset.filter(entity_type=entity_type)
    actor = params.get("actor")
    if actor:
        queryset = queryset.filter(actor__username=actor)

    date_from = _parse_day(params.get("date_from"))
    date_to = _parse_day(params.get("date_to"))
    # Instants, never `created_at__date`: that compiles to a CONVERT_TZ which is NULL on a
    # MySQL without timezone tables, and would answer "nothing happened" for a busy month.
    if date_from:
        queryset = queryset.filter(created_at__gte=start_of_day(date_from))
    if date_to:
        queryset = queryset.filter(created_at__lt=end_of_day(date_to))

    term = (params.get("search") or "").strip()
    if term:
        # What somebody actually has in their hand: a record number, a person, a table name,
        # or the request id off an error report.
        queryset = queryset.filter(
            Q(entity_id__icontains=term)
            | Q(entity_type__icontains=term)
            | Q(actor__username__icontains=term)
            | Q(actor__full_name__icontains=term)
            | Q(request_id__icontains=term)
            | Q(ip_address__icontains=term)
        )
    return queryset


@extend_schema(
    tags=["core"],
    summary="Read the audit trail",
    description=(
        "Every consequential action, newest first, as sentences rather than raw rows.\n\n"
        "`summary` is what happened in the last 30 days — a working signal, since an "
        "append-only table's lifetime total only ever grows. `facets` lists the actions and "
        "record types actually present with their counts, so the screen's filters are built "
        "from the data rather than from a list that drifts from it.\n\n"
        "Each row carries a one-line `summary` built from the action, the record and whichever "
        "metadata key holds the outcome; `changes` is a real before/after diff where the call "
        "site recorded one, and `facts` is the rest of the metadata, labelled. The two are "
        "kept apart because they are not the same thing.\n\n"
        "**`pii_access` is the action this exists for** — who opened a farmer's Aadhaar card, "
        "who took a workbook of bank details out of the building (SRS §16). It is never folded "
        "into a generic read.\n\n"
        "Filter with `action`, `entity_type`, `actor` (username), `date_from`, `date_to` and "
        "`search`, which matches a record id, a record type, a person, a request id or an IP.\n\n"
        "Read-only. There is no write path to this endpoint and none to the table behind it "
        "outside `record_audit` — an audit trail that can be edited is not one."
    ),
    parameters=[
        OpenApiParameter("search", description="Record, person, request id or IP", type=str),
        OpenApiParameter("action", description="One of the AuditLog actions", type=str),
        OpenApiParameter("entity_type", description="Record type", type=str),
        OpenApiParameter("actor", description="Username", type=str),
        OpenApiParameter("date_from", description="YYYY-MM-DD, inclusive", type=str),
        OpenApiParameter("date_to", description="YYYY-MM-DD, inclusive", type=str),
        OpenApiParameter(
            "limit", description=f"Default {DEFAULT_LIMIT}, max {MAX_LIMIT}", type=int
        ),
        OpenApiParameter("offset", type=int),
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin, in_section(PortalSection.LOGS)])
def audit_trail(request):
    params = request.query_params
    queryset = _filtered(params)

    try:
        limit = max(1, min(MAX_LIMIT, int(params.get("limit", DEFAULT_LIMIT))))
        offset = max(0, int(params.get("offset", 0)))
    except (TypeError, ValueError):
        limit, offset = DEFAULT_LIMIT, 0

    # Counted before paging, so the pager describes the trail rather than the page.
    count = queryset.count()
    page = list(queryset[offset : offset + limit])

    return Response(
        {
            "count": count,
            "limit": limit,
            "offset": offset,
            "results": [serialise(entry) for entry in page],
            "summary": _summary(),
            # Each facet counted against every filter but its own — see `_filtered`.
            "facets": {
                "actions": _action_facets(_filtered(params, skip="action")),
                "entity_types": _entity_facets(_filtered(params, skip="entity_type")),
            },
        }
    )


def _summary() -> dict:
    """The headline figures, over the last `SUMMARY_DAYS`."""
    since = timezone.now() - timedelta(days=SUMMARY_DAYS)
    window = AuditLog.objects.filter(created_at__gte=since)
    today = AuditLog.objects.filter(created_at__gte=start_of_day(timezone.localdate()))
    return {
        "window_days": SUMMARY_DAYS,
        "total": window.count(),
        "today": today.count(),
        # People, not rows: one person doing forty things is one person to ask about it.
        "people": window.exclude(actor=None).values("actor_id").distinct().count(),
        # The obligation, counted on its own.
        "pii_access": window.filter(action=AuditLog.Action.PII_ACCESS).count(),
    }


def _action_facets(queryset) -> list[dict]:
    """Which actions the trail holds, with the count each chip would show."""
    rows = queryset.values("action").annotate(n=Count("id")).order_by("-n")
    return [
        {
            "key": row["action"],
            "label": ACTIONS.get(row["action"], (row["action"], None))[0],
            "tone": ACTIONS.get(row["action"], (None, None))[1],
            "count": row["n"],
        }
        for row in rows
    ]


def _entity_facets(queryset) -> list[dict]:
    """Which record types the trail holds, most common first."""
    rows = queryset.values("entity_type").annotate(n=Count("id")).order_by("-n")
    return [
        {"key": row["entity_type"], "label": entity_label(row["entity_type"]), "count": row["n"]}
        for row in rows
    ]
