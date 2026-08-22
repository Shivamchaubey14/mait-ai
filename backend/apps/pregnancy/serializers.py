"""
What a pregnancy check looks like over the wire.

Shaped for the one screen that reads it: a row is a name, a date, and how many days until it
is due — everything else on that row exists to tell a Mait which yard to walk to. So the
serializer flattens the event, the animal and the owner rather than making the handset join
three responses in a village with one bar.
"""

from __future__ import annotations

from datetime import date

from rest_framework import serializers

from .models import PregnancyCheck


class PregnancyCheckSerializer(serializers.ModelSerializer):
    ai_event_id = serializers.IntegerField(source="ai_event.id", read_only=True)
    owner_name = serializers.SerializerMethodField()
    owner_type = serializers.CharField(source="ai_event.owner_type", read_only=True)
    mpp_id = serializers.IntegerField(source="ai_event.mpp.id", read_only=True)
    mpp_code = serializers.CharField(source="ai_event.mpp.mpp_code", read_only=True)
    # Enough to start the next insemination without asking the Mait for answers the record
    # already holds. She is standing in the same yard with the same animal.
    member_code = serializers.CharField(
        source="ai_event.member.member_code", read_only=True, default=""
    )
    non_member_id = serializers.IntegerField(
        source="ai_event.non_member.id", read_only=True, default=None
    )
    animal_id = serializers.IntegerField(source="ai_event.animal.id", read_only=True)
    mpp_name = serializers.CharField(source="ai_event.mpp.mpp_name", read_only=True)
    animal_type = serializers.CharField(source="ai_event.animal.animal_type", read_only=True)
    ear_tag_no = serializers.CharField(source="ai_event.animal.ear_tag_no", read_only=True)
    breed = serializers.SerializerMethodField()
    served_on = serializers.SerializerMethodField()
    days_until = serializers.SerializerMethodField()
    days_since_ai = serializers.SerializerMethodField()
    outcome_display = serializers.CharField(source="get_outcome_display", read_only=True)

    class Meta:
        model = PregnancyCheck
        fields = [
            "id",
            "ai_event_id",
            "owner_name",
            "owner_type",
            "mpp_id",
            "mpp_code",
            "mpp_name",
            "member_code",
            "non_member_id",
            "animal_id",
            "animal_type",
            "ear_tag_no",
            "breed",
            "served_on",
            "due_on",
            "days_until",
            "days_since_ai",
            "outcome",
            "outcome_display",
            "checked_at",
            "calving_due_on",
            "photo_url",
            "note",
        ]
        read_only_fields = fields

    def get_owner_name(self, check: PregnancyCheck) -> str:
        event = check.ai_event
        # A member carries `member_name` and a non-member carries `name`. Read the same way
        # the AI event serializer reads it, so one farmer is not two different names across
        # two screens.
        owner = event.member or event.non_member
        return getattr(owner, "member_name", None) or getattr(owner, "name", "") or ""

    def get_breed(self, check: PregnancyCheck) -> str:
        # Off the straw that was used, the way every other reader of an event gets it — the
        # event itself carries the batch, not a breed field.
        event = check.ai_event
        batch = event.semen_batch
        return (getattr(batch, "breed", "") or "") if batch else ""

    def _served_on(self, check: PregnancyCheck) -> date | None:
        event = check.ai_event
        moment = event.performed_at or event.completed_at
        # `local_day` rather than `.date()`: the stored instant is UTC, and east of Greenwich
        # a dawn insemination is the previous day read that way.
        if not moment:
            return None
        from apps.core.timeframe import local_day

        return local_day(moment)

    def get_served_on(self, check: PregnancyCheck) -> str | None:
        served = self._served_on(check)
        return served.isoformat() if served else None

    def get_days_until(self, check: PregnancyCheck) -> int:
        """Negative when overdue. The badge on the row is this number."""
        today = self.context.get("today") or date.today()
        return (check.due_on - today).days

    def get_days_since_ai(self, check: PregnancyCheck) -> int | None:
        """How long she has been carrying, if she is. Shown on the recording screen."""
        served = self._served_on(check)
        if not served:
            return None
        today = self.context.get("today") or date.today()
        return (today - served).days


class RecordCheckSerializer(serializers.Serializer):
    """
    What the handset sends back from the yard.

    `client_uuid` is minted when the Mait taps the outcome, not when the request goes out —
    a check is done without a signal as often as not, and a key generated at send time is new
    on every retry and deduplicates nothing (ADR 0003).
    """

    outcome = serializers.ChoiceField(choices=PregnancyCheck.Outcome.choices)
    photo_url = serializers.CharField(required=False, allow_blank=True, max_length=500)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)
    client_uuid = serializers.UUIDField(required=False)
