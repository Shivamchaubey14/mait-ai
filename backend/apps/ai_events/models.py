"""
The AI event — the heart of the platform (SRS §8.2 `ai_event`, §11).

``status`` drives the mobile UI and gates every subsequent action. Transitions are decided
server-side; the client sends intent, never state. That is what makes the flow impossible to
skip or backdate from a compromised or buggy app.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import TimeStampedModel


class AIEvent(TimeStampedModel):
    """One artificial insemination, from draft to completion."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        STRAW_VERIFIED = "straw_verified", "Straw verified"
        PHOTO_CAPTURED = "photo_captured", "Photo captured"
        PAYMENT_PENDING = "payment_pending", "Payment pending"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    # The state machine from SRS §11, expressed once so every caller agrees on it.
    ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
        Status.DRAFT: (Status.STRAW_VERIFIED, Status.CANCELLED),
        Status.STRAW_VERIFIED: (Status.PHOTO_CAPTURED, Status.CANCELLED),
        Status.PHOTO_CAPTURED: (Status.PAYMENT_PENDING, Status.CANCELLED),
        Status.PAYMENT_PENDING: (Status.COMPLETED, Status.CANCELLED),
        Status.COMPLETED: (),  # terminal
        Status.CANCELLED: (),  # terminal
    }

    # Everything that is not terminal. A capture in one of these is a Mait standing between an
    # animal that has been served and a record that says so — which is what the app's
    # Unfinished list is for, and why the set is defined here rather than retyped per screen.
    UNFINISHED_STATUSES = (
        Status.DRAFT,
        Status.STRAW_VERIFIED,
        Status.PHOTO_CAPTURED,
        Status.PAYMENT_PENDING,
    )

    class OwnerType(models.TextChoices):
        MEMBER = "member", "Member"
        NON_MEMBER = "non_member", "Non-member"

    # Client-generated UUID, also the Idempotency-Key for this event's writes (ADR 0003).
    client_uuid = models.UUIDField(
        unique=True,
        db_index=True,
        help_text="Generated on the device before the first sync attempt.",
    )

    mait = models.ForeignKey("masterdata.Mait", on_delete=models.PROTECT, related_name="ai_events")
    mpp = models.ForeignKey("masterdata.MPP", on_delete=models.PROTECT, related_name="ai_events")

    owner_type = models.CharField(max_length=12, choices=OwnerType.choices)
    member = models.ForeignKey(
        "masterdata.Member",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="ai_events",
    )
    non_member = models.ForeignKey(
        "masterdata.NonMember",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="ai_events",
    )

    animal = models.ForeignKey("animals.Animal", on_delete=models.PROTECT, related_name="ai_events")
    semen_batch = models.ForeignKey(
        "inventory.SemenBatch",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="ai_events",
    )
    straw_unique_no = models.CharField(
        max_length=30,
        blank=True,
        db_index=True,
        help_text="Denormalised from the batch so history survives any master-data cleanup.",
    )

    ai_photo_url = models.CharField(max_length=255, blank=True)
    gps_lat = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    gps_lng = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True
    )
    performed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the AI was actually performed — set at photo capture, not at sync, "
        "so an offline event reports the real time.",
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_reason = models.CharField(max_length=255, blank=True)

    synced_from_offline = models.BooleanField(
        default=False, help_text="True when the event reached the server via the offline queue."
    )

    class Meta:
        db_table = "ai_event"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(member__isnull=False, non_member__isnull=True)
                    | models.Q(member__isnull=True, non_member__isnull=False)
                ),
                name="ai_event_exactly_one_owner",
            ),
            # A completed event without a straw would mean an insemination with nothing
            # deducted — exactly the leakage this platform exists to stop.
            models.CheckConstraint(
                condition=(
                    ~models.Q(status="completed")
                    | models.Q(semen_batch__isnull=False, completed_at__isnull=False)
                ),
                name="ai_event_completed_requires_straw",
            ),
        ]
        indexes = [
            models.Index(fields=["mait", "-created_at"], name="aievent_mait_time_idx"),
            models.Index(fields=["mpp", "-created_at"], name="aievent_mpp_time_idx"),
            models.Index(fields=["status", "-created_at"], name="aievent_status_time_idx"),
            # Serves the dashboard's daily/monthly aggregation job.
            models.Index(fields=["completed_at"], name="aievent_completed_idx"),
        ]

    def __str__(self) -> str:
        return f"AI #{self.pk} {self.straw_unique_no or '(no straw)'} [{self.status}]"

    # -- state machine ------------------------------------------------------------------

    def can_transition_to(self, new_status: str) -> bool:
        return new_status in self.ALLOWED_TRANSITIONS.get(self.status, ())

    @property
    def is_terminal(self) -> bool:
        return self.status in (self.Status.COMPLETED, self.Status.CANCELLED)

    @property
    def owner(self):
        return self.member or self.non_member

    def clean(self) -> None:
        if bool(self.member_id) == bool(self.non_member_id):
            raise ValidationError(
                "An AI event must be for exactly one of a member or a non-member."
            )


class AIEventTimeline(models.Model):
    """
    Step-by-step audit trail for one event, served by
    ``GET /ai-events/{id}/timeline/`` (SRS §9.6).

    Separate from the global ``AuditLog`` because this one is user-facing: a Mait or an
    admin resolving a dispute reads it directly, so it holds a human-readable narrative
    rather than raw before/after payloads.
    """

    ai_event = models.ForeignKey(AIEvent, on_delete=models.CASCADE, related_name="timeline_entries")
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20)
    note = models.CharField(max_length=255, blank=True)
    actor = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="ai_event_transitions",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "ai_event_timeline"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["ai_event", "created_at"], name="timeline_event_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.ai_event_id}: {self.from_status or '-'} → {self.to_status}"
