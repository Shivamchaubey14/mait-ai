"""
Pregnancy diagnosis — did the insemination take?

An AI event ends when the straw is used and the payment is settled, but it does not end the
*question*. Ninety days later somebody has to put a hand on the animal and find out whether
she is carrying, and until that happens the platform knows what it sold, not what it achieved.
Conception rate is the number this product is ultimately judged on, and it cannot be computed
from AI events alone.

So every completed insemination books a check, and the check is the Mait's job.

Four outcomes, and they are not symmetrical:

  pregnant       Sets a calving date. Stored rather than recomputed on read, because the
                 gestation constants below will be argued about and revised, and a date
                 already told to a farmer must not silently move afterwards.
  not pregnant   She can be inseminated again the same day, and usually is — the Mait is
                 standing in the yard and the animal is in heat. A photo is required for this
                 outcome and no other: it is the one that costs somebody money, and the one a
                 farmer disputes.
  not sure       Honest, and ordinary at ninety days on a first check. Books another check
                 three weeks out rather than forcing a guess into the record.
  declined       The owner would not have the animal examined. Nothing was found, because
                 nothing was looked at, and the visit is over — no follow-up, no charge.

The fourth is not a finding and must never be counted as one. A Mait who walks to the yard and
is turned away has done their job; the animal has not been examined, and an insemination whose
only check was refused has neither succeeded nor failed. Recording it matters anyway, and for
two reasons: without it the Mait's only way to clear the row is to invent a result, and a round
that keeps showing checks nobody can explain is a round an admin stops reading.

A refusal **closes the chain and books nothing**. That is a decision with a sharp edge behind
it, and `oversight.py` is where the edge is handled: an insemination whose checks are all
recorded and none pregnant is otherwise the definition of a *failed* service, so a chain that
ends in a refusal would be scored a failure for an examination her owner did not permit. The
rate excludes it explicitly instead — a chain has to contain an actual finding before it counts
either way.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.db import models

from apps.animals.models import AnimalType
from apps.core.models import TimeStampedModel

# --------------------------------------------------------------------------------------
# The arithmetic
# --------------------------------------------------------------------------------------
# Business rules that will be revisited, so they are named constants in one place rather than
# numbers buried in the services.

#: Days after the insemination that the check falls due.
DAYS_TO_CHECK = 90

#: How far ahead the Mait is warned. The list is "this week" because a round is planned by
#: the week, and a check that appears the morning it is due cannot be planned around at all.
ALERT_WINDOW_DAYS = 7

#: An unsure check books another this far out — one oestrus cycle, so a missed pregnancy has
#: had time to show itself.
RECHECK_AFTER_DAYS = 21


#: Gestation, by species. A buffalo carries about a month longer than a cow, and telling a
#: farmer the wrong month is worse than telling her nothing.
GESTATION_DAYS = {
    AnimalType.COW: 283,
    AnimalType.BUFFALO: 310,
}


def calving_due_from(served_on: date, animal_type: str) -> date:
    """When she is due, counted from the insemination rather than from the check."""
    return served_on + timedelta(
        days=GESTATION_DAYS.get(animal_type, GESTATION_DAYS[AnimalType.COW])
    )


class PregnancyRate(TimeStampedModel):
    """
    What a pregnancy diagnosis costs. One row, two prices.

    Not per breed, unlike the insemination rate on `BreedConfig`. A straw is a different
    product at a different cost depending on the bull it came from; putting a hand on an
    animal is the same work whatever she is, and pricing it eighteen times would be eighteen
    chances to leave one of them at zero.

    **Two prices, one service** — the same split the insemination rate makes, and for the same
    reason. A member is charged against a milk payment the dairy already owes her and hands
    over nothing in the yard; a non-member pays the Mait in cash on the spot. They are settled
    in different worlds, so the dairy prices them apart.

    **Zero is not free, it is unpriced.** The consequence of an unset rate is invisible from
    the desk that sets it and lands on a Mait halfway through a visit, so `price_for` returns
    `None` rather than `0` and the app says the service is chargeable without naming a figure.
    """

    #: There is one row and this is its key. A `TextChoices` rather than a boolean singleton
    #: flag, so a second priced service is a row instead of a schema change.
    class Service(models.TextChoices):
        PREGNANCY_DIAGNOSIS = "pd", "Pregnancy diagnosis"

    service = models.CharField(
        max_length=20,
        choices=Service.choices,
        default=Service.PREGNANCY_DIAGNOSIS,
        unique=True,
    )
    member_rate = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text="What a member is charged for one pregnancy diagnosis, in rupees. She hands "
        "over nothing: the dairy deducts it from her milk payment at the next payout. Zero "
        "means not priced, never free.",
    )
    non_member_rate = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text="What a non-member pays the Mait on the spot, in rupees. Zero means not "
        "priced, never free.",
    )

    class Meta:
        db_table = "pregnancy_rate"

    def __str__(self) -> str:
        return (
            f"{self.get_service_display()}: "
            f"member {self.member_rate}, other {self.non_member_rate}"
        )

    def for_owner(self, owner_type: str):
        """The rate this owner pays, or `None` where nobody has set one."""
        rate = self.member_rate if owner_type == "member" else self.non_member_rate
        return rate if rate and rate > 0 else None


class PregnancyCheck(TimeStampedModel):
    """
    One visit to find out whether an insemination took.

    Not a field on `AIEvent`, because there can be more than one: an unsure check books a
    recheck, and both belong to the same insemination. The chain is what makes a conception
    rate honest — an event whose second check came back pregnant did not fail.
    """

    class Outcome(models.TextChoices):
        PREGNANT = "pregnant", "Pregnant"
        NOT_PREGNANT = "not_pregnant", "Not pregnant"
        UNSURE = "unsure", "Not sure"
        # Not a finding. Stored alongside the three that are, because the row has to be
        # closable and a refusal is the honest thing to close it with — but every reader that
        # counts outcomes has to know this one answers nothing, and `is_finding` below is how
        # they ask.
        DECLINED = "declined", "Owner declined"

    ai_event = models.ForeignKey(
        "ai_events.AIEvent", on_delete=models.CASCADE, related_name="pregnancy_checks"
    )
    #: Denormalised from the event so the Mait's own list needs no join, and so a check
    #: survives its event being reassigned to somebody else mid-window.
    mait = models.ForeignKey(
        "masterdata.Mait", on_delete=models.PROTECT, related_name="pregnancy_checks"
    )

    due_on = models.DateField(
        db_index=True, help_text="Ninety days after the insemination, or a recheck's own date."
    )

    outcome = models.CharField(max_length=14, choices=Outcome.choices, blank=True, db_index=True)
    checked_at = models.DateTimeField(null=True, blank=True, db_index=True)
    photo_url = models.CharField(max_length=500, blank=True)
    calving_due_on = models.DateField(
        null=True, blank=True, help_text="Set on a pregnant result and never recomputed after."
    )
    note = models.CharField(max_length=255, blank=True)

    amount_charged = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "What this visit cost, copied from the rate at the moment it was recorded rather "
            "than read back through today's rate. A price the farmer was quoted in a yard is "
            "a fact about that day; re-deriving it later would silently restate every past "
            "visit the next time the dairy changes what it charges. Null on a visit that was "
            "never performed — a refused check is not billed for — and on one recorded before "
            "anybody set a rate."
        ),
    )

    #: The recheck an unsure result booked, so the chain can be walked in either direction.
    rechecks = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="rechecked_by",
        help_text="The earlier check this one was booked by.",
    )

    client_uuid = models.UUIDField(
        null=True,
        blank=True,
        unique=True,
        help_text=(
            "Minted on the handset when the result is recorded, so a result replayed from the "
            "offline queue is written once. A check is done in a yard with no signal as often "
            "as not (ADR 0003)."
        ),
    )

    class Meta:
        db_table = "pregnancy_check"
        ordering = ["due_on", "id"]
        constraints = [
            # A recorded check has an outcome and a time; an open one has neither. Half a
            # result is a check nobody can act on and nobody can count.
            models.CheckConstraint(
                condition=(
                    models.Q(outcome="", checked_at__isnull=True)
                    | (~models.Q(outcome="") & models.Q(checked_at__isnull=False))
                ),
                name="pregnancy_recorded_together",
            ),
            # A calving date belongs to a pregnant result and to nothing else.
            models.CheckConstraint(
                condition=(models.Q(calving_due_on__isnull=True) | models.Q(outcome="pregnant")),
                name="pregnancy_calving_only_when_pregnant",
            ),
        ]
        indexes = [
            # The Mait's own list: what is open, soonest first.
            models.Index(fields=["mait", "outcome", "due_on"], name="pd_mait_open_idx"),
        ]

    def __str__(self) -> str:
        state = self.get_outcome_display() if self.outcome else "due"
        return f"PD {self.ai_event_id} · {self.due_on} · {state}"

    @property
    def is_recorded(self) -> bool:
        return bool(self.outcome)

    @property
    def is_finding(self) -> bool:
        """
        Whether this check actually examined the animal.

        A declined check is recorded but found nothing, and the two are different questions:
        "has this row been dealt with" and "does this row tell us whether she is in calf".
        Anything computing a rate wants the second.
        """
        return self.is_recorded and self.outcome != self.Outcome.DECLINED

    def days_until(self, today: date | None = None) -> int:
        """Negative when overdue. What the badge on the row counts."""
        return (self.due_on - (today or date.today())).days
