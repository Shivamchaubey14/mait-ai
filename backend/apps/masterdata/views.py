"""
Master data and SAP upload endpoints (SRS §9.2, §9.3).

Uploads are accepted, persisted and queued — never parsed inline. The Member Master is
105,484 rows and takes roughly fifteen minutes; holding an HTTP request open for that would
time out at the proxy long before it finished (SRS §6.1.6).
"""

from __future__ import annotations

from django.db.models import Count
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.admin_serializers import MPPAssignmentSerializer
from apps.animals.queries import animals_with_history
from apps.core.dispatch import run_in_background
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin, IsAdminOrMaitReadOnly, IsMait
from apps.core.services import record_audit

from . import columns as cols
from .models import MPP, DataUploadLog, Member, NonMember
from .serializers import (
    DataUploadLogSerializer,
    MasterUploadSerializer,
    MemberDetailSerializer,
    MemberListSerializer,
    MPPDetailSerializer,
    MPPListSerializer,
    NonMemberDetailSerializer,
    NonMemberSerializer,
    UploadErrorRowSerializer,
)
from .tasks import process_master_upload
from .templates_xlsx import assignment_template_response


@extend_schema(tags=["master-data"])
class MasterUploadViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """SAP master-data upload and its history (SRS §6.1)."""

    queryset = DataUploadLog.objects.select_related("uploaded_by").all()
    serializer_class = DataUploadLogSerializer
    permission_classes = [IsAdmin]
    parser_classes = [MultiPartParser, FormParser]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["upload_type", "status"]

    def get_queryset(self):
        """
        Keep the error reports out of the history list.

        `error_report` holds up to 5,000 rejected rows, and the list is ordered by
        `-created_at`: MySQL drags every selected column through the sort buffer, so a page of
        fifteen uploads that includes one large report is sorted with a megabyte of JSON in
        tow. That is an "Out of sort memory" 500 on the screen an operator opens to find out
        what went wrong — worst exactly when a file has just gone badly.

        Counting them in SQL does not help — `JSON_LENGTH(error_report)` in the select list
        makes MySQL carry the column through the sort to evaluate it, which is the same
        megabyte by another route. The serializer derives the count from `failed_rows`
        instead, so nothing on this path reads the reports at all. They stay where they
        belong, behind `/errors/`.
        """
        queryset = super().get_queryset()
        return queryset.defer("error_report") if self.action == "list" else queryset

    def _accept(self, request, upload_type: str) -> Response:
        """
        Validate, store and queue one workbook.

        Returns 202 rather than 201: the row exists, but the work it describes has not
        happened yet. The client polls the detail endpoint for progress.
        """
        serializer = MasterUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploaded = serializer.validated_data["file"]

        upload = DataUploadLog.objects.create(
            upload_type=upload_type,
            file_name=uploaded.name,
            file=uploaded,
            uploaded_by=request.user,
            status=DataUploadLog.Status.QUEUED,
        )

        record_audit(
            action=AuditLog.Action.UPLOAD,
            entity_type="data_upload_log",
            entity_id=upload.id,
            request=request,
            meta={"upload_type": upload_type, "file_name": uploaded.name, "size": uploaded.size},
        )

        # Not `.delay()` directly: with CELERY_TASK_ALWAYS_EAGER, which is how this runs without
        # a broker, `.delay()` imports the whole workbook inline and this 202 arrives minutes
        # late — after the import it is announcing has already finished.
        run_in_background(process_master_upload, upload.id)

        return Response(DataUploadLogSerializer(upload).data, status=status.HTTP_202_ACCEPTED)

    @extend_schema(
        summary="Upload the SAP Member Master",
        description=(
            "Accepts Member.xlsx and queues it for asynchronous import. The real export is "
            "~105,000 rows with the header on row 6; both are handled. Upload the MPP master "
            "first — member rows referencing an unknown MPP are rejected individually."
        ),
        request=MasterUploadSerializer,
        responses={202: DataUploadLogSerializer},
    )
    @action(detail=False, methods=["post"], url_path="members")
    def members(self, request):
        return self._accept(request, DataUploadLog.UploadType.MEMBER)

    @extend_schema(
        summary="Upload the SAP Mait/Vendor Master",
        request=MasterUploadSerializer,
        responses={202: DataUploadLogSerializer},
    )
    @action(detail=False, methods=["post"], url_path="maits")
    def maits(self, request):
        return self._accept(request, DataUploadLog.UploadType.MAIT)

    @extend_schema(
        summary="Upload the SAP MPP/Sahayak Master",
        description=(
            "Accepts Sahyak.xlsx. This file carries both the MPP and its assigned Sahayak "
            "(Mait), so it creates or refreshes both, and it is what establishes the "
            "MPP-to-Mait link. Upload it before the Member master."
        ),
        request=MasterUploadSerializer,
        responses={202: DataUploadLogSerializer},
    )
    @action(detail=False, methods=["post"], url_path="mpp")
    def mpp(self, request):
        return self._accept(request, DataUploadLog.UploadType.MPP)

    @extend_schema(
        summary="Upload the Mait ↔ MPP assignment sheet",
        description=(
            "The round-trip workbook from `assignment-template`, edited and sent back.\n\n"
            "Only the assignment moves. MPPs are never created here — they come from SAP, and "
            "an unknown code is reported as a bad row rather than quietly brought into "
            "existence. A Mait may be created when the row names them, since a new Sahayak "
            "has to start somewhere. A blank Sahayak column unassigns the MPP.\n\n"
            "Partial success, like every other upload: good rows commit, bad rows come back "
            "with their spreadsheet row number."
        ),
        request=MasterUploadSerializer,
        responses={202: DataUploadLogSerializer},
    )
    @action(detail=False, methods=["post"], url_path="assignments")
    def assignments(self, request):
        return self._accept(request, DataUploadLog.UploadType.ASSIGNMENT)

    @extend_schema(
        summary="Download the assignment sheet, already filled in",
        description=(
            "Every MPP, one per row, with whichever Mait currently covers it — so an admin "
            "edits what is there instead of composing a file and guessing at the headers.\n\n"
            "Unassigned MPPs are included with the Sahayak columns blank: they are the rows "
            "most likely to need filling, and a template that omitted them would hide the "
            "work."
        ),
        responses={200: bytes},
    )
    @action(detail=False, methods=["get"], url_path="assignment-template")
    def assignment_template(self, request):
        return assignment_template_response()

    @extend_schema(
        summary="Row-level error report",
        description=(
            "Rows rejected during import, with the spreadsheet row number so they can be "
            "corrected at source (SRS §6.1.4). Valid rows from the same file are already "
            "committed."
        ),
        responses={200: UploadErrorRowSerializer(many=True)},
    )
    @action(detail=True, methods=["get"], url_path="errors")
    def errors(self, request, pk=None):
        upload = self.get_object()
        return Response(
            {
                "upload_id": upload.id,
                "file_name": upload.file_name,
                "upload_type": upload.upload_type,
                "failed_rows": upload.failed_rows,
                "truncated": len(upload.error_report or []) < upload.failed_rows,
                # Which identifying columns this file's rows carry. Sent rather than hardcoded
                # in the page: a Member rejection and an assignment rejection are identified by
                # different cells, and the report is one screen for all four.
                "columns": cols.identity_labels(upload.upload_type),
                "results": upload.error_report or [],
            }
        )


@extend_schema(tags=["master-data"])
class MPPViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """MPP directory (SRS §9.3)."""

    permission_classes = [IsAdminOrMaitReadOnly]
    lookup_field = "mpp_code"
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["plant_code", "district_code", "tehsil_code", "mait", "is_active"]
    search_fields = ["mpp_code", "mpp_name"]

    def get_queryset(self):
        # `mait__user` is selected because the list reports whether the assigned Mait has ever
        # been activated — without it that is one extra query per row.
        queryset = MPP.objects.select_related("mait", "mait__user")
        user = self.request.user
        # SRS §6.2.3 — a Mait only ever sees their own MPPs. Enforced in the queryset rather
        # than by a filter the client supplies, so it cannot be bypassed by omitting one.
        mait = getattr(user, "mait_profile", None)
        if mait is not None and not user.is_admin:
            queryset = queryset.filter(mait=mait)
        if self.action in ("retrieve", "list"):
            queryset = queryset.annotate(member_count=Count("members"))
        return queryset

    def get_serializer_class(self):
        if self.action == "assign_mait":
            return MPPAssignmentSerializer
        return MPPDetailSerializer if self.action == "retrieve" else MPPListSerializer

    @extend_schema(
        summary="The plants, for the directory's filter",
        description=(
            "Every distinct plant with its name and how many MPPs report into it.\n\n"
            "A plant is the dairy a collection point reports into. There is no plant master "
            "to read from — the code and the name arrive on each MPP row in the SAP export — "
            "so they are grouped here rather than derived in the browser from whatever page "
            "of the directory happened to load."
        ),
        responses={200: dict},
    )
    @action(detail=False, methods=["get"], url_path="plants")
    def plants(self, request):
        # `get_queryset` is used rather than the model, so a Mait asking sees only the plants
        # their own MPPs report into — the same scoping the directory itself is under.
        rows = (
            self.get_queryset()
            .exclude(plant_code="")
            .values("plant_code", "plant_name")
            .annotate(mpp_count=Count("id"))
            .order_by("plant_code")
        )
        return Response({"results": list(rows)})

    @extend_schema(
        summary="Reassign this MPP to a different Mait",
        description=(
            "Overrides the SAP-derived default (SRS §6.2.2). The assignment is what scopes "
            "a Mait's app, so this moves the MPP and its members out of one Mait's view and "
            "into another's. Pass null to unassign."
        ),
        request=MPPAssignmentSerializer,
        responses={200: MPPDetailSerializer},
    )
    @action(detail=True, methods=["patch"], url_path="assign-mait", permission_classes=[IsAdmin])
    def assign_mait(self, request, mpp_code=None):
        mpp = self.get_object()
        serializer = MPPAssignmentSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        previous = mpp.mait
        mpp.mait = serializer.context.get("mait")
        mpp.save(update_fields=["mait", "updated_at"])

        record_audit(
            action=AuditLog.Action.UPDATE,
            entity_type="mpp",
            entity_id=mpp.id,
            request=request,
            meta={
                "mpp_code": mpp.mpp_code,
                "before": previous.sahayak_vendor_code if previous else None,
                "after": mpp.mait.sahayak_vendor_code if mpp.mait else None,
            },
        )
        mpp = (
            MPP.objects.select_related("mait")
            .annotate(member_count=Count("members"))
            .get(pk=mpp.pk)
        )
        return Response(MPPDetailSerializer(mpp).data)


@extend_schema(tags=["master-data"])
class MemberViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    Member search (SRS §9.3).

    Backed by the ``member_mpp_name_idx`` composite index — the table holds 105k+ rows, so an
    unindexed search here would be the slowest thing a Mait does all day.
    """

    permission_classes = [IsAdminOrMaitReadOnly]
    lookup_field = "member_code"
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["mpp__mpp_code", "activation_status", "mobile_no"]
    search_fields = ["member_name", "member_code", "mobile_no"]

    def get_queryset(self):
        queryset = Member.objects.select_related("mpp")
        if self.action == "retrieve":
            # Only on detail: the list serializer has no animals, and prefetching for a
            # 105k-row search would cost a second query per page for nothing.
            queryset = queryset.prefetch_related(animals_with_history())
        user = self.request.user
        mait = getattr(user, "mait_profile", None)
        if mait is not None and not user.is_admin:
            queryset = queryset.filter(mpp__mait=mait)
        return queryset

    def get_serializer_class(self):
        return MemberDetailSerializer if self.action == "retrieve" else MemberListSerializer

    @extend_schema(
        summary="Search members",
        parameters=[
            OpenApiParameter(
                "search",
                description="Matches member name, member code or mobile number.",
                required=False,
                type=str,
            ),
            OpenApiParameter(
                "mpp__mpp_code",
                description="Restrict to one MPP. The mobile app always sends this.",
                required=False,
                type=str,
            ),
        ],
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)


@extend_schema(tags=["master-data"])
class NonMemberViewSet(mixins.CreateModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Non-member registration by a Mait in the field (SRS §9.3)."""

    serializer_class = NonMemberSerializer
    permission_classes = [IsMait]

    def get_queryset(self):
        mait = getattr(self.request.user, "mait_profile", None)
        if mait is None:
            return NonMember.objects.none()
        queryset = NonMember.objects.filter(created_by_mait=mait)
        if self.action == "retrieve":
            queryset = queryset.prefetch_related(animals_with_history())
        return queryset

    def get_serializer_class(self):
        # The detail shape carries the animals already registered to this farmer, which is
        # what step 3 of the capture flow picks from.
        return NonMemberDetailSerializer if self.action == "retrieve" else NonMemberSerializer

    def perform_create(self, serializer):
        """
        Stamp the creating Mait server-side.

        Never taken from the request body — that would let one Mait attribute a registration
        to another (SRS §16).
        """
        mait = getattr(self.request.user, "mait_profile", None)
        non_member = serializer.save(created_by_mait=mait)
        record_audit(
            action="create",
            entity_type="non_member",
            entity_id=non_member.id,
            request=self.request,
            meta={"mpp_id": non_member.mpp_id},
        )
