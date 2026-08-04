"""Stock requests and their Indent Easy lifecycle (SRS §6.6, §8.2 `indent_request`)."""

from __future__ import annotations

from django.db import models

from apps.core.models import TimeStampedModel
from apps.inventory.models import ProductType


class IndentRequest(TimeStampedModel):
    """
    A Mait's request for straws or consumables.

    Fulfilment happens in Indent Easy, not here: this platform pushes the request out and
    credits stock when the GRN callback arrives (SRS §6.6.2–6.6.3). ``indent_easy_ref_no``
    is the idempotency key for that callback — a redelivered webhook must not credit twice.
    """

    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        APPROVED = "approved", "Approved"
        ISSUED = "issued", "Issued"
        REJECTED = "rejected", "Rejected"

    class SyncStatus(models.TextChoices):
        PENDING = "pending", "Not yet pushed"
        SYNCED = "synced", "Pushed to Indent Easy"
        FAILED = "failed", "Push failed"

    mait = models.ForeignKey("masterdata.Mait", on_delete=models.PROTECT, related_name="indents")
    product_type = models.CharField(max_length=12, choices=ProductType.choices)
    product_ref_id = models.BigIntegerField(
        null=True,
        blank=True,
        help_text="Consumable.id where applicable. Straw requests are by breed, not by "
        "straw — the specific straws are chosen at issue time.",
    )
    breed = models.CharField(
        max_length=30, blank=True, help_text="For straw requests (SRS §6.6.1)."
    )
    qty_requested = models.PositiveIntegerField()
    qty_issued = models.PositiveIntegerField(default=0)

    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.REQUESTED, db_index=True
    )
    indent_easy_ref_no = models.CharField(
        max_length=50,
        blank=True,
        db_index=True,
        help_text="Reference returned by Indent Easy; dedupes GRN callbacks (SRS §6.6.5).",
    )
    sync_status = models.CharField(
        max_length=10, choices=SyncStatus.choices, default=SyncStatus.PENDING, db_index=True
    )
    sync_attempts = models.PositiveSmallIntegerField(default=0)
    last_sync_error = models.CharField(max_length=255, blank=True)

    requested_at = models.DateTimeField(auto_now_add=True, db_index=True)
    issued_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "indent_request"
        ordering = ["-requested_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(qty_requested__gt=0),
                name="indent_qty_requested_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(qty_issued__lte=models.F("qty_requested")),
                name="indent_issued_not_over_requested",
            ),
        ]
        indexes = [
            models.Index(fields=["mait", "-requested_at"], name="indent_mait_time_idx"),
            models.Index(fields=["status", "-requested_at"], name="indent_status_time_idx"),
            models.Index(fields=["sync_status", "sync_attempts"], name="indent_sync_idx"),
        ]

    def __str__(self) -> str:
        label = self.breed or f"{self.product_type}#{self.product_ref_id}"
        return f"Indent #{self.pk} {label} ×{self.qty_requested} [{self.status}]"

    @property
    def is_fulfilled(self) -> bool:
        return self.status == self.Status.ISSUED and self.qty_issued > 0

    @property
    def is_stale(self) -> bool:
        """Requested but never issued — surfaced in the admin exception view (SRS §6.7.6)."""
        from django.utils import timezone

        if self.status in (self.Status.ISSUED, self.Status.REJECTED):
            return False
        return (timezone.now() - self.requested_at).days >= 3


class IndentEasyWebhookEvent(TimeStampedModel):
    """
    Raw inbound webhook deliveries from Indent Easy.

    Persisted before processing so a delivery is never lost to a handler bug, and so a
    redelivery can be recognised as one. Also the audit trail when the store and the app
    disagree about what was issued.
    """

    class Status(models.TextChoices):
        RECEIVED = "received", "Received"
        PROCESSED = "processed", "Processed"
        DUPLICATE = "duplicate", "Duplicate — ignored"
        FAILED = "failed", "Processing failed"

    delivery_id = models.CharField(max_length=64, unique=True, db_index=True)
    indent_easy_ref_no = models.CharField(max_length=50, db_index=True)
    payload = models.JSONField(default=dict)
    signature_valid = models.BooleanField(default=False)
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.RECEIVED, db_index=True
    )
    error = models.CharField(max_length=255, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "indent_easy_webhook_event"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.delivery_id} [{self.status}]"
