"""
CSV export (SRS §9.9, `GET /reports/export/`).

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

from django.http import StreamingHttpResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes

from apps.ai_events.models import AIEvent
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin
from apps.core.services import record_audit

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
    if date_from:
        queryset = queryset.filter(created_at__date__gte=date_from)
    if date_to:
        queryset = queryset.filter(created_at__date__lte=date_to)
    if params.get("mpp"):
        queryset = queryset.filter(mpp__mpp_code=params["mpp"])
    if params.get("mait"):
        queryset = queryset.filter(mait_id=params["mait"])
    if params.get("status"):
        queryset = queryset.filter(status=params["status"])

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
