"""Audit-trail service. The only supported way to write an AuditLog row."""

from __future__ import annotations

from typing import Any

from .models import AuditLog


def record_audit(
    *,
    action: str,
    entity_type: str,
    entity_id: str | int,
    actor=None,
    meta: dict[str, Any] | None = None,
    request=None,
) -> AuditLog:
    """
    Write an immutable audit entry (SRS §7 Auditability).

    Callers are responsible for masking PII before it reaches ``meta`` — this function
    stores what it is given.
    """
    ip = None
    request_id = ""
    if request is not None:
        ip = request.META.get("REMOTE_ADDR")
        request_id = getattr(request, "request_id", "") or ""
        if actor is None and getattr(request, "user", None) and request.user.is_authenticated:
            actor = request.user

    return AuditLog.objects.create(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        meta_json=meta or {},
        ip_address=ip,
        request_id=request_id,
    )
