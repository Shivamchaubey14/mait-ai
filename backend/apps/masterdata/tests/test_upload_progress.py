"""
Import progress (SRS §6.1.6).

The Member master is 105,000 rows and the operator is asked not to close the tab, so the one
thing the progress endpoint must do is move. It did not: `total_rows` was written only once the
import had finished, and `progress_percent` is processed/total — so every upload sat at 0% for
its whole run and jumped to 100% when there was nothing left to wait for. Worse, progress was
written once per committed chunk of a thousand rows, so a thousand-row sheet reported nothing
at all until it was over.

These tests watch the counters as the import runs rather than checking the final row, because
the final row was always right. It was the middle that was missing.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.base import ContentFile
from openpyxl import Workbook

from apps.accounts.models import Role, User
from apps.masterdata import tasks
from apps.masterdata.models import MPP, DataUploadLog, Mait

pytestmark = pytest.mark.django_db

ROWS = 250


@pytest.fixture
def uploader(db):
    return User.objects.create_user(username="admin-progress", full_name="Admin", role=Role.ADMIN)


@pytest.fixture
def assignment_upload(db, uploader):
    """An assignment sheet of 250 real rows, stored and ready for the importer."""
    mait = Mait.objects.create(sahayak_vendor_code="5500009999", name="PROGRESS MAIT")
    for index in range(ROWS):
        MPP.objects.create(mpp_code=f"9{index:05d}", mpp_name=f"VILLAGE {index}")

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["MPP Code", "Sahayak Vendor"])
    for index in range(ROWS):
        sheet.append([f"9{index:05d}", mait.sahayak_vendor_code])

    stream = io.BytesIO()
    workbook.save(stream)
    stream.seek(0)

    upload = DataUploadLog.objects.create(
        upload_type=DataUploadLog.UploadType.ASSIGNMENT,
        file_name="progress.xlsx",
        uploaded_by=uploader,
        status=DataUploadLog.Status.QUEUED,
    )
    upload.file.save("progress.xlsx", ContentFile(stream.getvalue()), save=True)
    return upload


def snapshots_of(monkeypatch) -> list[dict]:
    """Record what the database says at every progress write."""
    seen: list[dict] = []
    original = tasks._report_progress

    def spy(upload, processed, success, failed):
        original(upload, processed, success, failed)
        fresh = DataUploadLog.objects.get(pk=upload.pk)
        seen.append(
            {
                "percent": fresh.progress_percent,
                "processed": fresh.processed_rows,
                "total": fresh.total_rows,
            }
        )

    monkeypatch.setattr(tasks, "_report_progress", spy)
    return seen


def test_the_total_is_known_before_the_first_row_is_applied(assignment_upload, monkeypatch):
    seen = snapshots_of(monkeypatch)

    tasks.process_master_upload(assignment_upload.id)

    # The first write already has a denominator. Without one, percent is 0 by definition.
    assert seen, "no progress was reported at all"
    assert seen[0]["total"] == ROWS
    assert seen[0]["percent"] > 0


def test_progress_moves_while_the_import_runs(assignment_upload, monkeypatch):
    seen = snapshots_of(monkeypatch)

    tasks.process_master_upload(assignment_upload.id)

    percents = [s["percent"] for s in seen]
    # A file this size commits in one chunk, so every one of these came from the row counter
    # rather than from a commit — which is the whole point.
    assert len(percents) >= 2, percents
    assert percents == sorted(percents), percents
    assert any(0 < p < 100 for p in percents), percents


def test_the_finished_row_still_reports_the_exact_count(assignment_upload):
    tasks.process_master_upload(assignment_upload.id)

    upload = DataUploadLog.objects.get(pk=assignment_upload.pk)
    # The declared dimension is an estimate for the bar; the count written at the end is not.
    assert upload.total_rows == ROWS
    assert upload.success_rows == ROWS
    assert upload.progress_percent == 100
    assert upload.status == DataUploadLog.Status.COMPLETED
