"""Indent serializers (SRS §9.8)."""

from __future__ import annotations

from rest_framework import serializers

from apps.inventory.models import Consumable

from .models import IndentHandover, IndentRequest


class HandoverSummarySerializer(serializers.ModelSerializer):
    """
    One trip across a store's counter, as the Mait and the portal see it.

    Carries no code. The Mait's app is the one place the code must never reach: it is read
    aloud at the counter, and a handset that already knew it would prove nothing by typing it.
    """

    store_name = serializers.CharField(source="store.name", read_only=True)
    state = serializers.SerializerMethodField()

    class Meta:
        model = IndentHandover
        fields = ["id", "qty", "store_name", "issued_at", "collected_at", "cancelled_at", "state"]
        read_only_fields = fields

    def get_state(self, obj) -> str:
        if obj.cancelled_at:
            return "cancelled"
        return "collected" if obj.collected_at else "waiting"


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
    store_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    approved_by_zone = serializers.SerializerMethodField()
    qty_open = serializers.IntegerField(read_only=True)
    qty_to_collect = serializers.SerializerMethodField()
    needs_code = serializers.SerializerMethodField()
    handovers = serializers.SerializerMethodField()

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
            "store",
            "store_name",
            "approved_at",
            "approved_by_name",
            "approved_by_zone",
            "qty_open",
            "qty_to_collect",
            "needs_code",
            "handovers",
        ]
        read_only_fields = fields

    # -- stores ------------------------------------------------------------------------------
    #
    # Read off `handovers.all()` rather than filtered querysets, so a list view that prefetched
    # them answers every row from one query.

    def _handovers(self, obj) -> list[IndentHandover]:
        return [h for h in obj.handovers.all() if h.cancelled_at is None]

    def _waiting(self, obj) -> list[IndentHandover]:
        return [h for h in self._handovers(obj) if h.collected_at is None]

    def get_store_name(self, obj) -> str:
        return obj.store.name if obj.store_id else ""

    def get_approved_by_name(self, obj) -> str:
        return obj.approved_by.full_name if obj.approved_by_id else ""

    def get_approved_by_zone(self, obj) -> str:
        """
        The approver's zone, for "approved by the zonal manager, Mathura".

        The first of them, because a line on a handset has room for one — and an approver
        holding several is head office, who is better described by name than by region.
        """
        if not obj.approved_by_id:
            return ""
        zones = [zone.name for zone in obj.approved_by.zones.all() if zone.is_active]
        return zones[0] if len(zones) == 1 else ""

    def get_qty_to_collect(self, obj) -> int:
        """
        What is at a counter with the Mait's name on it right now.

        Handed over at a store and not yet confirmed; or, for an indent the portal issued, the
        whole issue until it is confirmed. This is the number the app's *Confirm collection*
        is about, and it is not the same as `qty_issued` once an indent has been issued twice.
        """
        handovers = self._handovers(obj)
        if handovers:
            return sum(h.qty for h in handovers if h.collected_at is None)
        if obj.status == IndentRequest.Status.ISSUED and not obj.received_at:
            return obj.qty_issued
        return 0

    def get_needs_code(self, obj) -> bool:
        """Whether collecting needs the code a store keeper reads out — every store handover."""
        return bool(self._waiting(obj))

    def get_handovers(self, obj) -> list[dict]:
        return HandoverSummarySerializer(self._handovers(obj), many=True).data

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


class IndentCollectSerializer(serializers.Serializer):
    """The code a store keeper read out. Not needed for stock the portal issued."""

    code = serializers.CharField(max_length=8, required=False, allow_blank=True)


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
