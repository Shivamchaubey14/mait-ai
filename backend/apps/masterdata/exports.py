"""
The non-member roster, as a workbook the back office can take away (W10b).

The screen it comes from is a review queue: rows typed by a Mait in a yard, on the one path
in this product that ends with cash changing hands. Reviewing them on the screen works while
there are fifty; the moment somebody has to reconcile a district against a milk-payment run,
or sit in a field meeting with the list of farmers whose card was never photographed, they
need it in something they can sort and filter. That is what this is for.

**xlsx rather than the CSV the other two exports produce.** Not a preference — the columns
here are full of things Excel corrupts on the way in from a CSV, and this file carries the
worst of them. A twelve-digit Aadhaar becomes ``1.23457E+11``, a mobile number becomes
``9.19876E+11``, and an MPP code loses the leading zero off ``001302``. A number that arrives
rounded into scientific notation is worse than one that never arrived: it still looks like a
number, and it is the number somebody is about to verify a farmer against. Written as a real
workbook, every one of those cells is typed as text and arrives intact. ``templates_xlsx``
already had to learn this about the assignment sheet.

**Built in memory, not streamed.** The other exports stream because a month of AI events is
tens of thousands of rows; this is bounded by the non-member population, which is farmers
registered by hand — a few thousand, growing at the speed of people. An xlsx is a zip and
cannot be valid until its central directory is written, so there is nothing to stream anyway:
the file has to be finished before its first byte is honest. ``MAX_ROWS`` is the guard against
that assumption quietly ceasing to be true.

**Aadhaar and mobile leave in full, and that is a deliberate exception** to the rule the
AI-event and Pregnancy exports keep. Those two are read to answer questions about the work —
how many inseminations, which villages, who is owed a check — and a masked number costs them
nothing. This file is read to *verify the farmer*: an operator sits with it against the card
images and the registration and confirms that the woman a Mait charged in cash is who the row
says she is. A masked number cannot be checked against anything, which would leave this file
unable to do the one job it exists for.

So the exposure is accepted rather than hidden, and three things hold it in place. The
endpoint is Admin-only and behind the Non-members section, the same gate as the detail screen —
which already returns the card images, so a full number was readable to exactly these people
before this file existed. Every export is written to the audit log with the filters it ran,
so who took which rows away is on the record. And the sheet says on its first row that it
carries them, because the person who opens it in a month is the person who has to decide where
it may be stored (SRS §7, §16).
"""

from __future__ import annotations

from django.http import HttpResponse
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from apps.core.timeframe import local_day

#: The population is hand-entered, so this is a long way off. It exists so the decision to
#: build in memory fails loudly if that stops being true, rather than by degrees.
MAX_ROWS = 50_000

# The portal's ink, so the file looks like it came from the same product as the assignment
# sheet.
HEADER_FILL = PatternFill("solid", fgColor="253D4E")
HEADER_FONT = Font(color="FFFFFF", bold=True)
# Not a quiet grey note: this line is a warning about what the file holds, and it has to
# survive being skimmed past on the way to the data.
WARN_FONT = Font(color="B42318", bold=True, size=9)
# A row missing either of the two things that keep this path honest, tinted the way the screen
# tints them. These are what the file was downloaded to work through.
GAP_FILL = PatternFill("solid", fgColor="FDECEC")

#: ``(header, width, force_text)``. Codes and numbers are text; counts and litres are genuinely
#: numeric and stay that way, so a pivot table can sum them.
COLUMNS = [
    ("Name", 26, False),
    ("Household", 24, False),
    ("Relation", 12, False),
    ("Mobile", 16, True),
    ("Aadhaar", 18, True),
    ("Card", 12, False),
    ("Consent", 14, False),
    ("MPP code", 12, True),
    ("MPP name", 26, False),
    ("Registered by", 24, False),
    ("Mait code", 14, True),
    ("Cows", 8, False),
    ("Buffaloes", 11, False),
    ("Herd", 8, False),
    ("Litres/day", 11, False),
    ("Animals on file", 15, False),
    ("AI events", 11, False),
    ("Registered on", 15, True),
]


def _card(non_member) -> str:
    """
    The card, in the same four words the screen uses.

    "Missing" and "Back only" are different jobs for the back office — one is a registration to
    redo, the other a photograph to chase — so they are not collapsed into a single word here
    either. ``non-members.js`` draws exactly these.
    """
    front = bool(non_member.aadhar_front_url)
    back = bool(non_member.aadhar_back_url)
    if front and back:
        return "On file"
    if front:
        return "Front only"
    if back:
        return "Back only"
    return "Missing"


def _consent(non_member) -> str:
    """When she agreed to be on file, or the fact that there is no record of her agreeing."""
    if non_member.consent_captured_at:
        return local_day(non_member.consent_captured_at).isoformat()
    return "Not captured"


def _row(non_member) -> list:
    mait = non_member.created_by_mait
    mpp = non_member.mpp
    return [
        non_member.name,
        non_member.father_husband_name or "Not recorded",
        non_member.get_relation_display() or "",
        # In full, both of them. This file is what the number is checked *against* — see the
        # note at the top of the module about why that is the exception here.
        non_member.mobile_no or "",
        non_member.aadhar_no or "",
        _card(non_member),
        _consent(non_member),
        mpp.mpp_code if mpp else "",
        mpp.mpp_name if mpp else "",
        mait.name if mait else "",
        mait.sahayak_vendor_code if mait else "",
        non_member.cattle_cows,
        non_member.cattle_buffaloes,
        non_member.cattle_total,
        # A Decimal reaches openpyxl as a number, but float() keeps it one rather than letting
        # it arrive as the string repr of a Decimal.
        float(non_member.daily_yield_litres or 0),
        # Annotated by the viewset. Defaulted because the builder is also reachable from a
        # shell and from tests, where the annotation may not be there.
        getattr(non_member, "animal_count", 0) or 0,
        getattr(non_member, "ai_event_count", 0) or 0,
        local_day(non_member.created_at).isoformat(),
    ]


def build_non_member_workbook(queryset) -> Workbook:
    """
    One sheet, one row per farmer, in whatever order the queryset arrived in.

    The order is the caller's on purpose: this is taken from a screen and it should match the
    screen it was taken from, down to the sort. Re-sorting here is how a file and its preview
    quietly stop agreeing.
    """
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Non-members"

    # Said on the sheet, not only in this docstring. Somebody opens the file a month later with
    # no idea where it came from, and the person holding it is the person who decides where it
    # gets stored and who it gets sent to — they cannot make that call without being told what
    # is in it.
    stamp = timezone.localdate().isoformat()
    banner = sheet.cell(
        row=1,
        column=1,
        value=(
            f"Non-members registered by Maits in the field · exported {stamp} · "
            "CONTAINS FULL AADHAAR AND MOBILE NUMBERS — handle as personal data"
        ),
    )
    banner.font = WARN_FONT

    for index, (title, width, _force_text) in enumerate(COLUMNS, start=1):
        cell = sheet.cell(row=2, column=index, value=title)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(vertical="center")
        sheet.column_dimensions[get_column_letter(index)].width = width

    line = 3
    for non_member in queryset.iterator(chunk_size=1000):
        values = _row(non_member)
        # Tinted rather than filtered out: the file is the whole queue, and these are the part
        # of it somebody has to act on.
        incomplete = values[5] != "On file" or values[6] == "Not captured"
        for index, value in enumerate(values, start=1):
            cell = sheet.cell(row=line, column=index, value=value)
            if COLUMNS[index - 1][2]:
                cell.number_format = "@"
            if incomplete:
                cell.fill = GAP_FILL
        line += 1
        if line > MAX_ROWS + 2:
            break

    # Below the banner, so a scroll through the roster keeps the column names in view. The
    # filter arrows sit on the header row, because sorting and filtering a list is reading it.
    sheet.freeze_panes = "A3"
    if line > 3:
        sheet.auto_filter.ref = f"A2:{get_column_letter(len(COLUMNS))}{line - 1}"
    return workbook


def non_member_workbook_response(queryset) -> HttpResponse:
    workbook = build_non_member_workbook(queryset)
    stamp = timezone.localdate().isoformat()
    response = HttpResponse(
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    response["Content-Disposition"] = f'attachment; filename="non-members-{stamp}.xlsx"'
    workbook.save(response)
    workbook.close()
    return response
