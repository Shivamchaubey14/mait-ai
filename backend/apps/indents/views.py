"""
Indent endpoints (SRS §9.8).

Fulfilment belongs to Indent Easy: this platform pushes the request out and credits stock
when the GRN callback arrives (SRS §6.6.2–6.6.3). That integration is not built yet
(ROADMAP phase 5, days 20–22), and until it is, an indent raised in the app can never leave
``requested``.

So approve/reject/issue exist here as the manual back-office path, admin-only. They were
deliberately absent before, and the reason still stands — an admin marking stock issued is
asserting a handover the platform cannot verify. What keeps that honest is in
``services.py``: straws are issued by their printed numbers, never as a bare quantity, and a
straw already held or already consumed is refused. Read that module before changing this one.
"""

from __future__ import annotations

import django_filters
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Role
from apps.core.idempotency import idempotent
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin, IsMait
from apps.core.services import record_audit

from .models import IndentRequest, stale_indent_q
from .serializers import (
    IndentCreateSerializer,
    IndentIssueSerializer,
    IndentRejectSerializer,
    IndentSerializer,
)
from .services import approve_indent, confirm_collection, issue_indent, reject_indent


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
        The ones nobody is moving — `stale_indent_q`, which the dashboard's exception queue
        counts with too, so a count there opens onto exactly the rows it counted.
        """
        if not value:
            return queryset
        return queryset.filter(stale_indent_q())


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
        if self.action in ("create", "confirm_collection"):
            # Collection is the Mait's own acknowledgement, and the queryset already scopes
            # them to their own indents — so this is theirs to confirm, nobody else's.
            return [IsMait()]
        # Fulfilment is a back-office decision. Enforced here rather than by hiding buttons —
        # a Mait who could approve their own request could credit themselves stock.
        if self.action in ("approve", "reject", "issue"):
            return [IsAdmin()]
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

    @extend_schema(
        summary="Approve an indent",
        description="Agrees to the request. Moves no stock — that is `issue`.",
        request=None,
        responses={200: IndentSerializer},
    )
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        indent = approve_indent(self.get_object(), actor=request.user, request=request)
        return Response(IndentSerializer(indent).data)

    @extend_schema(
        summary="Reject an indent",
        description=(
            "Declines the request. The reason is stored on the indent, where the Mait can "
            "read it, rather than only in the audit log."
        ),
        request=IndentRejectSerializer,
        responses={200: IndentSerializer},
    )
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        payload = IndentRejectSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        indent = reject_indent(
            self.get_object(),
            reason=payload.validated_data.get("reason", ""),
            actor=request.user,
            request=request,
        )
        return Response(IndentSerializer(indent).data)

    @extend_schema(
        summary="Confirm collection",
        description=(
            "The Mait acknowledges that issued stock reached them. Moves no stock — the "
            "balance rose when it was issued — and is the only step in the chain the Mait "
            "owns. Allowed once, on an issued indent."
        ),
        request=None,
        responses={200: IndentSerializer},
    )
    @action(detail=True, methods=["post"], url_path="confirm-collection")
    def confirm_collection(self, request, pk=None):
        indent = confirm_collection(self.get_object(), actor=request.user, request=request)
        return Response(IndentSerializer(indent).data)

    @extend_schema(
        summary="Issue an approved indent",
        description=(
            "Credits the stock to the Mait and closes the indent.\n\n"
            "Straw requests take `straw_numbers` — the number printed on each straw handed "
            "over — and never a bare quantity: the app scans a straw against the Mait's "
            "stock, so a count with no numbers behind it credits a balance nothing can be "
            "scanned against. Consumable requests take `qty`.\n\n"
            "Issuing fewer than were requested is allowed and closes the indent; the "
            "remainder needs a fresh request."
        ),
        request=IndentIssueSerializer,
        responses={200: IndentSerializer},
    )
    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        payload = IndentIssueSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        indent = issue_indent(
            self.get_object(),
            straw_numbers=payload.validated_data.get("straw_numbers"),
            qty=payload.validated_data.get("qty"),
            actor=request.user,
            request=request,
        )
        return Response(IndentSerializer(indent).data)
