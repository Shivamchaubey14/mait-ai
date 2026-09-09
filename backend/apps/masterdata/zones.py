"""
Zones — the dairy's own grouping of chilling centres, and who may see which.

Two things live here: the setup screen's CRUD, and the list of BMC/MCCs it assigns from.
The scoping those zones then cause is in ``apps.core.scoping``, deliberately apart — one
module decides what a zone *is*, another decides what it *hides*, and merging them is how a
change to the second quietly becomes a change to the first.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.models import PortalSection
from apps.core.exceptions import RecordInUse
from apps.core.permissions import IsAdmin, in_section
from apps.core.scoping import scope_of
from apps.core.services import record_audit
from apps.core.timeframe import end_of_day, start_of_day

from .models import MPP, Zone, ZonePlant, plants_with_counts


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
