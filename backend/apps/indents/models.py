"""Stock requests and the counter they are handed over at (SRS §8.2 `indent_request`)."""

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

    Fulfilment happens here, at a counter: the zonal manager approves on the portal, the store
    keeper hands the stock over from their app and reads the Mait a code, and the Mait typing
    that code moves the stock. It used to be pushed out to Indent Easy, a separate web
    application, and credited back on a GRN webhook; that was dropped on 2026-09-18 when the
    store keeper's app replaced it, and nothing here talks to it any more.
    """

    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        APPROVED = "approved", "Approved"
        ISSUED = "issued", "Issued"
        REJECTED = "rejected", "Rejected"

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

    store = models.ForeignKey(
        "stores.Store",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="indents",
        help_text="The depot that hands this over. Worked out from the Mait's BMC/MCCs when "
        "the indent is raised or approved; empty where no store serves them yet, which leaves "
        "the portal's own Issue as the way out.",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_indents",
        help_text="Who agreed to it — the zonal manager, normally. The store keeper reads "
        "this before handing anything over.",
    )

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
        ]

    def __str__(self) -> str:
        label = self.breed or f"{self.product_type}#{self.product_ref_id}"
        return f"Indent #{self.pk} {label} ×{self.qty_requested} [{self.status}]"

    @property
    def is_fulfilled(self) -> bool:
        return self.status == self.Status.ISSUED and self.qty_issued > 0

    @property
    def qty_open(self) -> int:
        """
        What the approval still owes: approved and not yet handed over.

        Only an approved indent owes anything. A request nobody has agreed to owes nothing yet,
        and one that was rejected or fully issued is closed.
        """
        if self.status != self.Status.APPROVED:
            return 0
        return max(self.qty_requested - self.qty_issued, 0)

    @property
    def is_stale(self) -> bool:
        """
        One row's answer to the question ``stale_indent_q`` asks of a queryset.

        Kept beside it deliberately: the two used to disagree, and a row the admin's stale
        filter returned could arrive at a screen that did not think it was stale.
        """
        from django.utils import timezone

        if self.status in (self.Status.ISSUED, self.Status.REJECTED):
            return False
        return (timezone.now() - self.requested_at).days >= STALE_AFTER_DAYS


def stale_indent_q(now=None) -> Q:
    """
    The definition of a stale indent, as something the database can answer.

    Open and untouched past the cutoff: a Mait asked for stock and nobody is bringing it.
    Whether the office has got as far as approving it is the office's business, not the
    Mait's — which is why an unapproved request counts here, and why the admin's queue and the
    Indents screen's own filter are the same query rather than two that nearly agree.

    A second arm used to sit here — anything that failed to push to Indent Easy — which went
    with that integration on 2026-09-18.
    """
    cutoff = (now or timezone.now()) - timedelta(days=STALE_AFTER_DAYS)
    return ~Q(status__in=[IndentRequest.Status.ISSUED, IndentRequest.Status.REJECTED]) & Q(
        requested_at__lt=cutoff
    )


class IndentHandover(TimeStampedModel):
    """
    One trip across a store's counter: this much of an indent, handed to the Mait.

    An indent can take several. The store has 18 Murrah and the approval is for 25, so 18 go
    today and the other 7 stay open on the same indent — the Mait does not raise it again, and
    the next batch into the depot is issued against it.

    **Issued is not collected.** The keeper issuing sets the stock aside on the shelf and reads
    the Mait a four-digit code; the Mait typing that code into the app is what moves the stock
    into their balance and off the store's. The code is what the handover proves: that the Mait
    was standing at this counter when it happened, rather than confirming from a village that
    something probably arrived. If they walk off without typing it, the handover stays open and
    the depot still holds the count.
    """

    CODE_LENGTH = 4
    MAX_CODE_ATTEMPTS = 5

    indent = models.ForeignKey(IndentRequest, on_delete=models.PROTECT, related_name="handovers")
    store = models.ForeignKey("stores.Store", on_delete=models.PROTECT, related_name="handovers")
    qty = models.PositiveIntegerField()
    collection_code = models.CharField(
        max_length=8,
        help_text="Read aloud by the keeper and typed in by the Mait. Never sent to the Mait's "
        "app — a code the handset already knows proves nothing.",
    )
    code_attempts = models.PositiveSmallIntegerField(default=0)
    flask_checked = models.BooleanField(
        default=False,
        help_text="The keeper checked the flask's temperature before straws left the store.",
    )
    issued_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="handovers_issued",
    )
    issued_at = models.DateTimeField(auto_now_add=True, db_index=True)
    collected_at = models.DateTimeField(null=True, blank=True, db_index=True)
    cancelled_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="The Mait never collected it and the keeper put the stock back. The quantity "
        "goes back to being open on the indent.",
    )

    class Meta:
        db_table = "indent_handover"
        ordering = ["-issued_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(qty__gt=0), name="handover_qty_positive"),
        ]
        indexes = [
            models.Index(fields=["store", "-issued_at"], name="handover_store_time_idx"),
        ]

    def __str__(self) -> str:
        return f"IND-{self.indent_id} × {self.qty} at {self.store_id}"

    @property
    def is_pending(self) -> bool:
        return self.collected_at is None and self.cancelled_at is None

    @property
    def is_locked(self) -> bool:
        return self.code_attempts >= self.MAX_CODE_ATTEMPTS
