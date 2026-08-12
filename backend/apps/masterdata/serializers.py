"""Serializers for master data and the SAP upload pipeline (SRS §6.1, §9.2, §9.3)."""

from __future__ import annotations

from rest_framework import serializers

from apps.animals.serializers import AnimalSerializer
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

    class Meta:
        model = NonMember
        fields = [
            "id",
            "name",
            "father_husband_name",
            "mobile_no",
            "address",
            "aadhar_no",
            "masked_aadhar",
            "mpp",
            "created_by_mait",
            "consent_captured_at",
            "created_at",
        ]
        read_only_fields = ["id", "created_by_mait", "created_at"]

    def validate_aadhar_no(self, value: str) -> str:
        """
        Twelve digits, and they must not already be on the membership roll.

        This is the one check that stops the fraud the non-member path invites: a member
        recorded as a non-member is a farmer the Mait can take cash from for a service the
        dairy has already paid for out of her milk payment. She has no reason to query it —
        she was asked for money and she paid it.

        Matched on the keyed fingerprint, never on the number: the encrypted column cannot be
        searched, and adding a searchable copy of an Aadhaar to solve that would be a worse
        problem than the one being solved.
        """
        digits = "".join(c for c in value if c.isdigit())
        if len(digits) != 12:
            raise serializers.ValidationError("Aadhaar is 12 digits.")

        member = (
            Member.objects.filter(aadhar_hash=pii_lookup_hash(digits)).select_related("mpp").first()
        )
        if member is not None:
            # Named, because the Mait's next action is to go back and find her in the roster,
            # and "this Aadhaar is registered" would leave them guessing at which farmer.
            raise serializers.ValidationError(
                f"{member.member_name} is already a member at "
                f"{member.mpp.mpp_name} ({member.member_code}). "
                "Record this as a member — she pays nothing today."
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
