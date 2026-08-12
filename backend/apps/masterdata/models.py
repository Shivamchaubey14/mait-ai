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
from apps.core.fields import EncryptedCharField, mask, pii_lookup_hash
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
        max_length=15,
        unique=True,
        db_index=True,
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

    # The Sahayak who runs this collection point. Their own role, not the Mait's: a Sahayak
    # staffs one MPP and takes the milk in, while a Mait is the AI technician covering many.
    # Held as plain contact fields rather than a relation because SAP owns them and they are
    # refreshed wholesale on each upload — and because making a Mait record out of every one
    # of them is precisely the mistake this platform used to make.
    sahayak_vendor_code = models.CharField(max_length=20, blank=True, db_index=True)
    sahayak_name = models.CharField(max_length=150, blank=True)
    sahayak_mobile_no = models.CharField(max_length=15, blank=True)

    mait = models.ForeignKey(
        Mait,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="mpps",
        help_text="The Mait covering this MPP (SRS §6.2.2). Set from the assignment sheet, "
        "never from the SAP master — the master's Sahayak column is a different person.",
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
        max_length=30,
        blank=True,
        help_text="SAP 'Class' column — renamed, `class` is a Python keyword.",
    )

    sap_vendor_code = models.CharField(max_length=20, blank=True, db_index=True)
    form_no = models.CharField(max_length=20, blank=True)
    folio_no = models.CharField(max_length=20, blank=True, db_index=True)

    mobile_no = models.CharField(
        max_length=15,
        blank=True,
        db_index=True,
        help_text="Payment authorisation OTPs are sent here (SRS §6.5).",
    )
    aadhar_no = EncryptedCharField(max_length=20, blank=True)
    # Keyed fingerprint of the Aadhaar, kept only so a non-member registration can be checked
    # against the membership roll (SRS §6.3 step 2). Ciphertext cannot be searched; this can,
    # and it reveals nothing without the key.
    aadhar_hash = models.CharField(max_length=64, blank=True, db_index=True)
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

    def save(self, *args, **kwargs):
        # Kept in step with the number here rather than at the call sites, so the SAP importer
        # — which is where almost every member comes from — cannot forget it.
        self.aadhar_hash = pii_lookup_hash(self.aadhar_no)
        return super().save(*args, **kwargs)

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
    # Two women in one village share a first name more often than not, and the roster a Mait
    # reads on the second visit has to tell them apart. Members carry the same field from SAP.
    father_husband_name = models.CharField(max_length=150, blank=True)
    mobile_no = models.CharField(max_length=15, validators=[mobile_validator], db_index=True)
    address = models.CharField(max_length=255, blank=True)

    # PII — encrypted at rest, masked in API responses (SRS §16), same treatment members and
    # Maits get. The card itself is never photographed or stored; SRS §7 asks for data
    # minimisation, and a masked number satisfies it.
    #
    # Required, unlike everywhere else this field appears. It is what proves this farmer is
    # not already on the membership roll — a member recorded as a non-member is one a Mait can
    # charge in cash for a service the dairy has already paid for.
    aadhar_no = EncryptedCharField(max_length=20, blank=True)
    aadhar_hash = models.CharField(max_length=64, blank=True, db_index=True)

    mpp = models.ForeignKey(
        MPP,
        on_delete=models.PROTECT,
        related_name="non_members",
        help_text="Nearest/served MPP.",
    )
    created_by_mait = models.ForeignKey(
        Mait, on_delete=models.PROTECT, related_name="registered_non_members"
    )
    consent_captured_at = models.DateTimeField(
        null=True,
        blank=True,
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

    def save(self, *args, **kwargs):
        self.aadhar_hash = pii_lookup_hash(self.aadhar_no)
        return super().save(*args, **kwargs)

    @property
    def masked_aadhar(self) -> str:
        return mask(self.aadhar_no)


# How many rejected rows one upload keeps, so a file where every row fails cannot grow the JSON
# column without bound. Lives here rather than with the importer because it is a property of the
# field: anything reading `error_report` without loading it — the history list does exactly that
# — needs the same number to say how long the report is.
MAX_ERRORS_STORED = 5000


class DataUploadLog(TimeStampedModel):
    """History of every SAP upload (SRS §6.1.5, §8.2 `data_upload_log`)."""

    class UploadType(models.TextChoices):
        MEMBER = "member", "Member Master"
        MAIT = "mait", "Mait / Vendor Master"
        MPP = "mpp", "MPP / Sahayak Master"
        # Not a SAP export: the round-trip workbook the portal hands out already filled with
        # the current mapping, so an admin edits what is there rather than composing a file.
        ASSIGNMENT = "assignment", "Mait ↔ MPP assignment"

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
        default=list,
        blank=True,
        help_text="Row-level failures, downloadable as a report (SRS §6.1.4). One entry per "
        "rejected row up to MAX_ERRORS_STORED — except a whole-file failure, which stores a "
        "single explanation and rejects no rows.",
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
