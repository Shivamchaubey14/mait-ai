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
from apps.inventory.models import Consumable
from apps.masterdata.models import MPP, Member, NonMember
from apps.masterdata.procurement import decide_from_periods as decide_eligibility
from apps.masterdata.procurement import serializer_context as procurement_context
from apps.payments.models import Payment
from apps.payments.pricing import price_for

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


class AIEventPhotoStatusSerializer(serializers.Serializer):
    """
    The proof photo's state, served by ``GET /ai-events/{id}/photo-status/``.

    A read-only poll for the mobile client to confirm an upload landed when the upload's own
    response was lost on a village connection — the fallback the offline queue falls back to. It
    answers whether the photo is on file and, once it is, the URLs and the checksum.
    """

    id = serializers.IntegerField()
    status = serializers.CharField()
    photo_uploaded = serializers.BooleanField()
    ai_photo_url = serializers.CharField(allow_blank=True)
    ai_photo_thumbnail_url = serializers.CharField(allow_blank=True)
    ai_photo_checksum = serializers.CharField(allow_blank=True)
    performed_at = serializers.DateTimeField(allow_null=True)


class AIEventTimelineSerializer(serializers.ModelSerializer):
    """One step of the audit trail, served by ``GET /ai-events/{id}/timeline/``."""

    actor_name = serializers.CharField(source="actor.full_name", read_only=True, default="")

    class Meta:
        model = AIEventTimeline
        fields = ["id", "from_status", "to_status", "note", "actor_name", "created_at"]
        read_only_fields = fields


class AIEventConsumableSerializer(serializers.Serializer):
    """One consumable a visit used, named the way the catalogue names it."""

    code = serializers.CharField(source="consumable.code", read_only=True)
    name = serializers.CharField(source="consumable.name", read_only=True)
    unit = serializers.CharField(source="consumable.unit", read_only=True)
    qty = serializers.IntegerField(read_only=True)


def other_codes_by_vendor(events) -> dict[str, list[dict]]:
    """Every member code under the SAP vendors of these events' members, in one query."""
    from apps.masterdata.models import Member

    vendors = {
        (event.member.sap_vendor_code or "").strip()
        for event in events
        if event.member_id and (event.member.sap_vendor_code or "").strip()
    }
    if not vendors:
        return {}
    by_vendor: dict[str, list[dict]] = {}
    rows = (
        Member.objects.filter(sap_vendor_code__in=vendors)
        .select_related("mpp")
        .order_by("activation_date", "member_code")
    )
    for row in rows:
        by_vendor.setdefault(row.sap_vendor_code, []).append(
            {
                "member_code": row.member_code,
                "mpp_code": row.mpp.mpp_code,
                "mpp_name": row.mpp.mpp_name,
                "activation_status": row.activation_status,
                # The master's own active flag ('Yes'), as the member screens read it.
                "current": row.activation_status == "Yes",
            }
        )
    return by_vendor


class AIEventSerializer(serializers.ModelSerializer):
    """
    Read shape for an AI event.

    Names are denormalised into the response because the app renders this list offline from
    its own cache — a row that only carried foreign keys would show blanks with no signal.
    """

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mpp_code = serializers.CharField(source="mpp.mpp_code", read_only=True)
    # The member's own code, not just her row id. It is what the app names her by everywhere
    # else, and without it a capture picked back up out of the Unfinished list cannot re-fetch
    # the farmer it belongs to — it would have a number the rest of the flow does not speak.
    member_code = serializers.CharField(source="member.member_code", read_only=True, default="")
    # Hers for life, where the member code changes when she moves MPP. See `search_events`.
    sap_vendor_code = serializers.CharField(
        source="member.sap_vendor_code", read_only=True, default=""
    )
    other_member_codes = serializers.SerializerMethodField()
    mpp_name = serializers.CharField(source="mpp.mpp_name", read_only=True)
    # The admin list is a table of who did what: an event row without the Mait on it cannot
    # be read without opening every one of 31,000 rows.
    mait_name = serializers.CharField(source="mait.name", read_only=True)
    mait_code = serializers.CharField(source="mait.sahayak_vendor_code", read_only=True)
    # The Mait's number, for the portal's hover card over the vendor code — so an admin chasing
    # an event can ring the Mait without opening the record. Just the number; the name is already
    # on the row. Defaulted blank because the oldest imported Maits predate the mobile column.
    mait_mobile = serializers.CharField(source="mait.mobile_no", read_only=True, default="")
    payment = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    animal_type = serializers.CharField(source="animal.animal_type", read_only=True)
    breed = serializers.CharField(source="animal.breed", read_only=True)
    ear_tag_no = serializers.CharField(source="animal.ear_tag_no", read_only=True)
    semen_breed = serializers.CharField(source="semen_batch.breed", read_only=True, default="")
    consumables = AIEventConsumableSerializer(many=True, read_only=True)
    amount_due = serializers.SerializerMethodField()
    # Her milk procurement and whether it clears the insemination-code bar — the same figure the
    # Super OTP panel shows, so the office can read a member's eligibility from the event row
    # without crossing to another screen. Members only; `null` for a non-member (who pays cash
    # and is never gated) and whenever the gate is not yet live.
    procurement = serializers.SerializerMethodField()

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
            "mait_mobile",
            "payment",
            "owner_type",
            "member",
            "member_code",
            "sap_vendor_code",
            "other_member_codes",
            "non_member",
            "owner_name",
            "animal",
            "animal_type",
            "breed",
            "ear_tag_no",
            "semen_breed",
            "doses",
            "consumables",
            "amount_due",
            "procurement",
            "straw_unique_no",
            "stock_deducted",
            "ai_photo_url",
            "ai_photo_thumbnail_url",
            "ai_photo_checksum",
            "photo_source",
            "gps_lat",
            "gps_lng",
            "gps_source",
            "performed_at",
            "completed_at",
            "cancelled_reason",
            "farmer_check",
            "created_at",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_amount_due(self, obj) -> str | None:
        """
        What this insemination costs, decided by the server and never by the handset.

        A member and a non-member are charged different rates for the same service, and both
        are the administrator's to set — so the app displays this figure rather than
        computing one. Null where nobody has priced the breed yet: the app then says the
        service is chargeable without naming a number, because a figure the system cannot
        stand behind is heard by the farmer as final.
        """
        breed = getattr(obj.semen_batch, "breed", "") if obj.semen_batch_id else ""
        amount = price_for(
            breed=breed,
            animal_type=obj.animal.animal_type,
            owner_type=obj.owner_type,
        )
        return None if amount is None else f"{amount:.2f}"

    @extend_schema_field(serializers.ListField(child=serializers.DictField()))
    def get_other_member_codes(self, obj) -> list:
        """
        The member's other codes — the same SAP vendor under another member code.

        A member who moves MPP is given a new code there and keeps her vendor, so an event
        recorded under her old code names a code nobody uses any more, and one under her new
        code hides that she has a history. Each comes with `current`: whether that code is the
        active one. A list page reads these from one query for the whole page (the viewset puts
        them in the context); a single event asks for its own.
        """
        member = obj.member
        vendor = (getattr(member, "sap_vendor_code", "") or "").strip()
        if member is None or not vendor:
            return []
        by_vendor = self.context.get("other_codes")
        if by_vendor is None:
            # Inside a list with no map supplied, saying nothing beats a query per row.
            if self.parent is not None:
                return []
            by_vendor = other_codes_by_vendor([obj])
        return [
            row for row in by_vendor.get(vendor, []) if row["member_code"] != member.member_code
        ]

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

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_procurement(self, obj):
        """
        Her milk procurement and the insemination-code eligibility it decides.

        The same shape the Super OTP panel reads (``accounts.super_otp_views``): whether the
        gate is live, whether she clears it, the bar, how much she has poured, and her latest
        period. Decided the one way the backend defines eligibility (``masterdata.procurement``)
        so the two screens never disagree.

        ``null`` for a non-member — she pays the Mait in cash on the spot, so eligibility does
        not apply — and the front end hides the note entirely when the gate is not yet live, so
        a dairy that has uploaded no procurement sees nothing new.

        The threshold and whether the gate is live are computed once per request and handed in
        through the serializer context, and the member's periods are prefetched (newest first),
        so a page of 25 events costs no extra query per row.
        """
        if obj.owner_type != AIEvent.OwnerType.MEMBER or obj.member is None:
            return None
        member = obj.member

        gated = self.context.get("procurement_gated")
        threshold = self.context.get("procurement_threshold")
        if gated is None or threshold is None:
            # A single event served without the list's shared context: pay the two small
            # queries here rather than leave eligibility undecided.
            ctx = procurement_context()
            gated = ctx["procurement_gated"]
            threshold = ctx["procurement_threshold"]

        rows = list(member.procurements.all())  # prefetched, newest first (model Meta ordering)
        latest = rows[0] if rows else None
        # Sum her latest cycle (a month that may have been uploaded in pieces) rather than the
        # newest window alone — the one rule the member serializers also take.
        decision = decide_eligibility(periods=rows, threshold=threshold, gated=gated)
        block = {
            "member_code": member.member_code,
            "member_name": member.member_name,
            "eligible": decision.eligible,
            "gated": decision.gated,
            "threshold": str(decision.threshold),
            "amount": str(decision.amount) if decision.amount is not None else None,
        }
        if latest is not None:
            block["period"] = {
                # ISO strings, never raw `date` objects. DRF renders these to strings over HTTP
                # either way, but the idempotency layer stores this serializer's `.data` as JSON
                # *before* that render (`core.idempotency`), and a raw `date` there cannot be
                # serialised — it 500s every finalize/complete of a member with procurement on
                # record, which strands the capture on the queue for good. The mobile contract is
                # a string (`MemberProcurement.period`), so this is also simply correct.
                "from_date": latest.from_date.isoformat(),
                "to_date": latest.to_date.isoformat(),
                "qty": str(latest.qty),
                "avg_fat": str(latest.avg_fat),
                "avg_snf": str(latest.avg_snf),
                "amount": str(latest.amount),
                "no_of_pouring_days": latest.no_of_pouring_days,
                "no_of_pouring_shift": latest.no_of_pouring_shift,
            }
        return block


class AIEventDetailSerializer(AIEventSerializer):
    """
    One event, with the question of whether it worked.

    An insemination is not finished when the straw is used — it is finished when somebody
    finds out whether it took, and that answer lives on a chain of pregnancy checks rather
    than on the event (docs/API_CONTRACT.md §9.11). The detail screen is where a dispute is
    settled from, so it is the one place that trail belongs.

    Detail only, and deliberately not on ``AIEventSerializer`` itself: the list renders 25
    events at a time and the app renders it offline, so a reverse lookup per row would be 25
    extra queries to show something no list column has room for.
    """

    pregnancy_checks = serializers.SerializerMethodField()
    # The farmer behind the event, in enough detail to settle a dispute: who she is, how to
    # reach her, and — for a non-member, who has no SAP record to look up — the Aadhaar she
    # registered with. Detail only and never on the list, which renders 25 rows at a time and
    # has no room for it. The Aadhaar is **masked** here (SRS §16): the full number lives
    # behind the per-record endpoint that logs the read, which this screen does not need.
    owner_detail = serializers.SerializerMethodField()
    # The animal as it was registered, before the first insemination could be recorded against
    # it (SRS §6.3 step 3) — with the portrait the Mait took of her in the yard. The event
    # already carries her type, breed and tag for the list; this is the registration record
    # itself, and the photo is the part of it the summary row can never show. Detail only,
    # because a list of 25 has no room for a picture.
    animal_detail = serializers.SerializerMethodField()

    class Meta(AIEventSerializer.Meta):
        fields = [
            *AIEventSerializer.Meta.fields,
            "pregnancy_checks",
            "owner_detail",
            "animal_detail",
        ]

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_animal_detail(self, event):
        animal = event.animal
        if animal is None:
            return None
        return {
            "id": animal.id,
            "animal_type": animal.animal_type,
            "animal_type_display": animal.get_animal_type_display(),
            "breed": animal.breed,
            "ear_tag_no": animal.ear_tag_no,
            # Root-relative, like every other media URL the API returns; the portal passes it
            # through `mediaUrl()` so it resolves on the dev path too. Blank when the upload
            # that follows registration never completed on a village connection.
            "photo_url": animal.photo_url,
            "registered_at": animal.created_at,
        }

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_owner_detail(self, event):
        owner = event.owner
        if owner is None:
            return None
        if event.owner_type == AIEvent.OwnerType.MEMBER:
            return {
                "type": "member",
                "name": owner.member_name,
                "code": owner.member_code,
                "mobile_no": owner.mobile_no,
                "father_husband_name": owner.father_husband_name,
                "aadhar_masked": owner.masked_aadhar,
                "has_aadhar": bool(owner.aadhar_no),
            }
        return {
            "type": "non_member",
            "name": owner.name,
            # A non-member has no membership number — the field is here for shape, blank by
            # definition, so the screen reads a member and a non-member the same way.
            "code": "",
            "mobile_no": owner.mobile_no,
            "father_husband_name": owner.father_husband_name,
            "relation": owner.get_relation_display() if owner.relation else "",
            "address": owner.address,
            "aadhar_masked": owner.masked_aadhar,
            "has_aadhar": bool(owner.aadhar_no),
            # Whether a card photo was taken at registration — the thing the non-member record
            # screen shows in full, linked to from here rather than reproduced.
            "has_aadhar_image": bool(owner.aadhar_front_url or owner.aadhar_back_url),
        }

    def get_pregnancy_checks(self, event) -> list:
        # Imported here rather than at module scope: `apps.pregnancy` imports the AI event
        # model, and hoisting this makes the two modules import each other at startup.
        from apps.pregnancy.serializers import PregnancyCheckSerializer

        checks = event.pregnancy_checks.all().order_by("due_on", "id")
        return PregnancyCheckSerializer(checks, many=True, context=self.context).data


class AIEventCompleteSerializer(serializers.Serializer):
    """
    The one decision a completion can carry.

    Empty on every ordinary completion, which is why the body is optional: the capture flow
    closes an event it has just walked through, and there is nothing to say about it.
    """

    close_without_stock = serializers.BooleanField(
        required=False,
        default=False,
        help_text=(
            "Close a record whose straw has already left the Mait's stock, without spending "
            "another one on it. The straw is still deducted where it is there to deduct."
        ),
    )


class AIEventPhotoSerializer(serializers.Serializer):
    """
    The proof photo and where and when it was taken (SRS §6.3 step 5).

    ``performed_at`` comes from the device, not the server clock. An event captured offline
    may not reach us for hours, and the report has to show when the insemination actually
    happened — a server timestamp would quietly move every offline event to whenever the
    Mait next found signal.

    GPS is recorded when the handset has a fix, but it is **optional**: a phone with location
    denied, an old device, or an insemination done inside a shed still has to be recordable —
    refusing the proof because there is no pin would strand the very capture the app exists to
    save (offline-first, SRS §6.9). The photo alone carries the proof; the pin, where present,
    ties it to the village it was billed to. A capture with no fix stores a null coordinate,
    which the portal already renders as "No location recorded".

    Null is accepted three ways, because a multipart client cannot send a JSON null: the field
    omitted, an explicit ``null``, and the literal strings an older field build puts on the wire
    for "no value" (``"null"``/``""``) — all map to ``None`` (see ``_drop_nullish_gps`` in the
    view, which strips them before validation). That last case is what let no-GPS captures
    strand: the offline queue sent ``gps_lat="null"`` and the required DecimalField refused it.
    """

    photo = serializers.ImageField()
    gps_lat = serializers.DecimalField(
        max_digits=10, decimal_places=7, required=False, allow_null=True
    )
    gps_lng = serializers.DecimalField(
        max_digits=10, decimal_places=7, required=False, allow_null=True
    )
    performed_at = serializers.DateTimeField(required=False)
    # Both default to the honest answer for a client that says nothing, which is the app as it
    # shipped before the gallery existed: a live capture, pinned by the handset.
    photo_source = serializers.ChoiceField(
        choices=AIEvent.PhotoSource.choices,
        required=False,
        default=AIEvent.PhotoSource.CAMERA,
    )
    gps_source = serializers.ChoiceField(
        choices=AIEvent.GpsSource.choices,
        required=False,
        default=AIEvent.GpsSource.DEVICE,
    )

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

    The straw is named by **breed**, not by number. Reading a number means lifting the goblet
    out of the liquid nitrogen, which warms every straw in it — the app would be asking a Mait
    to damage the semen in order to record it. So ``semen_breed`` opens the capture and holds
    one straw of that breed from the Mait's stock, and the gate becomes a count: ten straws of
    a breed complete ten inseminations of it.

    ``straw_unique_no`` remains accepted for the cases where a number is genuinely known
    without opening anything — a depot scan, an admin correction, a barcode on the goblet.
    Supplied, it is validated against stock as before and wins over the breed. With neither,
    the event stays a ``draft`` the Mait can come back to.
    """

    class ConsumableLine(serializers.Serializer):
        """A catalogue code and how many of it the visit took."""

        code = serializers.CharField(max_length=30)
        qty = serializers.IntegerField(min_value=1, max_value=99)

    client_uuid = serializers.UUIDField()
    mpp_code = serializers.CharField(max_length=20)
    member_code = serializers.CharField(max_length=20, required=False, allow_blank=True)
    non_member_id = serializers.IntegerField(required=False, allow_null=True)
    animal_id = serializers.IntegerField()
    straw_unique_no = serializers.CharField(max_length=30, required=False, allow_blank=True)
    doses = serializers.IntegerField(
        required=False,
        default=1,
        min_value=1,
        max_value=1,
        error_messages={
            "max_value": (
                "Only one semen per animal. The next can be given 21 days after the last AI, "
                "if she has not conceived."
            )
        },
        help_text=(
            "Always 1. The dairy's rule is one semen per animal per AI; the next may be given "
            "21 days later if she has not conceived (`ai_events.rules`)."
        ),
    )
    consumables = ConsumableLine(
        many=True,
        required=False,
        help_text=(
            "What else the visit took — sheaths, gloves — by catalogue code. Deducted at "
            "completion alongside the straws, and never charged to the farmer."
        ),
    )
    semen_breed = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
        help_text=(
            "Breed of the straw used. This is how the capture flow names a straw: one of "
            "that breed is held from the Mait's stock and deducted at completion, with no "
            "number read and no goblet lifted out of the nitrogen."
        ),
    )

    office_code = serializers.RegexField(
        r"^\d{4,8}$",
        required=False,
        help_text=(
            "The office's code the farmer read out, where the phone checked her with no signal. "
            "Proved here against what the office issued; the event is recorded either way."
        ),
    )
    office_code_day = serializers.DateField(
        required=False,
        help_text="The day the phone checked it — the day of the key it used.",
    )

    def validate(self, attrs):
        mait = self.context["mait"]

        if bool(attrs.get("office_code")) != bool(attrs.get("office_code_day")):
            raise serializers.ValidationError(
                "Send office_code and office_code_day together, or neither."
            )

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

        # -- One semen, then 21 days, never while pregnant (`ai_events.rules`) -------------
        # A repeat of a create that already landed never reaches here: the view answers it as
        # a replay first, so this cannot refuse the AI it is being asked about.
        from .rules import next_service_for, refusal

        service = next_service_for(animal)
        if service.block:
            raise serializers.ValidationError({"animal_id": refusal(service)})

        # -- Consumables: real catalogue codes, and one line each ---------------------------
        lines = attrs.get("consumables") or []
        codes = [line["code"].strip().upper() for line in lines]
        if len(set(codes)) != len(codes):
            raise serializers.ValidationError(
                {"consumables": "Each consumable may be listed once, with its total."}
            )

        found = {item.code: item for item in Consumable.objects.filter(code__in=codes)}
        missing = [code for code in codes if code not in found]
        if missing:
            raise serializers.ValidationError(
                {"consumables": f"No such consumable: {', '.join(missing)}."}
            )
        attrs["consumable_lines"] = [
            (found[code], line["qty"]) for code, line in zip(codes, lines, strict=True)
        ]

        return attrs

    def validate_straw_unique_no(self, value: str) -> str:
        return (value or "").strip()

    def validate_semen_breed(self, value: str) -> str:
        return (value or "").strip().upper()
