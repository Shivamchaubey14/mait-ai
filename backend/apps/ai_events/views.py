"""
AI event endpoints (SRS §9.6).

Thin by design: each view parses HTTP, calls one function in ``services.py`` and renders the
result. Every rule about what may follow what lives in the state machine, so there is exactly
one place to read — and one place to get it wrong.
"""

from __future__ import annotations

import django_filters
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Case, Count, IntegerField, Q, Value, When
from django.http import QueryDict
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import PortalSection, Role
from apps.core.exceptions import DomainError, InvalidStateTransition, PaymentNotVerified
from apps.core.idempotency import idempotent
from apps.core.models import AuditLog
from apps.core.permissions import CanDeleteAIEvent, IsMait, in_section
from apps.core.scoping import apply_scope
from apps.core.services import record_audit
from apps.core.timeframe import end_of_day, event_day_expr, start_of_day
from apps.payments.models import Payment
from apps.payments.pricing import price_for

from .models import AIEvent
from .serializers import (
    AIEventCompleteSerializer,
    AIEventCreateSerializer,
    AIEventDetailSerializer,
    AIEventPhotoSerializer,
    AIEventPhotoStatusSerializer,
    AIEventSerializer,
    AIEventTimelineSerializer,
    other_codes_by_vendor,
)
from .services import (
    attach_photo,
    cancel_ai_event,
    complete_ai_event,
    finalize_member_capture,
    mark_payment_pending,
    office_force_complete,
    photo_already_attached,
    start_ai_event,
)
from .storage import store_photo_with_meta


# The strings a multipart client sends for "no coordinate". A JSON null cannot ride in a
# multipart field, so the handset's offline queue historically put the literal "null" on the
# wire; older callers may also send an empty value. All mean "no GPS fix".
_NULLISH_GPS = {"", "null", "undefined", "nan", "none"}


def _drop_nullish_gps(data):
    """
    Strip absent/placeholder GPS so the serializer reads it as "no fix" rather than a bad number.

    GPS is optional on a proof photo (see ``AIEventPhotoSerializer``), but a required-looking
    ``gps_lat="null"`` from the offline queue was being parsed as a decimal and refused — which
    stranded every no-GPS member capture at ``straw_verified`` for good. Dropping the key here
    lets the optional field default to None, so a capture taken with no location still closes.
    Returns a mutable copy; the original (an immutable multipart QueryDict) is untouched.

    The copy is deliberately *shallow*. ``request.data`` on these endpoints is a multipart
    ``QueryDict`` carrying the uploaded proof photo, and ``QueryDict.copy()`` deep-copies every
    value — which raised an uncaught 500 on every photo upload, because an uploaded file object
    cannot be deep-copied. Rebuilding a mutable ``QueryDict`` with ``setlist`` keeps the same file
    object by reference and copies none of its bytes, so dropping the GPS keys is all this does.
    """
    if hasattr(data, "lists"):
        cleaned = QueryDict(mutable=True)
        for key, values in data.lists():
            cleaned.setlist(key, values)
    else:
        # A plain dict (e.g. a JSON request or a test fixture): a shallow copy is enough.
        cleaned = dict(data)
    for key in ("gps_lat", "gps_lng"):
        value = cleaned.get(key)
        if value is None or (isinstance(value, str) and value.strip().lower() in _NULLISH_GPS):
            cleaned.pop(key, None)
    return cleaned


def search_events(queryset, term: str):
    """
    Everything someone has to hand when chasing one event, from one box.

    A straw number comes off a complaint, a farmer's name or phone off a call, a code off a
    roster or a collection slip, an event number off another screen or an export. The operator
    should not have to know which kind of thing they are holding, so the box matches any of
    them: the event's own number, the farmer (member or non-member) by name, code, SAP vendor or
    mobile,
    their MPP's code, and the Mait by name or code.

    An all-digits term is treated as an event number as well — matched against the id exactly,
    so "228" jumps to event 228 rather than only dragging in every straw and phone number that
    happens to contain 228.

    Shared with the CSV export rather than reimplemented there: a report is defined by the
    filters that produced it, and an export that quietly ignored the search would hand back a
    file disagreeing with the screen it was taken from.
    """
    term = (term or "").strip()
    if not term:
        return queryset
    conditions = (
        Q(straw_unique_no__icontains=term)
        | Q(member__member_name__icontains=term)
        | Q(member__member_code__icontains=term)
        # Her SAP vendor code, which outlives the member code: a member who moves to another MPP
        # is given a new code there and keeps the vendor. Searching it brings back her events
        # under the old code and the new one together — her whole history in one list.
        | Q(member__sap_vendor_code__icontains=term)
        | Q(member__mobile_no__icontains=term)
        | Q(non_member__name__icontains=term)
        | Q(non_member__mobile_no__icontains=term)
        | Q(mpp__mpp_code__icontains=term)
        | Q(mait__name__icontains=term)
        # A Mait's own code off the roster, so "show me SAH-0421's events this week" is one box
        # and a date range — the same name-or-code search the roster screen offers.
        | Q(mait__sahayak_vendor_code__icontains=term)
    )
    # Up to the signed 64-bit ceiling a BIGINT primary key can hold; a longer run of digits is a
    # straw or a phone number, never an event id, so it stays a plain contains-search.
    if term.isdigit() and int(term) <= 9223372036854775807:
        # The event number is the shortest, most exact thing someone can type, so a digits-only
        # search puts the event with that id at the very top — ahead of every row whose straw or
        # phone number merely contains those digits — then falls back to the list's own recency
        # order for the rest.
        event_id = int(term)
        return (
            queryset.filter(conditions | Q(pk=event_id))
            .annotate(
                _event_match=Case(
                    When(pk=event_id, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                )
            )
            .order_by("_event_match", "-created_at")
        )
    return queryset.filter(conditions)


class AIEventFilter(django_filters.FilterSet):
    """The filters the admin list and the Mait's own history need (SRS §9.6)."""

    mpp = django_filters.CharFilter(field_name="mpp__mpp_code")
    mait = django_filters.NumberFilter(field_name="mait_id")
    # By the code on the roster rather than the internal id, so a link or a saved report can
    # name a Mait the way the rest of the portal does.
    mait_code = django_filters.CharFilter(field_name="mait__sahayak_vendor_code")
    # Compared against instants, never against `created_at__date`. On a MySQL without the
    # timezone tables loaded that lookup compiles to a CONVERT_TZ returning NULL, and a NULL
    # comparison matches nothing — so every date-filtered request answered zero on a day full
    # of events, and nothing in the answer said the filter was the problem rather than the
    # data. See `apps.core.timeframe`, which the dashboard already goes through.
    #
    # And the field is the event's *day*, not when its draft row happened to be created — a
    # capture started at 23:50 and finished at 00:05 belongs to the day it finished, which is
    # the day the dashboard counts it on. See `event_day_expr`. An unfinished capture has no
    # completion instant, so it is dated by when it was started, which is all there is.
    date_from = django_filters.DateFilter(method="filter_date_from")
    date_to = django_filters.DateFilter(method="filter_date_to")
    search = django_filters.CharFilter(method="filter_search")
    unfinished = django_filters.BooleanFilter(method="filter_unfinished")
    # The Mait's "Needs attention" list asks for `office_call_unmatched`: captures whose
    # no-signal farmer check carried a code the office has no record of giving.
    farmer_check = django_filters.ChoiceFilter(choices=AIEvent.FarmerCheck.choices)

    class Meta:
        model = AIEvent
        fields = [
            "status",
            "mpp",
            "mait",
            "mait_code",
            "date_from",
            "date_to",
            "search",
            "unfinished",
            "farmer_check",
        ]

    def filter_search(self, queryset, name, value):
        return search_events(queryset, value)

    @staticmethod
    def _dated(queryset):
        """Annotate the event day once — a second date filter must not re-add the alias."""
        if "event_day" in queryset.query.annotations:
            return queryset
        return queryset.annotate(event_day=event_day_expr())

    def filter_date_from(self, queryset, name, value):
        return (
            self._dated(queryset).filter(event_day__gte=start_of_day(value)) if value else queryset
        )

    def filter_date_to(self, queryset, name, value):
        # Half-open: everything up to the instant the next local day begins, which includes
        # the last microsecond of `date_to` without the off-by-one `__lte` on a date invites.
        return self._dated(queryset).filter(event_day__lt=end_of_day(value)) if value else queryset

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


class AIEventBulkDeleteSerializer(serializers.Serializer):
    """The ids of the events a bulk delete should remove."""

    # Capped so one request cannot try to erase the whole table in a single transaction. The
    # list screen pages at 25, which is the ordinary selection; the ceiling is headroom.
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
        max_length=200,
    )


@extend_schema(tags=["ai-events"])
class AIEventViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Capture and read AI events (SRS §6.3, §11)."""

    # Declared for schema generation only — every request goes through get_queryset below,
    # which scopes to the caller. Without it the generator cannot resolve the model and types
    # the `id` path parameter as a string.
    queryset = AIEvent.objects.none()
    filterset_class = AIEventFilter
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        # Capture happens in the field, by the Mait standing with the animal — including the
        # photo and the completion, which are the two writes that matter most. Reading is
        # wider: an admin resolving a dispute needs the same record.
        if self.action in ("create", "photo", "complete", "finalize", "cancel"):
            return [IsMait()]
        # Deleting a record is the one thing a Mait can never do to their own history, and the
        # one thing on this endpoint that is not reversible. It is a back-office correction —
        # a test row, a duplicate, an event captured against the wrong farmer — so it is gated
        # to a real admin holding the AI events section, never to the field. `CanDeleteAIEvent`
        # rather than `IsAdmin` on purpose: a Normal User reaches every other part of this
        # endpoint as an admin does, but deletion is the single thing that role withholds.
        # Completing from the office is a back-office correction, like deleting: it closes a
        # capture the Mait left stuck, so it is gated to a real admin holding the section — not
        # to a Normal User, and never to the field — exactly as the delete routes are.
        if self.action in ("destroy", "bulk_delete", "office_complete", "force_complete"):
            return [CanDeleteAIEvent(), in_section(PortalSection.AI_EVENTS)()]
        # Reading is where the portal comes in, and two of its screens read this: the AI
        # events roster and the Reports query builder, which runs the same filters.
        return [
            IsAuthenticated(),
            in_section(PortalSection.AI_EVENTS, PortalSection.REPORTS)(),
        ]

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

        if self.action == "retrieve":
            # Only the detail serializer reads the chain. Prefetched rather than left to the
            # serializer, which would otherwise issue one query per check on the one screen
            # a dispute is settled from.
            base = base.prefetch_related("pregnancy_checks__ai_event__semen_batch")

        if self.action in ("list", "retrieve"):
            # The `procurement` field reads each member's latest milk period. Prefetched (newest
            # first, by the model's Meta ordering) so a page of 25 rows is one query, not 25.
            base = base.prefetch_related("member__procurements")

        user = self.request.user
        if getattr(user, "role", None) in (Role.SUPER_ADMIN, Role.ADMIN, Role.NORMAL_USER):
            # An office account sees the whole network unless it has been given zones, in
            # which case it sees the chilling centres those zones hold. Applied to the
            # queryset rather than to the response, so the detail route, the count and any
            # future export are narrowed by the same line — a scope enforced only on the list
            # is one an operator walks around by opening a row.
            return apply_scope(base, self.request)

        mait = getattr(user, "mait_profile", None)
        if mait is None:
            return base.none()
        return base.filter(mait=mait)

    def get_serializer_class(self):
        if self.action == "create":
            return AIEventCreateSerializer
        if self.action == "retrieve":
            # The detail screen alone carries the pregnancy chain — see the serializer.
            return AIEventDetailSerializer
        return AIEventSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["mait"] = getattr(self.request.user, "mait_profile", None)
        # Eligibility's two inputs — whether the gate is live and the standard AI rate — computed
        # once per read and shared across every row, so the `procurement` field decides a page
        # without re-querying the breed list and procurement table per member.
        if self.action in ("list", "retrieve"):
            from apps.masterdata.procurement import serializer_context as procurement_context

            context.update(procurement_context())
        return context

    def get_serializer(self, *args, **kwargs):
        # A page of events reads every member's other codes in one query, not one per row.
        if kwargs.get("many") and args and self.action == "list":
            kwargs["context"] = {
                **self.get_serializer_context(),
                "other_codes": other_codes_by_vendor(list(args[0])),
            }
        return super().get_serializer(*args, **kwargs)

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

        # A farmer checked on the phone with no signal: prove the code against the office's.
        if data.get("office_code"):
            from apps.accounts.field_codes import record_office_check

            record_office_check(
                event=event,
                code=data["office_code"],
                day=data["office_code_day"],
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

        # A replay of an upload whose response was lost, which is an ordinary outcome on a
        # village connection. Answered before the serializer runs and before anything is
        # written: the photograph is already on file, and storing the same picture a second
        # time would leave an orphan in the bucket for every retry the queue makes.
        if photo_already_attached(event):
            return Response(AIEventSerializer(event).data)

        serializer = AIEventPhotoSerializer(data=_drop_nullish_gps(request.data))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Written before the transition, and outside any transaction: the upload takes as
        # long as the village connection takes, and nothing else should wait on it. The
        # thumbnail and checksum are made here too, and never block: a failure leaves them empty.
        stored = store_photo_with_meta(event, data["photo"])

        event = attach_photo(
            event,
            photo_url=stored.url,
            thumbnail_url=stored.thumbnail_url,
            checksum=stored.checksum,
            gps_lat=data.get("gps_lat"),
            gps_lng=data.get("gps_lng"),
            performed_at=data.get("performed_at"),
            photo_source=data["photo_source"],
            gps_source=data["gps_source"],
            actor=request.user,
        )
        return Response(AIEventSerializer(event).data)

    @extend_schema(
        summary="Poll the proof photo's status",
        description=(
            "A read-only fallback for the mobile client to confirm a proof photo has landed, for "
            "when the upload's own response was lost on a village connection. Returns whether the "
            "photo is on file and, once it is, the full URL, the thumbnail URL and the SHA-256 "
            "checksum. Writes nothing and is safe to poll."
        ),
        responses={200: AIEventPhotoStatusSerializer},
    )
    @action(detail=True, methods=["get"], url_path="photo-status")
    def photo_status(self, request, pk=None):
        event = self.get_object()
        self._assert_own(event, request)
        return Response(
            AIEventPhotoStatusSerializer(
                {
                    "id": event.id,
                    "status": event.status,
                    "photo_uploaded": bool(event.ai_photo_url),
                    "ai_photo_url": event.ai_photo_url,
                    "ai_photo_thumbnail_url": event.ai_photo_thumbnail_url,
                    "ai_photo_checksum": event.ai_photo_checksum,
                    "performed_at": event.performed_at,
                }
            ).data
        )

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

    @extend_schema(
        summary="Finish a member capture in one step (photo + complete)",
        description=(
            "The Mait's own one-request close of a **member** capture: attach the proof photo, "
            "record her verified ₹ deduction, deduct one straw, complete the event and book its "
            "pregnancy check — all in a single call.\n\n"
            "It exists for the weak-network case the step-by-step close cannot survive. Those "
            "steps are three ordered round trips (photo, payment, complete), and on a village "
            "connection they do not always arrive in order: the completion reaches the server "
            "ahead of its own photo and is refused against a `straw_verified` event. Carrying "
            "both in one request makes that impossible.\n\n"
            "Multipart: `photo`, `gps_lat`, `gps_lng`, and optionally `performed_at`. The photo "
            "may be omitted **only** when it is already on file (the other half of the race — "
            "the photo landed, the completion was lost); otherwise it is required.\n\n"
            "Member only — a non-member authorises her own payment with a code, which this path "
            "cannot stand in for. An unpriced breed is refused (`400`), and nothing is touched. "
            "A replay of an already-completed event is a no-op that returns it as it stands. "
            "Send `Idempotency-Key` from the offline queue."
        ),
        request=AIEventPhotoSerializer,
        responses={200: AIEventSerializer},
    )
    @idempotent(endpoint="ai-events.finalize")
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def finalize(self, request, pk=None):
        event = self.get_object()
        self._assert_own(event, request)

        # Already done: a lost-response retry lands here, and the honest answer is that it is
        # finished. Returned before anything is read, so a replay carrying a second photo never
        # stores it and never spends a second straw.
        if event.status == AIEvent.Status.COMPLETED:
            return Response(AIEventSerializer(event).data)

        if event.owner_type != AIEvent.OwnerType.MEMBER:
            raise DomainError(
                "One-step finish is only for a member's capture. A non-member authorises her "
                "own payment with a code, which this path cannot stand in for."
            )

        # Price the deduction first. An unpriced breed is a refusal no retry can clear — an admin
        # must set the rate — so it is surfaced before anything is attached or deducted, exactly
        # as the payment endpoint does, and the event is left untouched.
        breed = getattr(event.semen_batch, "breed", "") if event.semen_batch_id else ""
        amount = price_for(
            breed=breed,
            animal_type=event.animal.animal_type,
            owner_type=event.owner_type,
        )
        if amount is None:
            raise DomainError(
                "This breed has no rate set for this kind of farmer. Ask the administrator to "
                "price it before the capture can be closed."
            )

        # Attach the photo, unless it is already on file — the race where the photo landed and
        # the completion was lost. `photo_already_attached` is the same replay check the photo
        # endpoint uses, and it is asked before the upload is stored so a replay leaves no orphan.
        if not photo_already_attached(event):
            if "photo" not in request.FILES:
                raise serializers.ValidationError(
                    {"photo": "This capture still needs its proof photo."}
                )
            photo_in = AIEventPhotoSerializer(data=_drop_nullish_gps(request.data))
            photo_in.is_valid(raise_exception=True)
            data = photo_in.validated_data
            stored = store_photo_with_meta(event, data["photo"])
            event = attach_photo(
                event,
                photo_url=stored.url,
                thumbnail_url=stored.thumbnail_url,
                checksum=stored.checksum,
                gps_lat=data.get("gps_lat"),
                gps_lng=data.get("gps_lng"),
                performed_at=data.get("performed_at"),
                photo_source=data["photo_source"],
                gps_source=data["gps_source"],
                actor=request.user,
            )

        event = finalize_member_capture(event, amount=amount, actor=request.user)

        # Audited as a one-step finish, after the completion's own `state_change` entry, so the
        # trail says plainly this closed in one request rather than through the usual three.
        record_audit(
            action="state_change",
            entity_type="ai_event",
            entity_id=event.id,
            request=request,
            meta={
                "to": event.status,
                "one_step_finish": True,
                "mait_id": event.mait_id,
                "mpp_code": event.mpp.mpp_code,
                "stock_deducted": event.stock_deducted,
            },
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

    @extend_schema(
        summary="Discard an unfinished capture (Mait)",
        description=(
            "The Mait's own way to abandon a capture they will never finish — the farmer walked "
            "off, the wrong animal was picked, the photo was never going to be taken. It moves "
            "the event to `cancelled`, which is terminal and deducts no stock.\n\n"
            "**It releases the held straw.** A straw is held by an unfinished capture and offered "
            "to no other until that capture closes; cancelling closes it, so the straw is free "
            "for the next insemination again at once (no stock was ever deducted — that only "
            "happens at completion).\n\n"
            "Only the Mait's **own** event, and only while it is still unfinished: a completed "
            "capture cannot be discarded (the insemination happened and the straw is spent), and "
            "an already-cancelled one comes back unchanged — the same no-op a lost-response retry "
            "from the offline queue needs. Send the capture's `client_uuid` as the idempotency "
            "key. An optional `reason` is kept on the record and the timeline."
        ),
        request=None,
        responses={200: AIEventSerializer},
    )
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        event = self.get_object()
        self._assert_own(event, request)

        # Already cancelled: the honest answer is that it is gone, with nothing to redo — the
        # same no-op the completion endpoints give a lost-response retry. Returned before the
        # status guard so a blind resend from the offline queue is never an error.
        if event.status == AIEvent.Status.CANCELLED:
            return Response(AIEventSerializer(event).data)
        if event.is_terminal:
            # The only other terminal state is completed: the insemination happened and the straw
            # is spent, so there is nothing to discard. `cancel_ai_event` would refuse it too;
            # saying so here keeps the message about discarding rather than about transitions.
            raise DomainError(
                "This capture is already finished and cannot be discarded. A completed "
                "insemination stays on the record."
            )

        reason = (request.data.get("reason") or "").strip()[:255]
        event = cancel_ai_event(event, reason=reason or "Discarded by the Mait", actor=request.user)

        record_audit(
            action="state_change",
            entity_type="ai_event",
            entity_id=event.id,
            request=request,
            meta={
                "to": event.status,
                "discarded_by_mait": True,
                "mait_id": event.mait_id,
                "mpp_code": event.mpp.mpp_code,
            },
        )
        return Response(AIEventSerializer(event).data)

    @extend_schema(
        summary="Complete a stuck event from the office (admin)",
        description=(
            "The office's counterpart to the Mait's own completion, for a capture the Mait "
            "left stuck. The Mait's `complete` is barred to an admin on purpose — nobody "
            "should close an insemination they were not at — so this is the one narrow door "
            "the office gets, and it is deliberately kept narrow.\n\n"
            "Only a **member** capture at `photo_captured` or `payment_pending` whose ₹100 "
            "deduction is already **recorded and verified**. A non-member pays on the spot "
            "against her own authorisation code, which the office cannot stand in for, so a "
            "non-member is refused here. An event with no verified payment is refused too — "
            "the money is finance's to record, not this endpoint's to invent.\n\n"
            "Where it applies it does exactly what the handset would: advances "
            "`photo_captured → payment_pending` if needed, then deducts the straw and closes "
            "the event in one transaction. Already-completed is a no-op. Audited as an office "
            "completion with the acting admin on the event's own timeline."
        ),
        request=None,
        responses={200: AIEventSerializer},
    )
    @action(detail=True, methods=["post"], url_path="office-complete")
    def office_complete(self, request, pk=None):
        event = self.get_object()  # through get_queryset, so an admin's zone scope still binds

        if event.status == AIEvent.Status.COMPLETED:
            # A second click, or two admins on the same stuck row. The honest answer is that
            # it is done — same no-op the Mait's completion gives a lost-response retry.
            return Response(AIEventSerializer(event).data)

        if event.owner_type != AIEvent.OwnerType.MEMBER:
            raise DomainError(
                "Office completion is only for a member's capture. A non-member authorises her "
                "own payment with a code, which the office cannot enter for her."
            )
        if event.status not in (AIEvent.Status.PHOTO_CAPTURED, AIEvent.Status.PAYMENT_PENDING):
            raise InvalidStateTransition(
                "This capture is not far enough along to complete — it needs its photo and a "
                "recorded payment first."
            )
        payment = getattr(event, "payment", None)
        if payment is None or not payment.is_verified:
            raise PaymentNotVerified()

        with transaction.atomic():
            if event.status == AIEvent.Status.PHOTO_CAPTURED:
                mark_payment_pending(event, actor=request.user)
            event = complete_ai_event(event, actor=request.user)

        record_audit(
            action="state_change",
            entity_type="ai_event",
            entity_id=event.id,
            request=request,
            meta={
                "to": event.status,
                "office_complete": True,
                "mait_id": event.mait_id,
                "mpp_code": event.mpp.mpp_code,
                "stock_deducted": event.stock_deducted,
            },
        )
        return Response(AIEventSerializer(event).data)

    @extend_schema(
        summary="Complete a member capture WITHOUT its proof photo (office)",
        description=(
            "The deliberate exception to office completion: close a **member** capture the Mait "
            "left stuck whose **proof photo never reached the server** — the handset lost it, or "
            "it was never taken. It records the same verified ₹ deduction and deducts the same "
            "one straw the ordinary close does, and books the pregnancy check — but attaches no "
            "photo, so the record carries **no proof**. The timeline and the audit both say so.\n\n"
            "This waives the evidence an insemination normally cannot complete without, so it is "
            "for the records the Mait genuinely cannot finish from the phone, not a shortcut past "
            "a photo that is merely on its way. Member only (a non-member authorises her own "
            "payment with a code the office cannot enter), and an unpriced breed is refused "
            "(`400`). A replay of an already-completed event is a no-op."
        ),
        request=None,
        responses={200: AIEventSerializer},
    )
    @action(detail=True, methods=["post"], url_path="force-complete")
    def force_complete(self, request, pk=None):
        event = self.get_object()  # scoped by get_queryset, so an admin's zone still binds

        if event.status == AIEvent.Status.COMPLETED:
            return Response(AIEventSerializer(event).data)

        if event.owner_type != AIEvent.OwnerType.MEMBER:
            raise DomainError(
                "Office completion is only for a member's capture. A non-member authorises her "
                "own payment with a code, which the office cannot enter for her."
            )
        if event.status not in (
            AIEvent.Status.STRAW_VERIFIED,
            AIEvent.Status.PHOTO_CAPTURED,
            AIEvent.Status.PAYMENT_PENDING,
        ):
            raise InvalidStateTransition(
                "This capture is not in a state that can be completed — it has no straw held yet, "
                "or it is already finished."
            )

        # Price the deduction first, exactly as the one-step finish does: an unpriced breed is a
        # refusal no retry can clear, surfaced before anything is touched so the event is left as
        # it was.
        breed = getattr(event.semen_batch, "breed", "") if event.semen_batch_id else ""
        amount = price_for(
            breed=breed,
            animal_type=event.animal.animal_type,
            owner_type=event.owner_type,
        )
        if amount is None:
            raise DomainError(
                "This breed has no rate set for this kind of farmer. Ask the administrator to "
                "price it before the capture can be closed."
            )

        event = office_force_complete(
            event,
            amount=amount,
            actor=request.user,
            reason="Completed by the office without a proof photo",
        )

        record_audit(
            action="state_change",
            entity_type="ai_event",
            entity_id=event.id,
            request=request,
            meta={
                "to": event.status,
                "office_complete": True,
                # The one that matters on this route: the record closed with no proof photo, by
                # an office decision. Kept distinct from `office_complete` so a later reviewer can
                # find every proof-less close without reading each event.
                "force_complete": True,
                "no_photo": not bool(event.ai_photo_url),
                "mait_id": event.mait_id,
                "mpp_code": event.mpp.mpp_code,
                "stock_deducted": event.stock_deducted,
            },
        )
        return Response(AIEventSerializer(event).data)

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

    # -- delete --------------------------------------------------------------------------
    def _purge(self, event, request):
        """
        Remove one event and the records that hang off it, leaving a trail of what was there.

        Audited before anything is touched, because the event is about to stop existing and the
        audit log is the only place the fact of it — who deleted whose insemination, and what
        money it carried — will survive. The straws, consumables, timeline and pregnancy checks
        cascade with the row (their FKs say so); the payment is `PROTECT`, so it is removed
        explicitly here in the same transaction rather than blocking the delete.

        The inventory ledger is deliberately left alone. Its rows are an append-only record of
        straws that genuinely left a flask (`ref_id` is a plain id, not a cascading FK), so a
        completed event's deduction stays on the books — deleting the event does not put a spent
        straw back, it only removes the service record, and a report reconciling the two reads
        the deletion from the audit log.
        """
        try:
            payment = event.payment
        except Payment.DoesNotExist:
            payment = None

        record_audit(
            action=AuditLog.Action.DELETE,
            entity_type="ai_event",
            entity_id=event.id,
            request=request,
            meta={
                "status": event.status,
                "mpp_code": event.mpp.mpp_code,
                "mait_code": event.mait.sahayak_vendor_code,
                "mait_name": event.mait.name,
                "owner_type": event.owner_type,
                "straw": event.straw_unique_no,
                "doses": event.doses,
                "completed_at": event.completed_at.isoformat() if event.completed_at else None,
                "payment": (
                    {
                        "amount": str(payment.amount),
                        "mode": payment.mode,
                        "status": payment.status,
                    }
                    if payment is not None
                    else None
                ),
            },
        )
        if payment is not None:
            payment.delete()
        event.delete()

    @extend_schema(
        summary="Delete an AI event",
        description=(
            "Admin only, and the one irreversible action on this endpoint. Removes the event "
            "and the records attached to it — straws, consumables, timeline and pregnancy "
            "checks — in one transaction, together with its payment row. For a back-office "
            "correction: a test capture, a duplicate, or an event recorded against the wrong "
            "farmer.\n\n"
            "The inventory ledger is not rewound: a straw a completed event spent stays spent. "
            "Every deletion is written to the audit log with the event's key details and any "
            "payment it carried."
        ),
    )
    def destroy(self, request, *args, **kwargs):
        event = self.get_object()
        with transaction.atomic():
            self._purge(event, request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        summary="Delete several AI events at once",
        description=(
            "Admin only. The same delete as the single route, for a selection of events — the "
            "portal's bulk action. Ids outside the caller's scope (a zonal manager's) are "
            "silently skipped and returned in `missing`; everything deletable goes in one "
            "transaction, so the call either removes them all or, on an error, none.\n\n"
            "Returns `deleted` (the ids removed), `deleted_count`, and `missing` (ids that were "
            "not found or not in scope)."
        ),
        request=AIEventBulkDeleteSerializer,
        responses={200: dict},
    )
    @action(detail=False, methods=["post"], url_path="bulk-delete")
    def bulk_delete(self, request):
        payload = AIEventBulkDeleteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        ids = payload.validated_data["ids"]

        # Through get_queryset, so an admin's zone scope narrows what can be deleted exactly as
        # it narrows what can be read — a selection cannot reach an event the operator could not
        # open. Dropping duplicates keeps the count honest if the client sends an id twice.
        events = list(self.get_queryset().filter(id__in=set(ids)))
        # Captured before the loop: `Model.delete()` clears the instance's pk, so reading
        # `event.id` afterwards would give None for every one of them.
        found = sorted(event.id for event in events)

        with transaction.atomic():
            for event in events:
                self._purge(event, request)

        missing = sorted(set(ids) - set(found))
        return Response({"deleted": found, "deleted_count": len(found), "missing": missing})

    @extend_schema(
        summary="List AI events",
        description=(
            "Scoped to the caller: a Mait sees their own captures, an admin sees all of "
            "them. Filter with `status`, `mpp`, `mait` (id) or `mait_code`, `date_from` and "
            "`date_to`, or `search` — one box that matches the event number, the farmer by "
            "name, member code or mobile, the MPP code, the straw number, and the Mait by name "
            "or code — so one term and a date range answers 'this event' or 'this person's "
            "events for this period'.\n\n"
            "Alongside the page, `summary` carries the status split of the **whole** filtered "
            "set, not just the rows on this page: `completed`, `unfinished` (the captures still "
            "waiting on a Mait) and `cancelled`. The dashboard counts only the completed ones, "
            "so this is what reconciles the two — a day the dashboard calls seven and this list "
            "shows eight is seven completed and one still unfinished."
        ),
    )
    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        # Over the whole filtered set, before pagination — a breakdown of the page's 25 rows
        # would say nothing about the thousands behind them. Three bounded counts on an indexed
        # column, which the same filter (and date window) already narrows.
        counts = self.filter_queryset(self.get_queryset()).aggregate(
            completed=Count("id", filter=Q(status=AIEvent.Status.COMPLETED)),
            unfinished=Count("id", filter=Q(status__in=AIEvent.UNFINISHED_STATUSES)),
            cancelled=Count("id", filter=Q(status=AIEvent.Status.CANCELLED)),
        )
        if isinstance(response.data, dict):
            response.data["summary"] = {key: value or 0 for key, value in counts.items()}
        return response
