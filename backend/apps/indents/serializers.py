"""Indent serializers (SRS §9.8)."""

from __future__ import annotations

from rest_framework import serializers

from apps.inventory.models import Consumable

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
            "received_at",
            "note",
        ]
        read_only_fields = fields

    def _catalogue(self) -> tuple[dict[int, str], dict[str, str]]:
        """
        The catalogue by id and by code, read once per serialisation rather than once per row.

        Cached on the serializer instance, which `many=True` reuses across the whole page —
        the alternative is a query per indent, and this list is paged twenty-five at a time.
        The catalogue itself is a couple of dozen rows.
        """
        if not hasattr(self, "_products"):
            rows = list(Consumable.objects.values_list("id", "code", "name"))
            self._products = (
                {pk: name for pk, _, name in rows},
                {code: name for _, code, name in rows},
            )
        return self._products

    def get_item(self, obj) -> str:
        """
        What was asked for, in the words the Mait used when asking.

        Named, not categorised. "1 × Consumable" tells nobody whether the sheaths or the
        gloves are coming, and both the app and the admin screen show this string as the
        whole description of the request.

        The code fallback covers indents raised before the app started sending
        ``product_ref_id``: it used to put the product code in ``note`` instead, so those rows
        can still be named rather than being stuck reading "Consumable" forever.
        """
        if obj.breed:
            return f"{obj.qty_requested} {obj.breed}"

        by_id, by_code = self._catalogue()
        name = by_id.get(obj.product_ref_id) or by_code.get((obj.note or "").strip().upper())
        return f"{obj.qty_requested} × {name or obj.get_product_type_display()}"


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


class IndentRejectSerializer(serializers.Serializer):
    """A reason is optional to the API and asked for in the portal — the Mait reads it."""

    reason = serializers.CharField(max_length=200, required=False, allow_blank=True)


class IndentIssueSerializer(serializers.Serializer):
    """
    What an admin is handing over.

    Either shape works for straws. Numbers, when the depot slip lists them, and the record
    names exactly which straws moved. Or a bare quantity, when it does not: a bundle of a
    breed is handed over and the number that matters is the one printed on whichever straw
    gets used, which the Mait reads off at the AI step.
    """

    straw_numbers = serializers.ListField(
        child=serializers.CharField(max_length=30),
        required=False,
        help_text="One per straw handed over. Optional — omit to issue by quantity instead.",
    )
    qty = serializers.IntegerField(
        min_value=1,
        required=False,
        help_text="Units handed over. Defaults to the full request. Ignored when "
        "`straw_numbers` is given, since the list already says how many.",
    )
