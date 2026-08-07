"""
Admin user management (SRS §6.8, §9.10).

Creating logins and handing out roles is the most privileged thing the API does, so every
action here is audit-logged with the acting admin — an account that appears without a trace
of who created it is exactly what an audit is meant to catch.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Prefetch, Q
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
    MaitUpdateSerializer,
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
        summary="Create an office account",
        description=(
            "Maits are not created here. They are activated from an existing Mait record via "
            "`/admin/users/activate-mait/`, so every field login traces back to a real one."
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
            "Gives an existing Mait record a login and sets the mobile number their OTP will "
            "be sent to.\n\n"
            "The number is set here because SAP records routinely arrive without one, and "
            "OTP is a Mait's only way in. No password is created — that is what keeps OTP "
            "the sole route into a field account."
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
            "Maits with no login yet, so an admin can work through them. "
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

    @extend_schema(
        summary="Correct one Mait's number or coverage",
        description=(
            "Mobile and MPP coverage together, because they are corrected together — an "
            "operator on the phone to a Sahayak fixes both in one conversation.\n\n"
            "`mpp_codes` is the complete set this Mait covers, not an addition: MPPs missing "
            "from it are unassigned. Every field is optional and absence leaves it alone.\n\n"
            "The assignment is what scopes a Mait's whole app, so this moves MPPs and their "
            "members between Maits (SRS §6.2.2–6.2.3)."
        ),
        request=MaitUpdateSerializer,
        responses={200: dict},
    )
    @action(detail=False, methods=["patch"], url_path=r"maits/(?P<vendor_code>[^/.]+)")
    def update_mait(self, request, vendor_code=None):
        try:
            mait = Mait.objects.get(sahayak_vendor_code=vendor_code)
        except Mait.DoesNotExist:
            return Response({"detail": "No such Mait."}, status=status.HTTP_404_NOT_FOUND)

        serializer = MaitUpdateSerializer(data=request.data)
        serializer.instance = mait
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        before = {
            "mobile_no": mait.mobile_no,
            "mpp_codes": sorted(mpp.mpp_code for mpp in mait.mpps.all()),
        }

        with transaction.atomic():
            fields = []
            if data.get("name"):
                mait.name = data["name"]
                fields.append("name")
            if "mobile_no" in data:
                mait.mobile_no = data["mobile_no"]
                fields.append("mobile_no")
            if fields:
                mait.save(update_fields=[*fields, "updated_at"])

            if "mpp_codes" in data:
                # Set semantics, not append: the screen sends what the Mait covers, so an MPP
                # dropped from the list is one they no longer work and must stop seeing.
                keep = set(data["mpp_codes"])
                MPP.objects.filter(mait=mait).exclude(mpp_code__in=keep).update(mait=None)
                MPP.objects.filter(mpp_code__in=keep).update(mait=mait)

        mait.refresh_from_db()
        after = {
            "mobile_no": mait.mobile_no,
            "mpp_codes": sorted(mpp.mpp_code for mpp in mait.mpps.all()),
        }

        record_audit(
            action=AuditLog.Action.UPDATE,
            entity_type="mait",
            entity_id=mait.id,
            request=request,
            meta={
                "sahayak_vendor_code": mait.sahayak_vendor_code,
                "before": before,
                "after": after,
            },
        )

        return Response(
            {
                "id": mait.id,
                "sahayak_vendor_code": mait.sahayak_vendor_code,
                "name": mait.name,
                "mobile_no": mait.mobile_no,
                "needs_mobile": not mait.mobile_no,
                "is_active": mait.is_active,
                "activated": mait.user_id is not None,
                "mpp_codes": after["mpp_codes"],
                "mpp_count": len(after["mpp_codes"]),
            }
        )

    @extend_schema(
        summary="The Mait roster",
        description=(
            "Every Mait on the current roster, activated or not — the list the admin "
            "portal's Maits screen works from.\n\n"
            "Separate from `/admin/users/` because much of the roster has no login yet, and "
            "a user-only list would show the handful already activated and silently omit "
            "everyone still waiting.\n\n"
            "Filter with `?needs_mobile=true`, `?activated=false`, `?mpp=<code>` or "
            "`?search=<name or code>`.\n\n"
            "Retired records are excluded unless `?include_retired=true`. Those are the "
            "pseudo-Maits the MPP master used to mint from its Sahayak column, kept so old "
            "AI events still name somebody (SRS §18.2)."
        ),
        responses={200: dict},
    )
    @action(detail=False, methods=["get"], url_path="maits")
    def maits(self, request):
        roster = Mait.objects.select_related("user").prefetch_related("mpps")

        # Retired records are out by default. The MPP master used to mint a Mait per village
        # from its Sahayak column, and those 3,108 rows are kept only so old AI events still
        # name somebody — counting them turns a roster of sixty-three into one of thousands
        # and reports an activation backlog that nobody is ever going to work through.
        include_retired = request.query_params.get("include_retired") in ("true", "1")
        if not include_retired:
            roster = roster.filter(is_active=True)

        search = (request.query_params.get("search") or "").strip()
        if search:
            roster = roster.filter(
                Q(name__icontains=search)
                | Q(sahayak_vendor_code__icontains=search)
                | Q(mobile_no__icontains=search)
            )

        needs_mobile = request.query_params.get("needs_mobile")
        if needs_mobile in ("true", "1"):
            roster = roster.filter(mobile_no="")

        activated = request.query_params.get("activated")
        if activated in ("true", "1"):
            roster = roster.filter(user__isnull=False)
        elif activated in ("false", "0"):
            roster = roster.filter(user__isnull=True)

        mpp_code = request.query_params.get("mpp")
        if mpp_code:
            roster = roster.filter(mpps__mpp_code=mpp_code)

        roster = roster.order_by("name")
        page = self.paginate_queryset(roster)

        # Counted over the whole roster rather than this page: the banner reports the size of
        # the activation backlog, which a filtered count would understate. Retired rows follow
        # whatever the caller asked for, so the banner and the table always agree.
        everyone = Mait.objects.all() if include_retired else Mait.objects.filter(is_active=True)
        rows = [
            {
                "id": mait.id,
                "sahayak_vendor_code": mait.sahayak_vendor_code,
                "name": mait.name,
                "mobile_no": mait.mobile_no,
                "needs_mobile": not mait.mobile_no,
                "is_active": mait.is_active,
                "activated": mait.user_id is not None,
                "mpp_codes": [mpp.mpp_code for mpp in mait.mpps.all()],
                "mpp_count": len(mait.mpps.all()),
            }
            for mait in page
        ]
        response = self.get_paginated_response(rows)
        response.data["summary"] = {
            "total": everyone.count(),
            "activated": everyone.filter(user__isnull=False).count(),
            "without_mobile": everyone.filter(mobile_no="").count(),
        }
        return response
