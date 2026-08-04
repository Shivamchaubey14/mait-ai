"""
Indent Easy synchronisation (SRS §6.6.2–6.6.5).

Outbound: push new indents. Inbound: a GRN webhook credits stock. Because a webhook can be
lost, a reconciliation job polls for GRNs whose callback never arrived — at-least-once
delivery, made safe by deduplicating on the Indent Easy reference.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.indents.models import IndentRequest

logger = logging.getLogger(__name__)

MAX_SYNC_ATTEMPTS = 5


def _integration_configured() -> bool:
    cfg = settings.INDENT_EASY
    return bool(cfg.get("BASE_URL") and cfg.get("API_KEY"))


@shared_task(
    name="apps.integrations.tasks.push_indent_to_indent_easy",
    bind=True,
    max_retries=5,
    default_retry_delay=30,
)
def push_indent_to_indent_easy(self, indent_id: int) -> None:
    """
    Push one indent into Indent Easy so the store user sees it (SRS §6.6.2).

    Failure is recorded on the indent rather than swallowed: a Mait whose stock request
    never reached the store needs that visible in the app, not buried in a worker log.
    """
    from .client import IndentEasyClient, IndentEasyError

    if not _integration_configured():
        logger.warning(
            "Indent Easy is not configured; indent %s stays pending. "
            "Set INDENT_EASY_BASE_URL and INDENT_EASY_API_KEY.",
            indent_id,
        )
        return

    indent = IndentRequest.objects.select_related("mait").get(pk=indent_id)
    try:
        ref_no = IndentEasyClient().create_indent(indent)
    except IndentEasyError as exc:
        indent.sync_attempts += 1
        indent.last_sync_error = str(exc)[:255]
        indent.sync_status = (
            IndentRequest.SyncStatus.FAILED
            if indent.sync_attempts >= MAX_SYNC_ATTEMPTS
            else IndentRequest.SyncStatus.PENDING
        )
        indent.save(update_fields=["sync_attempts", "last_sync_error", "sync_status", "updated_at"])
        if indent.sync_attempts < MAX_SYNC_ATTEMPTS:
            raise self.retry(exc=exc) from exc
        logger.error("Indent %s gave up after %s attempts", indent_id, indent.sync_attempts)
        return

    indent.indent_easy_ref_no = ref_no
    indent.sync_status = IndentRequest.SyncStatus.SYNCED
    indent.last_sync_error = ""
    indent.save(
        update_fields=["indent_easy_ref_no", "sync_status", "last_sync_error", "updated_at"]
    )


@shared_task(name="apps.integrations.tasks.reconcile_indent_easy_grn")
def reconcile_indent_easy_grn() -> int:
    """
    Poll Indent Easy for GRNs whose webhook never arrived (SRS §6.6.5).

    The webhook is the fast path; this is the guarantee. Without it, one dropped callback
    leaves a Mait holding physical straws the platform will not let them use — the worst
    possible failure, because the inventory gate then blocks real work.

    Idempotent by ``indent_easy_ref_no``: re-processing a GRN already credited is a no-op.
    """
    from .client import IndentEasyClient, IndentEasyError
    from .services import apply_grn

    if not _integration_configured():
        logger.warning("Indent Easy is not configured; skipping reconciliation.")
        return 0

    pending = IndentRequest.objects.filter(
        sync_status=IndentRequest.SyncStatus.SYNCED,
        status__in=[IndentRequest.Status.REQUESTED, IndentRequest.Status.APPROVED],
    ).exclude(indent_easy_ref_no="")

    client = IndentEasyClient()
    reconciled = 0
    for indent in pending.iterator(chunk_size=100):
        try:
            grn = client.fetch_grn(indent.indent_easy_ref_no)
        except IndentEasyError as exc:
            logger.warning("GRN poll failed for %s: %s", indent.indent_easy_ref_no, exc)
            continue
        if not grn:
            continue
        if apply_grn(indent=indent, grn=grn, source="reconciliation"):
            reconciled += 1

    if reconciled:
        logger.info("Reconciliation credited %s indents missed by webhooks", reconciled)
    return reconciled


@shared_task(name="apps.integrations.tasks.retry_failed_indent_pushes")
def retry_failed_indent_pushes() -> int:
    """Re-queue indents whose push exhausted its retries, e.g. after an outage."""
    stuck = IndentRequest.objects.filter(
        sync_status=IndentRequest.SyncStatus.FAILED,
        requested_at__gte=timezone.now() - timedelta(days=7),
    )
    for indent in stuck:
        indent.sync_attempts = 0
        indent.sync_status = IndentRequest.SyncStatus.PENDING
        indent.save(update_fields=["sync_attempts", "sync_status", "updated_at"])
        push_indent_to_indent_easy.delay(indent.id)
    return stuck.count()
