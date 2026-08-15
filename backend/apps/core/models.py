"""Shared base models: timestamps, the audit trail, and idempotency storage."""

from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    """Every table carries creation and modification times. No exceptions."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class AuditLog(models.Model):
    """
    Immutable record of every consequential change (SRS §7 Auditability).

    Written by the audit service, never by hand. There is deliberately no update or delete
    path — an audit trail that can be edited is not an audit trail.
    """

    class Action(models.TextChoices):
        CREATE = "create", "Create"
        UPDATE = "update", "Update"
        DELETE = "delete", "Delete"
        LOGIN = "login", "Login"
        LOGOUT = "logout", "Logout"
        STATE_CHANGE = "state_change", "State change"
        PII_ACCESS = "pii_access", "Full PII access"
        UPLOAD = "upload", "Master data upload"

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_entries",
        help_text="Null for system-initiated actions such as scheduled jobs.",
    )
    action = models.CharField(max_length=20, choices=Action.choices, db_index=True)
    entity_type = models.CharField(max_length=50, db_index=True)
    entity_id = models.CharField(max_length=50, db_index=True)
    meta_json = models.JSONField(
        default=dict,
        blank=True,
        help_text="Before/after values. PII is stored masked, never in the clear.",
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    request_id = models.CharField(max_length=36, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "audit_log"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["entity_type", "entity_id", "-created_at"], name="audit_entity_time_idx"
            ),
            models.Index(fields=["actor", "-created_at"], name="audit_actor_time_idx"),
        ]

    def __str__(self) -> str:
        when = f"{self.created_at:%Y-%m-%d %H:%M}"
        return f"{self.action} {self.entity_type}#{self.entity_id} @ {when}"


class IdempotencyRecord(TimeStampedModel):
    """
    Stores the response of a completed idempotent write so a retry replays it (ADR 0003).

    The mobile offline queue retries blindly on reconnect; this is what makes that safe.
    `request_fingerprint` catches a client reusing a key for different content — that is a
    client bug, and returning the wrong stored response would hide it.

    Identified by key *and* endpoint. ADR 0003 puts one capture's `client_uuid` on every write
    for that event, so the same key reaches create, complete and the rest with a different body
    each time; that is the design, not a client bug. The key was unique on its own until
    2026-08-14, which meant the create's record answered the completion's lookup and every
    completion was refused with a 422.
    """

    key = models.CharField(max_length=64, db_index=True)
    endpoint = models.CharField(max_length=120)
    request_fingerprint = models.CharField(max_length=64)
    response_status = models.PositiveSmallIntegerField()
    response_body = models.JSONField(default=dict)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = "idempotency_record"
        indexes = [models.Index(fields=["expires_at"], name="idem_expiry_idx")]
        constraints = [
            models.UniqueConstraint(
                fields=["key", "endpoint"], name="idempotency_key_endpoint_uniq"
            )
        ]

    def __str__(self) -> str:
        return f"{self.key} → {self.response_status}"
