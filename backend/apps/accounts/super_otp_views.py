"""
The portal's Login codes screen (``SuperOTP``): the asks waiting, and generating a code.

Behind its own section, beside Users & roles. Narrowed by zone like every other "who" screen:
a zonal manager with the section sees the Maits and store keepers in their own zone, and a
code for anybody else is a 404, not a button that happens not to be drawn.
"""

from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsAdmin, in_section
from apps.core.scoping import scope_of

from .models import PortalSection, Role, SuperOTP
from .super_otp import _field_user, decline, issue_code, last_sms


class SuperOTPSerializer(serializers.ModelSerializer):
    """One ask or code, with who it is for and what their last SMS did. Never the code."""

    state = serializers.CharField(read_only=True)
    step = serializers.SerializerMethodField()
    for_farmer = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    role = serializers.CharField(source="user.role", read_only=True)
    role_display = serializers.CharField(source="user.get_role_display", read_only=True)
    who = serializers.SerializerMethodField()
    number_on_file = serializers.SerializerMethodField()
    issued_by_name = serializers.SerializerMethodField()
    sms = serializers.SerializerMethodField()

    class Meta:
        model = SuperOTP
        fields = [
            "id",
            "state",
            "purpose",
            "step",
            "for_farmer",
            "farmer_name",
            "context",
            "ai_event_id",
            "status",
            "status_display",
            "full_name",
            "role",
            "role_display",
            "who",
            "mobile_no",
            "number_on_file",
            "reason",
            "requested_at",
            "request_count",
            "issued_by_name",
            "issued_at",
            "expires_at",
            "attempt_count",
            "used_at",
            "decline_reason",
            "sms",
        ]
        read_only_fields = fields

    STEPS = {
        "login": "Sign-in",
        "farmer_verify": "Farmer check",
        "payment_online": "Online payment",
        "payment_cod": "Cash payment",
    }

    def get_step(self, obj) -> str:
        return self.STEPS.get(obj.purpose, obj.purpose)

    def get_for_farmer(self, obj) -> bool:
        """The office calls her, not the Mait who asked — the reveal says so."""
        return obj.purpose != "login"

    def get_who(self, obj) -> str:
        """The line under the name that tells the office which Mait or which store it is."""
        user = obj.user
        if user.role == Role.STORE:
            return f"Store keeper · {user.store.name}" if user.store_id else "Store keeper"
        mait = getattr(user, "mait_profile", None)
        return f"Mait · {mait.sahayak_vendor_code}" if mait else "Mait"

    def get_number_on_file(self, obj) -> str:
        """
        The number to call back — the one on the record, not whoever rang the office.

        For a Mait it is the SAP record's number, which is what sign-in resolves them by; the
        office should dial that and nothing else. For a farmer step it is *her* number, off her
        record — the one the SMS went to, and the only one the code works on.
        """
        if obj.purpose != "login":
            return obj.mobile_no
        mait = getattr(obj.user, "mait_profile", None)
        return (mait.mobile_no if mait else "") or obj.user.mobile_no or obj.mobile_no

    def get_issued_by_name(self, obj) -> str:
        return obj.issued_by.full_name if obj.issued_by_id else ""

    def get_sms(self, obj) -> dict | None:
        return last_sms(obj.mobile_no, obj.purpose)


class DeclineSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True)


class IssueForNumberSerializer(serializers.Serializer):
    mobile_no = serializers.RegexField(r"^[6-9]\d{9}$", max_length=10)


@extend_schema(tags=["super-otp"])
class SuperOTPViewSet(viewsets.ReadOnlyModelViewSet):
    """Sign-in codes for field users whose SMS did not arrive."""

    serializer_class = SuperOTPSerializer
    permission_classes = [IsAdmin, in_section(PortalSection.SUPER_OTP)]
    pagination_class = None

    def get_queryset(self):
        rows = SuperOTP.objects.select_related(
            "user", "user__mait_profile", "user__store", "issued_by"
        ).order_by("-updated_at")
        codes = scope_of(self.request)
        if codes is not None:
            rows = rows.filter(
                Q(user__mait_profile__mpps__plant_code__in=codes)
                | Q(user__store__plants__plant_code__in=codes)
            ).distinct()
        return rows

    @extend_schema(
        summary="Asks and codes",
        description=(
            "`state=open` (the default) for what needs the office: asks waiting, and codes "
            "given and not yet used. `state=all` for the last 200 of everything, used, declined "
            "and expired included."
        ),
    )
    def list(self, request, *args, **kwargs):
        rows = list(self.get_queryset()[:500])
        if request.query_params.get("state", "open") == "open":
            rows = [row for row in rows if row.state in ("waiting", "issued")]
        else:
            rows = rows[:200]
        # Waiting first, oldest ask first — the person who has waited longest is called first.
        rows.sort(
            key=lambda row: (
                row.state != "waiting",
                row.requested_at.timestamp() if row.requested_at else 0,
            )
        )
        return Response(self.get_serializer(rows, many=True).data)

    @extend_schema(
        summary="Generate the code for an ask",
        description=(
            "Returns the code **once**, as `code`, for the admin to read out on the phone. It "
            "is stored only as a hash and is never returned again. Expires in "
            "`SUPER_OTP_EXPIRY_SECONDS`; any earlier code for the same person is revoked."
        ),
        request=None,
        responses={201: OpenApiTypes.OBJECT},
    )
    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        row, code = issue_code(row=self.get_object(), actor=request.user, request=request)
        return self._with_code(row, code)

    @extend_schema(
        summary="Generate a code for somebody who phoned",
        description="No ask from the app needed — for a user who rang the office instead.",
        request=IssueForNumberSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["post"], url_path="issue-for-number")
    def issue_for_number(self, request):
        payload = IssueForNumberSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        mobile_no = payload.validated_data["mobile_no"]
        # The zone rule, before anything is written: generating would revoke the person's live
        # code, and that must not happen on the say-so of somebody who cannot see them.
        user = _field_user(mobile_no)
        if user is not None and not self._in_reach(user):
            return Response(
                {"detail": "That number belongs to somebody outside your zone."},
                status=status.HTTP_404_NOT_FOUND,
            )
        row, code = issue_code(mobile_no=mobile_no, actor=request.user, request=request)
        return self._with_code(row, code)

    def _in_reach(self, user) -> bool:
        codes = scope_of(self.request)
        if codes is None:
            return True
        mait = getattr(user, "mait_profile", None)
        if mait is not None and mait.mpps.filter(plant_code__in=codes).exists():
            return True
        return bool(user.store_id) and user.store.plants.filter(plant_code__in=codes).exists()

    @extend_schema(summary="Decline an ask", request=DeclineSerializer)
    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        payload = DeclineSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        row = decline(
            row=self.get_object(),
            reason=payload.validated_data.get("reason", ""),
            actor=request.user,
            request=request,
        )
        return Response(self.get_serializer(row).data)

    def _with_code(self, row, code: str) -> Response:
        row = get_object_or_404(self.get_queryset(), pk=row.pk)
        body = dict(self.get_serializer(row).data)
        body["code"] = code
        response = Response(body, status=status.HTTP_201_CREATED)
        # The one response that carries a live credential: nothing between here and the
        # admin's screen should keep a copy.
        response["Cache-Control"] = "no-store"
        return response
