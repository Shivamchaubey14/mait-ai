"""
Admin user management (SRS §6.8, §9.10).

Creating logins and handing out roles is the most privileged thing the API does, so every
action here is audit-logged with the acting admin — an account that appears without a trace
of who created it is exactly what an audit is meant to catch.
"""

from __future__ import annotations

from django.db.models import Prefetch
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin
from apps.core.services import record_audit
from apps.masterdata.models import MPP, Mait

from .admin_serializers import (
    AdminUserCreateSerializer,
    AdminUserSerializer,
    AdminUserUpdateSerializer,
    MaitActivationSerializer,
)
from .models import Role, User


@extend_schema(tags=["auth"])
class AdminUserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Platform user administration (SRS §9.10)."""

    permission_classes = [IsAdmin]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["role", "is_active"]
    search_fields = ["username", "full_name", "mobile_no"]
    ordering_fields = ["created_at", "username", "last_login_at"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return User.objects.select_related("mait_profile").prefetch_related(
            Prefetch("mait_profile__mpps", queryset=MPP.objects.only("id", "mait_id"))
        )

    def get_serializer_class(self):
        if self.action == "create":
            return AdminUserCreateSerializer
        if self.action in ("update", "partial_update"):
            return AdminUserUpdateSerializer
        return AdminUserSerializer

    @extend_schema(
        summary="Create an Admin or MPP Operator",
        description=(
            "Maits are not created here. They are activated from an existing SAP Sahayak "
            "record via `/admin/users/activate-mait/`, so every field login traces back to "
            "a real Sahayak."
        ),
        request=AdminUserCreateSerializer,
        responses={201: AdminUserSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = AdminUserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        record_audit(
            action=AuditLog.Action.CREATE,
            entity_type="user",
            entity_id=user.id,
            request=request,
            meta={"username": user.username, "role": user.role},
        )
        return Response(AdminUserSerializer(user).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Update, activate or deactivate an account",
        request=AdminUserUpdateSerializer,
        responses={200: AdminUserSerializer},
    )
    def partial_update(self, request, *args, **kwargs):
        user = self.get_object()
        before = {"is_active": user.is_active, "role": user.role, "mobile_no": user.mobile_no}

        serializer = AdminUserUpdateSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        record_audit(
            action=AuditLog.Action.UPDATE,
            entity_type="user",
            entity_id=user.id,
            request=request,
            meta={
                "before": before,
                "after": {
                    "is_active": user.is_active,
                    "role": user.role,
                    "mobile_no": user.mobile_no,
                },
                # Never record whether a password was involved beyond the fact of it.
                "password_reset": "password" in request.data,
            },
        )
        return Response(AdminUserSerializer(user).data)

    @extend_schema(
        summary="Activate a Mait",
        description=(
            "Gives an existing SAP Sahayak record a login and sets the mobile number their "
            "OTP will be sent to.\n\n"
            "The number is set here because 2,886 of 3,110 Sahayak records arrive from SAP "
            "without one, and OTP is a Mait's only way in. No password is created — that is "
            "what keeps OTP the sole route into a field account."
        ),
        request=MaitActivationSerializer,
        responses={201: AdminUserSerializer},
    )
    @action(detail=False, methods=["post"], url_path="activate-mait")
    def activate_mait(self, request):
        serializer = MaitActivationSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        record_audit(
            action=AuditLog.Action.CREATE,
            entity_type="user",
            entity_id=user.id,
            request=request,
            meta={
                "username": user.username,
                "role": Role.MAIT,
                "sahayak_vendor_code": request.data.get("sahayak_vendor_code"),
                "activated": True,
            },
        )
        return Response(AdminUserSerializer(user).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Maits awaiting activation",
        description=(
            "Sahayak records with no login yet, so an admin can work through them. "
            "`needs_mobile` flags the ones whose SAP record has no number — those cannot "
            "receive an OTP until one is supplied at activation."
        ),
        responses={200: dict},
    )
    @action(detail=False, methods=["get"], url_path="pending-maits")
    def pending_maits(self, request):
        pending = Mait.objects.filter(user__isnull=True, is_active=True).order_by("name")
        without_mobile = pending.filter(mobile_no="").count()

        page = self.paginate_queryset(pending)
        rows = [
            {
                "sahayak_vendor_code": m.sahayak_vendor_code,
                "name": m.name,
                "mobile_no": m.mobile_no,
                "needs_mobile": not m.mobile_no,
                "mpp_count": m.mpps.count(),
            }
            for m in page
        ]
        response = self.get_paginated_response(rows)
        response.data["summary"] = {
            "pending_total": pending.count(),
            "without_mobile": without_mobile,
        }
        return response
