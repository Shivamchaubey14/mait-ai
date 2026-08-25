"""
Master data and SAP upload endpoints (SRS §9.2, §9.3).

Uploads are accepted, persisted and queued — never parsed inline. The Member Master is
105,484 rows and takes roughly fifteen minutes; holding an HTTP request open for that would
time out at the proxy long before it finished (SRS §6.1.6).
"""

from __future__ import annotations

from django.conf import settings
from django.db.models import Count, Max, Q
from django.http import Http404, HttpResponse
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.admin_serializers import MPPAssignmentSerializer
from apps.animals.queries import animals_with_history
from apps.core.dispatch import run_in_background
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin, IsAdminOrMaitReadOnly, IsMait
from apps.core.services import record_audit
from apps.payments.models import OTPLog
from apps.payments.services import issue_otp, verify_otp

from . import columns as cols
from .models import MPP, DataUploadLog, Member, NonMember
from .serializers import (
    AdminNonMemberDetailSerializer,
    AdminNonMemberListSerializer,
    DataUploadLogSerializer,
    MasterUploadSerializer,
    MemberDetailSerializer,
    MemberListSerializer,
    MPPDetailSerializer,
    MPPListSerializer,
    NonMemberAadhaarSerializer,
    NonMemberDetailSerializer,
    NonMemberPickerSerializer,
    NonMemberSerializer,
    UploadErrorRowSerializer,
)
from .snapshots import build_snapshot, latest_upload
from .storage import store_aadhaar_image
from .tasks import process_master_upload
from .templates_xlsx import assignment_template_response
from .verification import (
    FarmerKeySerializer,
    FarmerOTPVerifySerializer,
    mask_mobile,
    resolve_farmer,
)


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
        summary="Which masters have a copy to download",
        description=(
            "One entry per SAP master, saying whether there is a landed upload behind it and "
            "what it was."
            "\n\n"
            "Sent as a list rather than left for the screen to assemble from the history, "
            "because the screen would have to know which statuses count as landed — and a "
            "portal offering a download of a failed upload is a portal handing back a file "
            "that never became the master."
        ),
        responses={200: dict},
    )
    @action(detail=False, methods=["get"], url_path="snapshots")
    def snapshots(self, request):
        masters = [
            DataUploadLog.UploadType.MEMBER,
            DataUploadLog.UploadType.MAIT,
            DataUploadLog.UploadType.MPP,
        ]

        results = []
        for upload_type in masters:
            upload = latest_upload(upload_type)
            results.append(
                {
                    "upload_type": upload_type,
                    "label": DataUploadLog.UploadType(upload_type).label,
                    "available": upload is not None,
                    "file_name": upload.file_name if upload else "",
                    "uploaded_at": (
                        (upload.finished_at or upload.created_at).isoformat() if upload else None
                    ),
                    "uploaded_by": (
                        (upload.uploaded_by.full_name or upload.uploaded_by.username)
                        if upload
                        else ""
                    ),
                    "total_rows": upload.total_rows if upload else 0,
                    "success_rows": upload.success_rows if upload else 0,
                    "failed_rows": upload.failed_rows if upload else 0,
                }
            )

        return Response({"results": results})

    @extend_schema(
        summary="Download the last upload of a master, locked",
        description=(
            "The workbook this platform is currently running on, rebuilt and protected."
            "\n\n"
            "Not a blank template — the templates are the SAP exports themselves, which this "
            "portal has always said. This is *what we last loaded*, so an admin about to "
            "re-upload a corrected master can open the one in force and check a column "
            "against it."
            "\n\n"
            "**Protected, not sealed.** The sheet carries Excel's own protection, which stops "
            "the accidental edit — a stray keystroke, a dragged column — and can be removed by "
            "anyone who means to. It is not encryption, and one of these files is not "
            "evidence."
            "\n\n"
            "404 where nothing has landed for that master yet."
        ),
        responses={200: bytes},
    )
    @action(detail=False, methods=["get"], url_path=r"snapshots/(?P<upload_type>[a-z]+)")
    def snapshot(self, request, upload_type=None):
        masters = {
            DataUploadLog.UploadType.MEMBER,
            DataUploadLog.UploadType.MAIT,
            DataUploadLog.UploadType.MPP,
        }
        if upload_type not in masters:
            raise Http404("No such master.")

        upload = latest_upload(upload_type)
        if upload is None:
            raise Http404("Nothing has been uploaded for this master yet.")

        # The masters carry names, mobile numbers and member codes, so handing one back is a
        # PII read and is logged as one — the same treatment the exports get.
        record_audit(
            action=AuditLog.Action.PII_ACCESS,
            entity_type="master_snapshot",
            entity_id=str(upload.id),
            request=request,
            meta={"upload_type": upload_type, "file_name": upload.file_name},
        )

        payload = build_snapshot(upload).getvalue()

        stamp = timezone.localtime(upload.finished_at or upload.created_at).strftime("%Y-%m-%d")

        # One body, with its length stated.
        #
        # An xlsx is a zip and is not valid until its central directory is written, so there is
        # no honest way to stream one as it is assembled: the build has to finish first. Sending
        # the finished bytes in chunks *was* tried, to give the browser's reader more than one
        # reading to draw a bar from — and it made this endpoint take **12.6 seconds** for a
        # 482 KB file. `runserver` is wsgiref, which does a blocking write per chunk, so
        # fifteen chunks cost about eight tenths of a second each. Behind gunicorn it would be
        # fine and here it is unusable, and the development path is the one people run.
        #
        # So the framing is left to TCP, which delivers it in several reads anyway, and the
        # part of the wait that was actually invisible — the server building the workbook — is
        # reported by the client as its own phase instead. `Content-Length` matters either way:
        # it is what makes the bar a fraction rather than a stripe that only says "working".
        response = HttpResponse(
            payload,
            content_type=("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        )
        response["Content-Disposition"] = (
            f'attachment; filename="{upload_type}-master-{stamp}.xlsx"'
        )
        response["Content-Length"] = str(len(payload))
        # Readable cross-origin. On the no-Docker development path the portal is served on
        # :8080 and the API on :8000, and `Content-Length` is not a CORS-safelisted response
        # header — without this the browser hides it, `measured()` finds no total, and the
        # percentage silently becomes a stripe. Behind nginx the two share an origin and this
        # header is redundant; it costs nothing and the dev path is where it is noticed.
        response["Access-Control-Expose-Headers"] = "Content-Length, Content-Disposition"
        return response

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
class NonMemberViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    The non-members a Mait works with in the field (SRS §9.3).

    **Scoped by MPP, not by who typed the row in.** It used to be `created_by_mait`, which was
    wrong in two ways that only showed up once registering the same woman twice became
    impossible. A Mait who registered her in March and returns in August could still find her;
    a Mait who took over that MPP could not see her at all, and the only thing the app offered
    them was the registration form — which now refuses the Aadhaar as a duplicate and leaves
    them with a farmer they cannot serve and cannot re-create.

    An MPP is the unit of work here, the same way it is for members (`MemberViewSet` has always
    scoped this way), so the rule is the same rule: a Mait sees the farmers at the collection
    points they cover, and nothing else (SRS §16).
    """

    serializer_class = NonMemberSerializer
    permission_classes = [IsMait]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["mpp__mpp_code"]
    # A Mait is told a name in the yard and reads a number off a phone. Both find her.
    search_fields = ["name", "mobile_no", "father_husband_name"]

    def get_queryset(self):
        mait = getattr(self.request.user, "mait_profile", None)
        if mait is None:
            return NonMember.objects.none()

        queryset = NonMember.objects.filter(mpp__mait=mait)
        if self.action == "list":
            # What the picker needs to tell two women in one village apart, counted in SQL:
            # a page of rows that each queried for their own animals would be a query per row.
            queryset = queryset.annotate(
                animal_count=Count("animals", distinct=True),
                ai_event_count=Count("ai_events", distinct=True),
                last_ai_at=Max("ai_events__created_at"),
            ).order_by("name")
        if self.action == "retrieve":
            queryset = queryset.prefetch_related(animals_with_history())
        return queryset

    def get_serializer_class(self):
        # The detail shape carries the animals already registered to this farmer, which is
        # what step 4 of the capture flow picks from.
        if self.action == "aadhaar":
            return NonMemberAadhaarSerializer
        if self.action == "list":
            return NonMemberPickerSerializer
        return NonMemberDetailSerializer if self.action == "retrieve" else NonMemberSerializer

    @extend_schema(
        summary="The non-members already registered at an MPP",
        description=(
            "What the capture flow offers a Mait once they have said *non-member* and picked "
            "the collection point. Without it the only path was the registration form, so a "
            "farmer served a second time was registered a second time — and since one Aadhaar "
            "is now one farmer, that path simply refuses.\n\n"
            "Scoped to the MPPs the requesting Mait covers. Pass `mpp__mpp_code` for one of "
            "them, and `search` for her name, her number or the household name.\n\n"
            "Each row carries how many animals are on her record and when she was last "
            "served, because a Mait picking from a list of names in one village needs "
            "something other than the name to tell two of them apart."
        ),
        responses={200: NonMemberPickerSerializer},
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_serializer_context(self):
        # The serializer needs to know whose MPPs are whose before it accepts one.
        context = super().get_serializer_context()
        context["mait"] = getattr(self.request.user, "mait_profile", None)
        return context

    def perform_create(self, serializer):
        """
        Stamp the creating Mait, and the moment she consented, server-side.

        Neither is taken from the request body as a value — the Mait because that would let one
        attribute a registration to another (SRS §16), and the consent time because a handset
        clock is not evidence of when anything happened. The app sends `consent` as the fact
        that she agreed; the server decides what time it is.
        """
        mait = getattr(self.request.user, "mait_profile", None)
        consented = serializer.validated_data.pop("consent", False)
        non_member = serializer.save(
            created_by_mait=mait,
            consent_captured_at=timezone.now() if consented else None,
        )
        record_audit(
            action="create",
            entity_type="non_member",
            entity_id=non_member.id,
            request=self.request,
            meta={"mpp_id": non_member.mpp_id},
        )

    @extend_schema(
        summary="Attach her Aadhaar card",
        description=(
            "Multipart: `front`, `back`, or both. Photographed at registration, as evidence "
            "behind the number that was typed.\n\n"
            "Separate from registration rather than part of it, like an animal's portrait: "
            "the record must survive a village connection dropping a JPEG, because the flow "
            "is standing on her id by then and losing it costs the whole form again.\n\n"
            "The stored URLs are never returned. The response says whether each face is on "
            "file — `aadhar_front_captured` and `aadhar_back_captured` — because a Mait needs "
            "to know the step is done and a link to somebody's identity card has no business "
            "in a handset's cache."
        ),
        request=NonMemberAadhaarSerializer,
        responses={200: NonMemberSerializer},
    )
    @action(detail=True, methods=["patch"], parser_classes=[MultiPartParser, FormParser])
    def aadhaar(self, request, pk=None):
        non_member = self.get_object()

        serializer = NonMemberAadhaarSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Outside any transaction: an upload holds the connection for as long as the village
        # network takes, and a transaction held open that long blocks whatever sits behind it.
        changed = []
        if serializer.validated_data.get("front"):
            non_member.aadhar_front_url = store_aadhaar_image(
                non_member, serializer.validated_data["front"], face="front"
            )
            changed.append("aadhar_front_url")
        if serializer.validated_data.get("back"):
            non_member.aadhar_back_url = store_aadhaar_image(
                non_member, serializer.validated_data["back"], face="back"
            )
            changed.append("aadhar_back_url")

        non_member.save(update_fields=[*changed, "updated_at"])

        record_audit(
            action=AuditLog.Action.UPDATE,
            entity_type="non_member",
            entity_id=non_member.id,
            request=request,
            # Which faces arrived, never where they landed. An audit row is read by more
            # people than the record is.
            meta={"aadhaar_faces": [f.replace("aadhar_", "").replace("_url", "") for f in changed]},
        )
        return Response(NonMemberSerializer(non_member).data)


@extend_schema(tags=["master-data"])
class AdminNonMemberViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """
    The farmers Maits registered in the field, for the back office (SRS §9.3, W10b).

    Separate from ``NonMemberViewSet`` rather than a permission branch on it, because the two
    answer different questions. That one is a Mait's own working set — scoped to what they
    created, because a Mait has no business reading another's farmers (SRS §16). This one is
    the whole population, and it exists because until now nobody outside the app could see it
    at all: a non-member is registered on a form that ends with cash changing hands, and the
    only oversight of that was the row's absence from every admin screen.

    Counts are annotated rather than serialised per row. A farmer with four animals and eleven
    inseminations is one row here, and a property that queried for each would be a page of
    fifty rows costing a hundred queries.
    """

    permission_classes = [IsAdmin]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["mpp__mpp_code", "created_by_mait", "relation"]
    search_fields = ["name", "mobile_no", "father_husband_name"]
    ordering_fields = ["created_at", "name"]
    ordering = ["-created_at"]

    def get_queryset(self):
        queryset = NonMember.objects.select_related("mpp", "created_by_mait").annotate(
            animal_count=Count("animals", distinct=True),
            ai_event_count=Count("ai_events", distinct=True),
        )
        if self.action == "retrieve":
            # Only on detail: the list has no animals column, and prefetching for a page of
            # fifty would buy a second query for nothing.
            queryset = queryset.prefetch_related(animals_with_history())
        return queryset

    def get_serializer_class(self):
        if self.action == "retrieve":
            return AdminNonMemberDetailSerializer
        return AdminNonMemberListSerializer

    @extend_schema(
        summary="Search the non-members Maits have registered",
        parameters=[
            OpenApiParameter(
                "search",
                description="Matches her name, her mobile number, or the household name.",
                required=False,
                type=str,
            ),
            OpenApiParameter(
                "no_card",
                description=(
                    "`true` returns only the farmers missing one or both faces of their "
                    "Aadhaar card — the rows the back office has to chase."
                ),
                required=False,
                type=bool,
            ),
        ],
        responses={200: AdminNonMemberListSerializer},
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        # A queue, not a filter: these are the registrations that cannot be checked against
        # anything, and they are the reason an operator opens this screen twice.
        if str(self.request.query_params.get("no_card", "")).lower() in ("true", "1"):
            queryset = queryset.filter(Q(aadhar_front_url="") | Q(aadhar_back_url=""))
        return queryset

    @extend_schema(
        summary="One non-member, with her card and her animals",
        description=(
            "The only endpoint that returns the Aadhaar card image URLs. The Mait's own app is "
            "told a boolean instead, because a link to an identity document has no business in "
            "a handset's cache — an admin checking that the number typed matches the card has "
            "to see the card. **The read is audit-logged against the operator's account.**"
        ),
        responses={200: AdminNonMemberDetailSerializer},
    )
    def retrieve(self, request, *args, **kwargs):
        non_member = self.get_object()

        # Logged in the same spirit as unmasking a member's Aadhaar: this response carries
        # photographs of a government identity document, and who looked at one is part of
        # holding them at all (SRS §7, §16).
        if non_member.aadhar_front_url or non_member.aadhar_back_url:
            record_audit(
                action=AuditLog.Action.PII_ACCESS,
                entity_type="non_member",
                entity_id=non_member.id,
                request=request,
                meta={"aadhaar_card_viewed": True},
            )

        return Response(self.get_serializer(non_member).data)


@extend_schema(tags=["master-data"])
class FarmerOTPSendView(APIView):
    """Send a verification code to a farmer's own number (SRS §6.5)."""

    permission_classes = [IsMait]
    throttle_scope = "otp_send"

    @extend_schema(
        summary="Send a farmer verification code",
        description=(
            "The code goes to the number on the farmer's record, never to a number in the "
            "request. A Mait who could nominate the destination could nominate their own "
            "phone, and a verification a Mait can satisfy alone verifies nothing.\n\n"
            "A farmer whose record carries no mobile number cannot be verified at all, and "
            "is refused here rather than at the end of the capture."
        ),
        request=FarmerKeySerializer,
        responses={200: dict},
    )
    def post(self, request):
        serializer = FarmerKeySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        mait = getattr(request.user, "mait_profile", None)
        farmer, mobile_no = resolve_farmer(mait=mait, **serializer.validated_data)
        if farmer is None:
            return Response(
                {"detail": "No such farmer at your MPPs."}, status=status.HTTP_404_NOT_FOUND
            )
        if not mobile_no:
            return Response(
                {"detail": "No mobile number on record — she must add it at the collection point."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        issue_otp(mobile_no=mobile_no, purpose=OTPLog.Purpose.FARMER_VERIFY)
        return Response(
            {
                "mobile_no": mask_mobile(mobile_no),
                "expires_in_seconds": settings.OTP_EXPIRY_SECONDS,
            }
        )


@extend_schema(tags=["master-data"])
class FarmerOTPVerifyView(APIView):
    """Check the code the farmer read out (SRS §6.5.1)."""

    permission_classes = [IsMait]
    throttle_scope = "otp_verify"

    @extend_schema(
        summary="Verify a farmer verification code",
        description=(
            "Expires after five minutes; three wrong attempts force a resend. Expired, "
            "wrong and out-of-attempts are distinct problem types, because each needs a "
            "different action from a Mait standing in a yard."
        ),
        request=FarmerOTPVerifySerializer,
        responses={200: dict},
    )
    def post(self, request):
        serializer = FarmerOTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        mait = getattr(request.user, "mait_profile", None)
        farmer, mobile_no = resolve_farmer(
            mait=mait,
            member_code=data["member_code"],
            non_member_id=data.get("non_member_id"),
        )
        if farmer is None or not mobile_no:
            return Response(
                {"detail": "No such farmer at your MPPs."}, status=status.HTTP_404_NOT_FOUND
            )

        # Raises OTPInvalid / OTPExpired / OTPAttemptsExceeded, each its own problem type.
        verify_otp(mobile_no=mobile_no, purpose=OTPLog.Purpose.FARMER_VERIFY, code=data["otp"])

        record_audit(
            action=AuditLog.Action.UPDATE,
            entity_type="member" if data["member_code"] else "non_member",
            entity_id=farmer.id,
            request=request,
            meta={"farmer_verified": True},
        )
        return Response({"verified": True, "mobile_no": mask_mobile(mobile_no)})
