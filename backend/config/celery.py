"""Celery application and the scheduled job table (SRS §3.2 Async/Jobs)."""

import logging
import os

from celery import Celery
from celery.schedules import crontab

logger = logging.getLogger(__name__)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("maitai")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    # Catches GRNs whose webhook never arrived — at-least-once delivery (SRS §6.6.5).
    "reconcile-indent-easy-grn": {
        "task": "apps.integrations.tasks.reconcile_indent_easy_grn",
        "schedule": crontab(minute="*/15"),
    },
    # Dashboards read pre-aggregated rows, never raw events (SRS §7 Performance).
    "aggregate-daily-ai-counts": {
        "task": "apps.dashboard.tasks.aggregate_daily_ai_counts",
        "schedule": crontab(minute=5),
    },
    "expire-stale-otps": {
        "task": "apps.payments.tasks.expire_stale_otps",
        "schedule": crontab(minute="*/5"),
    },
    "prune-idempotency-records": {
        "task": "apps.core.tasks.prune_idempotency_records",
        "schedule": crontab(hour=3, minute=0),
    },
    "flag-low-stock-maits": {
        "task": "apps.inventory.tasks.flag_low_stock_maits",
        "schedule": crontab(hour=6, minute=0),
    },
}


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Smoke test that a worker is alive and consuming from the broker."""
    logger.info("Celery debug task ran: %r", self.request)
