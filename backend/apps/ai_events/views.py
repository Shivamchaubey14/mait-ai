"""
AI event endpoints (SRS §9.6).

Thin by design: each view parses HTTP, calls one function in ``services.py`` and renders the
result. Every rule about what may follow what lives in the state machine, so there is exactly
one place to read — and one place to get it wrong.
"""

from __future__ import annotations

import django_filters
from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Role
from apps.core.idempotency import idempotent
from apps.core.models import AuditLog
from apps.core.permissions import IsMait
from apps.core.services import record_audit

from .models import AIEvent
from .serializers import AIEventCreateSerializer, AIEventSerializer, AIEventTimelineSerializer
from .services import start_ai_event


class AIEventFilter(django_filters.FilterSet):
    """The filters the admin list and the Mait's own history need (SRS §9.6)."""

    mpp = django_filters.CharFilter(field_name="mpp__mpp_code")
    mait = django_filters.NumberFilter(field_name="mait_id")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = AIEvent
        fields = ["status", "mpp", "mait", "date_from", "date_to"]


@extend_schema(tags=["ai-events"])
class AIEventViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Capture and read AI events (SRS §6.3, §11)."""

    # Declared for schema generation only — every request goes through get_queryset below,
    # which scopes to the caller. Without it the generator cannot resolve the model and types
    # the `id` path parameter as a string.
    queryset = AIEvent.objects.none()
    filterset_class = AIEventFilter
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        # Capture happens in the field, by the Mait standing with the animal. Reading is
        # wider: an admin resolving a dispute needs the same record.
        if self.action == "create":
            return [IsMait()]
        return [IsAuthenticated()]

    def get_queryset(self):
        """
        A Mait sees their own events; an admin sees everything (SRS §16).

        Anyone else sees nothing rather than an error — a role that should not be here is a
        configuration problem, not something to explain to the caller.
        """
        base = AIEvent.objects.select_related(
            "mpp", "member", "non_member", "animal", "mait"
        ).order_by("-created_at")

        user = self.request.user
        if getattr(user, "role", None) in (Role.SUPER_ADMIN, Role.ADMIN):
            return base

        mait = getattr(user, "mait_profile", None)
        if mait is None:
            return base.none()
        return base.filter(mait=mait)

    def get_serializer_class(self):
        if self.action == "create":
            return AIEventCreateSerializer
        return AIEventSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["mait"] = getattr(self.request.user, "mait_profile", None)
        return context

    # -- create --------------------------------------------------------------------------
    def _replay(self, client_uuid, mait):
        """
        Return the event this ``client_uuid`` already created, if there is one.

        The offline queue retries blindly — it cannot tell "never arrived" from "arrived and
        the response was lost" (ADR 0003). Answering with the existing event turns that retry
        into a no-op instead of a second insemination record for one animal.
        """
        if not client_uuid:
            return None
        try:
            existing = AIEvent.objects.filter(client_uuid=client_uuid).first()
        except (DjangoValidationError, ValueError, TypeError):
            # Not a UUID at all. Let the serializer produce the readable field error.
            return None
        if existing is None:
            return None
        if existing.mait_id != mait.id:
            raise serializers.ValidationError(
                {"client_uuid": "This event id belongs to another Mait's capture."}
            )
        return existing

    @extend_schema(
        summary="Start an AI event",
        description=(
            "Creates the capture and, when `straw_unique_no` is supplied, validates that "
            "straw against the Mait's stock in the same transaction — the event comes back "
            "as `straw_verified`. Omit the straw to keep a `draft` to return to.\n\n"
            "No stock is deducted here. Inventory moves only at completion, so an abandoned "
            "capture leaves the Mait's holding untouched.\n\n"
            "Send the device-generated `client_uuid` on every retry: a repeat returns `200` "
            "with the event already created rather than recording the insemination twice."
        ),
        request=AIEventCreateSerializer,
        responses={201: AIEventSerializer, 200: AIEventSerializer},
    )
    @idempotent(endpoint="ai-events.create")
    def create(self, request, *args, **kwargs):
        mait = getattr(request.user, "mait_profile", None)

        replayed = self._replay(request.data.get("client_uuid"), mait)
        if replayed is not None:
            return Response(AIEventSerializer(replayed).data, status=status.HTTP_200_OK)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        event = start_ai_event(
            mait=mait,
            mpp=data["mpp"],
            owner_type=data["owner_type"],
            owner=data["owner"],
            animal=data["animal"],
            client_uuid=data["client_uuid"],
            straw_unique_no=data.get("straw_unique_no", ""),
            actor=request.user,
        )

        record_audit(
            action=AuditLog.Action.CREATE,
            entity_type="ai_event",
            entity_id=event.id,
            request=request,
            meta={
                "status": event.status,
                "mpp_code": event.mpp.mpp_code,
                "straw": event.straw_unique_no,
            },
        )
        return Response(AIEventSerializer(event).data, status=status.HTTP_201_CREATED)

    # -- read ----------------------------------------------------------------------------
    @extend_schema(
        summary="Step-by-step audit trail",
        description=(
            "Every transition the event has been through, in order, with who made it. This "
            "is the record a dispute is settled from, so it is readable rather than raw."
        ),
        responses={200: AIEventTimelineSerializer(many=True)},
    )
    @action(detail=True, methods=["get"])
    def timeline(self, request, pk=None):
        event = self.get_object()
        entries = event.timeline_entries.select_related("actor").all()
        return Response(AIEventTimelineSerializer(entries, many=True).data)

    @extend_schema(
        summary="List AI events",
        description=(
            "Scoped to the caller: a Mait sees their own captures, an admin sees all of "
            "them. Filter with `status`, `mpp`, `mait`, `date_from` and `date_to`."
        ),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)
