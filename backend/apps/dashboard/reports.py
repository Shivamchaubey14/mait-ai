"""
Exports (SRS §9.9) — AI events, and pregnancy diagnosis, as Excel workbooks.

**Workbooks, not CSV.** These used to be CSV, and Excel mangles a CSV on the way in: a member
code is sixteen digits starting with a zero (``0906167700010001``), and opened from a CSV it
loses the zero and turns into ``9.06168E+14`` — still looks like a number, and is no longer
anybody's code. An MPP code loses the zeros off ``001303``, and so does a straw number. In a
workbook every code is a text cell and arrives exactly as it left (``masterdata.exports`` learnt
the same about the non-member roster). Dates are real dates, so a column can be sorted and
filtered by day.

Written with openpyxl's write-only mode: rows go to a temporary file as they are read rather
than piling up in memory, which is what a month of tens of thousands of events needs. An xlsx is
a zip and is not valid until it is finished, so the file is sent once it is whole.

**PII is excluded by design.** The export leaves this system entirely — it lands in an inbox,
a shared drive, a laptop — so it carries the same masked view the portal shows, and never
Aadhaar, bank details or a full mobile number. An admin who genuinely needs those reads them
on a single record, where the access is logged (SRS §16).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from rest_framework.decorators import api_view, permission_classes

from apps.accounts.models import PortalSection
from apps.ai_events.models import AIEvent
from apps.ai_events.views import search_events
from apps.core.fields import mask
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin, in_section
from apps.core.scoping import apply_scope
from apps.core.services import record_audit
from apps.core.timeframe import end_of_day, event_day_expr, local_day, start_of_day
from apps.pregnancy.models import PregnancyCheck

MAX_ROWS = 100_000


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# How a column is written. TEXT is every code — member, vendor, MPP, Mait, straw, ear tag — so
# Excel keeps it character for character, leading zeros and all.
TEXT, NUMBER, PLAIN, WHEN, DAY = "text", "number", "plain", "datetime", "date"

# The portal's ink, as on the other workbooks this system hands out.
HEADER_FILL = PatternFill("solid", fgColor="253D4E")
HEADER_FONT = Font(color="FFFFFF", bold=True)


def _local(moment):
    """An aware instant as the wall-clock time in India, which is what Excel can hold."""
    return timezone.localtime(moment).replace(tzinfo=None) if moment else None


def _cell(sheet, kind, value):
    if kind == TEXT:
        cell = WriteOnlyCell(sheet, value="" if value is None else str(value))
        cell.number_format = "@"
        return cell
    if kind == WHEN and value:
        cell = WriteOnlyCell(sheet, value=value)
        cell.number_format = "dd-mm-yyyy hh:mm"
        return cell
    if kind == DAY and value:
        cell = WriteOnlyCell(sheet, value=value)
        cell.number_format = "dd-mm-yyyy"
        return cell
    if kind == NUMBER and isinstance(value, Decimal):
        return float(value)
    return None if value == "" else value


def workbook_response(*, sheet_title: str, columns, rows, filename: str) -> HttpResponse:
    """
    One sheet: a header row that stays in view and carries the filter arrows, then the rows.

    ``columns`` is ``(title, width, kind)``; each row is the values in that order.
    """
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet(sheet_title)
    for index, (_title, width, _kind) in enumerate(columns, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = "A2"

    header = []
    for title, _width, _kind in columns:
        cell = WriteOnlyCell(sheet, value=title)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        header.append(cell)
    # Set before any row is written: a write-only sheet writes its settings with the first row,
    # and the rows are a stream whose length is not known yet — so the arrows cover as far as
    # an export can go, which Excel treats the same as covering the data.
    count = len(rows) if isinstance(rows, list) else MAX_ROWS
    sheet.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{count + 1}"
    sheet.append(header)

    for row in rows:
        sheet.append(
            [_cell(sheet, kind, value) for (_t, _w, kind), value in zip(columns, row, strict=True)]
        )

    response = HttpResponse(content_type=XLSX)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    workbook.save(response)
    return response


AI_EVENT_COLUMNS = [
    ("Event ID", 10, NUMBER),
    ("Status", 16, PLAIN),
    ("Captured at", 17, WHEN),
    ("Completed at", 17, WHEN),
    ("MPP code", 11, TEXT),
    ("MPP name", 22, PLAIN),
    ("Mait code", 13, TEXT),
    ("Mait name", 22, PLAIN),
    ("Farmer type", 12, PLAIN),
    ("Farmer name", 24, PLAIN),
    # Beside the name, not instead of it. A name is what a person recognises and a code is what
    # the dairy's own systems key on, so a file that has to be reconciled against a milk
    # payment or looked up in SAP needs both — and there are several AKANKSHAs. Empty for a
    # non-member, who by definition has no membership number; `Farmer type` says which is which.
    ("Member code", 19, TEXT),
    # Hers for life, where the member code is not: a member who moves to another MPP is given a
    # new code there, and the SAP vendor is what stays the same. So it is the column that puts
    # her events under the old code and the new one back together.
    ("SAP vendor", 13, TEXT),
    ("Animal", 9, PLAIN),
    ("Breed", 12, PLAIN),
    # The tag in the animal's ear, where it has one. Not personal data — it identifies the
    # animal, not the farmer — so it belongs in the file a dispute is reconciled against, and
    # an event's row was unidentifiable without it when a member owned several of one breed.
    ("Ear tag", 12, TEXT),
    ("Straw no.", 16, TEXT),
    ("Payment mode", 13, PLAIN),
    ("Amount", 10, NUMBER),
    ("Payment status", 14, PLAIN),
    # Everything else the record holds that is safe outside the system — the whole event on
    # one row, so the file answers a question without anybody going back to the portal.
    ("AI done at", 17, WHEN),
    ("Semen breed", 13, PLAIN),
    ("Doses", 7, NUMBER),
    ("Consumables", 24, PLAIN),
    ("Father / husband", 22, PLAIN),
    # Masked to the last four, as everywhere an export leaves the system: enough to tell two
    # Kavitas apart on a call, not a contact list.
    ("Farmer mobile", 14, TEXT),
    ("Farmer check", 22, PLAIN),
    ("Payment reference (UTR)", 20, TEXT),
    ("Payment verified", 10, PLAIN),
    ("Proof photo", 12, PLAIN),
    ("Latitude", 12, PLAIN),
    ("Longitude", 12, PLAIN),
    ("Location from", 13, PLAIN),
    ("Sent from offline", 10, PLAIN),
    ("Pregnancy check due", 14, DAY),
    ("Pregnancy outcome", 16, PLAIN),
    ("Cancelled reason", 26, PLAIN),
]

PHOTO_FROM = {"camera": "Camera", "gallery": "Gallery"}
POSITION_FROM = {"device": "Handset", "photo": "Photograph"}

FARMER_TYPE = {"member": "Member", "non_member": "Non-member"}


def _ai_event_rows(queryset):
    for event in queryset.iterator(chunk_size=2000):
        payment = getattr(event, "payment", None)
        member = event.member
        yield [
            event.id,
            event.get_status_display(),
            _local(event.created_at),
            _local(event.completed_at),
            event.mpp.mpp_code,
            event.mpp.mpp_name,
            event.mait.sahayak_vendor_code,
            event.mait.name,
            FARMER_TYPE.get(event.owner_type, event.owner_type),
            getattr(event.owner, "member_name", None) or getattr(event.owner, "name", ""),
            member.member_code if member else "",
            member.sap_vendor_code if member else "",
            event.animal.animal_type,
            event.animal.breed,
            event.animal.ear_tag_no or "",
            event.straw_unique_no,
            payment.get_mode_display() if payment else "",
            payment.amount if payment else "",
            payment.get_status_display() if payment else "",
            _local(event.performed_at),
            getattr(event.semen_batch, "breed", "") or "",
            event.doses,
            ", ".join(f"{line.consumable.name} × {line.qty}" for line in event.consumables.all()),
            getattr(event.owner, "father_husband_name", "") or "",
            mask(getattr(event.owner, "mobile_no", "") or ""),
            event.get_farmer_check_display() if event.farmer_check else "",
            payment.utr_number if payment else "",
            ("Yes" if payment.is_verified else "No") if payment else "",
            (
                PHOTO_FROM.get(event.photo_source, event.photo_source)
                if event.ai_photo_url
                else "None"
            ),
            float(event.gps_lat) if event.gps_lat is not None else "",
            float(event.gps_lng) if event.gps_lng is not None else "",
            POSITION_FROM.get(event.gps_source, event.gps_source) if event.gps_lat else "",
            "Yes" if event.synced_from_offline else "No",
            check.due_on if (check := _first_check(event)) else None,
            (check.get_outcome_display() if check.outcome else "Not checked yet") if check else "",
            event.cancelled_reason,
        ]


def _first_check(event):
    checks = list(event.pregnancy_checks.all())
    return min(checks, key=lambda row: row.due_on) if checks else None


def _parse_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


@extend_schema(
    tags=["reports"],
    summary="Export AI events as an Excel workbook",
    description=(
        "Filter with `date_from`, `date_to`, `mpp`, `mait`, `status` and `search` (which "
        "matches a member's SAP vendor too).\n\n"
        "Codes are text cells, so a member code keeps its leading zero.\n\n"
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
@permission_classes([IsAdmin, in_section(PortalSection.REPORTS, PortalSection.AI_EVENTS)])
def export_csv(request):
    # Scoped before any filter the caller sent. An export is the easiest way to walk around a
    # screen's scope — the rows leave the building as a file — so it is narrowed at the source
    # rather than trusted to a query parameter.
    queryset = apply_scope(
        AIEvent.objects.select_related(
            "mpp", "mait", "member", "non_member", "animal", "payment", "semen_batch"
        )
        .prefetch_related("consumables__consumable", "pregnancy_checks")
        .order_by("id"),
        request,
    )

    params = request.query_params
    date_from = _parse_date(params.get("date_from"))
    date_to = _parse_date(params.get("date_to"))
    # Instants, for the same reason the list filter uses them: `created_at__date` is a
    # CONVERT_TZ that returns NULL on a MySQL without timezone tables, and the export would
    # hand back an empty file for a month that had four hundred events in it.
    #
    # Dated on the event *day* — completion for a finished capture, else when it was started —
    # so the file matches the on-screen list it was taken from, and both match the dashboard.
    # See `event_day_expr`.
    if date_from or date_to:
        queryset = queryset.annotate(event_day=event_day_expr())
    if date_from:
        queryset = queryset.filter(event_day__gte=start_of_day(date_from))
    if date_to:
        queryset = queryset.filter(event_day__lt=end_of_day(date_to))
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
        meta={
            "filters": dict(params.items()),
            "columns": [title for title, _w, _k in AI_EVENT_COLUMNS],
        },
    )

    return workbook_response(
        sheet_title="AI events",
        columns=AI_EVENT_COLUMNS,
        rows=_ai_event_rows(queryset),
        filename=f"ai-events-{timezone.localdate().isoformat()}.xlsx",
    )


# --------------------------------------------------------------------------------------
# Pregnancy diagnosis
# --------------------------------------------------------------------------------------
#
# The question this file is opened to answer is not "how many checks are there" — the screen
# says that. It is **who agreed to the check and who did not**, name by name, in something the
# dairy can sort, filter and take to a field meeting.
#
# So `Owner consent` is a column of its own rather than something to be inferred from
# `Outcome`. Inferring it means knowing that a blank outcome is a visit nobody made, that
# `declined` is a refusal and that the other three are consent — three facts about this
# platform that a person opening a spreadsheet does not have and should not need.

PREGNANCY_COLUMNS = [
    ("Check ID", 10, NUMBER),
    ("AI event ID", 11, NUMBER),
    ("Owner consent", 15, PLAIN),
    ("Outcome", 13, PLAIN),
    ("Farmer type", 12, PLAIN),
    ("Farmer name", 24, PLAIN),
    ("Member code", 19, TEXT),
    ("SAP vendor", 13, TEXT),
    ("Farmer mobile", 14, TEXT),
    ("Mait code", 13, TEXT),
    ("Mait name", 22, PLAIN),
    ("MPP code", 11, TEXT),
    ("MPP name", 22, PLAIN),
    ("Animal", 9, PLAIN),
    ("Breed", 12, PLAIN),
    ("Ear tag", 12, TEXT),
    ("Served on", 12, DAY),
    ("Due on", 12, DAY),
    ("Days overdue", 13, NUMBER),
    ("Checked at", 17, WHEN),
    ("Calving due", 12, DAY),
    ("Amount charged", 15, NUMBER),
    ("Note", 30, PLAIN),
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
            FARMER_TYPE.get(event.owner_type, event.owner_type),
            getattr(owner, "member_name", None) or getattr(owner, "name", ""),
            getattr(owner, "member_code", "") or "",
            getattr(owner, "sap_vendor_code", "") or "",
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
            local_day(served) if served else None,
            check.due_on,
            # Only meaningful while it is still owed; a recorded check is not overdue, it is
            # done, and a positive number against it would be read as a failure to act.
            max(0, overdue),
            _local(check.checked_at),
            check.calving_due_on,
            check.amount_charged if check.amount_charged is not None else "",
            check.note,
        ]


@extend_schema(
    tags=["reports"],
    summary="Export pregnancy diagnosis as an Excel workbook",
    description=(
        "Who agreed to a check and who did not, one row per check."
        "\n\n"
        "`Owner consent` is the column this report exists for: **Accepted** where somebody "
        "examined the animal, **Declined** where the owner refused, and **Not visited yet** "
        "where the check is still owed. `Outcome` carries the raw value beside it for "
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
        OpenApiParameter(
            "date_from", description="Due on or after, YYYY-MM-DD", required=False, type=str
        ),
        OpenApiParameter(
            "date_to", description="Due on or before, YYYY-MM-DD", required=False, type=str
        ),
        OpenApiParameter("mait", description="Mait id", required=False, type=int),
        OpenApiParameter("mpp", description="MPP code", required=False, type=str),
        OpenApiParameter(
            "outcome",
            description="pregnant / not_pregnant / unsure / declined",
            required=False,
            type=str,
        ),
        OpenApiParameter(
            "consent",
            description="accepted / declined / pending — the same split as `owner_consent`.",
            required=False,
            type=str,
        ),
        OpenApiParameter(
            "search", description="Mait name or vendor code", required=False, type=str
        ),
    ],
    responses={200: bytes},
)
@api_view(["GET"])
@permission_classes([IsAdmin, in_section(PortalSection.REPORTS, PortalSection.PREGNANCY)])
def export_pregnancy_csv(request):
    queryset = apply_scope(
        PregnancyCheck.objects.select_related(
            "mait",
            "ai_event",
            "ai_event__mpp",
            "ai_event__animal",
            "ai_event__member",
            "ai_event__non_member",
            "ai_event__semen_batch",
        ).order_by("due_on", "id"),
        request,
        "ai_event__mpp__plant_code",
    )

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
        queryset = queryset.exclude(outcome="").exclude(outcome=PregnancyCheck.Outcome.DECLINED)
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
        meta={
            "filters": dict(params.items()),
            "columns": [title for title, _w, _k in PREGNANCY_COLUMNS],
        },
    )

    today = timezone.localdate()
    return workbook_response(
        sheet_title="Pregnancy checks",
        columns=PREGNANCY_COLUMNS,
        rows=_pregnancy_rows(queryset, today),
        filename=f"pregnancy-checks-{today.isoformat()}.xlsx",
    )
