"""Animal registry and the config-driven breed list (SRS §6.3 step 3, §8.2 `animal`)."""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import TimeStampedModel


class AnimalType(models.TextChoices):
    COW = "COW", "Cow"
    BUFFALO = "BUFF", "Buffalo"


class BreedConfig(TimeStampedModel):
    """
    Admin-editable breed list per animal type (SRS §6.3 step 3).

    Deliberately a table rather than a Python enum: the authoritative list is still an open
    item for business confirmation (SRS §18.2 item 1), and it must be changeable without a
    deploy.
    """

    animal_type = models.CharField(max_length=4, choices=AnimalType.choices, db_index=True)
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=60)
    name_hi = models.CharField(
        max_length=60, blank=True, help_text="Devanagari label for the Hindi toggle."
    )
    rate = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text="Cost of one straw of this breed, in rupees. Zero means not priced — the "
        "list is maintained by hand and a rate nobody has entered must not read as free.",
    )
    display_order = models.PositiveSmallIntegerField(default=100)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "breed_config"
        ordering = ["animal_type", "display_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["animal_type", "code"], name="uniq_breed_per_animal_type"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.get_animal_type_display()})"


class Animal(TimeStampedModel):
    """
    An animal belonging to a Member or a Non-Member (SRS §8.2 `animal`).

    Ownership is a nullable pair rather than a generic foreign key: exactly one of
    ``member`` / ``non_member`` is populated, enforced by a database constraint. A generic
    relation would be more flexible and would lose that guarantee.
    """

    class OwnerType(models.TextChoices):
        MEMBER = "member", "Member"
        NON_MEMBER = "non_member", "Non-member"

    owner_type = models.CharField(max_length=12, choices=OwnerType.choices, db_index=True)
    member = models.ForeignKey(
        "masterdata.Member",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="animals",
    )
    non_member = models.ForeignKey(
        "masterdata.NonMember",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="animals",
    )

    animal_type = models.CharField(max_length=4, choices=AnimalType.choices, db_index=True)
    breed = models.CharField(
        max_length=30,
        blank=True,
        default="",
        help_text=(
            "BreedConfig.code, and the animal's own breed — not the semen's. Optional, "
            "because a Mait registering a cow in a yard often cannot say what she is, and a "
            "flow that insists would collect guesses. Fill it in later from the portal or "
            "the animal endpoint."
        ),
    )
    ear_tag_no = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        unique=True,
        db_index=True,
        help_text="Optional, but unique across the platform when present (SRS §6.3 step 3).",
    )
    photo_url = models.CharField(
        max_length=255,
        blank=True,
        help_text=(
            "A portrait taken when she was registered, so the Mait recognises her on the next "
            "visit. Most animals here carry no ear tag, and 'the black one' is not a record."
        ),
    )

    class Meta:
        db_table = "animal"
        ordering = ["-created_at"]
        constraints = [
            # Exactly one owner. Enforced here rather than in clean() so no code path —
            # including bulk operations and raw SQL — can create an orphan or a double-owned
            # animal (SRS §7 Data Integrity).
            models.CheckConstraint(
                condition=(
                    models.Q(member__isnull=False, non_member__isnull=True)
                    | models.Q(member__isnull=True, non_member__isnull=False)
                ),
                name="animal_exactly_one_owner",
            ),
        ]
        indexes = [
            models.Index(fields=["member", "animal_type"], name="animal_member_type_idx"),
            models.Index(fields=["non_member"], name="animal_nonmember_idx"),
        ]

    def __str__(self) -> str:
        tag = self.ear_tag_no or "no tag"
        return f"{self.get_animal_type_display()} / {self.breed} ({tag})"

    def clean(self) -> None:
        """Mirror the DB constraint with a friendly message for admin and serializers."""
        if bool(self.member_id) == bool(self.non_member_id):
            raise ValidationError(
                "An animal must belong to exactly one of a member or a non-member."
            )
        expected = self.OwnerType.MEMBER if self.member_id else self.OwnerType.NON_MEMBER
        if self.owner_type != expected:
            raise ValidationError({"owner_type": f"Should be '{expected}' for this owner."})

    @property
    def owner(self):
        return self.member or self.non_member
