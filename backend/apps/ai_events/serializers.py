"""
AI event serializers (SRS §9.6, §11).

The write shape carries intent only — which MPP, which farmer, which animal, which straw.
Status is never accepted from the client: it is decided by the state machine in
``services.py``, which is what makes the flow impossible to skip or backdate from a
compromised app.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.animals.models import Animal
from apps.masterdata.models import MPP, Member, NonMember
from apps.payments.models import Payment

from .models import AIEvent, AIEventTimeline

# A phone camera at a sensible quality lands well under this. The ceiling exists because the
# upload happens on a village connection: a 20 MB photo is a Mait standing in a field
# watching a progress bar that will not finish.
MAX_PHOTO_BYTES = 8 * 1024 * 1024


class PaymentSummarySerializer(serializers.ModelSerializer):
    """Just enough payment to read an AI event row without opening it."""

    mode_display = serializers.CharField(source="get_mode_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    is_verified = serializers.BooleanField(read_only=True)

    class Meta:
        model = Payment
        fields = ["amount", "mode", "mode_display", "status", "status_display", "is_verified"]
        read_only_fields = fields


class AIEventTimelineSerializer(serializers.ModelSerializer):
    """One step of the audit trail, served by ``GET /ai-events/{id}/timeline/``."""

    actor_name = serializers.CharField(source="actor.full_name", read_only=True, default="")

    class Meta:
        model = AIEventTimeline
        fields = ["id", "from_status", "to_status", "note", "actor_name", "created_at"]
        read_only_fields = fields


class AIEventSerializer(serializers.ModelSerializer):
    """
    Read shape for an AI event.

    Names are denormalised into the response because the app renders this list offline from
    its own cache — a row that only carried foreign keys would show blanks with no signal.
    """

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mpp_code = serializers.CharField(source="mpp.mpp_code", read_only=True)
    mpp_name = serializers.CharField(source="mpp.mpp_name", read_only=True)
    # The admin list is a table of who did what: an event row without the Mait on it cannot
    # be read without opening every one of 31,000 rows.
    mait_name = serializers.CharField(source="mait.name", read_only=True)
    mait_code = serializers.CharField(source="mait.sahayak_vendor_code", read_only=True)
    payment = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    animal_type = serializers.CharField(source="animal.animal_type", read_only=True)
    breed = serializers.CharField(source="animal.breed", read_only=True)
    ear_tag_no = serializers.CharField(source="animal.ear_tag_no", read_only=True)

    class Meta:
        model = AIEvent
        fields = [
            "id",
            "client_uuid",
            "status",
            "status_display",
            "mpp",
            "mpp_code",
            "mpp_name",
            "mait",
            "mait_name",
            "mait_code",
            "payment",
            "owner_type",
            "member",
            "non_member",
            "owner_name",
            "animal",
            "animal_type",
            "breed",
            "ear_tag_no",
            "straw_unique_no",
            "ai_photo_url",
            "gps_lat",
            "gps_lng",
            "performed_at",
            "completed_at",
            "cancelled_reason",
            "created_at",
        ]
        read_only_fields = fields

    def get_owner_name(self, obj) -> str:
        owner = obj.owner
        return getattr(owner, "member_name", None) or getattr(owner, "name", "")

    @extend_schema_field(PaymentSummarySerializer(allow_null=True))
    def get_payment(self, obj):
        """
        Enough of the payment to render a row and decide whether it needs chasing.

        Null until the Mait reaches step 6, which is normal rather than missing — an event in
        `straw_verified` has no payment yet and the portal should say so, not show a blank.
        """
        payment = getattr(obj, "payment", None)
        if payment is None:
            return None
        return PaymentSummarySerializer(payment).data


class AIEventPhotoSerializer(serializers.Serializer):
    """
    The proof photo and where and when it was taken (SRS §6.3 step 5).

    ``performed_at`` comes from the device, not the server clock. An event captured offline
    may not reach us for hours, and the report has to show when the insemination actually
    happened — a server timestamp would quietly move every offline event to whenever the
    Mait next found signal.

    GPS is required. The photo alone proves an animal was photographed; the pin is what ties
    it to the village it was billed to.
    """

    photo = serializers.ImageField()
    gps_lat = serializers.DecimalField(max_digits=10, decimal_places=7)
    gps_lng = serializers.DecimalField(max_digits=10, decimal_places=7)
    performed_at = serializers.DateTimeField(required=False)

    def validate_photo(self, value):
        if value.size > MAX_PHOTO_BYTES:
            raise serializers.ValidationError(
                f"The photo is {value.size // 1024 // 1024} MB. "
                f"Keep it under {MAX_PHOTO_BYTES // 1024 // 1024} MB."
            )
        return value

    def validate_performed_at(self, value):
        # A device clock can be wrong, and an event stamped in the future would sort ahead of
        # everything real. Trusting it forward is the only direction that corrupts a report.
        if value > timezone.now() + timedelta(minutes=5):
            raise serializers.ValidationError(
                "This is stamped in the future. Check the phone's date and time."
            )
        return value


class AIEventCreateSerializer(serializers.Serializer):
    """
    Start a capture (SRS §6.3 steps 1–4).

    ``client_uuid`` is generated on the device before the first sync attempt, so an event
    queued offline keeps one identity across however many retries it takes to land
    (ADR 0003). It is required rather than optional: an event that reaches the server without
    one cannot be de-duplicated afterwards, and by then the damage is a double insemination
    record.

    ``straw_unique_no`` is optional. Supplied, the event is validated against stock and lands
    in ``straw_verified``; omitted, it stays a ``draft`` the Mait can come back to.
    """

    client_uuid = serializers.UUIDField()
    mpp_code = serializers.CharField(max_length=20)
    member_code = serializers.CharField(max_length=20, required=False, allow_blank=True)
    non_member_id = serializers.IntegerField(required=False, allow_null=True)
    animal_id = serializers.IntegerField()
    straw_unique_no = serializers.CharField(max_length=30, required=False, allow_blank=True)
    semen_breed = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
        help_text=(
            "Breed of the straw used. Needed only when the number is not on record yet and "
            "the Mait is carrying unnumbered stock in more than one breed — the number alone "
            "cannot say which bundle it came from."
        ),
    )

    def validate(self, attrs):
        mait = self.context["mait"]

        # -- MPP: must be one of this Mait's own (SRS §16) --------------------------------
        mpp = MPP.objects.filter(mpp_code=attrs["mpp_code"].strip()).first()
        if mpp is None:
            raise serializers.ValidationError({"mpp_code": "No such MPP."})
        if mpp.mait_id != mait.id:
            raise serializers.ValidationError({"mpp_code": "You are not assigned to this MPP."})
        attrs["mpp"] = mpp

        # -- Owner: exactly one, and at that MPP ------------------------------------------
        member_code = (attrs.get("member_code") or "").strip()
        non_member_id = attrs.get("non_member_id")
        if bool(member_code) == bool(non_member_id):
            raise serializers.ValidationError("Supply exactly one of member_code or non_member_id.")

        if member_code:
            owner = Member.objects.filter(member_code=member_code, mpp=mpp).first()
            if owner is None:
                raise serializers.ValidationError({"member_code": "No such member at this MPP."})
            attrs["owner_type"] = AIEvent.OwnerType.MEMBER
        else:
            owner = NonMember.objects.filter(pk=non_member_id, mpp=mpp).first()
            if owner is None:
                raise serializers.ValidationError(
                    {"non_member_id": "No such non-member at this MPP."}
                )
            attrs["owner_type"] = AIEvent.OwnerType.NON_MEMBER
        attrs["owner"] = owner

        # -- Animal: must belong to the farmer being served -------------------------------
        # Checked rather than trusted: the animal id comes from a list the app may have
        # cached before the animal was transferred or the member moved MPP.
        animal = Animal.objects.filter(pk=attrs["animal_id"]).first()
        if animal is None:
            raise serializers.ValidationError({"animal_id": "No such animal."})
        owner_matches = (
            animal.member_id == owner.id
            if attrs["owner_type"] == AIEvent.OwnerType.MEMBER
            else animal.non_member_id == owner.id
        )
        if not owner_matches:
            raise serializers.ValidationError(
                {"animal_id": "This animal is not registered to that farmer."}
            )
        attrs["animal"] = animal

        return attrs

    def validate_straw_unique_no(self, value: str) -> str:
        return (value or "").strip()

    def validate_semen_breed(self, value: str) -> str:
        return (value or "").strip().upper()
