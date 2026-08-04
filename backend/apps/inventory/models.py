"""
Semen batches, Mait stock and the immutable movement ledger (SRS §8.2).

This app owns the invariant the whole platform rests on: a Mait cannot consume a straw they
do not hold. The guarantee is structural, not procedural — see ADR 0002 and
``apps/inventory/services.py``.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TimeStampedModel


class ProductType(models.TextChoices):
    STRAW = "straw", "Semen straw"
    CONSUMABLE = "consumable", "Consumable"


class SemenBatch(TimeStampedModel):
    """
    A single-use frozen semen straw, identified by the unique number printed on it
    (SRS §8.2 `semen_batch`).

    One row per straw, not per batch, despite the SAP-facing name: uniqueness and
    consumption are tracked per physical straw (SRS §6.3 step 4).
    """

    unique_straw_no = models.CharField(max_length=30, unique=True, db_index=True)
    breed = models.CharField(max_length=30, db_index=True)
    bull_id = models.CharField(max_length=30, blank=True)
    semen_station = models.CharField(max_length=100, blank=True)
    received_date = models.DateField(null=True, blank=True)
    is_consumed = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Set when an AI event completes against this straw. Never reset.",
    )

    class Meta:
        db_table = "semen_batch"
        ordering = ["-received_date", "unique_straw_no"]
        indexes = [
            models.Index(fields=["breed", "is_consumed"], name="straw_breed_consumed_idx"),
        ]

    def __str__(self) -> str:
        return self.unique_straw_no


class Consumable(TimeStampedModel):
    """Gloves, sheaths, liquid nitrogen and similar (SRS §6.6.1)."""

    code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=100)
    unit = models.CharField(max_length=20, default="piece")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "consumable"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class MaitInventory(TimeStampedModel):
    """
    A Mait's current balance of one product (SRS §8.2 `mait_inventory`).

    ``qty_available`` is the number the whole inventory gate depends on. The check
    constraint below is the last line of defence: even if application logic is wrong, the
    database refuses to let stock go negative (ADR 0002).
    """

    mait = models.ForeignKey("masterdata.Mait", on_delete=models.PROTECT, related_name="inventory")
    product_type = models.CharField(max_length=12, choices=ProductType.choices)
    product_ref_id = models.BigIntegerField(
        help_text="SemenBatch.id for straws, Consumable.id for consumables."
    )
    qty_available = models.IntegerField(default=0)

    class Meta:
        db_table = "mait_inventory"
        verbose_name_plural = "Mait inventory"
        constraints = [
            models.UniqueConstraint(
                fields=["mait", "product_type", "product_ref_id"],
                name="uniq_mait_product_balance",
            ),
            # The invariant, in the schema. Not advisory.
            models.CheckConstraint(
                condition=models.Q(qty_available__gte=0),
                name="inventory_qty_never_negative",
            ),
        ]
        indexes = [
            models.Index(fields=["mait", "product_type"], name="inventory_mait_type_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.mait.name}: {self.product_type}#{self.product_ref_id} × {self.qty_available}"


class MaitInventoryLedger(models.Model):
    """
    Immutable movement log (SRS §8.2 `mait_inventory_ledger`).

    Append-only. The balance in ``MaitInventory`` is a materialised convenience; this table
    is the truth, and summing it must always reproduce the balance. Any divergence is a bug
    worth alerting on.
    """

    class TxnType(models.TextChoices):
        ISSUE = "issue", "Issued to Mait"
        CONSUME = "consume", "Consumed by AI event"
        RETURN = "return", "Returned to store"
        ADJUSTMENT = "adjustment", "Manual adjustment"

    class RefType(models.TextChoices):
        INDENT = "indent", "Indent"
        AI_EVENT = "ai_event", "AI event"
        MANUAL = "manual", "Manual adjustment"

    inventory = models.ForeignKey(
        MaitInventory, on_delete=models.PROTECT, related_name="ledger_entries"
    )
    txn_type = models.CharField(max_length=12, choices=TxnType.choices, db_index=True)
    qty = models.IntegerField(help_text="Positive for credits, negative for debits.")
    balance_after = models.IntegerField(
        help_text="Balance immediately after this movement — makes the ledger auditable "
        "without replaying every prior row."
    )
    ref_type = models.CharField(max_length=12, choices=RefType.choices)
    ref_id = models.BigIntegerField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="inventory_movements",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "mait_inventory_ledger"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["inventory", "-created_at"], name="ledger_inv_time_idx"),
            models.Index(fields=["ref_type", "ref_id"], name="ledger_ref_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.txn_type} {self.qty:+d} → {self.balance_after}"
