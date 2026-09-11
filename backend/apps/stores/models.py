"""
Stores — the depots an approved indent is handed over at.

Each location has a store, and each store serves the BMC/MCCs around it. The zonal manager
approves an indent on the portal; the keeper at the Mait's store hands the stock over from
the app. Nothing arrives here from SAP — like zones, which stores serve which chilling
centres is the dairy's own decision, made on the portal's Stores screen.

A store's stock is counted apart from the Maits', in its own two tables. Mixing them into
``MaitInventory`` would have made "how many Murrah are in the flask" and "how many Murrah are
on the depot's shelf" the same query with a different filter, and the one mistake that costs a
farmer is a Mait believing the second answer is the first.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TimeStampedModel
from apps.inventory.models import ProductType


class Store(TimeStampedModel):
    """A depot, and the counter a Mait collects approved stock from."""

    code = models.CharField(
        max_length=20,
        unique=True,
        db_index=True,
        help_text="Short identifier, e.g. BARSANA. Set once — slips and saved links use it.",
    )
    name = models.CharField(max_length=100, db_index=True, help_text="e.g. Barsana depot.")
    zone = models.ForeignKey(
        "masterdata.Zone",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="stores",
        help_text="The zone it sits in, for grouping on the portal. Does not decide which "
        "Maits it serves — its BMC/MCCs do.",
    )
    description = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "store"
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} [{self.code}]"

    @property
    def plant_codes(self) -> list[str]:
        return list(self.plants.values_list("plant_code", flat=True))


class StorePlant(TimeStampedModel):
    """
    One BMC/MCC served by a store.

    The same shape as ``ZonePlant`` and for the same reason: ``plant_code`` is unique, so a
    chilling centre is served by one store. If two could serve it, a Mait there would have two
    queues holding their indent and two keepers who each think the other has it.
    """

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="plants")
    plant_code = models.CharField(max_length=10, unique=True, db_index=True)
    plant_name = models.CharField(max_length=100, blank=True)

    class Meta:
        db_table = "store_plant"
        ordering = ["plant_name"]

    def __str__(self) -> str:
        return f"{self.plant_name or self.plant_code} → {self.store.name}"


class StoreStock(TimeStampedModel):
    """
    What a store has on its shelf of one item.

    An item is a breed for straws — the depot hands over a bundle, and the number that matters
    is read off whichever straw the Mait uses — and a catalogue product for everything else.
    ``breed`` is blank for a product and ``product_ref_id`` is zero for a straw, rather than
    null, because a unique constraint over a nullable column is no constraint at all in MySQL.

    ``qty_on_hand`` is what is physically there, including stock already set aside for a Mait
    who has not collected it yet. What can still be promised is that minus the pending
    handovers — see ``apps.stores.services.availability``.
    """

    store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name="stock")
    product_type = models.CharField(max_length=12, choices=ProductType.choices)
    breed = models.CharField(max_length=30, blank=True, default="")
    product_ref_id = models.BigIntegerField(default=0)
    qty_on_hand = models.IntegerField(default=0)

    class Meta:
        db_table = "store_stock"
        constraints = [
            models.UniqueConstraint(
                fields=["store", "product_type", "breed", "product_ref_id"],
                name="uniq_store_item",
            ),
            # The same invariant a Mait's balance carries, and for the same reason: a shelf
            # cannot hold fewer than none, whatever the application code believes.
            models.CheckConstraint(
                condition=models.Q(qty_on_hand__gte=0),
                name="store_stock_never_negative",
            ),
        ]

    def __str__(self) -> str:
        label = self.breed or f"{self.product_type}#{self.product_ref_id}"
        return f"{self.store.code}: {label} × {self.qty_on_hand}"


class StoreLedger(models.Model):
    """
    Every movement on a store's shelf. Append-only, and summable to ``qty_on_hand``.

    A handover is written here when the Mait confirms collection, not when the keeper issues:
    until then the straws are still on the shelf, set aside, and a count that had already let
    them go would be wrong for as long as the Mait takes to walk back to the counter.
    """

    class TxnType(models.TextChoices):
        RECEIVE = "receive", "Received into the store"
        ISSUE = "issue", "Collected by a Mait"
        ADJUSTMENT = "adjustment", "Manual adjustment"

    stock = models.ForeignKey(StoreStock, on_delete=models.PROTECT, related_name="ledger")
    txn_type = models.CharField(max_length=12, choices=TxnType.choices, db_index=True)
    qty = models.IntegerField(help_text="Positive for receipts, negative for handovers.")
    balance_after = models.IntegerField()
    handover = models.ForeignKey(
        "indents.IndentHandover",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="store_movements",
    )
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="store_movements",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "store_ledger"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.txn_type} {self.qty:+d} → {self.balance_after}"
