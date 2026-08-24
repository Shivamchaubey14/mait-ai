"""
Handing a master back.

The portal's "Download masters" button answers one question: *what is this platform actually
running on*. Everything under test here protects that answer.

  - it must be the upload that **landed**, not merely the most recent row — a queued or failed
    file never became the master, and offering one as "what we are running on" is the specific
    lie the feature exists to prevent;
  - it must arrive **locked**, because a master that reaches somebody subtly altered is worse
    than no file at all;
  - and it must say **where it came from**, because a copy with no date on it is the thing that
    gets mistaken for the current one three weeks later.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from openpyxl import Workbook, load_workbook
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Role, User
from apps.masterdata.models import DataUploadLog

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        username="admin-snapshots",
        password="a-long-enough-password",
        full_name="Snapshot Admin",
        role=Role.ADMIN,
    )


@pytest.fixture
def admin_client(admin):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


def a_workbook(rows) -> bytes:
    book = Workbook()
    sheet = book.active
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


@pytest.fixture
def upload(db, admin):
    """One stored upload, in whatever state the case needs."""

    def _make(
        upload_type=DataUploadLog.UploadType.MPP,
        status=DataUploadLog.Status.COMPLETED,
        file_name="All MPP.xlsx",
        rows=(("MPP Code", "MPPName"), ("001302", "ALI PUR"), ("001303", "BAROLI")),
    ):
        return DataUploadLog.objects.create(
            upload_type=upload_type,
            file_name=file_name,
            file=SimpleUploadedFile(file_name, a_workbook(rows)),
            uploaded_by=admin,
            status=status,
            total_rows=len(rows) - 1,
            success_rows=len(rows) - 1,
            finished_at=timezone.now(),
        )

    return _make


def sheet_of(response):
    # A whole response rather than a stream: the file is built in memory so its length can be
    # sent, which is what lets the portal draw a real progress bar instead of a spinner.
    book = load_workbook(io.BytesIO(response.content))
    return book[book.sheetnames[0]]


def test_the_download_is_the_last_upload_that_landed(admin_client, upload):
    upload(file_name="Old MPP.xlsx")
    upload(file_name="Current MPP.xlsx")
    # Queued after both, and it is not the master: nothing has read it yet.
    upload(file_name="Still Going.xlsx", status=DataUploadLog.Status.QUEUED)
    # Failed after that, and it is not the master either — it never became one.
    upload(file_name="Rejected.xlsx", status=DataUploadLog.Status.FAILED)

    response = admin_client.get("/api/v1/admin/uploads/snapshots/mpp/")

    assert response.status_code == 200
    banner = sheet_of(response).cell(2, 1).value
    assert "Current MPP.xlsx" in banner
    assert "Still Going" not in banner
    assert "Rejected" not in banner


def test_a_partial_import_still_counts_as_landed(admin_client, upload):
    # Its good rows are in force and its bad ones already have a report of their own.
    upload(file_name="Half Good.xlsx", status=DataUploadLog.Status.COMPLETED_WITH_ERRORS)

    response = admin_client.get("/api/v1/admin/uploads/snapshots/mpp/")

    assert "Half Good.xlsx" in sheet_of(response).cell(2, 1).value


def test_the_workbook_is_locked(admin_client, upload):
    # Not a seal — the protection can be removed by anyone who means to. It stops the
    # accident, which is the whole risk: a master altered on its way to somebody.
    upload()

    sheet = sheet_of(admin_client.get("/api/v1/admin/uploads/snapshots/mpp/"))

    assert sheet.protection.sheet is True
    assert sheet.protection.password is not None


def test_the_file_says_where_it_came_from(admin_client, upload):
    upload(file_name="All MPP.xlsx")

    sheet = sheet_of(admin_client.get("/api/v1/admin/uploads/snapshots/mpp/"))

    assert "MPP / Sahayak Master" in sheet.cell(1, 1).value
    assert "All MPP.xlsx" in sheet.cell(2, 1).value
    assert "Snapshot Admin" in sheet.cell(2, 1).value
    # And that editing it achieves nothing, before anybody tries.
    assert "upload that instead" in sheet.cell(3, 1).value


def test_every_row_of_the_master_survives_the_rebuild(admin_client, upload):
    upload(rows=(("MPP Code", "MPPName"), ("001302", "ALI PUR"), ("001303", "BAROLI")))

    sheet = sheet_of(admin_client.get("/api/v1/admin/uploads/snapshots/mpp/"))

    # Three banner lines and a spacer, then the SAP header, then the data.
    assert sheet.cell(5, 1).value == "MPP Code"
    assert [sheet.cell(row, 1).value for row in (6, 7)] == ["001302", "001303"]


def test_a_master_nobody_has_uploaded_is_a_404(admin_client, upload):
    upload(upload_type=DataUploadLog.UploadType.MPP)

    assert admin_client.get("/api/v1/admin/uploads/snapshots/member/").status_code == 404


def test_the_assignment_workbook_is_not_a_master(admin_client, upload):
    # It is generated by this portal rather than uploaded from SAP, and it already has its own
    # round-trip download. Offering it here would be a second door to a different thing.
    upload(upload_type=DataUploadLog.UploadType.ASSIGNMENT)

    assert admin_client.get("/api/v1/admin/uploads/snapshots/assignment/").status_code == 404


def test_the_listing_says_which_masters_have_a_copy(admin_client, upload):
    upload(upload_type=DataUploadLog.UploadType.MPP, file_name="All MPP.xlsx")
    upload(upload_type=DataUploadLog.UploadType.MEMBER, status=DataUploadLog.Status.FAILED)

    body = admin_client.get("/api/v1/admin/uploads/snapshots/").json()
    by_type = {row["upload_type"]: row for row in body["results"]}

    assert by_type["mpp"]["available"] is True
    assert by_type["mpp"]["file_name"] == "All MPP.xlsx"
    # A failed upload leaves the master with nothing to hand back, and the screen has to be
    # able to say so rather than offering a button that 404s.
    assert by_type["member"]["available"] is False
    assert by_type["mait"]["available"] is False


def test_a_mait_cannot_download_a_master(db, mait, upload):
    upload()
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(mait.user).access_token}")

    assert client.get("/api/v1/admin/uploads/snapshots/mpp/").status_code == 403
    assert client.get("/api/v1/admin/uploads/snapshots/").status_code == 403
