"""Stock requests and their Indent Easy lifecycle (SRS §6.6, §8.2 `indent_request`)."""

from __future__ import annotations

from datetime import timedelta

from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import TimeStampedModel
from apps.inventory.models import ProductType

# An open indent nobody has moved for this long is a Mait waiting on stock that is not coming.
#
# One number, because there used to be two: the Indents screen called an indent stale after
# seven days and only if it had been approved, while the dashboard's exception queue counted
# anything open after three. The queue therefore counted rows the screen it links to would not
# show — an admin clicked a count of four and landed on an empty table.
STALE_AFTER_DAYS = 3


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
    received_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the Mait confirmed they collected it. This is where stock is "
        "credited — between issue and collection the goods are at the depot, not in the "
        "Mait's flask, and a balance that says otherwise would let them start an AI they "
        "cannot finish.",
    )
    issued_straw_numbers = models.JSONField(
        default=list,
        blank=True,
        help_text="Straws set aside for this indent at issue, credited on collection. Held "
        "here rather than as stock because they are not the Mait's until they collect them.",
    )
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
        """
        One row's answer to the question ``stale_indent_q`` asks of a queryset.

        Kept beside it deliberately: the two used to disagree, and a row the admin's stale
        filter returned could arrive at a screen that did not think it was stale.
        """
        from django.utils import timezone

        if self.sync_status == self.SyncStatus.FAILED:
            return True
        if self.status in (self.Status.ISSUED, self.Status.REJECTED):
            return False
        return (timezone.now() - self.requested_at).days >= STALE_AFTER_DAYS


def stale_indent_q(now=None) -> Q:
    """
    The definition of a stale indent, as something the database can answer.

    Open and untouched past the cutoff, or never pushed to Indent Easy at all. Both mean the
    same thing at the other end: a Mait asked for stock and nobody is bringing it. Whether the
    office has got as far as approving it is the office's business, not the Mait's — which is
    why an unapproved request counts here, and why the admin's queue and the Indents screen's
    own filter are the same query rather than two that nearly agree.
    """
    cutoff = (now or timezone.now()) - timedelta(days=STALE_AFTER_DAYS)
    open_and_unmoved = ~Q(
        status__in=[IndentRequest.Status.ISSUED, IndentRequest.Status.REJECTED]
    ) & Q(requested_at__lt=cutoff)
    return open_and_unmoved | Q(sync_status=IndentRequest.SyncStatus.FAILED)


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
