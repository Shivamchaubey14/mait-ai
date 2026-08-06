"""Inventory serializers (SRS §9.5)."""

from __future__ import annotations

from rest_framework import serializers

from .models import Consumable, MaitInventory, MaitInventoryLedger, ProductType, SemenBatch


class ConsumableSerializer(serializers.ModelSerializer):
    """One item a Mait can be issued, straws aside."""

    category_display = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Consumable
        fields = ["id", "code", "name", "category", "category_display", "unit", "display_order"]
        read_only_fields = fields


class SemenBatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = SemenBatch
        fields = ["id", "unique_straw_no", "breed", "bull_id", "semen_station", "received_date"]
        read_only_fields = fields


class StrawValidationSerializer(serializers.Serializer):
    """
    The answer to a scan (SRS §6.3 step 4).

    ``reason`` is a stable machine-readable code, not a message. The app branches on it to
    tell the Mait what to actually do — "raise an indent" and "report this straw" are
    different actions, and a translated sentence cannot be branched on.
    """

    valid = serializers.BooleanField()
    reason = serializers.CharField(allow_null=True)
    straw = SemenBatchSerializer(allow_null=True)
    available_straws = serializers.IntegerField()


class MaitInventorySerializer(serializers.ModelSerializer):
    """One product line in a Mait's stock."""

    product_type_display = serializers.CharField(source="get_product_type_display", read_only=True)
    straw_unique_no = serializers.SerializerMethodField()
    breed = serializers.SerializerMethodField()

    class Meta:
        model = MaitInventory
        fields = [
            "id",
            "product_type",
            "product_type_display",
            "product_ref_id",
            "straw_unique_no",
            "breed",
            "qty_available",
            "updated_at",
        ]
        read_only_fields = fields

    def _batch(self, obj):
        """Resolved from a map built once by the view, not a query per row."""
        if obj.product_type != ProductType.STRAW:
            return None
        return self.context.get("batches", {}).get(obj.product_ref_id)

    def get_straw_unique_no(self, obj) -> str | None:
        batch = self._batch(obj)
        return batch.unique_straw_no if batch else None

    def get_breed(self, obj) -> str | None:
        batch = self._batch(obj)
        return batch.breed if batch else None


class InventorySummarySerializer(serializers.Serializer):
    """
    What the app actually gates on (SRS §6.4.1).

    ``total_straws`` is the number that decides whether a Mait can start another AI at all,
    so it is returned as a single figure rather than left to the client to add up — a client
    that sums a paginated list will eventually sum the wrong page.
    """

    total_straws = serializers.IntegerField()
    is_low_stock = serializers.BooleanField()
    by_breed = serializers.DictField(child=serializers.IntegerField())
    # Split apart: what runs out and gets reordered, and what is issued once and kept.
    consumables = serializers.ListField(child=serializers.DictField())
    assets = serializers.ListField(child=serializers.DictField())


class LedgerEntrySerializer(serializers.ModelSerializer):
    """A movement in the immutable stock ledger (SRS §9.5)."""

    txn_type_display = serializers.CharField(source="get_txn_type_display", read_only=True)
    product_type = serializers.CharField(source="inventory.product_type", read_only=True)

    class Meta:
        model = MaitInventoryLedger
        fields = [
            "id",
            "txn_type",
            "txn_type_display",
            "qty",
            "balance_after",
            "ref_type",
            "ref_id",
            "product_type",
            "note",
            "created_at",
        ]
        read_only_fields = fields
