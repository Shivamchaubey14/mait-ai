"""
Zones — the dairy's own grouping of chilling centres, and who may see which.

Three things live here: the setup screen's CRUD, the list of BMC/MCCs it assigns from, and
the people each zone is run by — their number, and what they have done with it.

The scoping those zones then cause is in ``apps.core.scoping``, deliberately apart — one
module decides what a zone *is*, another decides what it *hides*, and merging them is how a
change to the second quietly becomes a change to the first.

The managers half is here rather than on Users & roles for a reason worth keeping. Users &
roles is the desk that hands out access: it knows an account has a zone the way it knows the
account has fourteen sections. This screen is the one somebody opens asking *who runs
Bahraich* — and since 2026-09-19 the answer decides something operational, because the mobile
number on that account is what signs them into the zonal manager's app (``apps.zonal``).
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Sum
from django.http import Http404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.models import PortalSection, Role, User, mobile_validator
from apps.core.exceptions import RecordInUse
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin, in_section
from apps.core.scoping import scope_of
from apps.core.services import record_audit
from apps.core.timeframe import end_of_day, start_of_day

from .models import MPP, Mait, Zone, ZonePlant, plants_with_counts


class ZoneSerializer(serializers.ModelSerializer):
    """
    A zone, with the chilling centres in it.

    ``plants`` is the whole membership on both read and write — the set this zone holds, not
    an addition to it. Sending three codes to a zone that had five removes the other two,
    which is what makes the setup screen's tick-boxes mean what they appear to mean. A
    partial update that could only ever add would leave an operator unticking a box, pressing
    save, and watching nothing happen.
    """

    # Write-only, with the read side supplied by `to_representation`. The name is deliberate
    # — it is what the field is called on the way in and on the way out — but `plants` is also
    # the related manager on the model, and letting DRF read the field from the instance hands
    # a RelatedManager to a ListField, which raises rather than degrading.
    plants = serializers.ListField(
        child=serializers.CharField(max_length=10),
        required=False,
        allow_empty=True,
        write_only=True,
    )
    mpp_count = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()

    class Meta:
        model = Zone
        fields = [
            "id",
            "code",
            "name",
            "description",
            "is_active",
            "plants",
            "plant_names",
            "mpp_count",
            "member_count",
            "user_count",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    plant_names = serializers.SerializerMethodField()

    def get_plant_names(self, zone) -> list[str]:
        return [p.plant_name or p.plant_code for p in zone.plants.all()]

    def get_mpp_count(self, zone) -> int:
        codes = zone.plant_codes
        return MPP.objects.filter(plant_code__in=codes).count() if codes else 0

    def get_member_count(self, zone) -> int:
        codes = zone.plant_codes
        from .models import Member

        return Member.objects.filter(mpp__plant_code__in=codes).count() if codes else 0

    def get_user_count(self, zone) -> int:
        return zone.users.filter(is_active=True).count()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # The codes this zone holds, which is the same set the caller writes.
        data["plants"] = instance.plant_codes
        return data

    def validate_code(self, value):
        return value.strip().upper()

    def validate_plants(self, value):
        """
        Refuse a plant that is already in another zone, by name.

        The database would refuse it anyway — ``plant_code`` is unique on ZonePlant — but as
        an IntegrityError, which reaches the operator as "something went wrong". A chilling
        centre belonging to two zones is the mistake this whole table shape exists to
        prevent, so it is worth a sentence saying which centre and which zone already has it.
        """
        codes = [code.strip() for code in value if code and code.strip()]
        if len(codes) != len(set(codes)):
            raise serializers.ValidationError("The same BMC/MCC is listed twice.")

        known = set(
            MPP.objects.filter(plant_code__in=codes).values_list("plant_code", flat=True).distinct()
        )
        unknown = [code for code in codes if code not in known]
        if unknown:
            raise serializers.ValidationError(
                "No BMC/MCC in the master data has the code "
                + ", ".join(sorted(unknown))
                + ". They arrive with the SAP upload; a code typed by hand will never match."
            )

        taken = ZonePlant.objects.filter(plant_code__in=codes).select_related("zone")
        mine = self.instance.pk if self.instance else None
        clashes = [row for row in taken if row.zone_id != mine]
        if clashes:
            raise serializers.ValidationError(
                "; ".join(
                    f"{row.plant_name or row.plant_code} is already in {row.zone.name}"
                    for row in clashes
                )
                + ". A BMC/MCC belongs to one zone — take it out of that one first."
            )
        return codes

    def _write_plants(self, zone, codes):
        """Replace this zone's membership with ``codes``."""
        names = {
            row["plant_code"]: row["plant_name"]
            for row in MPP.objects.filter(plant_code__in=codes).values("plant_code", "plant_name")
        }
        zone.plants.exclude(plant_code__in=codes).delete()
        held = set(zone.plants.values_list("plant_code", flat=True))
        ZonePlant.objects.bulk_create(
            [
                ZonePlant(zone=zone, plant_code=code, plant_name=names.get(code, ""))
                for code in codes
                if code not in held
            ]
        )
        # Names drift as SAP re-sends the masters; the copy on the row is a convenience, not
        # a record, so it is refreshed rather than left to go stale.
        for row in zone.plants.all():
            fresh = names.get(row.plant_code, "")
            if fresh and fresh != row.plant_name:
                row.plant_name = fresh
                row.save(update_fields=["plant_name", "updated_at"])

    @transaction.atomic
    def create(self, validated_data):
        codes = validated_data.pop("plants", [])
        zone = Zone.objects.create(**validated_data)
        self._write_plants(zone, codes)
        return zone

    @transaction.atomic
    def update(self, instance, validated_data):
        codes = validated_data.pop("plants", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if codes is not None:
            self._write_plants(instance, codes)
        return instance


# --------------------------------------------------------------------------------------
# The people who run a zone
# --------------------------------------------------------------------------------------
#: How far back the managers panel counts by default. A working window; the trail itself is
#: append-only and a lifetime total would only ever grow.
MANAGER_ACTIVITY_DAYS = 30

#: The ceiling on one page of the activity feed.
MANAGER_ACTIVITY_MAX = 200


def _activity_days(request) -> int:
    try:
        return min(365, max(1, int(request.query_params.get("days", MANAGER_ACTIVITY_DAYS))))
    except (TypeError, ValueError):
        return MANAGER_ACTIVITY_DAYS


def _scoped_managers(request):
    """
    Every account narrowed to a zone, within what the caller may see.

    Zone-scoped accounts only: a head-office Admin has no zone and is not the manager of one,
    and listing them here would turn a screen about who runs Bahraich into a second copy of
    Users & roles. A caller who is themselves scoped sees the managers of the zones they
    overlap and no others — the panel is a directory, not a way round the scope.
    """
    managers = (
        User.objects.filter(role=Role.ADMIN, zones__isnull=False)
        .prefetch_related("zones")
        .distinct()
        .order_by("full_name")
    )
    codes = scope_of(request)
    if codes is None:
        return managers
    mine = set(ZonePlant.objects.filter(plant_code__in=codes).values_list("zone_id", flat=True))
    return managers.filter(zones__id__in=mine).distinct()


def _activity_for(user_ids: list[int], days: int) -> dict[int, dict]:
    """
    What each of these accounts has done lately, in one pass over the trail.

    Approvals and rejections are counted from the audit log rather than from the indents.
    Approval is stamped on the indent (``approved_by``); a rejection is not — the reason goes
    on the indent and the actor only into the log — so the log is the single place both
    answers exist, and taking each from a different source is how two figures on one screen
    come to disagree.
    """
    if not user_ids:
        return {}

    since = start_of_day(timezone.localdate() - timedelta(days=days - 1))
    rows = (
        AuditLog.objects.filter(actor_id__in=user_ids, created_at__gte=since)
        .order_by("-created_at", "-id")
        .values("actor_id", "action", "entity_type", "meta_json", "created_at")
    )

    activity: dict[int, dict] = {
        user_id: {"actions": 0, "approved": 0, "rejected": 0, "last": None} for user_id in user_ids
    }
    for row in rows:
        stats = activity[row["actor_id"]]
        stats["actions"] += 1
        if stats["last"] is None:
            stats["last"] = row["created_at"]
        if row["action"] == AuditLog.Action.STATE_CHANGE and row["entity_type"] == "indent":
            to = (row["meta_json"] or {}).get("to")
            if to in ("approved", "rejected"):
                stats[to] += 1
    return activity


def _maits_under(zones) -> int:
    """How many Maits this account's live zones actually cover — the size of their patch."""
    codes = list(ZonePlant.objects.filter(zone__in=zones).values_list("plant_code", flat=True))
    if not codes:
        return 0
    return Mait.objects.filter(is_active=True, mpps__plant_code__in=codes).distinct().count()


def manager_row(user: User, activity: dict[int, dict]) -> dict:
    """One account, as the Zones screen reads it."""
    stats = activity.get(user.id) or {"actions": 0, "approved": 0, "rejected": 0, "last": None}
    zones = list(user.zones.all())
    live = [zone for zone in zones if zone.is_active]
    return {
        "id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "mobile_no": user.mobile_no,
        "is_active": user.is_active,
        "zone_codes": [zone.code for zone in zones],
        "zone_names": [zone.name for zone in live],
        # Named rather than counted: a manager whose only zone was switched off sees an empty
        # app and an empty dashboard, and "Ayodhya Zone (inactive)" is the sentence that
        # explains it. A bare count explains nothing.
        "inactive_zones": [zone.name for zone in zones if not zone.is_active],
        "sections": user.allowed_sections,
        "last_login_at": user.last_login_at,
        # Whether the handset app opens for them at all: a live zone and a number to send the
        # code to. Both, and nothing else — see `User.is_zonal_manager`.
        "app_access": bool(user.mobile_no) and user.is_zonal_manager,
        "maits": _maits_under(live),
        "activity": {
            "actions": stats["actions"],
            "approved": stats["approved"],
            "rejected": stats["rejected"],
            "last_action_at": stats["last"],
        },
    }


def manager_rows(request) -> dict:
    """The managers panel: who runs each zone, and what they have been doing in it."""
    days = _activity_days(request)
    managers = list(_scoped_managers(request))
    activity = _activity_for([user.id for user in managers], days)
    rows = [manager_row(user, activity) for user in managers]
    return {
        "days": days,
        "count": len(rows),
        # The two figures the panel is read for: who cannot be reached on a handset, and who
        # has done nothing at all in the window. Counted here so the screen does not have to
        # decide for itself what "no number" means.
        "without_mobile": sum(1 for row in rows if not row["mobile_no"]),
        "idle": sum(1 for row in rows if row["activity"]["actions"] == 0),
        "results": rows,
    }


class ManagerMobileSerializer(serializers.Serializer):
    """
    The one field this screen writes: the number a zonal manager signs into the app with.

    It has to be free. Sign-in resolves an account *by its mobile number*, so a manager
    sharing one with a Mait or a store keeper would sign in as whichever the lookup found
    first — the same rule, and very nearly the same sentence, the Stores screen applies to a
    keeper.

    Blank is allowed and means "no app": the account keeps its portal password and simply
    cannot sign in on a handset. That is not the same as a number nobody has got round to
    typing, which is why the panel counts those separately.
    """

    mobile_no = serializers.CharField(required=True, allow_blank=True)

    def validate_mobile_no(self, value):
        value = (value or "").strip()
        if not value:
            return ""
        mobile_validator(value)
        if Mait.objects.filter(mobile_no=value, is_active=True).exists():
            raise serializers.ValidationError(
                "A Mait signs in with this number. A manager needs a number of their own."
            )
        clash = (
            User.objects.filter(mobile_no=value, is_active=True)
            .exclude(pk=self.context["user"].pk)
            .first()
        )
        if clash is not None:
            raise serializers.ValidationError(
                f"{clash.full_name} already signs in with this number."
            )
        return value


@extend_schema(tags=["zones"])
class ZoneViewSet(viewsets.ModelViewSet):
    """
    Maintain the zones and what each one covers.

    Behind the Zones section, which sits beside Users & roles: this decides how much of the
    network an account sees, so it belongs to the desk that already decides which screens it
    opens rather than to the operational screens.

    Every write is audited. A zone quietly gaining a chilling centre changes what several
    people's dashboards report, and "the numbers moved last Tuesday" needs an answer.
    """

    serializer_class = ZoneSerializer
    permission_classes = [IsAdmin, in_section(PortalSection.ZONES)]
    queryset = Zone.objects.all().prefetch_related("plants").order_by("name")
    pagination_class = None

    def perform_create(self, serializer):
        zone = serializer.save()
        record_audit(
            action="create",
            entity_type="zone",
            entity_id=zone.id,
            request=self.request,
            meta={"code": zone.code, "name": zone.name, "plants": zone.plant_codes},
        )

    def perform_update(self, serializer):
        before = serializer.instance.plant_codes
        was_active = serializer.instance.is_active
        zone = serializer.save()
        after = zone.plant_codes
        record_audit(
            action="update",
            entity_type="zone",
            entity_id=zone.id,
            request=self.request,
            meta={
                "code": zone.code,
                "name": zone.name,
                "plants": {"before": sorted(before), "after": sorted(after)},
                "is_active": {"before": was_active, "after": zone.is_active},
            },
        )

    def perform_destroy(self, instance):
        """
        Delete, but never out from under the accounts that read it.

        A zone with people assigned is somebody's entire view of the platform. Removing it
        would silently widen them to the whole network — failing open, and in the one
        direction nobody would report as a bug. Deactivating has the same effect on the
        dashboard and leaves the assignment visible on Users & roles.
        """
        holders = list(instance.users.values_list("full_name", flat=True))
        if holders:
            raise RecordInUse(
                f"{instance.name} is the zone for "
                + ", ".join(holders[:3])
                + (f" and {len(holders) - 3} others" if len(holders) > 3 else "")
                + ". Deleting it would show them the whole network instead. Move those "
                "accounts to another zone first, or make this one inactive."
            )
        record_audit(
            action="delete",
            entity_type="zone",
            entity_id=instance.id,
            request=self.request,
            meta={"code": instance.code, "name": instance.name, "plants": instance.plant_codes},
        )
        instance.delete()

    # -- the people in a zone ------------------------------------------------------------
    #
    # A zone is a line drawn round some chilling centres; a zonal manager is the person who
    # works inside it. Until the app existed the two were only ever joined on Users & roles,
    # which is the desk that hands out access rather than the desk that runs the network — so
    # the question "who runs Ayodhya, what is their number, and what have they done with it"
    # had no screen at all. It does now, and this answers it.

    @action(detail=False, methods=["get"], url_path="managers")
    def managers(self, request):
        """
        The accounts narrowed to a zone, with their number and what they have been doing.

        Anyone scoped to a zone is here, whether or not they hold Indents: a zone with an
        account on it that does nothing is exactly as worth knowing as one with a busy
        manager. `app_access` is whether they can sign in to the handset app at all, which
        is a mobile number and a live zone and nothing else (``User.is_zonal_manager``).
        """
        return Response(manager_rows(request))

    @action(
        detail=False,
        methods=["patch"],
        url_path=r"managers/(?P<user_id>[0-9]+)",
    )
    def manager(self, request, user_id=None):
        """
        Set a zonal manager's mobile number, from the screen where their zone is decided.

        Here as well as on Users & roles, because this is the number that decides whether the
        manager has the app, and the desk that gives somebody a zone is the desk that is
        asked for it. Only the number: role, sections and zones are the other screen's, and a
        second way to change them is a second way for the two to disagree.
        """
        user = _scoped_managers(request).filter(pk=user_id).first()
        if user is None:
            raise Http404("No zonal manager with that id in a zone you can see.")

        serializer = ManagerMobileSerializer(data=request.data, context={"user": user})
        serializer.is_valid(raise_exception=True)
        before = user.mobile_no
        user.mobile_no = serializer.validated_data["mobile_no"]
        user.save(update_fields=["mobile_no", "updated_at"])

        record_audit(
            action="update",
            entity_type="user",
            entity_id=user.id,
            request=request,
            meta={
                "field": "mobile_no",
                "before": {"mobile_no": before},
                "after": {"mobile_no": user.mobile_no},
                "zones": user.zone_names,
            },
        )
        return Response(manager_row(user, _activity_for([user.id], _activity_days(request))))

    @extend_schema(
        summary="What the zone's managers have done",
        parameters=[
            OpenApiParameter("manager", description="One manager's account id", type=int),
            OpenApiParameter(
                "days", description=f"Window, default {MANAGER_ACTIVITY_DAYS}", type=int
            ),
            OpenApiParameter(
                "kind",
                description="`decisions` (the default) drops sign-ins; `all` is the whole trail",
                type=str,
            ),
            OpenApiParameter(
                "limit", description=f"Default 50, max {MANAGER_ACTIVITY_MAX}", type=int
            ),
            OpenApiParameter("offset", type=int),
        ],
        responses={200: dict},
    )
    @action(detail=False, methods=["get"], url_path="activity")
    def activity(self, request):
        """
        What the zone's managers have actually done, newest first.

        The audit trail this platform has always written, filtered to the people on the
        screen above it and turned into sentences by the same code the Audit log screen uses
        — one implementation, because a second would read the same rows differently and an
        office comparing the two screens would have no way to tell which was lying.

        `manager` narrows it to one of them; `days` sets the window; `limit`/`offset` page it.

        `kind` is the one that matters in practice, and it defaults to `decisions`. A manager
        who works in the portal signs in and out several times a day, so the unfiltered trail
        is ninety sign-ins with the two approvals somebody came to read buried inside them —
        which is a feed nobody scrolls twice. `kind=all` is the whole trail, and the Audit log
        screen remains the place for the full grid.
        """
        from apps.core.audit_api import serialise

        days = _activity_days(request)
        managers = _scoped_managers(request)
        wanted = request.query_params.get("manager")
        if wanted and str(wanted).isdigit():
            managers = managers.filter(pk=int(wanted))

        ids = list(managers.values_list("id", flat=True))
        since = start_of_day(timezone.localdate() - timedelta(days=days - 1))
        trail = (
            AuditLog.objects.select_related("actor")
            .filter(actor_id__in=ids, created_at__gte=since)
            .order_by("-created_at", "-id")
        )
        if request.query_params.get("kind", "decisions") != "all":
            # Everything that changed a record, which is everything a manager is answerable
            # for. Signing in is not one of those.
            trail = trail.exclude(action__in=[AuditLog.Action.LOGIN, AuditLog.Action.LOGOUT])

        try:
            limit = min(MANAGER_ACTIVITY_MAX, max(1, int(request.query_params.get("limit", 50))))
        except (TypeError, ValueError):
            limit = 50
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
        except (TypeError, ValueError):
            offset = 0

        total = trail.count()
        return Response(
            {
                "days": days,
                "count": total,
                "results": [serialise(entry) for entry in trail[offset : offset + limit]],
            }
        )

    @action(detail=False, methods=["get"], url_path="plants")
    def plants(self, request):
        """
        Every BMC/MCC in the master data, with its size and the zone that holds it.

        What the setup screen assigns from. It reports the unassigned ones too — they are the
        point of the screen, not an error — and each carries its MPP and member counts so an
        operator building a zone can tell a chilling centre of 250 MPPs from one of 39.
        """
        rows = plants_with_counts()
        return Response(
            {
                "count": len(rows),
                "unassigned": sum(1 for row in rows if not row["zone_code"]),
                "results": rows,
            }
        )


@extend_schema(
    tags=["zones"],
    summary="Zones, ranked by the work done in them",
    description=(
        "One row per zone for the period, so head office can read Bahraich against "
        "Pratapgarh. Reads the same pre-aggregated table as the trend chart.\n\n"
        "An account that is itself scoped sees only its own zones here — the panel is a "
        "comparison, not a way around the scope."
    ),
)
@api_view(["GET"])
@permission_classes([IsAdmin, in_section(PortalSection.DASHBOARD)])
def zone_performance(request):
    """
    How much work each zone did over a window.

    Counted off ``DailyAIAggregate`` by ``plant_code``, which is why that column was
    denormalised: the alternative is a join from every aggregate row through the MPP to its
    plant, on the one screen with a 400ms budget.

    The recent tail is read live and only the days before it come off the aggregate, exactly
    as ``trends`` and ``mait_performance`` do it. This panel used to trust the table all the
    way to today on the grounds that two days cannot reorder a ranking of weeks — true of the
    order, and beside the point for the totals. It sits directly beneath a chart that *does*
    overlay the tail, so the two read the same window and disagreed about it: the chart drew
    this morning's work and the panel under it did not count it, and the zone rows summed to
    less than the tile at the top of the page. On the no-Docker dev path, where no worker
    runs at all, the gap was every day since somebody last ran ``rebuild_ai_aggregates``.

    It costs the tail, not the window — settled days stay on the aggregate, which is what it
    is for.
    """
    # Imported here rather than at module scope: `apps.dashboard` imports this module's
    # models, and naming its own at the top would close the circle at startup.
    from apps.ai_events.models import AIEvent
    from apps.dashboard.models import AGGREGATE_LOOKBACK_DAYS, DailyAIAggregate

    try:
        days = min(365, max(1, int(request.query_params.get("days", 30))))
    except (TypeError, ValueError):
        days = 30

    end = timezone.localdate()
    start = end - timedelta(days=days - 1)

    zones = list(Zone.objects.filter(is_active=True).prefetch_related("plants").order_by("name"))
    scope = scope_of(request)
    if scope is not None:
        allowed = set(scope)
        zones = [zone for zone in zones if set(zone.plant_codes) & allowed]

    # Where the aggregate stops being authoritative. The hourly job rewrites the last
    # `AGGREGATE_LOOKBACK_DAYS` days wholesale — an event captured offline can arrive hours
    # late and land on one of them — so those days are read off the events themselves.
    live_from = max(start, end - timedelta(days=AGGREGATE_LOOKBACK_DAYS))

    counted = DailyAIAggregate.objects.filter(date__gte=start, date__lt=live_from)
    if scope is not None:
        counted = counted.filter(plant_code__in=scope)

    totals = {
        row["plant_code"]: row["events"] or 0
        for row in counted.values("plant_code").annotate(events=Sum("ai_count"))
    }

    # The tail, counted live and grouped by the same column. Bounded by the job's own
    # look-back, so this is a few days of events however wide the window is.
    live_qs = AIEvent.objects.filter(
        status=AIEvent.Status.COMPLETED,
        completed_at__gte=start_of_day(live_from),
        completed_at__lt=end_of_day(end),
    )
    if scope is not None:
        live_qs = live_qs.filter(mpp__plant_code__in=scope)

    for row in live_qs.values("mpp__plant_code").annotate(events=Count("id")):
        code = row["mpp__plant_code"] or ""
        totals[code] = totals.get(code, 0) + (row["events"] or 0)

    rows = []
    for zone in zones:
        codes = zone.plant_codes
        events = sum(totals.get(code, 0) for code in codes)
        rows.append(
            {
                "code": zone.code,
                "name": zone.name,
                "plants": len(codes),
                "plant_names": [p.plant_name or p.plant_code for p in zone.plants.all()],
                "events": events,
            }
        )

    # Busiest first, and a zone with nothing still appears. A zone missing from the panel
    # reads as a zone that does not exist; a zone showing zero reads as a zone that did no
    # work, and only one of those is ever true here.
    rows.sort(key=lambda row: (-row["events"], row["name"]))

    total = sum(row["events"] for row in rows)
    for row in rows:
        row["share_percent"] = round(row["events"] / total * 100, 1) if total else 0.0

    # What is in no zone at all. Not an error and not hidden: until every chilling centre is
    # assigned, the zone rows do not add up to the network total, and a panel that silently
    # loses events is one nobody can reconcile against the tile above it.
    assigned = {code for zone in zones for code in zone.plant_codes}
    unassigned = sum(events for code, events in totals.items() if code not in assigned)

    return Response(
        {
            "days": days,
            "results": rows,
            "total": total,
            "unassigned_events": unassigned,
            "unassigned_plants": (
                0
                if scope is not None
                else sum(1 for row in plants_with_counts() if not row["zone_code"])
            ),
        }
    )
