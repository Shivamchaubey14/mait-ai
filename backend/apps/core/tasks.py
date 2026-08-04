"""Housekeeping jobs."""

import logging

from celery import shared_task
from django.utils import timezone

from .models import IdempotencyRecord

logger = logging.getLogger(__name__)


@shared_task(name="apps.core.tasks.prune_idempotency_records")
def prune_idempotency_records() -> int:
    """Drop expired idempotency records so the table does not grow without bound."""
    deleted, _ = IdempotencyRecord.objects.filter(expires_at__lt=timezone.now()).delete()
    logger.info("Pruned %s expired idempotency records", deleted)
    return deleted
