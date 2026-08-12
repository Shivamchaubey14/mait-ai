"""
What a rejected row tells the operator (SRS §6.1.4).

"Row 12228 — Member code is blank." names the cell but not the record. On a 105,000-row export
that leaves an admin unable to tell a real member whose code SAP never allotted from a subtotal
line the export left in, and those need opposite responses: one is fixed in SAP, the other is
deleted from the sheet.

So a failure carries the cells that identify what the row was about, read off the row itself —
there is nothing in the database to look them up from, because the row was rejected.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.base import ContentFile
from openpyxl import Workbook
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.masterdata import tasks
from apps.masterdata.models import MPP, DataUploadLog

pytestmark = pytest.mark.django_db

MEMBER_HEADERS = ["Member Code", "Member Name", "MPP", "Father/Husband Name"]


@pytest.fixture
def uploader(db):
    return User.objects.create_user(username="admin-errors", full_name="Admin", role=Role.ADMIN)


@pytest.fixture
def admin_client(uploader):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(uploader).access_token}")
    return client


def member_upload(uploader, rows) -> DataUploadLog:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(MEMBER_HEADERS)
    for row in rows:
        sheet.append(row)

    stream = io.BytesIO()
    workbook.save(stream)
    stream.seek(0)

    upload = DataUploadLog.objects.create(
        upload_type=DataUploadLog.UploadType.MEMBER,
        file_name="members.xlsx",
        uploaded_by=uploader,
        status=DataUploadLog.Status.QUEUED,
    )
    upload.file.save("members.xlsx", ContentFile(stream.getvalue()), save=True)
    return upload


class TestRejectedRowsCarryTheirIdentity:
    def test_a_blank_member_code_still_reports_who_the_row_was(self, uploader):
        """The complaint that prompted this: 25 rows, all saying only 'Member code is blank.'"""
        MPP.objects.create(mpp_code="MPP000001", mpp_name="VILLAGE ONE")
        upload = member_upload(
            uploader,
            [
                ["MEM00000001", "KAVITA DEVI", "MPP000001", "RAM SINGH"],
                ["", "SUNITA DEVI", "MPP000001", "MOHAN LAL"],
            ],
        )

        tasks.process_master_upload(upload.id)
        upload.refresh_from_db()

        assert upload.success_rows == 1
        assert upload.failed_rows == 1

        rejected = upload.error_report[0]
        assert rejected["error"] == "Member code is blank."
        # The blank cell is reported as blank rather than omitted — beside a filled-in name it
        # is the whole explanation for the rejection.
        assert rejected["fields"]["Member code"] == ""
        assert rejected["fields"]["Member name"] == "SUNITA DEVI"
        assert rejected["fields"]["MPP"] == "MPP000001"

    def test_the_report_names_the_columns_it_carries(self, admin_client, uploader):
        """The page renders whatever columns the response declares — see upload-errors.js."""
        upload = member_upload(uploader, [["", "SUNITA DEVI", "MPP000001", "MOHAN LAL"]])
        tasks.process_master_upload(upload.id)

        body = admin_client.get(f"/api/v1/admin/uploads/{upload.id}/errors/").json()
        assert body["columns"] == ["Member code", "Member name", "MPP", "Father / husband"]
        assert body["results"][0]["fields"]["Member name"] == "SUNITA DEVI"

    def test_the_history_list_survives_a_file_that_failed_wholesale(self, admin_client, uploader):
        """
        A bad Member file rejects every one of its rows, and the report is then megabytes.

        The history list is ordered by `-created_at`, and MySQL pulls every selected column
        through the sort buffer — so selecting the reports made the list 500 with "Out of sort
        memory" precisely when a file had just gone badly and someone opened the page to find
        out why. The list needs the count, not the rows.
        """
        upload = DataUploadLog.objects.create(
            upload_type=DataUploadLog.UploadType.MEMBER,
            file_name="wholesale-failure.xlsx",
            uploaded_by=uploader,
            status=DataUploadLog.Status.COMPLETED_WITH_ERRORS,
            failed_rows=5000,
            error_report=[
                {
                    "row": n,
                    "error": "MPP 'MPP999999' not found. Upload the MPP master first.",
                    "fields": {
                        "Member code": f"MEM{n:08d}",
                        "Member name": "A MEMBER WITH A REASONABLY LONG NAME",
                        "MPP": "MPP999999",
                        "Father / husband": "ANOTHER REASONABLY LONG NAME HERE",
                    },
                }
                for n in range(5000)
            ],
        )

        response = admin_client.get("/api/v1/admin/uploads/?limit=15")
        assert response.status_code == 200

        listed = next(r for r in response.json()["results"] if r["id"] == upload.id)
        assert listed["error_count"] == 5000

    def test_an_unknown_mpp_reports_the_code_that_was_not_found(self, uploader):
        """The other common Member rejection. The row is fine; the MPP master is not loaded."""
        upload = member_upload(uploader, [["MEM00000002", "RADHA DEVI", "MPP999999", "SHYAM"]])

        tasks.process_master_upload(upload.id)
        upload.refresh_from_db()

        rejected = upload.error_report[0]
        assert "MPP999999" in rejected["error"]
        assert rejected["fields"]["Member code"] == "MEM00000002"
        assert rejected["fields"]["MPP"] == "MPP999999"
