"""
AI event endpoints (SRS §9.6).

Thin by design: each view parses HTTP, calls one function in ``services.py`` and renders the
result. Every rule about what may follow what lives in the state machine, so there is exactly
one place to read — and one place to get it wrong.
"""

from __future__ import annotations

import django_filters
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Role
from apps.core.idempotency import idempotent
from apps.core.models import AuditLog
from apps.core.permissions import IsMait
from apps.core.services import record_audit
from apps.core.timeframe import end_of_day, start_of_day

from .models import AIEvent
from .serializers import (
    AIEventCompleteSerializer,
    AIEventCreateSerializer,
    AIEventPhotoSerializer,
    AIEventSerializer,
    AIEventTimelineSerializer,
)
from .services import attach_photo, complete_ai_event, start_ai_event
from .storage import store_photo


def search_events(queryset, term: str):
    """
    The three things someone actually has to hand when chasing an event.

    A straw number comes off a complaint, a farmer's name off a phone call, a Mait's name off
    a roster. Searching all three from one box means the operator does not have to know which
    kind of thing they are holding.

    Shared with the CSV export rather than reimplemented there: a report is defined by the
    filters that produced it, and an export that quietly ignored the search would hand back a
    file disagreeing with the screen it was taken from.
    """
    term = (term or "").strip()
    if not term:
        return queryset
    return queryset.filter(
        Q(straw_unique_no__icontains=term)
        | Q(member__member_name__icontains=term)
        | Q(non_member__name__icontains=term)
        | Q(mait__name__icontains=term)
    )


class AIEventFilter(django_filters.FilterSet):
    """The filters the admin list and the Mait's own history need (SRS §9.6)."""

    mpp = django_filters.CharFilter(field_name="mpp__mpp_code")
    mait = django_filters.NumberFilter(field_name="mait_id")
    # Compared against instants, never against `created_at__date`. On a MySQL without the
    # timezone tables loaded that lookup compiles to a CONVERT_TZ returning NULL, and a NULL
    # comparison matches nothing — so every date-filtered request answered zero on a day full
    # of events, and nothing in the answer said the filter was the problem rather than the
    # data. See `apps.core.timeframe`, which the dashboard already goes through.
    date_from = django_filters.DateFilter(method="filter_date_from")
    date_to = django_filters.DateFilter(method="filter_date_to")
    search = django_filters.CharFilter(method="filter_search")
    unfinished = django_filters.BooleanFilter(method="filter_unfinished")

    class Meta:
        model = AIEvent
        fields = ["status", "mpp", "mait", "date_from", "date_to", "search", "unfinished"]

    def filter_search(self, queryset, name, value):
        return search_events(queryset, value)

    def filter_date_from(self, queryset, name, value):
        return queryset.filter(created_at__gte=start_of_day(value)) if value else queryset

    def filter_date_to(self, queryset, name, value):
        # Half-open: everything up to the instant the next local day begins, which includes
        # the last microsecond of `date_to` without the off-by-one `__lte` on a date invites.
        return queryset.filter(created_at__lt=end_of_day(value)) if value else queryset

    def filter_unfinished(self, queryset, name, value):
        """
        Captures that still need something from the Mait who started them.

        Which statuses those are is a domain rule, not a client's opinion, so it lives here
        rather than as a list of statuses each screen remembers to send. The app's job is to
        ask for the unfinished ones and to know where each resumes; deciding *what unfinished
        means* is the server's.

        Terminal states are excluded by definition — a completed event needs nothing and a
        cancelled one is over. Everything else is a Mait standing between an animal that has
        been served and a record that says so.
        """
        if value is None:
            return queryset
        unfinished = AIEvent.UNFINISHED_STATUSES
        return (
            queryset.filter(status__in=unfinished)
            if value
            else queryset.exclude(status__in=unfinished)
        )


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
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        # Capture happens in the field, by the Mait standing with the animal — including the
        # photo and the completion, which are the two writes that matter most. Reading is
        # wider: an admin resolving a dispute needs the same record.
        if self.action in ("create", "photo", "complete"):
            return [IsMait()]
        return [IsAuthenticated()]

    def get_queryset(self):
        """
        A Mait sees their own events; an admin sees everything (SRS §16).

        Anyone else sees nothing rather than an error — a role that should not be here is a
        configuration problem, not something to explain to the caller.
        """
        # `payment` is a reverse one-to-one and is rendered on every row, so it is selected
        # here rather than fetched per row — 25 rows would otherwise be 25 extra queries.
        base = AIEvent.objects.select_related(
            "mpp", "member", "non_member", "animal", "mait", "payment"
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
            semen_breed=data.get("semen_breed", ""),
            doses=data.get("doses", 1),
            consumables=data.get("consumable_lines", []),
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
                "doses": event.doses,
            },
        )
        return Response(AIEventSerializer(event).data, status=status.HTTP_201_CREATED)

    # -- capture -------------------------------------------------------------------------
    @extend_schema(
        summary="Attach the proof photo",
        description=(
            "Multipart: `photo`, `gps_lat`, `gps_lng`, and optionally `performed_at`.\n\n"
            "`performed_at` is the device's clock, not the server's. An event captured "
            "offline may not arrive for hours, and the report must show when the "
            "insemination happened rather than when the phone found signal.\n\n"
            "`photo_source` says whether the picture came from the app's camera or the "
            "handset's gallery, and `gps_source` whether the pin is the handset's own "
            "position or what was written into the photograph. Both default to the live "
            "answer, and both are recorded on the event and its audit trail — a chosen "
            "photograph is accepted, never quietly passed off as a live one.\n\n"
            "Only valid from `straw_verified`: a photo without a checked straw is a "
            "photograph of an animal, not evidence of an insemination."
        ),
        request=AIEventPhotoSerializer,
        responses={200: AIEventSerializer},
    )
    @action(detail=True, methods=["patch"], parser_classes=[MultiPartParser, FormParser])
    def photo(self, request, pk=None):
        event = self.get_object()
        self._assert_own(event, request)

        serializer = AIEventPhotoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Written before the transition, and outside any transaction: the upload takes as
        # long as the village connection takes, and nothing else should wait on it.
        photo_url = store_photo(event, data["photo"])

        event = attach_photo(
            event,
            photo_url=photo_url,
            gps_lat=data["gps_lat"],
            gps_lng=data["gps_lng"],
            performed_at=data.get("performed_at"),
            photo_source=data["photo_source"],
            gps_source=data["gps_source"],
            actor=request.user,
        )
        return Response(AIEventSerializer(event).data)

    @extend_schema(
        summary="Complete the event and deduct the straw",
        description=(
            "The only endpoint that moves inventory. Deduction and completion happen in one "
            "transaction with the inventory row locked, so two concurrent calls cannot both "
            "consume one straw (ADR 0002).\n\n"
            "Fails closed: `409` if the payment is not verified or the straw is no longer in "
            "the Mait's stock, and nothing is touched. Completing an event that is already "
            "complete is a no-op rather than an error — a retry whose first response was lost "
            "lands here, and the honest answer is that it is done.\n\n"
            "`close_without_stock` is for the record that is stuck: its straw has already "
            "left the holding, the insemination happened, and no further straw should be "
            "spent on it. Sent only from the app's *Close this off*, where the Mait has been "
            "shown what the record is missing. It is a permission rather than an instruction "
            "— a straw still in stock is deducted as normal — and where it does apply the "
            "event comes back with `stock_deducted: false` and a line on its audit trail.\n\n"
            "Send `Idempotency-Key` from the offline queue."
        ),
        request=AIEventCompleteSerializer,
        responses={200: AIEventSerializer},
    )
    @idempotent(endpoint="ai-events.complete")
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        event = self.get_object()
        self._assert_own(event, request)

        options = AIEventCompleteSerializer(data=request.data or {})
        options.is_valid(raise_exception=True)

        event = complete_ai_event(
            event,
            actor=request.user,
            without_stock=options.validated_data["close_without_stock"],
        )
        return Response(AIEventSerializer(event).data)

    def _assert_own(self, event, request):
        """
        A write only ever touches the caller's own event.

        The queryset already scopes reads, but an admin can read every event — and an admin
        must not be able to attach a photo or complete an insemination they were not at.
        """
        mait = getattr(request.user, "mait_profile", None)
        if mait is None or event.mait_id != mait.id:
            raise PermissionDenied("This is not your event.")

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
