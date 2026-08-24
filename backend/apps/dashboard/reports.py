"""
CSV exports (SRS §9.9) — AI events, and pregnancy diagnosis.

Streamed rather than assembled in memory: a month of events is tens of thousands of rows, and
building that as one string is a request that holds a worker for its whole life and then
hands the browser nothing until the end.

**PII is excluded by design.** The export leaves this system entirely — it lands in an inbox,
a shared drive, a laptop — so it carries the same masked view the portal shows, and never
Aadhaar, bank details or a full mobile number. An admin who genuinely needs those reads them
on a single record, where the access is logged (SRS §16).
"""

from __future__ import annotations

import csv
from datetime import datetime

from django.db.models import Q
from django.http import StreamingHttpResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes

from apps.ai_events.models import AIEvent
from apps.ai_events.views import search_events
from apps.core.fields import mask
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin
from apps.core.services import record_audit
from apps.core.timeframe import end_of_day, local_day, start_of_day
from apps.pregnancy.models import PregnancyCheck

MAX_ROWS = 100_000


class _Echo:
    """A file-like object whose write() returns the line, for csv.writer to stream through."""

    def write(self, value):
        return value


AI_EVENT_COLUMNS = [
    "event_id",
    "status",
    "captured_at",
    "completed_at",
    "mpp_code",
    "mpp_name",
    "mait_code",
    "mait_name",
    "farmer_type",
    "farmer_name",
    # Beside the name, not instead of it. A name is what a person recognises and a code is what
    # the dairy's own systems key on, so a file that has to be reconciled against a milk
    # payment or looked up in SAP needs both — and there are several AKANKSHAs. Empty for a
    # non-member, who by definition has no membership number; `farmer_type` says which is which.
    "member_code",
    "animal_type",
    "breed",
    "straw_no",
    "payment_mode",
    "payment_amount",
    "payment_status",
]


def _ai_event_rows(queryset):
    for event in queryset.iterator(chunk_size=2000):
        payment = getattr(event, "payment", None)
        yield [
            event.id,
            event.status,
            event.created_at.isoformat(),
            event.completed_at.isoformat() if event.completed_at else "",
            event.mpp.mpp_code,
            event.mpp.mpp_name,
            event.mait.sahayak_vendor_code,
            event.mait.name,
            event.owner_type,
            getattr(event.owner, "member_name", None) or getattr(event.owner, "name", ""),
            getattr(event.owner, "member_code", "") or "",
            event.animal.animal_type,
            event.animal.breed,
            event.straw_unique_no,
            payment.mode if payment else "",
            payment.amount if payment else "",
            payment.status if payment else "",
        ]


def _parse_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


@extend_schema(
    tags=["reports"],
    summary="Export AI events as CSV",
    description=(
        "Filter with `date_from`, `date_to`, `mpp`, `mait` and `status`.\n\n"
        "Personal data is excluded: the file leaves this system, so it carries no Aadhaar, "
        "no bank details and no full mobile number. Every export is audit-logged against the "
        "admin who ran it, including the filters used."
    ),
    parameters=[
        OpenApiParameter("date_from", description="YYYY-MM-DD", required=False, type=str),
        OpenApiParameter("date_to", description="YYYY-MM-DD", required=False, type=str),
        OpenApiParameter("mpp", description="MPP code", required=False, type=str),
        OpenApiParameter("mait", description="Mait id", required=False, type=int),
        OpenApiParameter("status", description="AI event status", required=False, type=str),
    ],
    responses={200: bytes},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def export_csv(request):
    queryset = AIEvent.objects.select_related(
        "mpp", "mait", "member", "non_member", "animal", "payment"
    ).order_by("id")

    params = request.query_params
    date_from = _parse_date(params.get("date_from"))
    date_to = _parse_date(params.get("date_to"))
    # Instants, for the same reason the list filter uses them: `created_at__date` is a
    # CONVERT_TZ that returns NULL on a MySQL without timezone tables, and the export would
    # hand back an empty file for a month that had four hundred events in it.
    if date_from:
        queryset = queryset.filter(created_at__gte=start_of_day(date_from))
    if date_to:
        queryset = queryset.filter(created_at__lt=end_of_day(date_to))
    if params.get("mpp"):
        queryset = queryset.filter(mpp__mpp_code=params["mpp"])
    if params.get("mait"):
        queryset = queryset.filter(mait_id=params["mait"])
    if params.get("status"):
        queryset = queryset.filter(status=params["status"])
    # The same predicate the list uses, so the file matches the preview it was taken from.
    queryset = search_events(queryset, params.get("search"))

    # A ceiling rather than an unbounded stream. Beyond this the honest answer is a narrower
    # date range, not a file nobody can open.
    queryset = queryset[:MAX_ROWS]

    record_audit(
        action=AuditLog.Action.PII_ACCESS,
        entity_type="report",
        entity_id="ai_events_export",
        request=request,
        meta={"filters": dict(params.items()), "columns": AI_EVENT_COLUMNS},
    )

    writer = csv.writer(_Echo())
    stamp = timezone.localdate().isoformat()

    def stream():
        yield writer.writerow(AI_EVENT_COLUMNS)
        for row in _ai_event_rows(queryset):
            yield writer.writerow(row)

    response = StreamingHttpResponse(stream(), content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="ai-events-{stamp}.csv"'
    return response


# --------------------------------------------------------------------------------------
# Pregnancy diagnosis
# --------------------------------------------------------------------------------------
#
# The question this file is opened to answer is not "how many checks are there" — the screen
# says that. It is **who agreed to the check and who did not**, name by name, in something the
# dairy can sort, filter and take to a field meeting.
#
# So `owner_consent` is a column of its own rather than something to be inferred from
# `outcome`. Inferring it means knowing that a blank outcome is a visit nobody made, that
# `declined` is a refusal and that the other three are consent — three facts about this
# platform that a person opening a spreadsheet does not have and should not need.

PREGNANCY_COLUMNS = [
    "check_id",
    "ai_event_id",
    "owner_consent",
    "outcome",
    "farmer_type",
    "farmer_name",
    "member_code",
    "farmer_mobile",
    "mait_code",
    "mait_name",
    "mpp_code",
    "mpp_name",
    "animal_type",
    "breed",
    "ear_tag_no",
    "served_on",
    "due_on",
    "days_overdue",
    "checked_at",
    "calving_due_on",
    "amount_charged",
    "note",
]

#: The three states of the question "did this farmer agree to the check", in the words a
#: spreadsheet reader will understand without being told how this platform works.
CONSENT_DECLINED = "Declined"
CONSENT_ACCEPTED = "Accepted"
CONSENT_NOT_VISITED = "Not visited yet"


def _consent(check) -> str:
    if not check.outcome:
        return CONSENT_NOT_VISITED
    if check.outcome == PregnancyCheck.Outcome.DECLINED:
        return CONSENT_DECLINED
    # Anything else means somebody had a hand on the animal, which is consent by definition.
    return CONSENT_ACCEPTED


def _pregnancy_rows(queryset, today):
    for check in queryset.iterator(chunk_size=2000):
        event = check.ai_event
        owner = event.member or event.non_member
        served = event.performed_at or event.completed_at
        overdue = (today - check.due_on).days if not check.outcome else 0

        yield [
            check.id,
            event.id,
            _consent(check),
            # The raw value beside the plain-English one: the first is for a person reading,
            # the second for a filter or a pivot table that has to match exactly.
            check.outcome or "",
            event.owner_type,
            getattr(owner, "member_name", None) or getattr(owner, "name", ""),
            getattr(owner, "member_code", "") or "",
            # Masked, like every other export out of this system. The file lands in an inbox
            # or on a laptop; a full mobile column is a contact list leaving the platform.
            # An admin who needs to ring somebody reads the number on the screen, where the
            # access is logged.
            mask(getattr(owner, "mobile_no", "") or ""),
            check.mait.sahayak_vendor_code,
            check.mait.name,
            event.mpp.mpp_code,
            event.mpp.mpp_name,
            event.animal.animal_type,
            getattr(event.semen_batch, "breed", "") or "",
            event.animal.ear_tag_no or "",
            local_day(served).isoformat() if served else "",
            check.due_on.isoformat(),
            # Only meaningful while it is still owed; a recorded check is not overdue, it is
            # done, and a positive number against it would be read as a failure to act.
            max(0, overdue),
            check.checked_at.isoformat() if check.checked_at else "",
            check.calving_due_on.isoformat() if check.calving_due_on else "",
            check.amount_charged if check.amount_charged is not None else "",
            check.note,
        ]


@extend_schema(
    tags=["reports"],
    summary="Export pregnancy diagnosis as CSV",
    description=(
        "Who agreed to a check and who did not, one row per check."
        "\n\n"
        "`owner_consent` is the column this report exists for: **Accepted** where somebody "
        "examined the animal, **Declined** where the owner refused, and **Not visited yet** "
        "where the check is still owed. `outcome` carries the raw value beside it for "
        "filtering."
        "\n\n"
        "Filter with `date_from` / `date_to` (on the due date), `mait`, `mpp`, `outcome` and "
        "`consent`. `search` matches a Mait's name or vendor code, so a file taken from the "
        "oversight screen matches what was on it."
        "\n\n"
        "Mobile numbers are masked and Aadhaar is absent, as in every export: the file leaves "
        "this system. Every export is audit-logged against the admin who ran it."
    ),
    parameters=[
        OpenApiParameter("date_from", description="Due on or after, YYYY-MM-DD", required=False, type=str),
        OpenApiParameter("date_to", description="Due on or before, YYYY-MM-DD", required=False, type=str),
        OpenApiParameter("mait", description="Mait id", required=False, type=int),
        OpenApiParameter("mpp", description="MPP code", required=False, type=str),
        OpenApiParameter("outcome", description="pregnant / not_pregnant / unsure / declined", required=False, type=str),
        OpenApiParameter(
            "consent",
            description="accepted / declined / pending — the same split as `owner_consent`.",
            required=False,
            type=str,
        ),
        OpenApiParameter("search", description="Mait name or vendor code", required=False, type=str),
    ],
    responses={200: bytes},
)
@api_view(["GET"])
@permission_classes([IsAdmin])
def export_pregnancy_csv(request):
    queryset = PregnancyCheck.objects.select_related(
        "mait",
        "ai_event",
        "ai_event__mpp",
        "ai_event__animal",
        "ai_event__member",
        "ai_event__non_member",
        "ai_event__semen_batch",
    ).order_by("due_on", "id")

    params = request.query_params
    date_from = _parse_date(params.get("date_from"))
    date_to = _parse_date(params.get("date_to"))
    # Plain dates here, unlike the AI event export: `due_on` is a DateField, so there is no
    # timezone conversion to trip over and no reason to widen it to instants.
    if date_from:
        queryset = queryset.filter(due_on__gte=date_from)
    if date_to:
        queryset = queryset.filter(due_on__lte=date_to)
    if params.get("mait"):
        queryset = queryset.filter(mait_id=params["mait"])
    if params.get("mpp"):
        queryset = queryset.filter(ai_event__mpp__mpp_code=params["mpp"])
    if params.get("outcome"):
        queryset = queryset.filter(outcome=params["outcome"])

    consent = (params.get("consent") or "").lower()
    if consent == "declined":
        queryset = queryset.filter(outcome=PregnancyCheck.Outcome.DECLINED)
    elif consent == "accepted":
        queryset = queryset.exclude(outcome="").exclude(
            outcome=PregnancyCheck.Outcome.DECLINED
        )
    elif consent == "pending":
        queryset = queryset.filter(outcome="")

    # The oversight screen searches Maits, so this does too — a file taken from that screen
    # while a search is in the box should hold what the screen was showing.
    term = (params.get("search") or "").strip()
    if term:
        queryset = queryset.filter(
            Q(mait__name__icontains=term) | Q(mait__sahayak_vendor_code__icontains=term)
        )

    queryset = queryset[:MAX_ROWS]

    record_audit(
        action=AuditLog.Action.PII_ACCESS,
        entity_type="report",
        entity_id="pregnancy_export",
        request=request,
        meta={"filters": dict(params.items()), "columns": PREGNANCY_COLUMNS},
    )

    writer = csv.writer(_Echo())
    stamp = timezone.localdate().isoformat()
    today = timezone.localdate()

    def stream():
        yield writer.writerow(PREGNANCY_COLUMNS)
        for row in _pregnancy_rows(queryset, today):
            yield writer.writerow(row)

    response = StreamingHttpResponse(stream(), content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="pregnancy-checks-{stamp}.csv"'
    return response
