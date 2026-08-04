"""
Authentication endpoints (SRS §9.1).

Two ways in, deliberately separate:

* **Admin and MPP Operator** — username and password.
* **Mait** — mobile OTP only. A field phone is shared, lost and handed around, so there is
  no password on a Mait account to steal or reuse.

Everything here is rate limited. These endpoints are the front door, and the OTP ones are
the fraud surface (SRS §16).
"""

from __future__ import annotations

import contextlib
import logging

from django.utils import timezone
from drf_spectacular.utils import OpenApiExample, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.exceptions import OTPInvalid
from apps.core.models import AuditLog
from apps.core.services import record_audit
from apps.masterdata.models import Mait
from apps.payments.models import OTPLog
from apps.payments.services import issue_otp, verify_otp

from .models import Role, User
from .serializers import (
    CurrentUserSerializer,
    LogoutSerializer,
    OTPSendSerializer,
    OTPVerifySerializer,
    PasswordLoginSerializer,
    TokenPairSerializer,
)

logger = logging.getLogger(__name__)


@extend_schema(tags=["auth"])
class PasswordLoginView(APIView):
    """Username/password login for Admin and MPP Operator."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = "login"

    @extend_schema(
        summary="Log in with a username and password",
        description=(
            "For Admin and MPP Operator accounts. Maits authenticate through "
            "`/auth/otp/send/` and `/auth/otp/verify/` instead."
        ),
        request=PasswordLoginSerializer,
        responses={200: TokenPairSerializer},
    )
    def post(self, request):
        serializer = PasswordLoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        user.touch_login()

        record_audit(
            action=AuditLog.Action.LOGIN,
            entity_type="user",
            entity_id=user.id,
            actor=user,
            request=request,
            meta={"method": "password", "role": user.role},
        )
        return Response(TokenPairSerializer.for_user(user))


@extend_schema(tags=["auth"])
class OTPSendView(APIView):
    """Send a login OTP to a Mait's registered mobile (SRS §6.8.2)."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = "otp_send"

    @extend_schema(
        summary="Send a login OTP",
        description=(
            "Always returns 200, whether or not the number is registered. Confirming which "
            "numbers exist would let anyone enumerate the field workforce.\n\n"
            "A Mait whose SAP record has no mobile number cannot receive an OTP at all; an "
            "Admin sets one at activation (SRS §6.8.2)."
        ),
        request=OTPSendSerializer,
        responses={200: dict},
        examples=[OpenApiExample("Request", value={"mobile_no": "9795402473"})],
    )
    def post(self, request):
        serializer = OTPSendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        mobile_no = serializer.validated_data["mobile_no"]

        user = self._resolve_mait_user(mobile_no)
        if user is not None:
            issue_otp(mobile_no=mobile_no, purpose=OTPLog.Purpose.LOGIN)
        else:
            # Logged, not returned. The caller gets the same response either way.
            logger.info("Login OTP requested for an unregistered number")

        return Response(
            {
                "detail": "If this number is registered, an OTP has been sent to it.",
                "expires_in_seconds": 300,
            }
        )

    @staticmethod
    def _resolve_mait_user(mobile_no: str) -> User | None:
        """
        Find the active Mait login behind a mobile number.

        Matched on the Mait record rather than ``User.mobile_no`` because SAP is the source
        of that number, and an Admin activating an account may set it on either.
        """
        mait = (
            Mait.objects.select_related("user")
            .filter(mobile_no=mobile_no, is_active=True, user__isnull=False)
            .first()
        )
        if mait and mait.user and mait.user.is_active:
            return mait.user
        return User.objects.filter(mobile_no=mobile_no, role=Role.MAIT, is_active=True).first()


@extend_schema(tags=["auth"])
class OTPVerifyView(APIView):
    """Verify a login OTP and issue tokens."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = "otp_verify"

    @extend_schema(
        summary="Verify a login OTP",
        description=(
            "Expires after 5 minutes; 3 wrong attempts force a resend (SRS §6.5.1). "
            "Every send and every attempt is logged for fraud review."
        ),
        request=OTPVerifySerializer,
        responses={200: TokenPairSerializer},
    )
    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        mobile_no = serializer.validated_data["mobile_no"]

        # Raises OTPInvalid / OTPExpired / OTPAttemptsExceeded, each a distinct problem
        # type so the app can tell the Mait what to actually do next.
        verify_otp(
            mobile_no=mobile_no,
            purpose=OTPLog.Purpose.LOGIN,
            code=serializer.validated_data["otp"],
        )

        user = OTPSendView._resolve_mait_user(mobile_no)
        if user is None:
            # The OTP was valid but the account has since been deactivated. Refusing here
            # keeps a revoked Mait from trading a stale code for a fresh token.
            raise OTPInvalid("This account is no longer active. Contact your administrator.")

        user.touch_login()
        record_audit(
            action=AuditLog.Action.LOGIN,
            entity_type="user",
            entity_id=user.id,
            actor=user,
            request=request,
            meta={"method": "otp", "role": user.role},
        )
        return Response(TokenPairSerializer.for_user(user))


@extend_schema(tags=["auth"])
class LogoutView(APIView):
    """Blacklist the current refresh token (SRS §16)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Log out",
        description=(
            "Blacklists the refresh token so it cannot be exchanged again. The access token "
            "remains valid until it expires — it is short-lived by design (~15 min), and "
            "revoking it would mean a database lookup on every request, which is exactly "
            "what stateless JWT avoids."
        ),
        request=LogoutSerializer,
        responses={205: None},
    )
    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Already blacklisted or expired is fine — logging out twice is not an error.
        with contextlib.suppress(TokenError):
            RefreshToken(serializer.validated_data["refresh"]).blacklist()

        record_audit(
            action=AuditLog.Action.LOGOUT,
            entity_type="user",
            entity_id=request.user.id,
            request=request,
        )
        return Response(status=status.HTTP_205_RESET_CONTENT)


@extend_schema(tags=["auth"])
class CurrentUserView(APIView):
    """The authenticated user's profile and scope."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Current user",
        description=(
            "The first call the mobile app makes after login. For a Mait it returns their "
            "assigned MPP codes, which scope everything the app will show."
        ),
        responses={200: CurrentUserSerializer},
    )
    def get(self, request):
        return Response(CurrentUserSerializer(request.user).data)


@extend_schema(tags=["auth"])
class ServerTimeView(APIView):
    """
    Server time, for the offline queue.

    The app timestamps events captured without connectivity, and field devices drift. This
    lets the client measure its own offset so a synced event reports when the insemination
    actually happened rather than when the phone thought it did (SRS §6.3.2).
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(summary="Server time", responses={200: dict})
    def get(self, request):
        return Response({"server_time": timezone.now().isoformat()})
