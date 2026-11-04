"""
The portal's Login codes screen (``SuperOTP``): the asks waiting, and generating a code.

Behind its own section, beside Users & roles. Narrowed by zone like every other "who" screen:
a zonal manager with the section sees the Maits and store keepers in their own zone, and a
code for anybody else is a 404, not a button that happens not to be drawn.
"""

from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsAdmin, in_section
from apps.core.scoping import scope_of

from .field_codes import issue_field_code
from .models import PortalSection, Role, SuperOTP
from .super_otp import _active, _field_user, decline, issue_code, last_sms


class SuperOTPSerializer(serializers.ModelSerializer):
    """One ask or code, with who it is for and what their last SMS did. Never the code."""

    state = serializers.CharField(read_only=True)
    step = serializers.SerializerMethodField()
    for_farmer = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    role = serializers.CharField(source="user.role", read_only=True)
    role_display = serializers.CharField(source="user.get_role_display", read_only=True)
    who = serializers.SerializerMethodField()
    number_on_file = serializers.SerializerMethodField()
    issued_by_name = serializers.SerializerMethodField()
    sms = serializers.SerializerMethodField()
    # For a farmer step: her milk procurement and whether it clears the code-eligibility bar,
    # so the office sees why a code is (or is not) warranted before reading one out.
    procurement = serializers.SerializerMethodField()

    class Meta:
        model = SuperOTP
        fields = [
            "id",
            "state",
            "purpose",
            "step",
            "for_farmer",
            "farmer_name",
            "context",
            "ai_event_id",
            "procurement",
            "status",
            "status_display",
            "full_name",
            "role",
            "role_display",
            "who",
            "mobile_no",
            "number_on_file",
            "reason",
            "requested_at",
            "request_count",
            "issued_by_name",
            "issued_at",
            "expires_at",
            "attempt_count",
            "used_at",
            "decline_reason",
            "sms",
        ]
        read_only_fields = fields

    STEPS = {
        "login": "Sign-in",
        "farmer_verify": "Farmer check",
        "payment_online": "Online payment",
        "payment_cod": "Cash payment",
    }

    def get_step(self, obj) -> str:
        return self.STEPS.get(obj.purpose, obj.purpose)

    def get_for_farmer(self, obj) -> bool:
        """The office calls her, not the Mait who asked — the reveal says so."""
        return obj.purpose != "login"

    def get_who(self, obj) -> str:
        """The line under the name: which Mait, which store, or which zone it is."""
        user = obj.user
        if user.role == Role.STORE:
            return f"Store keeper · {user.store.name}" if user.store_id else "Store keeper"
        if user.role == Role.ADMIN:
            # Their zone, because that is the whole of what the account is: the office is
            # about to phone somebody, and "Zonal manager" alone names a dozen people.
            names = ", ".join(user.zone_names)
            return f"Zonal manager · {names}" if names else "Zonal manager"
        mait = getattr(user, "mait_profile", None)
        return f"Mait · {mait.sahayak_vendor_code}" if mait else "Mait"

    def get_number_on_file(self, obj) -> str:
        """
        The number to call back — the one on the record, not whoever rang the office.

        For a Mait it is the SAP record's number, which is what sign-in resolves them by; the
        office should dial that and nothing else. For a farmer step it is *her* number, off her
        record — the one the SMS went to, and the only one the code works on.
        """
        if obj.purpose != "login":
            return obj.mobile_no
        mait = getattr(obj.user, "mait_profile", None)
        return (mait.mobile_no if mait else "") or obj.user.mobile_no or obj.mobile_no

    def get_issued_by_name(self, obj) -> str:
        return obj.issued_by.full_name if obj.issued_by_id else ""

    def get_sms(self, obj) -> dict | None:
        return last_sms(obj.mobile_no, obj.purpose)

    def _member_for(self, obj):
        """The member a farmer step is about — by the AI event if there is one, else her number."""
        from apps.masterdata.models import Member

        if obj.ai_event_id:
            from apps.ai_events.models import AIEvent

            event = (
                AIEvent.objects.filter(pk=obj.ai_event_id).select_related("member").first()
            )
            if event is not None and event.member_id:
                return event.member
        if obj.mobile_no:
            return (
                Member.objects.filter(mobile_no=obj.mobile_no).order_by("member_code").first()
            )
        return None

    def get_procurement(self, obj):
        """Her latest milk period and eligibility, for a farmer step; ``None`` for a sign-in."""
        if obj.purpose == "login":
            return None
        member = self._member_for(obj)
        if member is None:
            return None
        from apps.masterdata.procurement import eligibility_for

        decision = eligibility_for(member)
        block = {
            "member_code": member.member_code,
            "member_name": member.member_name,
            "eligible": decision.eligible,
            "gated": decision.gated,
            "threshold": str(decision.threshold),
            "amount": str(decision.amount) if decision.amount is not None else None,
        }
        latest = decision.latest
        if latest is not None:
            block["period"] = {
                "from_date": latest.from_date,
                "to_date": latest.to_date,
                "qty": str(latest.qty),
                "avg_fat": str(latest.avg_fat),
                "avg_snf": str(latest.avg_snf),
                "amount": str(latest.amount),
                "no_of_pouring_days": latest.no_of_pouring_days,
                "no_of_pouring_shift": latest.no_of_pouring_shift,
            }
        return block


class DeclineSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True)


class IssueForNumberSerializer(serializers.Serializer):
    mobile_no = serializers.RegexField(r"^[6-9]\d{9}$", max_length=10)


class FieldCodeSerializer(serializers.Serializer):
    """Which Mait rang, and which farmer is in front of them."""

    mait = serializers.CharField(
        max_length=15, help_text="The Mait's sign-in number, or their Sahayak vendor code."
    )
    member_code = serializers.CharField(max_length=20, required=False, allow_blank=True)
    farmer_mobile = serializers.RegexField(
        r"^[6-9]\d{9}$",
        max_length=10,
        required=False,
        allow_blank=True,
        help_text="For a non-member — possibly one the Mait registered with no signal, whom "
        "the office cannot see yet.",
    )
    farmer_name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate(self, attrs):
        if bool((attrs.get("member_code") or "").strip()) == bool(attrs.get("farmer_mobile")):
            raise serializers.ValidationError(
                "Give the member's code, or the farmer's number for a non-member — one of them."
            )
        return attrs


@extend_schema(tags=["super-otp"])
class SuperOTPViewSet(viewsets.ReadOnlyModelViewSet):
    """Sign-in codes for field users whose SMS did not arrive."""

    serializer_class = SuperOTPSerializer
    permission_classes = [IsAdmin, in_section(PortalSection.SUPER_OTP)]
    pagination_class = None

    def get_queryset(self):
        rows = SuperOTP.objects.select_related(
            "user", "user__mait_profile", "user__store", "issued_by"
        ).order_by("-updated_at")
        codes = scope_of(self.request)
        if codes is not None:
            rows = rows.filter(
                Q(user__mait_profile__mpps__plant_code__in=codes)
                | Q(user__store__plants__plant_code__in=codes)
            ).distinct()
        return rows

    @extend_schema(
        summary="Asks and codes",
        description=(
            "`state=open` (the default) for what needs the office: asks waiting, and codes "
            "given and not yet used. `state=all` for the last 200 of everything, used, declined "
            "and expired included."
        ),
    )
    def list(self, request, *args, **kwargs):
        rows = list(self.get_queryset()[:500])
        if request.query_params.get("state", "open") == "open":
            rows = [row for row in rows if row.state in ("waiting", "issued")]
        else:
            rows = rows[:200]
        # Waiting first, oldest ask first — the person who has waited longest is called first.
        rows.sort(
            key=lambda row: (
                row.state != "waiting",
                row.requested_at.timestamp() if row.requested_at else 0,
            )
        )
        return Response(self.get_serializer(rows, many=True).data)

    @extend_schema(
        summary="Generate the code for an ask",
        description=(
            "Returns the code **once**, as `code`, for the admin to read out on the phone. It "
            "is stored only as a hash and is never returned again. Expires in "
            "`SUPER_OTP_EXPIRY_SECONDS`; any earlier code for the same person is revoked."
        ),
        request=None,
        responses={201: OpenApiTypes.OBJECT},
    )
    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        row, code = issue_code(row=self.get_object(), actor=request.user, request=request)
        return self._with_code(row, code)

    @extend_schema(
        summary="Generate a code for somebody who phoned",
        description="No ask from the app needed — for a user who rang the office instead.",
        request=IssueForNumberSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["post"], url_path="issue-for-number")
    def issue_for_number(self, request):
        payload = IssueForNumberSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        mobile_no = payload.validated_data["mobile_no"]
        # The zone rule, before anything is written: generating would revoke the person's live
        # code, and that must not happen on the say-so of somebody who cannot see them.
        user = _field_user(mobile_no)
        if user is not None and not self._in_reach(user):
            return Response(
                {"detail": "That number belongs to somebody outside your zone."},
                status=status.HTTP_404_NOT_FOUND,
            )
        row, code = issue_code(mobile_no=mobile_no, actor=request.user, request=request)
        return self._with_code(row, code)

    @extend_schema(
        summary="Generate a farmer code for a Mait with no signal",
        description=(
            "For a Mait who phoned because there is no data where they are standing. The code "
            "is checked on their phone, not here, so nothing has to reach the server until the "
            "capture does — and the capture is then matched against this row. Read it to **the "
            "farmer**, on the number returned as `mobile_no`, never to the Mait. Good until the "
            "end of today; asking again for the same farmer returns the same code."
        ),
        request=FieldCodeSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["post"], url_path="field-code")
    def field_code(self, request):
        from apps.masterdata.models import Mait, Member, NonMember

        payload = FieldCodeSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        who = data["mait"].strip()
        user = _field_user(who) if who.isdigit() and len(who) == 10 else None
        mait = getattr(user, "mait_profile", None) if user is not None else None
        if mait is None:
            mait = Mait.objects.select_related("user").filter(sahayak_vendor_code=who).first()
        # Outside the zone reads the same as no such Mait: a zonal manager learns nothing
        # about the rest of the dairy from this box.
        if mait is None or mait.user is None or not self._in_reach(mait.user):
            return Response(
                {"detail": "No Mait signs in with that number or code."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if not _active(mait.user):
            return Response(
                {"detail": f"{mait.name} can no longer use the app, so no code can be given."},
                status=status.HTTP_409_CONFLICT,
            )

        member_code = (data.get("member_code") or "").strip()
        if member_code:
            member = Member.objects.filter(member_code=member_code, mpp__mait=mait).first()
            if member is None:
                return Response(
                    {"detail": f"No member {member_code} at {mait.name}'s MPPs."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if not member.mobile_no:
                return Response(
                    {"detail": "She has no number on record, so there is nobody to call."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # The eligibility gate reaches the no-signal path too: a member below the milk bar
            # is not handed a field code any more than an online one.
            from apps.masterdata.procurement import code_block_reason

            blocked = code_block_reason(member)
            if blocked:
                return Response(
                    {"detail": blocked, "code": "not-eligible"},
                    status=status.HTTP_409_CONFLICT,
                )
            mobile_no, name = member.mobile_no, member.member_name
        else:
            mobile_no = data["farmer_mobile"]
            known = NonMember.objects.filter(mobile_no=mobile_no, mpp__mait=mait).first()
            name = known.name if known else (data.get("farmer_name") or "").strip()

        row, code = issue_field_code(
            mait=mait, mobile_no=mobile_no, farmer_name=name, actor=request.user, request=request
        )
        return self._with_code(row, code)

    def _in_reach(self, user) -> bool:
        codes = scope_of(self.request)
        if codes is None:
            return True
        mait = getattr(user, "mait_profile", None)
        if mait is not None and mait.mpps.filter(plant_code__in=codes).exists():
            return True
        return bool(user.store_id) and user.store.plants.filter(plant_code__in=codes).exists()

    @extend_schema(summary="Decline an ask", request=DeclineSerializer)
    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        payload = DeclineSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        row = decline(
            row=self.get_object(),
            reason=payload.validated_data.get("reason", ""),
            actor=request.user,
            request=request,
        )
        return Response(self.get_serializer(row).data)

    def _with_code(self, row, code: str) -> Response:
        row = get_object_or_404(self.get_queryset(), pk=row.pk)
        body = dict(self.get_serializer(row).data)
        body["code"] = code
        response = Response(body, status=status.HTTP_201_CREATED)
        # The one response that carries a live credential: nothing between here and the
        # admin's screen should keep a copy.
        response["Cache-Control"] = "no-store"
        return response
