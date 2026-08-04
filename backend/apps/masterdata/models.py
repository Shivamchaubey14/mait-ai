"""
SAP-sourced master data (SRS §8.1).

SAP remains the system of record for MPP, Mait and Member identity; this app is an
operational layer refreshed by periodic admin uploads (SRS §3.3). Every table therefore
carries a natural key from SAP that upserts on re-upload (SRS §6.1.3), so re-uploading last
month's file refreshes rather than duplicates.
"""

from __future__ import annotations

from django.db import models

from apps.accounts.models import mobile_validator
from apps.core.fields import EncryptedCharField, mask
from apps.core.models import TimeStampedModel


class Mait(TimeStampedModel):
    """Field agent — the 'Sahayak' in SAP MPP data (SRS §8.1 `mait`)."""

    user = models.OneToOneField(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="mait_profile",
        help_text="Login identity. Null until an Admin activates the account (SRS §6.8.2).",
    )
    sahayak_vendor_code = models.CharField(
        max_length=15, unique=True, db_index=True,
        help_text="SAP Sahayak Vendor / Customer ID — the upsert key.",
    )
    name = models.CharField(max_length=150, db_index=True)
    mobile_no = models.CharField(max_length=15, validators=[mobile_validator], db_index=True)
    mobile_no_alt = models.CharField(max_length=15, blank=True)

    # PII — encrypted at rest, masked in API responses (SRS §16).
    pan_no = EncryptedCharField(max_length=12, blank=True)
    aadhar_no = EncryptedCharField(max_length=20, blank=True)
    bank_account_no = EncryptedCharField(max_length=30, blank=True)
    ifsc_code = models.CharField(max_length=15, blank=True)
    gst_no = models.CharField(max_length=20, blank=True)

    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "mait"
        ordering = ["name"]
        indexes = [models.Index(fields=["is_active", "name"], name="mait_active_name_idx")]

    def __str__(self) -> str:
        return f"{self.name} [{self.sahayak_vendor_code}]"

    @property
    def masked_aadhar(self) -> str:
        return mask(self.aadhar_no)

    @property
    def masked_bank_account(self) -> str:
        return mask(self.bank_account_no)


class MPP(TimeStampedModel):
    """Milk Producer Pool/Parlour — the village-level collection point (SRS §8.1 `mpp`)."""

    plant_code = models.CharField(max_length=10, blank=True)
    plant_name = models.CharField(max_length=100, blank=True)
    mpp_code = models.CharField(max_length=15, unique=True, db_index=True)
    mpp_name = models.CharField(max_length=150, db_index=True)
    mpp_category = models.CharField(max_length=20, blank=True)
    mpp_sub_category = models.CharField(max_length=20, blank=True)

    # Geo hierarchy straight from SAP (SRS §6.2.1). Kept as codes rather than FKs because
    # SAP owns the hierarchy and it is refreshed wholesale on each upload.
    state_code = models.CharField(max_length=10, blank=True, db_index=True)
    district_code = models.CharField(max_length=10, blank=True, db_index=True)
    tehsil_code = models.CharField(max_length=10, blank=True)
    panchayat_code = models.CharField(max_length=10, blank=True)
    village_code = models.CharField(max_length=10, blank=True)
    hamlet_code = models.CharField(max_length=10, blank=True)

    mobile_no = models.CharField(max_length=15, blank=True)
    address_line = models.CharField(max_length=255, blank=True)

    is_active = models.BooleanField(default=True, db_index=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    revival_date = models.DateField(null=True, blank=True)

    mait = models.ForeignKey(
        Mait, null=True, blank=True, on_delete=models.SET_NULL, related_name="mpps",
        help_text="Assigned Sahayak/Mait. Admin can override the SAP default (SRS §6.2.2).",
    )

    class Meta:
        db_table = "mpp"
        verbose_name = "MPP"
        verbose_name_plural = "MPPs"
        ordering = ["mpp_name"]
        indexes = [
            models.Index(fields=["district_code", "is_active"], name="mpp_district_idx"),
            models.Index(fields=["mait", "is_active"], name="mpp_mait_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.mpp_name} [{self.mpp_code}]"


class Member(TimeStampedModel):
    """
    Registered dairy producer from the SAP Member Master (SRS §8.1 `member`).

    ~105,000 rows. Every query path against this table must be indexed — see the
    composite indexes below, which cover the mobile app's member-search flow (SRS §6.3
    step 2).
    """

    mpp = models.ForeignKey(MPP, on_delete=models.PROTECT, related_name="members")
    member_code = models.CharField(max_length=20, unique=True, db_index=True)
    member_name = models.CharField(max_length=150, db_index=True)
    father_husband_name = models.CharField(max_length=150, blank=True)

    gender = models.CharField(max_length=10, blank=True)
    age = models.PositiveSmallIntegerField(null=True, blank=True)
    category = models.CharField(max_length=30, blank=True)
    education = models.CharField(max_length=50, blank=True)
    social_class = models.CharField(
        max_length=30, blank=True,
        help_text="SAP 'Class' column — renamed, `class` is a Python keyword.",
    )

    sap_vendor_code = models.CharField(max_length=20, blank=True, db_index=True)
    form_no = models.CharField(max_length=20, blank=True)
    folio_no = models.CharField(max_length=20, blank=True, db_index=True)

    mobile_no = models.CharField(
        max_length=15, blank=True, db_index=True,
        help_text="Payment authorisation OTPs are sent here (SRS §6.5).",
    )
    aadhar_no = EncryptedCharField(max_length=20, blank=True)
    cattle_holding = models.PositiveSmallIntegerField(null=True, blank=True)

    bank_ac_no = EncryptedCharField(max_length=30, blank=True)
    bank_name = models.CharField(max_length=100, blank=True)
    bank_branch = models.CharField(max_length=100, blank=True)
    ifsc_code = models.CharField(max_length=15, blank=True)

    activation_status = models.CharField(max_length=20, blank=True, db_index=True)
    activation_date = models.DateField(null=True, blank=True)
    deactivation_date = models.DateField(null=True, blank=True)
    remarks = models.TextField(blank=True)

    class Meta:
        db_table = "member"
        ordering = ["member_name"]
        indexes = [
            # Covers the app's primary lookup: members of the MPP I am standing in.
            models.Index(fields=["mpp", "member_name"], name="member_mpp_name_idx"),
            models.Index(fields=["mpp", "activation_status"], name="member_mpp_status_idx"),
            models.Index(fields=["mobile_no"], name="member_mobile_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.member_name} [{self.member_code}]"

    @property
    def masked_aadhar(self) -> str:
        return mask(self.aadhar_no)


class NonMember(TimeStampedModel):
    """
    A farmer without SAP membership who still avails the service (SRS §8.1 `non_member`).

    Captured in-app by the Mait and reused on subsequent visits. Consent for holding this
    data is captured at creation (SRS §7 Compliance).
    """

    name = models.CharField(max_length=150, db_index=True)
    mobile_no = models.CharField(max_length=15, validators=[mobile_validator], db_index=True)
    address = models.CharField(max_length=255, blank=True)
    mpp = models.ForeignKey(
        MPP, on_delete=models.PROTECT, related_name="non_members",
        help_text="Nearest/served MPP.",
    )
    created_by_mait = models.ForeignKey(
        Mait, on_delete=models.PROTECT, related_name="registered_non_members"
    )
    consent_captured_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When the farmer consented to their details being stored.",
    )

    class Meta:
        db_table = "non_member"
        ordering = ["name"]
        constraints = [
            # The same person re-registered at the same MPP is a data-entry mistake, not a
            # second farmer.
            models.UniqueConstraint(
                fields=["mobile_no", "mpp"], name="uniq_non_member_mobile_per_mpp"
            ),
        ]
        indexes = [models.Index(fields=["mpp", "name"], name="nonmember_mpp_name_idx")]

    def __str__(self) -> str:
        return f"{self.name} ({self.mobile_no})"


class DataUploadLog(TimeStampedModel):
    """History of every SAP upload (SRS §6.1.5, §8.2 `data_upload_log`)."""

    class UploadType(models.TextChoices):
        MEMBER = "member", "Member Master"
        MAIT = "mait", "Mait / Vendor Master"
        MPP = "mpp", "MPP / Sahayak Master"

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        COMPLETED = "completed", "Completed"
        COMPLETED_WITH_ERRORS = "completed_with_errors", "Completed with errors"
        FAILED = "failed", "Failed"

    upload_type = models.CharField(max_length=10, choices=UploadType.choices, db_index=True)
    file_name = models.CharField(max_length=255)
    file = models.FileField(upload_to="uploads/master-data/%Y/%m/")
    uploaded_by = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="master_uploads"
    )
    status = models.CharField(
        max_length=25, choices=Status.choices, default=Status.QUEUED, db_index=True
    )
    total_rows = models.PositiveIntegerField(default=0)
    success_rows = models.PositiveIntegerField(default=0)
    failed_rows = models.PositiveIntegerField(default=0)
    processed_rows = models.PositiveIntegerField(
        default=0, help_text="Drives the progress endpoint (SRS §6.1.6)."
    )
    error_report = models.JSONField(
        default=list, blank=True,
        help_text="Row-level failures, downloadable as a report (SRS §6.1.4).",
    )
    celery_task_id = models.CharField(max_length=64, blank=True, db_index=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "data_upload_log"
        ordering = ["-created_at"]
        verbose_name = "Data upload"

    def __str__(self) -> str:
        return f"{self.get_upload_type_display()} — {self.file_name} ({self.status})"

    @property
    def progress_percent(self) -> int:
        if not self.total_rows:
            return 0
        return min(100, round(self.processed_rows / self.total_rows * 100))
