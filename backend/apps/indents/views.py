"""
Indent endpoints (SRS §9.8).

Fulfilment happens here: the zonal manager approves, a store keeper hands the stock over and
reads the Mait a code, and the Mait typing that code credits their balance. (Until 2026-09-18
this was to be an integration with Indent Easy, a separate web application; it was dropped
when the keeper's app replaced it.)

Approve/reject/issue are the back-office path, admin-only. An admin marking stock issued is
asserting a handover the platform cannot verify, so what keeps that honest is in
``services.py``: straws are issued by their printed numbers, never as a bare quantity, and a
straw already held or already consumed is refused. Read that module before changing this one.

Approving is the zonal manager's job, and the list is narrowed to their zone the way every
other "who" screen is. Issuing, where a store serves the Mait, belongs to that store's keeper
in the app (``apps.stores``); the portal's own Issue is refused for those indents.
"""

from __future__ import annotations

import django_filters
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import PortalSection, Role
from apps.core.idempotency import idempotent
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin, IsMait, in_section
from apps.core.scoping import scope_of
from apps.core.services import record_audit
from apps.stores.services import store_for_mait

from .models import IndentRequest, stale_indent_q
from .serializers import (
    IndentCollectSerializer,
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
        fields = ["status", "mait", "search", "stale"]

    def filter_search(self, queryset, name, value):
        term = (value or "").strip()
        if not term:
            return queryset
        match = (
            Q(mait__name__icontains=term)
            | Q(breed__icontains=term)
            | Q(store__name__icontains=term)
        )
        # "IND-13" is how every screen prints an indent, so it is how people search for one.
        number = term.upper().removeprefix("IND").lstrip("-# ")
        if number.isdigit():
            match |= Q(pk=int(number))
        return queryset.filter(match)

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
            return [IsAdmin(), in_section(PortalSection.INDENTS)()]
        return [IsAuthenticated(), in_section(PortalSection.INDENTS)()]

    def get_queryset(self):
        base = (
            IndentRequest.objects.select_related("mait", "store", "approved_by")
            .prefetch_related("handovers__store", "approved_by__zones")
            .order_by("-requested_at")
        )
        user = self.request.user
        if getattr(user, "role", None) in (Role.SUPER_ADMIN, Role.ADMIN):
            # A zonal manager approves their own zone's indents and sees no one else's. Through
            # the Mait's collection points, because an indent carries no plant of its own —
            # and scoped here, on the queryset, so approving one outside the zone is a 404
            # rather than a button that happens not to be drawn.
            codes = scope_of(self.request)
            if codes is None:
                return base
            return base.filter(mait__mpps__plant_code__in=codes).distinct()
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

        mait = request.user.mait_profile
        indent = IndentRequest.objects.create(
            mait=mait,
            # Routed now, so the office can see where it will be collected before approving
            # it. Approval routes it again if no store served this Mait yet.
            store=store_for_mait(mait),
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
            "A Mait sees their own; an admin sees all. Filter with `status`, `mait`, "
            "`search`, and `stale=true` for the ones nobody is moving."
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
        return Response(IndentSerializer(self.get_queryset().get(pk=indent.pk)).data)

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
            "The Mait acknowledges that issued stock reached them, and this is where their "
            "balance rises — issuing only sets the stock aside. The only step in the chain the "
            "Mait owns.\n\n"
            "Stock handed over at a store needs `code`: the four digits the store keeper read "
            "out at the counter. A wrong code is refused as `collection-code-invalid`; after "
            "five, `collection-code-locked` until the keeper reads out a new one. Stock issued "
            "from the portal needs no code."
        ),
        request=IndentCollectSerializer,
        responses={200: IndentSerializer},
    )
    @action(detail=True, methods=["post"], url_path="confirm-collection")
    def confirm_collection(self, request, pk=None):
        payload = IndentCollectSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        indent = confirm_collection(
            self.get_object(),
            code=payload.validated_data.get("code"),
            actor=request.user,
            request=request,
        )
        return Response(IndentSerializer(self.get_queryset().get(pk=indent.pk)).data)

    @extend_schema(
        summary="Issue an approved indent",
        description=(
            "Credits the stock to the Mait and closes the indent.\n\n"
            "Straw requests take `straw_numbers` — the number printed on each straw handed "
            "over — and never a bare quantity: the app scans a straw against the Mait's "
            "stock, so a count with no numbers behind it credits a balance nothing can be "
            "scanned against. Consumable requests take `qty`.\n\n"
            "Issuing fewer than were requested is allowed and closes the indent; the "
            "remainder needs a fresh request.\n\n"
            "Refused for an indent routed to a store: that store's keeper hands it over from "
            "the app (`/store/indents/{id}/issue/`), and part-issues stay open there."
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
