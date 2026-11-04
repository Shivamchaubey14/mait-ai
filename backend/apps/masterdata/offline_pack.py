"""
The offline pack — a Mait's whole working set, for the handset to keep (SRS §6.9, ADR 0003).

A Mait works in villages with one bar or none. The app used to keep only the reads a screen
had happened to make while there was signal, so an MPP never opened online was an empty list
offline, and a search never typed online found nobody. This hands the handset everything the
capture flow reads — the MPPs, the members and non-members at them with their animals, and the
breed list — so steps 1–6 run from the phone and the network only keeps the copy fresh.

**Two calls, both small after the first.** ``/mait/offline-pack/`` is the index: the Mait's
MPPs and the breeds. ``/mait/offline-pack/<mpp_code>/`` is one MPP's farmers. Split by MPP so
a download cut off by a dropped connection costs one village, not the whole round, and so a
refresh only fetches the villages that changed.

**Only what changed.** Pass ``since`` — the ``server_time`` from the last answer — and only the
farmers touched after it come back: their record, any of their animals, or an insemination on
one of those animals (which moves "last AI" on the row). The window is widened by a few
minutes so a row committed just as the last answer was being built is not missed; sending a
farmer twice costs nothing, since the handset replaces by key. ``member_codes`` and
``non_member_ids`` always list everyone still at the MPP, so the handset drops whoever left.

**Less than the detail endpoints, on purpose.** A detail read is one farmer the Mait opened;
this is every farmer at every MPP they cover, sitting on a phone that is carried around all
day. So the member copy has no bank, folio, Aadhaar, age or education — nothing the capture
flow reads — and is the same scope the detail endpoints already enforce: the Mait's own MPPs.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.field_codes import keys_for
from apps.animals.models import BreedConfig
from apps.animals.queries import animals_with_history
from apps.animals.serializers import BreedConfigSerializer
from apps.core.permissions import IsMait

from .models import MPP, Member, NonMember
from .procurement import serializer_context as procurement_serializer_context
from .serializers import MemberDetailSerializer, MPPListSerializer, NonMemberDetailSerializer

#: How far back of ``since`` a refresh looks, for rows committed while the last answer was built.
OVERLAP = timedelta(minutes=5)


class OfflineMemberSerializer(MemberDetailSerializer):
    """A member as the capture flow reads her, and nothing more."""

    class Meta(MemberDetailSerializer.Meta):
        fields = [
            "id",
            "member_code",
            "member_name",
            "father_husband_name",
            "mobile_no",
            "activation_status",
            "mpp_code",
            "mpp_name",
            "can_receive_otp",
            # Carried into the pack so the picker pill, the milk panel and the code-eligibility
            # gate all work with no signal, from the phone's own copy.
            "procurement_eligible",
            "procurement",
            "animals",
        ]
        read_only_fields = fields


class OfflineNonMemberSerializer(NonMemberDetailSerializer):
    """A non-member with her animals, and the relation as the picker prints it."""

    relation_display = serializers.CharField(source="get_relation_display", read_only=True)

    class Meta(NonMemberDetailSerializer.Meta):
        fields = [*NonMemberDetailSerializer.Meta.fields, "relation_display"]


def _mait_of(request):
    return getattr(request.user, "mait_profile", None)


def _since(request):
    """The ``since`` parameter, widened by the overlap; ``None`` for a full download."""
    raw = request.query_params.get("since")
    if not raw:
        return None
    value = parse_datetime(raw)
    if value is None:
        raise serializers.ValidationError({"since": "Send the server_time from the last answer."})
    if timezone.is_naive(value):
        value = timezone.make_aware(value)
    return value - OVERLAP


class OfflinePackView(APIView):
    """The index: which MPPs to fetch, and the breed list."""

    permission_classes = [IsMait]

    @extend_schema(
        summary="The offline pack's index — the Mait's MPPs and the breeds",
        description=(
            "Everything the capture flow needs that is not one MPP's farmers: the collection "
            "points this Mait covers and the active breed list. The app then fetches "
            "`/mait/offline-pack/{mpp_code}/` for each MPP. `server_time` is what to send as "
            "`since` next time.\n\n"
            "`field_keys` are this Mait's keys for the next seven days, for checking a farmer "
            "with no signal against a code the office phoned her (`accounts.field_codes`); "
            "`office_phone` is the number to ring for one."
        ),
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        mait = _mait_of(request)
        # Every *active* MPP assigned to this Mait — the same set, counts and Mait fields the
        # online `/mpp/` picker returns for a Mait, so the step-1 picker reads the same list
        # whether the pack was built online or offline.
        #
        # Narrowed by `is_active`, matching `MPPViewSet`: a collection point the SAP master has
        # retired should not appear in the capture picker, where choosing it would open a flow
        # against a point the dairy no longer collects at. (A point freshly assigned to a Mait
        # carries `is_active=True` by default, so this drops only the ones SAP has marked
        # retired, not newly onboarded villages.)
        mpps = (
            MPP.objects.filter(mait=mait, is_active=True)
            .select_related("mait", "mait__user")
            # Count only active members, so the number on the step-1 card matches the member
            # list the Mait actually opens (the per-MPP pack serves active members only).
            .annotate(
                member_count=Count(
                    "members", filter=Q(members__activation_status=Member.ACTIVE_STATUS)
                )
            )
            .order_by("mpp_name")
        )
        return Response(
            {
                "server_time": timezone.now().isoformat(),
                "mpps": MPPListSerializer(mpps, many=True, context={"request": request}).data,
                "breeds": BreedConfigSerializer(
                    BreedConfig.objects.filter(is_active=True), many=True
                ).data,
                "field_keys": keys_for(mait.id) if mait else [],
                "office_phone": settings.FIELD_OFFICE_PHONE,
            }
        )


class OfflinePackMppView(APIView):
    """One MPP's farmers, whole or since the last download."""

    permission_classes = [IsMait]

    @extend_schema(
        summary="One MPP's farmers for the offline pack",
        description=(
            "The members and non-members at one of the Mait's MPPs, each with her animals and "
            "their AI history. With `since` (the last `server_time`), only farmers changed "
            "after it — her record, an animal, or an insemination on one. `member_codes` and "
            "`non_member_ids` always list everyone still at the MPP, so the app can drop "
            "farmers who left. `404` for an MPP the Mait does not cover."
        ),
        parameters=[
            OpenApiParameter(
                "since",
                description="The `server_time` of the last answer. Omit for everything.",
                required=False,
                type=str,
            )
        ],
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request, mpp_code: str):
        mait = _mait_of(request)
        mpp = get_object_or_404(MPP, mpp_code=mpp_code, mait=mait)
        since = _since(request)
        now = timezone.now()

        # Active members only. An inactive ("No") member left the rolls — she is kept for the
        # office and history, but the field app never captures for her, so she is absent from
        # the pack and from the code list the handset uses to drop farmers who are no longer
        # here. When a member is deactivated her code falls out of `member_codes`, so the
        # handset drops her on the next refresh.
        members = (
            Member.objects.filter(mpp=mpp, activation_status=Member.ACTIVE_STATUS)
            .select_related("mpp")
            .prefetch_related("procurements")
        )
        non_members = NonMember.objects.filter(mpp=mpp)
        member_codes = list(members.order_by("member_code").values_list("member_code", flat=True))
        non_member_ids = list(non_members.order_by("id").values_list("id", flat=True))

        if since is not None:
            changed = (
                Q(updated_at__gt=since)
                | Q(animals__updated_at__gt=since)
                | Q(animals__ai_events__updated_at__gt=since)
            )
            # A newly uploaded procurement period changes her eligibility and milk panel, so it
            # must bring her down on a refresh even when nothing else about her moved. Members
            # only — a non-member has no procurement.
            members = members.filter(changed | Q(procurements__updated_at__gt=since)).distinct()
            non_members = non_members.filter(changed).distinct()

        context = {"request": request, **procurement_serializer_context()}
        return Response(
            {
                "server_time": now.isoformat(),
                "mpp_code": mpp.mpp_code,
                "full": since is None,
                "members": OfflineMemberSerializer(
                    members.prefetch_related(animals_with_history()).order_by("member_name"),
                    many=True,
                    context=context,
                ).data,
                "non_members": OfflineNonMemberSerializer(
                    non_members.prefetch_related(animals_with_history()).order_by("name"),
                    many=True,
                    context=context,
                ).data,
                "member_codes": member_codes,
                "non_member_ids": non_member_ids,
            }
        )
