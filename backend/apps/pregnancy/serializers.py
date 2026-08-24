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

from .models import PregnancyCheck, PregnancyRate


class PregnancyCheckSerializer(serializers.ModelSerializer):
    ai_event_id = serializers.IntegerField(source="ai_event.id", read_only=True)
    owner_name = serializers.SerializerMethodField()
    owner_type = serializers.CharField(source="ai_event.owner_type", read_only=True)
    # A number to ring before walking. The single most useful thing on this record that was
    # not on it: a check is ninety days after the straw, and by then the animal may be at a
    # relative's, the owner may be at market, and the visit is a wasted morning nobody could
    # have prevented from a screen. One call answers it.
    #
    # Unmasked, like every other phone number this platform serves (`MemberListSerializer`,
    # `NonMemberSerializer`). Only Aadhaar is masked — a mobile number is operational data
    # here, and a masked one cannot be dialled, which is the entire point of carrying it.
    owner_mobile = serializers.SerializerMethodField()
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
    # Where the insemination was actually captured, off the event. A check has no pin of its
    # own — the Mait records the result in the same yard, from the handset, and it is the
    # event's pin that says which yard that is. An admin reading the round down the phone is
    # asked "which house?" more often than any other question, and `mpp_name` is the village,
    # not the household. Null on an event captured before GPS was mandatory, and never
    # silently swapped for the village's own centre: an approximate pin drawn as an exact one
    # is worse than no pin.
    gps_lat = serializers.DecimalField(
        source="ai_event.gps_lat", max_digits=10, decimal_places=7, read_only=True
    )
    gps_lng = serializers.DecimalField(
        source="ai_event.gps_lng", max_digits=10, decimal_places=7, read_only=True
    )
    # Whether the pin is the handset's own reading or one lifted out of a chosen photograph's
    # EXIF, which can be anywhere and any time (see `AIEvent.gps_source`). The two are never
    # presented as the same thing.
    gps_source = serializers.CharField(source="ai_event.gps_source", read_only=True)
    served_on = serializers.SerializerMethodField()
    days_until = serializers.SerializerMethodField()
    days_since_ai = serializers.SerializerMethodField()
    outcome_display = serializers.CharField(source="get_outcome_display", read_only=True)
    # What this visit will cost, already resolved for this owner. Carried on the check rather
    # than fetched from a rates endpoint for two reasons: the handset reads this list once and
    # then works a round with no signal, and a figure the app derives itself is a figure that
    # can disagree with the one the server bills.
    price = serializers.SerializerMethodField()
    amount_charged = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True
    )

    class Meta:
        model = PregnancyCheck
        fields = [
            "id",
            "ai_event_id",
            "owner_name",
            "owner_type",
            "owner_mobile",
            "mpp_id",
            "mpp_code",
            "mpp_name",
            "member_code",
            "non_member_id",
            "animal_id",
            "animal_type",
            "ear_tag_no",
            "breed",
            "gps_lat",
            "gps_lng",
            "gps_source",
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
            "price",
            "amount_charged",
        ]
        read_only_fields = fields

    def get_owner_name(self, check: PregnancyCheck) -> str:
        event = check.ai_event
        # A member carries `member_name` and a non-member carries `name`. Read the same way
        # the AI event serializer reads it, so one farmer is not two different names across
        # two screens.
        owner = event.member or event.non_member
        return getattr(owner, "member_name", None) or getattr(owner, "name", "") or ""

    def get_owner_mobile(self, check: PregnancyCheck) -> str:
        """
        The owner's number, whichever kind of owner they are.

        Read the same way `get_owner_name` reads the name, off the same pair, so one farmer is
        one person across the record. Blank rather than null when there is none: a member's
        number is optional in the SAP master and a screen that has to tell null from "" is a
        screen with two empty states for one fact.
        """
        event = check.ai_event
        owner = event.member or event.non_member
        return getattr(owner, "mobile_no", "") or ""

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

    def get_price(self, check: PregnancyCheck) -> str | None:
        """
        The rate this owner would pay for the visit, as a string, or null when unpriced.

        Null is not zero and the app must not render it as one. A rate nobody has entered is
        an administrator's omission, and the handset says the visit is chargeable without
        naming a figure rather than quoting a farmer nothing.

        Resolved once per response through the serializer context, because a page of a hundred
        checks would otherwise ask the same one-row table a hundred times.
        """
        rates = self.context.get("pd_rates")
        if rates is None:
            rates = PregnancyRate.objects.filter(
                service=PregnancyRate.Service.PREGNANCY_DIAGNOSIS
            ).first()
            self.context["pd_rates"] = rates
        if not rates:
            return None
        amount = rates.for_owner(check.ai_event.owner_type)
        return str(amount) if amount is not None else None

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


class PregnancyRateSerializer(serializers.ModelSerializer):
    """
    The two prices, as the Rates screen edits them.

    Zero is allowed and means *not priced*; negative is not. There is no such thing as being
    paid to examine an animal, and a minus sign typed into a rupee field is a typo every time.
    """

    class Meta:
        model = PregnancyRate
        fields = ["service", "member_rate", "non_member_rate", "updated_at"]
        read_only_fields = ["service", "updated_at"]

    def validate_member_rate(self, value):
        return _not_negative(value)

    def validate_non_member_rate(self, value):
        return _not_negative(value)


def _not_negative(value):
    if value < 0:
        raise serializers.ValidationError("A rate cannot be negative.")
    return value
