"""
Indent endpoints (SRS §9.8).

Read and raise only. Fulfilment lives in Indent Easy — this platform pushes the request out
and credits stock when the GRN callback arrives (SRS §6.6.2–6.6.3), so there is deliberately
no way to mark an indent issued from here. An admin who could would be creating stock that
no depot ever handed over.
"""

from __future__ import annotations

import django_filters
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Role
from apps.core.idempotency import idempotent
from apps.core.models import AuditLog
from apps.core.permissions import IsMait
from apps.core.services import record_audit

from .models import IndentRequest
from .serializers import IndentCreateSerializer, IndentSerializer

# An approved indent that has not been issued after this long is not moving on its own.
STALE_AFTER_DAYS = 7


class IndentFilter(django_filters.FilterSet):
    mait = django_filters.NumberFilter(field_name="mait_id")
    search = django_filters.CharFilter(method="filter_search")
    stale = django_filters.BooleanFilter(method="filter_stale")

    class Meta:
        model = IndentRequest
        fields = ["status", "sync_status", "mait", "search", "stale"]

    def filter_search(self, queryset, name, value):
        term = (value or "").strip()
        if not term:
            return queryset
        return queryset.filter(
            Q(mait__name__icontains=term)
            | Q(indent_easy_ref_no__icontains=term)
            | Q(breed__icontains=term)
        )

    def filter_stale(self, queryset, name, value):
        """
        Approved but never issued, or never pushed to Indent Easy at all.

        Both mean a Mait is waiting on stock that nobody is actually bringing, which is the
        one thing about indents an admin has to notice without being told.
        """
        if not value:
            return queryset
        cutoff = timezone.now() - timezone.timedelta(days=STALE_AFTER_DAYS)
        return queryset.filter(
            Q(status=IndentRequest.Status.APPROVED, requested_at__lt=cutoff)
            | Q(sync_status=IndentRequest.SyncStatus.FAILED)
        )


@extend_schema(tags=["indents"])
class IndentViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Stock requests, raised by a Mait and watched by an admin (SRS §9.8)."""

    queryset = IndentRequest.objects.none()  # for schema generation; see get_queryset
    filterset_class = IndentFilter
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action == "create":
            return [IsMait()]
        return [IsAuthenticated()]

    def get_queryset(self):
        base = IndentRequest.objects.select_related("mait").order_by("-requested_at")
        user = self.request.user
        if getattr(user, "role", None) in (Role.SUPER_ADMIN, Role.ADMIN):
            return base
        mait = getattr(user, "mait_profile", None)
        if mait is None:
            return base.none()
        return base.filter(mait=mait)

    def get_serializer_class(self):
        return IndentCreateSerializer if self.action == "create" else IndentSerializer

    @extend_schema(
        summary="Raise a stock indent",
        description=(
            "Straws are requested by breed, not by straw number — which physical straws are "
            "issued is decided at the depot.\n\n"
            "Accepts an `Idempotency-Key`: the app queues indents offline alongside AI "
            "events, and a blind retry must not raise the request twice."
        ),
        request=IndentCreateSerializer,
        responses={201: IndentSerializer},
    )
    @idempotent(endpoint="indents.create")
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        indent = IndentRequest.objects.create(
            mait=request.user.mait_profile,
            product_type=data["product_type"],
            product_ref_id=data.get("product_ref_id"),
            breed=(data.get("breed") or "").strip(),
            qty_requested=data["qty_requested"],
            note=(data.get("note") or "").strip(),
        )

        record_audit(
            action=AuditLog.Action.CREATE,
            entity_type="indent",
            entity_id=indent.id,
            request=request,
            meta={"qty": indent.qty_requested, "breed": indent.breed},
        )
        return Response(IndentSerializer(indent).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="List indents",
        description=(
            "A Mait sees their own; an admin sees all. Filter with `status`, `sync_status`, "
            "`mait`, `search`, and `stale=true` for the ones nobody is moving."
        ),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)
