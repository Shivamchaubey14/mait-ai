"""
The Mait's pregnancy checks.

Two things a handset needs: what is due, and a way to say what was found. Everything else —
what an outcome implies, when a recheck falls — is decided in `services.py`, because a rule
a client could choose differently is a rule that can be quietly skipped.

Scoped to the signed-in Mait by the queryset, never by a filter the app sends. A "which Mait
am I" parameter is one that can be omitted or altered.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsMait

from .models import ALERT_WINDOW_DAYS, PregnancyCheck
from .serializers import PregnancyCheckSerializer, RecordCheckSerializer
from .services import CheckAlreadyRecorded, PhotoRequired, record_check


@extend_schema(tags=["pregnancy"])
class PregnancyCheckViewSet(viewsets.ReadOnlyModelViewSet):
    """
    What this Mait owes a visit, and what they have already found.

    `window=due` is the default and the one the app opens on: everything open and due inside
    the alert window, plus everything already overdue. Overdue never falls off the list — a
    check nobody did does not stop mattering, and an animal quietly dropped from the round is
    a conception rate nobody can trust.
    """

    serializer_class = PregnancyCheckSerializer
    permission_classes = [IsAuthenticated, IsMait]

    def get_queryset(self):
        mait = getattr(self.request.user, "mait_profile", None)
        if mait is None:
            return PregnancyCheck.objects.none()

        base = (
            PregnancyCheck.objects.filter(mait=mait)
            .select_related(
                "ai_event",
                "ai_event__mpp",
                "ai_event__animal",
                "ai_event__member",
                "ai_event__non_member",
                "ai_event__semen_batch",
            )
            .order_by("due_on", "id")
        )

        # The window is a property of the *list*. Applied to a detail lookup it would hide a
        # check the moment it was recorded — and the moment after recording is exactly when a
        # replay from the offline queue arrives, so the retry would 404 on its own success.
        if self.action != "list":
            return base

        window = self.request.query_params.get("window", "due")
        today = timezone.localdate()

        if window == "done":
            return base.exclude(outcome="").order_by("-checked_at")
        if window == "all":
            return base
        # Open, and either overdue or due inside the week ahead.
        return base.filter(outcome="", due_on__lte=today + timedelta(days=ALERT_WINDOW_DAYS))

    def get_serializer_context(self):
        context = super().get_serializer_context()
        # One "today" for the whole response, so a request served across midnight cannot put
        # two different day-counts on one screen.
        context["today"] = timezone.localdate()
        return context

    @extend_schema(
        summary="Pregnancy checks for the signed-in Mait",
        parameters=[
            OpenApiParameter(
                name="window",
                description=(
                    "`due` (default) — open checks that are overdue or fall inside the "
                    "seven-day alert window. `done` — checks already recorded, newest first. "
                    "`all` — everything."
                ),
                required=False,
                type=str,
            )
        ],
    )
    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        today = timezone.localdate()
        mine = PregnancyCheck.objects.filter(
            mait=getattr(request.user, "mait_profile", None), outcome=""
        )
        # Counted on the server so every screen that shows a number shows the same one — the
        # Profile row, the list's own headline, and the tab badge.
        response.data["due_this_week"] = mine.filter(
            due_on__lte=today + timedelta(days=ALERT_WINDOW_DAYS)
        ).count()
        response.data["overdue"] = mine.filter(due_on__lt=today).count()
        return response

    @extend_schema(
        summary="Record what the Mait found",
        request=RecordCheckSerializer,
        responses={200: PregnancyCheckSerializer},
    )
    @action(detail=True, methods=["post"], url_path="record")
    def record(self, request, pk=None):
        check = self.get_object()

        mait = getattr(request.user, "mait_profile", None)
        if check.mait_id != getattr(mait, "id", None):
            raise PermissionDenied("This check belongs to another Mait.")

        payload = RecordCheckSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        client_uuid = data.get("client_uuid")
        if client_uuid:
            # A replay from the offline queue. The result already written is the answer —
            # returning it rather than refusing keeps a retrying handset from treating its own
            # success as a failure and asking a Mait to record the same visit twice.
            already = PregnancyCheck.objects.filter(client_uuid=client_uuid).first()
            if already:
                return Response(self.get_serializer(already).data)
            check.client_uuid = client_uuid
            check.save(update_fields=["client_uuid", "updated_at"])

        try:
            record_check(
                check,
                outcome=data["outcome"],
                photo_url=data.get("photo_url", ""),
                note=data.get("note", ""),
                actor=request.user,
            )
        except PhotoRequired as exc:
            raise ValidationError({"photo_url": [str(exc)]}) from exc
        except CheckAlreadyRecorded:
            # Not an error the Mait can do anything about, and not a failure either: the visit
            # is on the record. Answered with the record rather than a red screen.
            return Response(
                self.get_serializer(check).data,
                status=status.HTTP_200_OK,
                headers={"X-Already-Recorded": "1"},
            )

        return Response(self.get_serializer(check).data)
