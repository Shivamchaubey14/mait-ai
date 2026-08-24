"""
Handing a master back the way it came in — as a workbook nobody can quietly edit.

An admin's question here is not "what is the template". The templates are the SAP exports
themselves, and this portal has always said so. The question is **what did we last load**:
before re-uploading a corrected Member master somebody wants to open the one currently in
force, check a column, and be sure they are looking at what the platform is actually running
on. Until now the only copy was on whichever laptop uploaded it.

So this rebuilds the stored upload as a fresh workbook and locks it.

**"Locked" is Excel's own sheet protection, and that is worth being exact about.** It stops the
accident — a stray keystroke in a cell, a column dragged, a row deleted on the way to
somewhere else — which is the whole risk here, because a master that reaches somebody subtly
altered is worse than no file at all. It is *not* encryption and it is not a permission: the
protection can be removed by anyone who means to, and openpyxl itself will do it. Nothing on
the screen claims otherwise, and nothing downstream should treat one of these as evidence.

**Rebuilt rather than served.** The stored file could simply be streamed back, and it would be
faster — but it would arrive editable, and re-emitting is also what lets the sheet carry a
provenance banner saying which upload this is and when it landed. A copy of a master with no
date on it is the thing that gets mistaken for the current one three weeks later.

Streamed at both ends: `read_only` on the way in and `write_only` on the way out, because the
Member master is ~28 MB and about a hundred thousand rows, and materialising that twice is a
worker held for the length of a download.
"""

from __future__ import annotations

import io

from django.utils import timezone
from openpyxl import Workbook, load_workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .models import DataUploadLog

#: Beyond this the honest answer is the database, not a spreadsheet. The masters sit well
#: inside it; the cap is here so one malformed upload cannot turn a download into an outage.
MAX_SNAPSHOT_ROWS = 200_000

#: Sheet protection needs *a* password, or Excel offers to unprotect with a blank one and the
#: friction is zero. It is deliberately not a secret — see the module docstring. Keeping it in
#: the open is more honest than implying the file is sealed.
SHEET_PASSWORD = "mait-ai"  # noqa: S105 - not a credential; see above.

#: The portal's own ink header band, so the file looks like it came from here.
_HEADER_FILL = PatternFill("solid", fgColor="FF253D4E")
_HEADER_FONT = Font(bold=True, color="FFFFFFFF")
_TITLE_FONT = Font(bold=True, size=12, color="FF253D4E")
_NOTE_FONT = Font(italic=True, size=9, color="FF7A8893")


def latest_upload(upload_type: str) -> DataUploadLog | None:
    """
    The most recent upload of this master that actually landed.

    Not simply the most recent row. A queued or failed upload is a file that never became the
    master, and handing one back as "what we are running on" would be a lie of exactly the
    kind this feature exists to prevent. `completed_with_errors` counts: the rows that passed
    are in force, and the rejected ones already have their own report.
    """
    return (
        DataUploadLog.objects.filter(
            upload_type=upload_type,
            status__in=[
                DataUploadLog.Status.COMPLETED,
                DataUploadLog.Status.COMPLETED_WITH_ERRORS,
            ],
        )
        .select_related("uploaded_by")
        .order_by("-created_at")
        .first()
    )


def _provenance(upload: DataUploadLog) -> list[tuple[str, Font]]:
    """Where this file came from, written on the file itself."""
    landed = timezone.localtime(upload.finished_at or upload.created_at)
    who = upload.uploaded_by.full_name or upload.uploaded_by.username
    return [
        (
            f"{upload.get_upload_type_display()} — as loaded on "
            f"{landed.strftime('%d %b %Y at %H:%M')}",
            _TITLE_FONT,
        ),
        (
            f"Source file: {upload.file_name} · {upload.success_rows:,} of "
            f"{upload.total_rows:,} rows accepted · uploaded by {who}",
            _NOTE_FONT,
        ),
        (
            "Read-only copy. Editing here changes nothing — correct the SAP export and "
            "upload that instead.",
            _NOTE_FONT,
        ),
    ]


def build_snapshot(upload: DataUploadLog) -> io.BytesIO:
    """
    Rebuild an upload as a protected workbook.

    Only the first sheet is carried. Every master this platform reads is one sheet of rows; a
    second sheet in a SAP export has never been data, and copying one would put something in
    an admin's hands that the importer itself ignored.
    """
    source = load_workbook(upload.file, read_only=True, data_only=True)
    try:
        book = Workbook(write_only=True)
        sheet = book.create_sheet(title="Data")

        # Set before a single row is written. A write-only sheet is serialised as it goes, and
        # a protection flag set afterwards lands in the file too late to be honoured.
        sheet.protection.sheet = True
        sheet.protection.password = SHEET_PASSWORD
        sheet.protection.enable()

        for text, font in _provenance(upload):
            cell = WriteOnlyCell(sheet, value=text)
            cell.font = font
            sheet.append([cell])
        sheet.append([])

        written = 0
        widths: dict[int, int] = {}
        for index, row in enumerate(source[source.sheetnames[0]].iter_rows(values_only=True)):
            if written >= MAX_SNAPSHOT_ROWS:
                sheet.append(
                    [
                        f"Truncated at {MAX_SNAPSHOT_ROWS:,} rows. The full master is in the "
                        "platform, not in this file."
                    ]
                )
                break

            if index == 0:
                # The SAP export's own header row, given the portal's header band so it reads
                # as a heading when the file is opened rather than as the first record.
                cells = []
                for column, value in enumerate(row, start=1):
                    cell = WriteOnlyCell(sheet, value=value)
                    cell.font = _HEADER_FONT
                    cell.fill = _HEADER_FILL
                    cell.alignment = Alignment(vertical="center")
                    cells.append(cell)
                    widths[column] = min(40, max(12, len(str(value or "")) + 2))
                sheet.append(cells)
            else:
                sheet.append(list(row))
            written += 1

        # Column widths have to be declared before the data in write-only mode, but openpyxl
        # tolerates them being set on the sheet at any point before `save` — it serialises the
        # `<cols>` block itself. Without them every column is default width and a master opens
        # as a wall of `#####`.
        for column, width in widths.items():
            sheet.column_dimensions[get_column_letter(column)].width = width

        buffer = io.BytesIO()
        book.save(buffer)
        buffer.seek(0)
        return buffer
    finally:
        # A read-only workbook holds the file open; the importer learned this the hard way.
        source.close()
