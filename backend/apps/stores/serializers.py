"""Store serializers — the keeper's app and the portal's Stores screen."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.models import Role, User, mobile_validator
from apps.animals.models import BreedConfig
from apps.indents.models import IndentHandover, IndentRequest
from apps.inventory.models import Consumable, ProductType
from apps.masterdata.models import MPP, Mait

from .models import Store, StorePlant
from .services import availability, item_of


class ItemNames:
    """
    What an item is called, read once per response.

    Breeds by their catalogue name rather than their code — the keeper reads "Murrah", not
    "MURRAH" — and products by name and unit. One query each for the whole response.
    """

    def __init__(self):
        self.breeds = {
            code: (name, name_hi)
            for code, name, name_hi in BreedConfig.objects.values_list("code", "name", "name_hi")
        }
        self.products = {
            pk: (name, unit)
            for pk, name, unit in Consumable.objects.values_list("id", "name", "unit")
        }

    def name(self, product_type: str, breed: str, ref: int) -> str:
        if product_type == ProductType.STRAW:
            return self.breeds.get(breed, (breed.title(), ""))[0]
        return self.products.get(int(ref or 0), ("Unnamed product", ""))[0]

    def name_hi(self, product_type: str, breed: str) -> str:
        if product_type == ProductType.STRAW:
            return self.breeds.get(breed, ("", ""))[1]
        return ""

    def unit(self, product_type: str, ref: int) -> str:
        if product_type == ProductType.STRAW:
            return "straw"
        return self.products.get(int(ref or 0), ("", "piece"))[1]


def _names(context) -> ItemNames:
    if "names" not in context:
        context["names"] = ItemNames()
    return context["names"]


# --------------------------------------------------------------------------------------
# The keeper's app
# --------------------------------------------------------------------------------------
class StoreIndentSerializer(serializers.ModelSerializer):
    """
    One indent in a store's queue, with what the shelf can do about it.

    ``readiness`` is the word on the row: *ready* when the shelf covers what is still owed,
    *short* when it covers some, *waiting* when it covers none. The count behind it is what
    can still be promised — on hand, less what is already set aside for other Maits.

    Expects ``shelf`` in the context (``services.availability``), computed once for the whole
    queue rather than per row.
    """

    mait_name = serializers.CharField(source="mait.name", read_only=True)
    mait_code = serializers.CharField(source="mait.sahayak_vendor_code", read_only=True)
    item_name = serializers.SerializerMethodField()
    item_name_hi = serializers.SerializerMethodField()
    unit = serializers.SerializerMethodField()
    qty_open = serializers.IntegerField(read_only=True)
    in_store = serializers.SerializerMethodField()
    readiness = serializers.SerializerMethodField()
    short_by = serializers.SerializerMethodField()
    waiting_days = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    approved_by_zone = serializers.SerializerMethodField()
    waiting_handovers = serializers.SerializerMethodField()

    class Meta:
        model = IndentRequest
        fields = [
            "id",
            "mait_name",
            "mait_code",
            "product_type",
            "breed",
            "product_ref_id",
            "item_name",
            "item_name_hi",
            "unit",
            "qty_requested",
            "qty_issued",
            "qty_open",
            "in_store",
            "readiness",
            "short_by",
            "waiting_days",
            "requested_at",
            "approved_at",
            "approved_by_name",
            "approved_by_zone",
            "note",
            "waiting_handovers",
        ]
        read_only_fields = fields

    def get_waiting_handovers(self, obj) -> list[dict]:
        """
        What already went over the counter against this indent and is still waiting on a code.

        With the code, because this is the keeper's own view and the code is theirs to read
        out again. A Mait who loses it comes back to the counter; the keeper opens the indent
        and it is there, rather than on one screen that closed the moment they moved on.
        Read off the prefetched handovers, so the queue answers every row from one query.
        """
        return [
            {
                "id": handover.id,
                "qty": handover.qty,
                "collection_code": handover.collection_code,
                "issued_at": handover.issued_at,
                "locked": handover.is_locked,
            }
            for handover in obj.handovers.all()
            if handover.is_pending
        ]

    def _item(self, obj):
        return item_of(obj)

    def get_item_name(self, obj) -> str:
        product_type, breed, ref = self._item(obj)
        return _names(self.context).name(product_type, breed, ref)

    def get_item_name_hi(self, obj) -> str:
        product_type, breed, _ = self._item(obj)
        return _names(self.context).name_hi(product_type, breed)

    def get_unit(self, obj) -> str:
        product_type, _, ref = self._item(obj)
        return _names(self.context).unit(product_type, ref)

    def get_in_store(self, obj) -> int:
        return self.context["shelf"].get(self._item(obj), {}).get("available", 0)

    def get_readiness(self, obj) -> str:
        available = self.get_in_store(obj)
        if available <= 0:
            return "waiting"
        return "ready" if available >= obj.qty_open else "short"

    def get_short_by(self, obj) -> int:
        return max(obj.qty_open - self.get_in_store(obj), 0)

    def get_waiting_days(self, obj) -> int:
        """Days since the zonal manager agreed to it — how long the Mait has been waiting on us."""
        since = obj.approved_at or obj.requested_at
        return max((timezone.now() - since).days, 0)

    def get_approved_by_name(self, obj) -> str:
        return obj.approved_by.full_name if obj.approved_by_id else ""

    def get_approved_by_zone(self, obj) -> str:
        if not obj.approved_by_id:
            return ""
        zones = [zone.name for zone in obj.approved_by.zones.all() if zone.is_active]
        return zones[0] if len(zones) == 1 else ""


class StoreHandoverSerializer(serializers.ModelSerializer):
    """
    A handover as the keeper sees it — with the code, which is theirs to read aloud.

    ``qty_open`` is what is still owed on the indent after this, for the line that says the
    rest stays open.
    """

    indent_id = serializers.IntegerField(source="indent.id", read_only=True)
    mait_name = serializers.CharField(source="indent.mait.name", read_only=True)
    product_type = serializers.CharField(source="indent.product_type", read_only=True)
    breed = serializers.CharField(source="indent.breed", read_only=True)
    item_name = serializers.SerializerMethodField()
    item_name_hi = serializers.SerializerMethodField()
    qty_requested = serializers.IntegerField(source="indent.qty_requested", read_only=True)
    qty_open = serializers.IntegerField(source="indent.qty_open", read_only=True)
    state = serializers.SerializerMethodField()
    locked = serializers.BooleanField(source="is_locked", read_only=True)

    class Meta:
        model = IndentHandover
        fields = [
            "id",
            "indent_id",
            "mait_name",
            "product_type",
            "breed",
            "item_name",
            "item_name_hi",
            "qty",
            "qty_requested",
            "qty_open",
            "collection_code",
            "flask_checked",
            "issued_at",
            "collected_at",
            "cancelled_at",
            "state",
            "locked",
        ]
        read_only_fields = fields

    def get_item_name(self, obj) -> str:
        product_type, breed, ref = item_of(obj.indent)
        return _names(self.context).name(product_type, breed, ref)

    def get_item_name_hi(self, obj) -> str:
        product_type, breed, _ = item_of(obj.indent)
        return _names(self.context).name_hi(product_type, breed)

    def get_state(self, obj) -> str:
        if obj.cancelled_at:
            return "cancelled"
        return "collected" if obj.collected_at else "waiting"


class IssueSerializer(serializers.Serializer):
    qty = serializers.IntegerField(min_value=1)
    flask_checked = serializers.BooleanField(required=False, default=False)


class ReceiveSerializer(serializers.Serializer):
    """A delivery landing at the store. Straws by breed, everything else by catalogue id."""

    product_type = serializers.ChoiceField(choices=ProductType.choices)
    breed = serializers.CharField(max_length=30, required=False, allow_blank=True)
    product_ref_id = serializers.IntegerField(required=False, allow_null=True)
    qty = serializers.IntegerField(min_value=1, max_value=100000)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["product_type"] == ProductType.STRAW:
            breed = (attrs.get("breed") or "").strip().upper()
            if not BreedConfig.objects.filter(code=breed).exists():
                raise serializers.ValidationError({"breed": ["Pick a breed from the list."]})
            attrs["breed"] = breed
            attrs["product_ref_id"] = 0
        else:
            ref = attrs.get("product_ref_id")
            if not ref or not Consumable.objects.filter(pk=ref).exists():
                raise serializers.ValidationError(
                    {"product_ref_id": ["Pick a product from the list."]}
                )
            attrs["breed"] = ""
        return attrs


def stock_lines(store: Store, names: ItemNames | None = None) -> list[dict]:
    """
    The shelf, one line per item: on hand, set aside for a Mait, and free to promise.

    Sorted straws first and then by name, which is the order the keeper counts a delivery in.
    An item with nothing on hand and nothing set aside is left off — a list of zeros for every
    breed in the catalogue buries the three the store actually carries.
    """
    names = names or ItemNames()
    lines = []
    for (product_type, breed, ref), count in availability(store).items():
        if not count["on_hand"] and not count["set_aside"]:
            continue
        lines.append(
            {
                "product_type": product_type,
                "breed": breed,
                "product_ref_id": ref or None,
                "item_name": names.name(product_type, breed, ref),
                "item_name_hi": names.name_hi(product_type, breed),
                "unit": names.unit(product_type, ref),
                **count,
            }
        )
    lines.sort(key=lambda line: (line["product_type"] != ProductType.STRAW, line["item_name"]))
    return lines


# --------------------------------------------------------------------------------------
# The portal's Stores screen
# --------------------------------------------------------------------------------------
class KeeperSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "full_name", "mobile_no", "is_active", "last_login_at"]
        read_only_fields = fields


class AddKeeperSerializer(serializers.Serializer):
    """
    A store keeper's account, made from a name and the number they sign in with.

    The number has to be free. Sign-in looks an account up by its mobile number, and a keeper
    sharing one with a Mait — or with another keeper — would sign in as whichever the lookup
    happened to find first.
    """

    full_name = serializers.CharField(max_length=150)
    mobile_no = serializers.CharField(validators=[mobile_validator])

    def validate_full_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give their name.")
        return value

    def validate_mobile_no(self, value):
        value = value.strip()
        if Mait.objects.filter(mobile_no=value, is_active=True).exists():
            raise serializers.ValidationError(
                "A Mait signs in with this number. A keeper needs a number of their own."
            )
        clash = User.objects.filter(mobile_no=value, is_active=True).first()
        if clash is not None:
            where = f" at {clash.store.name}" if clash.store_id else ""
            raise serializers.ValidationError(
                f"{clash.full_name}{where} already signs in with this number."
            )
        return value


class StoreAdminSerializer(serializers.ModelSerializer):
    """
    A store, the BMC/MCCs it serves, and who works its counter.

    ``plants`` is the whole set on write, as it is for a zone: sending three codes to a store
    that had five removes the other two, so unticking a box and saving does what it looks like.
    """

    plants = serializers.ListField(
        child=serializers.CharField(max_length=10),
        required=False,
        allow_empty=True,
        write_only=True,
    )
    zone_name = serializers.SerializerMethodField()
    plant_names = serializers.SerializerMethodField()
    keepers = serializers.SerializerMethodField()
    stock = serializers.SerializerMethodField()
    open_indents = serializers.SerializerMethodField()
    mpp_count = serializers.SerializerMethodField()

    class Meta:
        model = Store
        fields = [
            "id",
            "code",
            "name",
            "zone",
            "zone_name",
            "description",
            "is_active",
            "plants",
            "plant_names",
            "mpp_count",
            "keepers",
            "stock",
            "open_indents",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["plants"] = instance.plant_codes
        return data

    def get_zone_name(self, store) -> str:
        return store.zone.name if store.zone_id else ""

    def get_plant_names(self, store) -> list[str]:
        return [p.plant_name or p.plant_code for p in store.plants.all()]

    def get_mpp_count(self, store) -> int:
        codes = store.plant_codes
        return MPP.objects.filter(plant_code__in=codes).count() if codes else 0

    def get_keepers(self, store) -> list[dict]:
        people = store.keepers.filter(role=Role.STORE).order_by("-is_active", "full_name")
        return KeeperSerializer(people, many=True).data

    def get_stock(self, store) -> list[dict]:
        return [
            {"item_name": line["item_name"], "on_hand": line["on_hand"]}
            for line in stock_lines(store, _names(self.context))
        ]

    def get_open_indents(self, store) -> int:
        from .services import open_indents

        return open_indents(store).count()

    def validate_code(self, value):
        return value.strip().upper()

    def validate_plants(self, value):
        """Refuse a BMC/MCC another store already serves, by name — the zone screen's rule."""
        codes = [code.strip() for code in value if code and code.strip()]
        if len(codes) != len(set(codes)):
            raise serializers.ValidationError("The same BMC/MCC is listed twice.")

        known = set(
            MPP.objects.filter(plant_code__in=codes).values_list("plant_code", flat=True).distinct()
        )
        unknown = [code for code in codes if code not in known]
        if unknown:
            raise serializers.ValidationError(
                "No BMC/MCC in the master data has the code "
                + ", ".join(sorted(unknown))
                + ". They arrive with the SAP upload; a code typed by hand will never match."
            )

        mine = self.instance.pk if self.instance else None
        clashes = [
            row
            for row in StorePlant.objects.filter(plant_code__in=codes).select_related("store")
            if row.store_id != mine
        ]
        if clashes:
            raise serializers.ValidationError(
                "; ".join(
                    f"{row.plant_name or row.plant_code} is served by {row.store.name}"
                    for row in clashes
                )
                + ". A BMC/MCC collects from one store — take it off that one first."
            )
        return codes

    def _write_plants(self, store, codes):
        names = {
            row["plant_code"]: row["plant_name"]
            for row in MPP.objects.filter(plant_code__in=codes).values("plant_code", "plant_name")
        }
        store.plants.exclude(plant_code__in=codes).delete()
        held = set(store.plants.values_list("plant_code", flat=True))
        StorePlant.objects.bulk_create(
            [
                StorePlant(store=store, plant_code=code, plant_name=names.get(code, ""))
                for code in codes
                if code not in held
            ]
        )

    @transaction.atomic
    def create(self, validated_data):
        codes = validated_data.pop("plants", [])
        store = Store.objects.create(**validated_data)
        self._write_plants(store, codes)
        return store

    @transaction.atomic
    def update(self, instance, validated_data):
        codes = validated_data.pop("plants", None)
        validated_data.pop("code", None)  # set once: slips and saved links carry it
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if codes is not None:
            self._write_plants(instance, codes)
        return instance
