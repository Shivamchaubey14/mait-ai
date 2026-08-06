"""Indent serializers (SRS §9.8)."""

from __future__ import annotations

from rest_framework import serializers

from .models import IndentRequest


class IndentSerializer(serializers.ModelSerializer):
    """
    Read shape for an indent.

    Carries both statuses because they answer different questions and routinely disagree:
    ``status`` is where the request has got to in Indent Easy, ``sync_status`` is whether
    Indent Easy has even heard about it. An indent approved a week ago that never synced is
    the failure mode the admin screen exists to catch — it looks fine on one field and is
    stuck on the other.
    """

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    sync_status_display = serializers.CharField(source="get_sync_status_display", read_only=True)
    mait_name = serializers.CharField(source="mait.name", read_only=True)
    mait_code = serializers.CharField(source="mait.sahayak_vendor_code", read_only=True)
    item = serializers.SerializerMethodField()

    class Meta:
        model = IndentRequest
        fields = [
            "id",
            "mait",
            "mait_name",
            "mait_code",
            "product_type",
            "breed",
            "item",
            "qty_requested",
            "qty_issued",
            "status",
            "status_display",
            "sync_status",
            "sync_status_display",
            "sync_attempts",
            "last_sync_error",
            "indent_easy_ref_no",
            "requested_at",
            "issued_at",
            "note",
        ]
        read_only_fields = fields

    def get_item(self, obj) -> str:
        """What was asked for, in the words the admin screen shows."""
        if obj.breed:
            return f"{obj.qty_requested} {obj.breed}"
        return f"{obj.qty_requested} × {obj.get_product_type_display()}"


class IndentCreateSerializer(serializers.Serializer):
    """
    A Mait raising a request from the app (SRS §6.6.1).

    Straws are requested by breed rather than by straw number: which physical straws get
    issued is decided at the depot, not by the Mait asking.
    """

    product_type = serializers.CharField(max_length=12)
    breed = serializers.CharField(max_length=30, required=False, allow_blank=True)
    product_ref_id = serializers.IntegerField(required=False, allow_null=True)
    qty_requested = serializers.IntegerField(min_value=1)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["product_type"] == "straw" and not (attrs.get("breed") or "").strip():
            raise serializers.ValidationError({"breed": "A straw request must name a breed."})
        return attrs
