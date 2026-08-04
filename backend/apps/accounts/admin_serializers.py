"""
Admin user-management serializers (SRS §6.8, §9.10).

Kept apart from ``serializers.py`` because these are the privileged shapes — they create
logins and hand out roles. Mixing them with the public auth serializers makes it too easy to
expose one by accident.
"""

from __future__ import annotations

from django.db import transaction
from rest_framework import serializers

from apps.masterdata.models import MPP, Mait

from .models import MPPOperatorAssignment, Role, User, mobile_validator


class AdminUserSerializer(serializers.ModelSerializer):
    """Read shape for the user list (SRS §9.10)."""

    role_display = serializers.CharField(source="get_role_display", read_only=True)
    mait_name = serializers.CharField(source="mait_profile.name", read_only=True, default=None)
    sahayak_vendor_code = serializers.CharField(
        source="mait_profile.sahayak_vendor_code", read_only=True, default=None
    )
    assigned_mpp_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "full_name",
            "email",
            "mobile_no",
            "role",
            "role_display",
            "is_active",
            "last_login_at",
            "created_at",
            "mait_name",
            "sahayak_vendor_code",
            "assigned_mpp_count",
        ]
        read_only_fields = fields

    def get_assigned_mpp_count(self, obj) -> int:
        mait = getattr(obj, "mait_profile", None)
        if mait is not None:
            return mait.mpps.count()
        if obj.role == Role.MPP_OPERATOR:
            return obj.mpp_assignments.count()
        return 0


class AdminUserCreateSerializer(serializers.Serializer):
    """
    Create an Admin or MPP Operator account.

    Maits are not created here — they are activated from an existing SAP record through
    ``MaitActivationSerializer``, so a field login always traces back to a real Sahayak.
    """

    username = serializers.CharField(max_length=64)
    full_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    mobile_no = serializers.CharField(
        required=False, allow_blank=True, validators=[mobile_validator]
    )
    role = serializers.ChoiceField(choices=[Role.ADMIN, Role.MPP_OPERATOR, Role.SUPER_ADMIN])
    password = serializers.CharField(write_only=True, min_length=10)
    mpp_codes = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        allow_empty=True,
        help_text="MPP Operators only — the MPPs this operator may read.",
    )

    def validate_username(self, value: str) -> str:
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is already taken.")
        return value

    def validate(self, attrs):
        if attrs["role"] == Role.MPP_OPERATOR and not attrs.get("mpp_codes"):
            raise serializers.ValidationError(
                {"mpp_codes": "An MPP Operator must be assigned at least one MPP."}
            )
        if attrs["role"] != Role.MPP_OPERATOR and attrs.get("mpp_codes"):
            raise serializers.ValidationError(
                {"mpp_codes": "Only MPP Operators take MPP assignments."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        mpp_codes = validated_data.pop("mpp_codes", [])
        password = validated_data.pop("password")

        user = User.objects.create_user(
            **validated_data,
            password=password,
            is_staff=validated_data["role"] == Role.SUPER_ADMIN,
            is_superuser=validated_data["role"] == Role.SUPER_ADMIN,
        )

        if mpp_codes:
            found = MPP.objects.filter(mpp_code__in=mpp_codes)
            missing = set(mpp_codes) - {m.mpp_code for m in found}
            if missing:
                raise serializers.ValidationError(
                    {"mpp_codes": f"Unknown MPP code(s): {', '.join(sorted(missing))}"}
                )
            MPPOperatorAssignment.objects.bulk_create(
                [MPPOperatorAssignment(user=user, mpp=mpp) for mpp in found]
            )
        return user


class AdminUserUpdateSerializer(serializers.Serializer):
    """Activate, deactivate or amend an account (SRS §6.8.1)."""

    full_name = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(required=False, allow_blank=True)
    mobile_no = serializers.CharField(
        required=False, allow_blank=True, validators=[mobile_validator]
    )
    is_active = serializers.BooleanField(required=False)
    role = serializers.ChoiceField(choices=Role.choices, required=False)
    password = serializers.CharField(write_only=True, required=False, min_length=10)

    def validate_role(self, value):
        """
        A role change must not turn an account into something it cannot be.

        Promoting a Mait would leave a user linked to a SAP Sahayak record but holding admin
        rights, and demoting an admin into a Mait would create a field login with no Sahayak
        behind it.
        """
        if self.instance and (self.instance.role == Role.MAIT) != (value == Role.MAIT):
            raise serializers.ValidationError(
                "An account cannot be switched between the Mait role and an office role. "
                "Deactivate it and create the correct kind instead."
            )
        return value

    @transaction.atomic
    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password:
            if instance.role == Role.MAIT:
                raise serializers.ValidationError(
                    {"password": "Maits sign in with an OTP and do not have a password."}
                )
            instance.set_password(password)
        instance.save()

        # Keep the SAP record in step. The Mait's number is the one the OTP is sent to, and
        # having two sources of it that disagree is how a login silently stops working.
        mait = getattr(instance, "mait_profile", None)
        if mait is not None and "mobile_no" in validated_data:
            mait.mobile_no = validated_data["mobile_no"]
            mait.save(update_fields=["mobile_no", "updated_at"])
        return instance


class MaitActivationSerializer(serializers.Serializer):
    """
    Give an existing SAP Sahayak record a login (SRS §6.8.2).

    ``mobile_no`` is accepted here because 2,886 of 3,110 Sahayak records arrive from SAP
    with no number at all, and OTP is a Mait's only way in. Setting it at activation is what
    SRS §6.8.2 describes — "activated by Admin with a mobile number for OTP-based first
    login" — and without it those Maits could never sign in
    (docs/DATA_FINDINGS.md §1).
    """

    sahayak_vendor_code = serializers.CharField()
    mobile_no = serializers.CharField(validators=[mobile_validator])
    username = serializers.CharField(
        max_length=64,
        required=False,
        help_text="Defaults to the Sahayak vendor code.",
    )

    def validate_sahayak_vendor_code(self, value: str) -> str:
        try:
            mait = Mait.objects.select_related("user").get(sahayak_vendor_code=value)
        except Mait.DoesNotExist:
            raise serializers.ValidationError(
                "No Sahayak with that vendor code. Upload the MPP/Sahayak master first."
            ) from None
        if mait.user_id is not None:
            raise serializers.ValidationError("This Mait already has a login.")
        self.context["mait"] = mait
        return value

    def validate_mobile_no(self, value: str) -> str:
        """
        The number must be unique across Maits.

        Two Maits sharing one number would make the login OTP ambiguous — whoever asked
        first would get a code that signs in as the wrong person.
        """
        clash = Mait.objects.filter(mobile_no=value).exclude(mobile_no="").first()
        if clash is not None:
            raise serializers.ValidationError(
                f"{clash.name} ({clash.sahayak_vendor_code}) already uses this number."
            )
        return value

    @transaction.atomic
    def create(self, validated_data):
        mait: Mait = self.context["mait"]
        username = validated_data.get("username") or f"mait{mait.sahayak_vendor_code}"

        if User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError({"username": "That username is already taken."})

        # No password is set: create_user leaves it unusable when none is given, which is
        # what keeps OTP the only route into a field account.
        user = User.objects.create_user(
            username=username,
            full_name=mait.name or username,
            mobile_no=validated_data["mobile_no"],
            role=Role.MAIT,
        )
        mait.user = user
        mait.mobile_no = validated_data["mobile_no"]
        mait.save(update_fields=["user", "mobile_no", "updated_at"])
        return user


class MPPAssignmentSerializer(serializers.Serializer):
    """
    Reassign an MPP to a different Mait (SRS §6.2.2).

    Overrides the SAP-derived default. The assignment is what scopes a Mait's app, so
    changing it moves both the MPP and its members out of one Mait's view and into another's.
    """

    sahayak_vendor_code = serializers.CharField(
        allow_null=True,
        help_text="Null unassigns the MPP, leaving it visible to admins only.",
    )

    def validate_sahayak_vendor_code(self, value):
        if value in (None, ""):
            return None
        try:
            self.context["mait"] = Mait.objects.get(sahayak_vendor_code=value, is_active=True)
        except Mait.DoesNotExist:
            raise serializers.ValidationError("No active Mait with that vendor code.") from None
        return value
