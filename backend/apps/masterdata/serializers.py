"""Serializers for master data and the SAP upload pipeline (SRS §6.1, §9.2, §9.3)."""

from __future__ import annotations

from rest_framework import serializers

from apps.animals.serializers import MAX_PHOTO_BYTES, AnimalSerializer
from apps.core.fields import pii_lookup_hash

from .models import MAX_ERRORS_STORED, MPP, DataUploadLog, Mait, Member, NonMember

# openpyxl only reads the OOXML format. Rejecting other types up front gives a clear error
# instead of an unhandled parser exception inside a Celery worker.
ALLOWED_CONTENT_TYPES = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",  # what some browsers send for .xlsx
)
MAX_UPLOAD_BYTES = 64 * 1024 * 1024  # Member.xlsx is ~28 MB; leave headroom for growth


class MasterUploadSerializer(serializers.Serializer):
    """Validates the uploaded workbook before anything is queued."""

    file = serializers.FileField(write_only=True)

    def validate_file(self, value):
        if not value.name.lower().endswith(".xlsx"):
            raise serializers.ValidationError(
                "Only .xlsx files are supported. Export from SAP as Excel 2007+ format."
            )
        if value.size > MAX_UPLOAD_BYTES:
            raise serializers.ValidationError(
                f"File is {value.size / 1024 / 1024:.1f} MB; the limit is "
                f"{MAX_UPLOAD_BYTES // 1024 // 1024} MB."
            )
        if value.size == 0:
            raise serializers.ValidationError("The file is empty.")
        return value


class DataUploadLogSerializer(serializers.ModelSerializer):
    """
    Upload status, polled by the admin UI while a large import runs (SRS §6.1.6).

    ``error_report`` is excluded here on purpose — it can hold thousands of rows, and the
    history list would become enormous. It has its own endpoint.
    """

    upload_type_display = serializers.CharField(source="get_upload_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True)
    progress_percent = serializers.IntegerField(read_only=True)
    error_count = serializers.SerializerMethodField()

    class Meta:
        model = DataUploadLog
        fields = [
            "id",
            "upload_type",
            "upload_type_display",
            "file_name",
            "status",
            "status_display",
            "uploaded_by",
            "uploaded_by_name",
            "total_rows",
            "processed_rows",
            "success_rows",
            "failed_rows",
            "progress_percent",
            "error_count",
            "started_at",
            "finished_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_error_count(self, obj) -> int:
        """
        How many rows the report holds, without loading the report to find out.

        The history list defers `error_report` — see `MasterUploadViewSet.get_queryset` — so
        touching it here would fetch a megabyte of JSON per row, one query at a time. The
        length is derivable instead: one entry per rejected row up to the cap, and a whole-file
        failure stores a single explanation having rejected no rows at all.
        """
        if "error_report" not in obj.get_deferred_fields():
            return len(obj.error_report or [])
        if obj.status == DataUploadLog.Status.FAILED:
            return 1
        return min(obj.failed_rows, MAX_ERRORS_STORED)


class UploadErrorRowSerializer(serializers.Serializer):
    """One rejected row in the downloadable error report (SRS §6.1.4)."""

    row = serializers.IntegerField(allow_null=True)
    error = serializers.CharField()
    # The identifying cells as they were read, keyed by the labels the same response sends in
    # `columns`. Absent on reports written before this was captured, and on a whole-file
    # failure, which has no row to identify.
    fields = serializers.DictField(child=serializers.CharField(allow_blank=True), required=False)


class MaitSerializer(serializers.ModelSerializer):
    """
    Mait detail.

    PII is masked by default (SRS §16). The unmasked values are reachable only from the
    restricted, audit-logged admin endpoint — never from here.
    """

    aadhar_no = serializers.CharField(source="masked_aadhar", read_only=True)
    bank_account_no = serializers.CharField(source="masked_bank_account", read_only=True)
    has_login = serializers.SerializerMethodField()
    can_receive_otp = serializers.SerializerMethodField()

    class Meta:
        model = Mait
        fields = [
            "id",
            "sahayak_vendor_code",
            "name",
            "mobile_no",
            "aadhar_no",
            "bank_account_no",
            "ifsc_code",
            "is_active",
            "has_login",
            "can_receive_otp",
        ]
        read_only_fields = fields

    def get_has_login(self, obj) -> bool:
        return obj.user_id is not None

    def get_can_receive_otp(self, obj) -> bool:
        """
        Whether this Mait can actually log in.

        Surfaced explicitly because the SAP export leaves ~93% of Sahayak mobile numbers
        blank, and a Mait without one cannot receive the OTP that is their only way in
        (docs/DATA_FINDINGS.md §1).
        """
        return bool(obj.mobile_no)


class MPPListSerializer(serializers.ModelSerializer):
    mait_name = serializers.CharField(source="mait.name", read_only=True, default=None)
    mait_code = serializers.CharField(
        source="mait.sahayak_vendor_code", read_only=True, default=None
    )
    # An MPP whose Mait exists in SAP but has never been activated records nothing at all,
    # and looks identical to a working one unless the portal is told the difference.
    mait_activated = serializers.SerializerMethodField()
    member_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = MPP
        fields = [
            "id",
            "mpp_code",
            "mpp_name",
            # The plant is the dairy this collection point reports into, and unlike the geo
            # codes beside it, it has a name. It is what an admin narrows the directory by.
            "plant_code",
            "plant_name",
            "district_code",
            "tehsil_code",
            "village_code",
            "mobile_no",
            "is_active",
            "mait",
            "mait_name",
            "mait_code",
            "mait_activated",
            # The person who staffs this collection point, straight from the SAP master. Not
            # the Mait — a Sahayak takes the milk in at one MPP, a Mait covers many — but the
            # only contact an office has for an MPP nobody is assigned to yet.
            "sahayak_name",
            "sahayak_mobile_no",
            "member_count",
        ]
        read_only_fields = fields

    def get_mait_activated(self, obj) -> bool:
        mait = obj.mait
        return bool(mait and mait.user_id)


class MPPDetailSerializer(MPPListSerializer):
    mait = MaitSerializer(read_only=True)
    member_count = serializers.IntegerField(read_only=True)

    class Meta(MPPListSerializer.Meta):
        fields = [
            *MPPListSerializer.Meta.fields,
            "plant_code",
            "plant_name",
            "mpp_category",
            "state_code",
            "panchayat_code",
            "hamlet_code",
            "address_line",
            "start_date",
            "end_date",
            "member_count",
        ]
        read_only_fields = fields


class MemberListSerializer(serializers.ModelSerializer):
    """
    Trimmed for the mobile app's member picker (SRS §6.3 step 2).

    A Mait standing at an MPP needs a name, a code and a number to confirm identity — not 54
    columns over a rural connection.
    """

    mpp_code = serializers.CharField(source="mpp.mpp_code", read_only=True)

    class Meta:
        model = Member
        fields = [
            "id",
            "member_code",
            "member_name",
            "father_husband_name",
            "mobile_no",
            "mpp_code",
            "activation_status",
        ]
        read_only_fields = fields


class MemberDetailSerializer(serializers.ModelSerializer):
    aadhar_no = serializers.CharField(source="masked_aadhar", read_only=True)
    mpp_code = serializers.CharField(source="mpp.mpp_code", read_only=True)
    mpp_name = serializers.CharField(source="mpp.mpp_name", read_only=True)
    can_receive_otp = serializers.SerializerMethodField()
    # Step 3 of the capture flow picks from these (SRS §6.3). Nested rather than a second
    # request because the Mait is standing in a yard with one bar of signal — two round trips
    # to show one screen is one too many.
    animals = AnimalSerializer(many=True, read_only=True)

    class Meta:
        model = Member
        fields = [
            "id",
            "member_code",
            "member_name",
            "father_husband_name",
            "gender",
            "age",
            "category",
            "education",
            "mobile_no",
            "aadhar_no",
            "cattle_holding",
            "bank_name",
            "ifsc_code",
            "folio_no",
            "activation_status",
            "activation_date",
            "mpp_code",
            "mpp_name",
            "can_receive_otp",
            "animals",
        ]
        read_only_fields = fields

    def get_can_receive_otp(self, obj) -> bool:
        """
        Whether a payment can be authorised for this member (SRS §6.5).

        1.5% of members have an unusable number. The app checks this before starting the
        flow, rather than stranding the Mait at the payment step with a completed
        insemination and no way to close the event (docs/DATA_FINDINGS.md §2).
        """
        return bool(obj.mobile_no)


class NonMemberSerializer(serializers.ModelSerializer):
    """Quick-capture registration by a Mait in the field (SRS §6.3 step 2)."""

    # Written once, read back masked (SRS §16), the same treatment members and Maits get. The
    # write field is separate from the read one so the number can never travel back to a
    # handset that has already stored it — a phone in a field is the last place it belongs.
    aadhar_no = serializers.CharField(write_only=True, max_length=20)
    masked_aadhar = serializers.CharField(read_only=True)

    # She agreed, and the agreement is the record — not the disabled button on the handset
    # that made her agree before the Mait could tap Save (SRS §7 Compliance). The app has
    # always collected this tick and always dropped it, so `consent_captured_at` was null on
    # every non-member ever registered. Timed server-side, because a device clock is not
    # evidence of when anything happened.
    consent = serializers.BooleanField(write_only=True, required=False, default=False)

    # Whether each face of the card is on file — not where it is. The images are identity
    # documents, and a URL to one has no business sitting in a handset's response cache. The
    # app needs to know the step is done; that is all this says.
    aadhar_front_captured = serializers.SerializerMethodField()
    aadhar_back_captured = serializers.SerializerMethodField()

    class Meta:
        model = NonMember
        fields = [
            "id",
            "name",
            "father_husband_name",
            "relation",
            "mobile_no",
            "address",
            "aadhar_no",
            "masked_aadhar",
            "aadhar_front_captured",
            "aadhar_back_captured",
            "consent",
            "mpp",
            "created_by_mait",
            "consent_captured_at",
            "created_at",
        ]
        read_only_fields = ["id", "created_by_mait", "consent_captured_at", "created_at"]
        # DRF builds a UniqueTogetherValidator from the model's uniqueness constraint, and it
        # runs before `validate()` — so it, not the message below, is what a Mait used to get:
        # "The fields mobile_no, mpp must make a unique set", filed under `non_field_errors`,
        # which no screen renders. Dropped in favour of a sentence keyed to the field that
        # caused it. The database constraint is untouched and is still the actual guarantee.
        validators: list = []

    def get_aadhar_front_captured(self, obj) -> bool:
        return bool(obj.aadhar_front_url)

    def get_aadhar_back_captured(self, obj) -> bool:
        return bool(obj.aadhar_back_url)

    def validate_aadhar_no(self, value: str) -> str:
        """
        Twelve digits, and belonging to nobody already on file — member or non-member.

        The membership check is what stops the fraud the non-member path invites: a member
        recorded as a non-member is a farmer the Mait can take cash from for a service the
        dairy has already paid for out of her milk payment. She has no reason to query it —
        she was asked for money and she paid it.

        The non-member check closes the other half of the same hole, which was open. One
        Aadhaar could be registered any number of times: at a second MPP, or at the same one
        on a different mobile — the only uniqueness the table had was mobile-per-MPP. Every
        copy is a farmer who can be charged again, and a duplicate is indistinguishable from
        a second woman once the round is over.

        Both are matched on the keyed fingerprint, never on the number: the encrypted column
        cannot be searched, and adding a searchable copy of an Aadhaar to solve that would be
        a worse problem than the one being solved.
        """
        digits = "".join(c for c in value if c.isdigit())
        if len(digits) != 12:
            raise serializers.ValidationError("Aadhaar is 12 digits.")

        fingerprint = pii_lookup_hash(digits)

        member = Member.objects.filter(aadhar_hash=fingerprint).select_related("mpp").first()
        if member is not None:
            # Named, because the Mait's next action is to go back and find her in the roster,
            # and "this Aadhaar is registered" would leave them guessing at which farmer.
            raise serializers.ValidationError(
                f"{member.member_name} is already a member at "
                f"{member.mpp.mpp_name} ({member.member_code}). "
                "Record this as a member — she pays nothing today."
            )

        already = NonMember.objects.filter(aadhar_hash=fingerprint)
        if self.instance is not None:
            already = already.exclude(pk=self.instance.pk)
        duplicate = already.select_related("mpp").first()
        if duplicate is not None:
            # Named and placed, so the Mait can go and find the record rather than conclude
            # the app is refusing her for no reason.
            raise serializers.ValidationError(
                f"This Aadhaar is already registered to {duplicate.name} at "
                f"{duplicate.mpp.mpp_name}. She is on file — pick her instead of "
                "registering her twice."
            )

        return digits

    def validate_mobile_no(self, value: str) -> str:
        """
        A non-member's number is not optional.

        Unlike members, whose numbers come from SAP, this is captured live — and it is the
        only channel for the payment OTP, so accepting a blank would create a record that
        can never complete an AI event.
        """
        digits = "".join(c for c in value if c.isdigit())
        if len(digits) != 10 or digits[0] not in "6789":
            raise serializers.ValidationError("Enter a valid 10-digit Indian mobile number.")
        return digits

    def validate(self, attrs):
        """
        The MPP must be one of this Mait's, and the farmer must not already be at it.

        Both refusals used to arrive as ``non_field_errors`` or not at all, and the app had no
        box for that key — so a Mait registering a woman who was already on file tapped Save
        and watched nothing happen. The message is now keyed to ``mobile_no``, which is the
        field they would have to change, and it names her, because the right next action is to
        go back and pick the record that already exists rather than invent a second one.
        """
        mpp = attrs.get("mpp") or getattr(self.instance, "mpp", None)
        mobile_no = attrs.get("mobile_no") or getattr(self.instance, "mobile_no", "")

        # SRS §16 — a Mait may only register at their own MPPs. The app can only offer them
        # their own, because /mpp/ is scoped, but the endpoint took whatever id it was handed.
        mait = self.context.get("mait")
        if mait is not None and mpp is not None and mpp.mait_id != mait.id:
            raise serializers.ValidationError({"mpp": "This is not one of your MPPs."})

        if mpp is not None and mobile_no:
            existing = NonMember.objects.filter(mobile_no=mobile_no, mpp=mpp)
            if self.instance is not None:
                existing = existing.exclude(pk=self.instance.pk)
            already = existing.first()
            if already is not None:
                raise serializers.ValidationError(
                    {
                        "mobile_no": (
                            f"{already.name} is already registered at this MPP on this "
                            "number. Go back and pick her from the list instead of "
                            "registering her again."
                        )
                    }
                )

        return attrs


class AdminNonMemberListSerializer(serializers.ModelSerializer):
    """
    The back office's view of the farmers Maits registered in the field (W10b).

    A different shape from the app's, because a different question is being asked. A Mait
    already knows who they just registered; an admin is looking at rows they have never seen,
    entered by somebody else, on a form that ends with cash changing hands. So the columns are
    the ones that make a row auditable without opening it: who she is, who registered her, and
    whether the two things that keep the path honest — her card and her consent — are on file.
    """

    relation_display = serializers.CharField(source="get_relation_display", read_only=True)
    mpp_code = serializers.CharField(source="mpp.mpp_code", read_only=True, default="")
    mpp_name = serializers.CharField(source="mpp.mpp_name", read_only=True, default="")
    registered_by = serializers.CharField(source="created_by_mait.name", read_only=True, default="")
    registered_by_code = serializers.CharField(
        source="created_by_mait.sahayak_vendor_code", read_only=True, default=""
    )
    masked_aadhar = serializers.CharField(read_only=True)
    aadhar_front_captured = serializers.SerializerMethodField()
    aadhar_back_captured = serializers.SerializerMethodField()
    animal_count = serializers.IntegerField(read_only=True, default=0)
    ai_event_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = NonMember
        fields = [
            "id",
            "name",
            "father_husband_name",
            "relation",
            "relation_display",
            "mobile_no",
            "address",
            "masked_aadhar",
            "aadhar_front_captured",
            "aadhar_back_captured",
            "mpp",
            "mpp_code",
            "mpp_name",
            "registered_by",
            "registered_by_code",
            "animal_count",
            "ai_event_count",
            "consent_captured_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_aadhar_front_captured(self, obj) -> bool:
        return bool(obj.aadhar_front_url)

    def get_aadhar_back_captured(self, obj) -> bool:
        return bool(obj.aadhar_back_url)


class AdminNonMemberDetailSerializer(AdminNonMemberListSerializer):
    """
    One farmer, with everything the back office would open her record to settle.

    **This is the only place the card images are readable**, and the only place they should be.
    A Mait's own app is told a boolean, because a link to somebody's Aadhaar has no business in
    a handset's cache; an admin verifying that the number typed matches the card has to see the
    card, and that is what the whole image is for. The view records the read against the
    operator's account, the same promise the Members screen already makes about unmasking.
    """

    aadhar_front_url = serializers.CharField(read_only=True)
    aadhar_back_url = serializers.CharField(read_only=True)
    animals = AnimalSerializer(many=True, read_only=True)

    class Meta(AdminNonMemberListSerializer.Meta):
        fields = [
            *AdminNonMemberListSerializer.Meta.fields,
            "aadhar_front_url",
            "aadhar_back_url",
            "animals",
        ]
        read_only_fields = fields


class NonMemberPickerSerializer(serializers.ModelSerializer):
    """
    One row in the list a Mait picks from before a capture (SRS §6.3 step 2, C4b).

    Deliberately not the registration shape. That one is a form being filled in; this is a
    roster being read in a yard, and the question it has to answer is "which of these is the
    woman in front of me". A name does not answer it — the same names repeat in a village —
    so the row carries the household and whose name that is, her number, and the two facts
    that identify her by her animals: how many are on her record and when she was last served.

    No Aadhaar, masked or otherwise. It is what proves she is not already a member, and that
    check happens at registration; a picker does not need it, and a screen full of them is a
    screen full of identity numbers being held up in a public place.
    """

    relation_display = serializers.CharField(source="get_relation_display", read_only=True)
    animal_count = serializers.IntegerField(read_only=True, default=0)
    ai_event_count = serializers.IntegerField(read_only=True, default=0)
    # Annotated: `Max` over her events, so a farmer who has never been served comes back null
    # rather than absent.
    last_ai_at = serializers.DateTimeField(read_only=True, allow_null=True, default=None)

    class Meta:
        model = NonMember
        fields = [
            "id",
            "name",
            "father_husband_name",
            "relation",
            "relation_display",
            "mobile_no",
            "animal_count",
            "ai_event_count",
            "last_ai_at",
            "created_at",
        ]
        read_only_fields = fields


class NonMemberAadhaarSerializer(serializers.Serializer):
    """
    Both faces of her Aadhaar card, photographed at registration.

    Sent after the record exists rather than as part of creating it, the same way an animal's
    portrait and a proof photo are. A registration that has already succeeded must not be
    undone by a village connection dropping a JPEG — the flow is standing on her id by then,
    and losing it costs the Mait the whole form again with the farmer waiting.

    Either face may be sent alone, so a retry only re-sends what failed, but at least one must
    be present: an empty request is a Mait who thinks they have uploaded something.
    """

    front = serializers.ImageField(required=False)
    back = serializers.ImageField(required=False)

    def validate(self, attrs):
        if not attrs.get("front") and not attrs.get("back"):
            raise serializers.ValidationError("Send the front of the card, the back, or both.")
        return attrs

    def _check_size(self, value):
        if value.size > MAX_PHOTO_BYTES:
            raise serializers.ValidationError(
                f"That image is {value.size // 1024 // 1024} MB. "
                f"Keep it under {MAX_PHOTO_BYTES // 1024 // 1024} MB."
            )
        return value

    def validate_front(self, value):
        return self._check_size(value)

    def validate_back(self, value):
        return self._check_size(value)


class NonMemberDetailSerializer(NonMemberSerializer):
    """
    A non-member with the animals already registered to them (SRS §6.3 step 3).

    Non-members are captured on the spot, so the first visit finds nothing here. The second
    one does, and a Mait who has to re-register the same buffalo every visit will stop
    trusting the list.
    """

    animals = AnimalSerializer(many=True, read_only=True)

    class Meta(NonMemberSerializer.Meta):
        fields = [*NonMemberSerializer.Meta.fields, "animals"]
