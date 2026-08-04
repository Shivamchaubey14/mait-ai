"""
SAP master-data import (SRS §6.1).

The Member Master is ~105,000 rows across 54 columns in a ~28 MB workbook, so this runs as a
Celery job with progress reporting and never inline on a request (SRS §6.1.6).

Three behaviours matter and are easy to get wrong:

* **Upsert by natural key**, so re-uploading last month's file refreshes rather than
  duplicates (SRS §6.1.3).
* **Partial success.** Invalid rows are skipped and reported; valid rows still commit
  (SRS §6.1.4). Rejecting a 105k-row file because 12 rows have a malformed mobile number
  would make the feature unusable.
* **Streamed reading.** ``read_only=True`` keeps openpyxl from materialising the whole
  workbook, which is the difference between a few hundred MB of memory and a worker kill.
"""

from __future__ import annotations

import logging
from typing import Any, Iterator

from celery import shared_task
from django.db import transaction
from django.utils import timezone
from openpyxl import load_workbook

from .models import DataUploadLog, Mait, Member, MPP

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1000
MAX_ERRORS_STORED = 5000  # bounded so one bad file cannot blow up the JSON column

# Natural keys per upload type (SRS §6.1.3).
REQUIRED_COLUMNS: dict[str, set[str]] = {
    DataUploadLog.UploadType.MEMBER: {"mpp code", "member code", "member name"},
    DataUploadLog.UploadType.MAIT: {"customer id", "name"},
    DataUploadLog.UploadType.MPP: {"mpp code", "mpp name"},
}


@shared_task(bind=True, name="apps.masterdata.tasks.process_master_upload")
def process_master_upload(self, upload_id: int) -> dict[str, int]:
    """Parse, validate and upsert one uploaded SAP workbook."""
    upload = DataUploadLog.objects.get(pk=upload_id)
    upload.status = DataUploadLog.Status.PROCESSING
    upload.celery_task_id = self.request.id or ""
    upload.started_at = timezone.now()
    upload.save(update_fields=["status", "celery_task_id", "started_at", "updated_at"])

    try:
        result = _import_workbook(upload)
    except Exception as exc:  # noqa: BLE001 — the failure must land on the upload record
        logger.exception("Master upload %s failed", upload_id)
        upload.status = DataUploadLog.Status.FAILED
        upload.error_report = [{"row": None, "error": str(exc)[:500]}]
        upload.finished_at = timezone.now()
        upload.save(update_fields=["status", "error_report", "finished_at", "updated_at"])
        raise

    upload.status = (
        DataUploadLog.Status.COMPLETED_WITH_ERRORS
        if upload.failed_rows
        else DataUploadLog.Status.COMPLETED
    )
    upload.finished_at = timezone.now()
    upload.save(update_fields=["status", "finished_at", "updated_at"])
    return result


def _import_workbook(upload: DataUploadLog) -> dict[str, int]:
    handler = {
        DataUploadLog.UploadType.MEMBER: _upsert_member,
        DataUploadLog.UploadType.MAIT: _upsert_mait,
        DataUploadLog.UploadType.MPP: _upsert_mpp,
    }[upload.upload_type]

    workbook = load_workbook(upload.file, read_only=True, data_only=True)
    sheet = workbook.active

    header_row_index, headers = _detect_header(sheet, upload.upload_type)
    missing = REQUIRED_COLUMNS[upload.upload_type] - set(headers)
    if missing:
        # SRS §6.1.2 — reject the whole file, with a usable message.
        raise ValueError(
            f"Required column(s) missing: {', '.join(sorted(missing))}. "
            f"Found: {', '.join(sorted(h for h in headers if h))}."
        )

    errors: list[dict[str, Any]] = []
    success = failed = processed = 0
    batch: list[dict[str, Any]] = []

    for row_number, row in _iter_rows(sheet, header_row_index, headers):
        processed += 1
        batch.append({"row_number": row_number, "data": row})

        if len(batch) >= CHUNK_SIZE:
            ok, bad = _commit_batch(batch, handler, errors)
            success += ok
            failed += bad
            batch = []
            _report_progress(upload, processed, success, failed)

    if batch:
        ok, bad = _commit_batch(batch, handler, errors)
        success += ok
        failed += bad

    upload.total_rows = processed
    upload.processed_rows = processed
    upload.success_rows = success
    upload.failed_rows = failed
    upload.error_report = errors[:MAX_ERRORS_STORED]
    upload.save(
        update_fields=[
            "total_rows", "processed_rows", "success_rows", "failed_rows",
            "error_report", "updated_at",
        ]
    )
    logger.info(
        "Upload %s finished: %s ok, %s failed of %s", upload.id, success, failed, processed
    )
    return {"total": processed, "success": success, "failed": failed}


def _commit_batch(batch, handler, errors) -> tuple[int, int]:
    """
    Commit one chunk.

    Each row gets its own savepoint so a single bad row cannot roll back the other 999.
    That is what makes partial success work (SRS §6.1.4).
    """
    ok = bad = 0
    for item in batch:
        try:
            with transaction.atomic():
                handler(item["data"])
            ok += 1
        except Exception as exc:  # noqa: BLE001 — per-row isolation is the point
            bad += 1
            if len(errors) < MAX_ERRORS_STORED:
                errors.append({"row": item["row_number"], "error": str(exc)[:300]})
    return ok, bad


def _report_progress(upload: DataUploadLog, processed: int, success: int, failed: int) -> None:
    """Update the counters the progress endpoint polls (SRS §6.1.6)."""
    DataUploadLog.objects.filter(pk=upload.pk).update(
        processed_rows=processed, success_rows=success, failed_rows=failed,
        updated_at=timezone.now(),
    )


def _detect_header(sheet, upload_type: str) -> tuple[int, list[str]]:
    """
    Find the header row (SRS §6.1.2).

    SAP exports frequently carry a title or a blank line above the real header, so the
    first row cannot be assumed. The header is the first row within the top 20 that
    contains all the required columns.
    """
    required = REQUIRED_COLUMNS[upload_type]
    for index, row in enumerate(sheet.iter_rows(min_row=1, max_row=20, values_only=True)):
        headers = [_normalise(c) for c in row]
        if required <= set(headers):
            return index + 1, headers
    raise ValueError(
        "Could not locate a header row in the first 20 rows. Expected columns: "
        f"{', '.join(sorted(required))}."
    )


def _iter_rows(sheet, header_row_index: int, headers: list[str]) -> Iterator[tuple[int, dict]]:
    """Yield (row_number, {column: value}) for every non-empty row below the header."""
    for offset, row in enumerate(
        sheet.iter_rows(min_row=header_row_index + 1, values_only=True)
    ):
        if row is None or all(cell in (None, "") for cell in row):
            continue
        yield header_row_index + 1 + offset, dict(zip(headers, row))


def _normalise(value) -> str:
    return str(value).strip().lower() if value is not None else ""


def _clean(value) -> str:
    return str(value).strip() if value not in (None, "") else ""


def _mobile(value) -> str:
    """
    Normalise an Indian mobile number.

    SAP exports carry these inconsistently — as floats, with +91, with spaces. Returns ""
    when the value cannot be salvaged rather than guessing, because a wrong number means
    the payment OTP goes to a stranger.
    """
    raw = _clean(value).replace(" ", "").replace("-", "")
    if raw.endswith(".0"):
        raw = raw[:-2]
    if raw.startswith("+91"):
        raw = raw[3:]
    elif raw.startswith("91") and len(raw) == 12:
        raw = raw[2:]
    return raw if len(raw) == 10 and raw[0] in "6789" and raw.isdigit() else ""


# -- per-type upserts --------------------------------------------------------------------

def _upsert_mpp(row: dict) -> None:
    mpp_code = _clean(row.get("mpp code"))
    if not mpp_code:
        raise ValueError("MPP Code is blank.")

    mait = None
    vendor_code = _clean(row.get("sahayak vendor") or row.get("sahayak vendor code"))
    if vendor_code:
        mait = Mait.objects.filter(sahayak_vendor_code=vendor_code).first()

    MPP.objects.update_or_create(
        mpp_code=mpp_code,
        defaults={
            "plant_code": _clean(row.get("plant") or row.get("plant code")),
            "plant_name": _clean(row.get("plant name")),
            "mpp_name": _clean(row.get("mpp name")),
            "mpp_category": _clean(row.get("mpp category")),
            "mpp_sub_category": _clean(row.get("mpp sub category")),
            "state_code": _clean(row.get("state")),
            "district_code": _clean(row.get("district")),
            "tehsil_code": _clean(row.get("tehsil")),
            "panchayat_code": _clean(row.get("panchayat")),
            "village_code": _clean(row.get("village")),
            "hamlet_code": _clean(row.get("hamlet")),
            "mobile_no": _mobile(row.get("mobile no") or row.get("mobile")),
            "address_line": _clean(row.get("address")),
            "is_active": _clean(row.get("active")).lower() in ("x", "yes", "true", "1", "active"),
            "mait": mait,
        },
    )


def _upsert_mait(row: dict) -> None:
    vendor_code = _clean(row.get("customer id") or row.get("sahayak vendor"))
    if not vendor_code:
        raise ValueError("Customer ID is blank.")

    Mait.objects.update_or_create(
        sahayak_vendor_code=vendor_code,
        defaults={
            "name": _clean(row.get("name")),
            "mobile_no": _mobile(row.get("contact number") or row.get("mobile no")),
            "mobile_no_alt": _mobile(row.get("alternate number")),
            "pan_no": _clean(row.get("pan") or row.get("pan no")),
            "aadhar_no": _clean(row.get("aadhar") or row.get("aadhar no")),
            "bank_account_no": _clean(row.get("account number")),
            "ifsc_code": _clean(row.get("ifsc") or row.get("bank key")),
            "gst_no": _clean(row.get("gst") or row.get("gst no")),
            "is_active": True,
        },
    )


def _upsert_member(row: dict) -> None:
    member_code = _clean(row.get("member code"))
    if not member_code:
        raise ValueError("Member Code is blank.")

    mpp_code = _clean(row.get("mpp") or row.get("mpp code"))
    mpp = MPP.objects.filter(mpp_code=mpp_code).only("id").first()
    if mpp is None:
        # Skipped rather than auto-created: inventing an MPP from a member row would put a
        # member at a collection point that may not exist (SRS §6.1.4).
        raise ValueError(f"MPP '{mpp_code}' not found. Upload the MPP master first.")

    Member.objects.update_or_create(
        member_code=member_code,
        defaults={
            "mpp_id": mpp.id,
            "member_name": _clean(row.get("member name")),
            "father_husband_name": _clean(row.get("father/husband name")
                                          or row.get("father husband name")),
            "gender": _clean(row.get("gender")),
            "age": _int_or_none(row.get("age")),
            "category": _clean(row.get("category")),
            "education": _clean(row.get("education")),
            "social_class": _clean(row.get("class")),
            "sap_vendor_code": _clean(row.get("sap vendor")),
            "form_no": _clean(row.get("form no")),
            "folio_no": _clean(row.get("folio no")),
            "mobile_no": _mobile(row.get("mobile no")),
            "aadhar_no": _clean(row.get("aadhar no")),
            "cattle_holding": _int_or_none(row.get("cattle holding")),
            "bank_ac_no": _clean(row.get("bank a/c no") or row.get("account number")),
            "bank_name": _clean(row.get("bank name")),
            "bank_branch": _clean(row.get("bank branch")),
            "ifsc_code": _clean(row.get("ifsc code")),
            "activation_status": _clean(row.get("activation status")),
        },
    )


def _int_or_none(value) -> int | None:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None
