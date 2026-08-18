"""Inventory serializers (SRS §9.5)."""

from __future__ import annotations

from rest_framework import serializers

from .models import Consumable, MaitInventory, MaitInventoryLedger, ProductType, SemenBatch


class ConsumableSerializer(serializers.ModelSerializer):
    """One item a Mait can be issued, straws aside."""

    category_display = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Consumable
        fields = [
            "id",
            "code",
            "name",
            "category",
            "category_display",
            "unit",
            "rate",
            "display_order",
        ]
        read_only_fields = fields


class ConsumableWriteSerializer(serializers.ModelSerializer):
    """
    The admin's edit shape for the catalogue (SRS §6.6.1).

    ``code`` is what indents, uploads and the app all key on, so it is set once at creation
    and never edited: renaming it would orphan every indent already raised against it. The
    display name is the editable one — that is what the wording on both screens comes from.
    """

    class Meta:
        model = Consumable
        fields = ["id", "code", "name", "category", "unit", "rate", "display_order", "is_active"]

    def validate_code(self, value: str) -> str:
        code = (value or "").strip().upper()
        if not code:
            raise serializers.ValidationError("A code is required.")
        existing = Consumable.objects.filter(code=code)
        if self.instance is not None:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError("Another product already uses this code.")
        return code

    def update(self, instance, validated_data):
        # Silently ignored rather than rejected: the portal sends the whole object back, and
        # an unchanged code in the payload is not an attempt to rename anything.
        validated_data.pop("code", None)
        return super().update(instance, validated_data)


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
    breed_choices = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        help_text="Breeds the Mait holds as unnumbered stock. Present when `reason` is "
        "`breed_required`, so the app can ask instead of guessing.",
    )


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
    # The same straws as `by_breed`, with the species and the history alongside — what the
    # stock screen groups cow from buffalo by, and what lets a row say `issued 10 · used 8`
    # rather than a bare 2. `by_breed` is untouched because the capture flow and Home gate on
    # it, and changing a shape two screens depend on to serve a third is how those two break.
    straws = serializers.ListField(child=serializers.DictField())
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
