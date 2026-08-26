"""Authentication serializers (SRS §9.1, §6.8)."""

from __future__ import annotations

from django.contrib.auth import authenticate
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Role, User, mobile_validator


class TokenPairSerializer(serializers.Serializer):
    """The JWT pair every successful login returns."""

    access = serializers.CharField(read_only=True)
    refresh = serializers.CharField(read_only=True)

    @staticmethod
    def for_user(user: User) -> dict[str, str]:
        refresh = RefreshToken.for_user(user)
        # Carried in the token so the mobile app can branch on role without a second
        # round trip at startup. Authorisation still re-checks server-side on every
        # request — this is a convenience, never the basis for a permission decision.
        refresh["role"] = user.role
        refresh["full_name"] = user.full_name
        return {"access": str(refresh.access_token), "refresh": str(refresh)}


class PasswordLoginSerializer(serializers.Serializer):
    """
    Username/password login for Admin accounts (SRS §9.1).

    Maits are excluded by design: they authenticate by mobile OTP and their accounts carry
    an unusable password. Allowing a password here would create a second, weaker way into a
    field account.
    """

    username = serializers.CharField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate(self, attrs):
        user = authenticate(
            request=self.context.get("request"),
            username=attrs["username"],
            password=attrs["password"],
        )
        # One message for every failure mode. Distinguishing "no such user" from "wrong
        # password" hands an attacker a way to enumerate valid usernames.
        if user is None:
            raise serializers.ValidationError("Incorrect username or password.")
        if not user.is_active:
            raise serializers.ValidationError("This account has been deactivated.")
        if user.role == Role.MAIT:
            raise serializers.ValidationError(
                "Maits sign in with a mobile OTP. Use the app, or ask an administrator."
            )

        attrs["user"] = user
        return attrs


class OTPSendSerializer(serializers.Serializer):
    """Request a login OTP for a Mait (SRS §6.8.2)."""

    mobile_no = serializers.CharField(validators=[mobile_validator])


class OTPVerifySerializer(serializers.Serializer):
    """Verify the login OTP and exchange it for tokens."""

    mobile_no = serializers.CharField(validators=[mobile_validator])
    otp = serializers.CharField(min_length=4, max_length=8)


class LogoutSerializer(serializers.Serializer):
    """Blacklist a refresh token so a stolen one cannot outlive the session (SRS §16)."""

    refresh = serializers.CharField()

    def validate_refresh(self, value: str) -> str:
        try:
            RefreshToken(value)
        except Exception as exc:  # any malformed token is simply invalid
            raise serializers.ValidationError("This refresh token is not valid.") from exc
        return value


class CurrentUserSerializer(serializers.ModelSerializer):
    """
    The authenticated user's profile (`GET /auth/me/`).

    For a Mait this also carries their assigned MPP codes, because it is the first call the
    app makes after login and the answer scopes everything the app will show (SRS §6.2.3).
    An Admin has no MPP scope, so the list is empty for them.
    """

    role_display = serializers.CharField(source="get_role_display", read_only=True)
    mait_id = serializers.SerializerMethodField()
    sahayak_vendor_code = serializers.SerializerMethodField()
    assigned_mpp_codes = serializers.SerializerMethodField()
    portal_sections = serializers.SerializerMethodField()

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
            "mait_id",
            "sahayak_vendor_code",
            "assigned_mpp_codes",
            "portal_sections",
        ]
        read_only_fields = fields

    def get_portal_sections(self, obj) -> list[str]:
        """
        The portal sections this account may open, in sidebar order.

        What the admin portal draws its sidebar from, and empty for a Mait — the app has no
        sections. It is a convenience, never the control: every endpoint behind a section
        checks for itself, because a sidebar has no say over a URL typed into the bar.
        """
        return obj.allowed_sections

    def _mait(self, obj):
        return getattr(obj, "mait_profile", None)

    def get_mait_id(self, obj) -> int | None:
        mait = self._mait(obj)
        return mait.id if mait else None

    def get_sahayak_vendor_code(self, obj) -> str | None:
        mait = self._mait(obj)
        return mait.sahayak_vendor_code if mait else None

    def get_assigned_mpp_codes(self, obj) -> list[str]:
        mait = self._mait(obj)
        if mait is not None:
            return list(mait.mpps.values_list("mpp_code", flat=True))
        return []
