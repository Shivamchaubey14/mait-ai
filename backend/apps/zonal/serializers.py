"""
What a zonal manager is shown on a handset.

One shape here that exists nowhere else: an indent **awaiting a decision**, with the facts
the decision is made on. The portal's Indents screen is a list with an Approve button on it,
which works at a desk with the Inventory screen in the next tab; a manager standing in a
depot yard has one screen and needs the whole answer on it — how much this Mait is already
holding, what the depot that will serve them can actually cover, and how long the request has
been sitting. Approving blind is the failure this shape is here to prevent.

Nothing is written from here. Approve and reject stay on ``/indents/{id}/`` where the audit
trail, the state machine and the store routing already live (``apps.indents.services``) — a
second write path for the same decision is a second place for the two to disagree.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from apps.indents.models import IndentRequest
from apps.inventory.models import MaitInventory, ProductType
from apps.stores.serializers import ItemNames
from apps.stores.services import item_of


class ApprovalSerializer(serializers.ModelSerializer):
    """
    One indent waiting on this manager, and everything the decision turns on.

    Expects two things in the context, both computed once for the whole page rather than per
    row: ``shelves`` — ``{store_id: services.availability(store)}`` — and ``held``, what each
    Mait already has of each item.
    """

    mait_name = serializers.CharField(source="mait.name", read_only=True)
    mait_code = serializers.CharField(source="mait.sahayak_vendor_code", read_only=True)
    item_name = serializers.SerializerMethodField()
    item_name_hi = serializers.SerializerMethodField()
    unit = serializers.SerializerMethodField()
    store_name = serializers.SerializerMethodField()
    in_store = serializers.SerializerMethodField()
    mait_holds = serializers.SerializerMethodField()
    coverage = serializers.SerializerMethodField()
    waiting_days = serializers.SerializerMethodField()
    mpp_names = serializers.SerializerMethodField()

    class Meta:
        model = IndentRequest
        fields = [
            "id",
            "mait",
            "mait_name",
            "mait_code",
            "mpp_names",
            "product_type",
            "breed",
            "item_name",
            "item_name_hi",
            "unit",
            "qty_requested",
            "note",
            "requested_at",
            "waiting_days",
            "status",
            "store",
            "store_name",
            "in_store",
            "mait_holds",
            "coverage",
        ]
        read_only_fields = fields

    # -- the item ----------------------------------------------------------------------
    def _names(self) -> ItemNames:
        # One catalogue for the whole page. Built on first use rather than in the view, so a
        # response with no rows costs nothing.
        if "names" not in self.context:
            self.context["names"] = ItemNames()
        return self.context["names"]

    def get_item_name(self, obj) -> str:
        product_type, breed, ref = item_of(obj)
        return self._names().name(product_type, breed, ref)

    def get_item_name_hi(self, obj) -> str:
        product_type, breed, _ = item_of(obj)
        return self._names().name_hi(product_type, breed)

    def get_unit(self, obj) -> str:
        product_type, _, ref = item_of(obj)
        return self._names().unit(product_type, ref)

    def get_mpp_names(self, obj) -> list[str]:
        """Where this Mait works, so a manager can place them without opening anything."""
        return [mpp.mpp_name or mpp.mpp_code for mpp in obj.mait.mpps.all()][:4]

    # -- the two stock figures ---------------------------------------------------------
    def get_store_name(self, obj) -> str:
        return obj.store.name if obj.store_id else ""

    def get_in_store(self, obj) -> int:
        """
        What the depot that will serve this Mait can still promise.

        Available, not on hand: straws already set aside for somebody who has not collected
        them are on the shelf and are not the store's to promise twice. ``-1`` says there is
        no store, which is a different answer from a store holding nothing — the first means
        the portal's own Issue is the route, the second means somebody has to restock.
        """
        if not obj.store_id:
            return -1
        shelf = self.context.get("shelves", {}).get(obj.store_id, {})
        return shelf.get(item_of(obj), {}).get("available", 0)

    def get_mait_holds(self, obj) -> int:
        """What this Mait already has of exactly this item — the other half of the decision."""
        return self.context.get("held", {}).get((obj.mait_id, item_of(obj)), 0)

    def get_coverage(self, obj) -> str:
        """
        One word for what happens if this is approved now.

        *ready* — the depot can hand it all over; *short* — some of it; *empty* — none of it;
        *no-store* — nobody serves this Mait yet, so it will be issued from the portal.
        """
        available = self.get_in_store(obj)
        if available < 0:
            return "no-store"
        if available <= 0:
            return "empty"
        return "ready" if available >= obj.qty_requested else "short"

    def get_waiting_days(self, obj) -> int:
        return max((timezone.now() - obj.requested_at).days, 0)


def held_by_maits(mait_ids: list[int]) -> dict[tuple[int, tuple], int]:
    """
    What each Mait already holds, keyed the way ``item_of`` keys an indent.

    One query for the page. A straw balance is per batch rather than per breed, so the rows
    are summed into the breed the indent is written in — which is the number a manager is
    actually weighing the request against.
    """
    from apps.inventory.models import SemenBatch

    if not mait_ids:
        return {}

    lines = MaitInventory.objects.filter(mait_id__in=mait_ids, qty_available__gt=0)
    straw_refs = [line.product_ref_id for line in lines if line.product_type == ProductType.STRAW]
    breeds = {batch.id: batch.breed for batch in SemenBatch.objects.filter(id__in=straw_refs)}

    held: dict[tuple[int, tuple], int] = {}
    for line in lines:
        if line.product_type == ProductType.STRAW:
            key = (line.mait_id, (ProductType.STRAW, breeds.get(line.product_ref_id, ""), 0))
        else:
            key = (line.mait_id, (line.product_type, "", int(line.product_ref_id or 0)))
        held[key] = held.get(key, 0) + line.qty_available
    return held
