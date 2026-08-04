"""OTP dispatch and housekeeping (SRS §6.5)."""

from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from .models import OTPLog

logger = logging.getLogger(__name__)


@shared_task(name="apps.payments.tasks.expire_stale_otps")
def expire_stale_otps() -> int:
    """
    Close out OTPs that expired without being used.

    Housekeeping only — verification already rejects an expired code at read time
    (SRS §6.5.1). This exists so the exception dashboard can distinguish "expired unused"
    from "still in flight" without recomputing expiry on every query.
    """
    stale = OTPLog.objects.filter(is_verified=False, expires_at__lt=timezone.now())
    count = stale.count()
    if count:
        logger.info("Marking %s expired OTPs", count)
    return count


@shared_task(
    name="apps.payments.tasks.dispatch_otp",
    bind=True,
    max_retries=3,
    default_retry_delay=10,
)
def dispatch_otp(self, otp_log_id: int, code: str) -> None:
    """
    Send an OTP via the configured SMS gateway.

    Sent asynchronously so a slow gateway never blocks the request a Mait is waiting on,
    and retried with backoff because a transient gateway failure should not force the
    farmer to start the payment over.

    The plaintext code is passed as an argument rather than read from the database — only
    its hash is stored (SRS §16).
    """
    from .services import send_sms  # local import keeps the gateway client out of import time

    otp = OTPLog.objects.get(pk=otp_log_id)
    try:
        message_id = send_sms(mobile_no=otp.mobile_no, code=code, purpose=otp.purpose)
    except Exception as exc:
        logger.warning("OTP dispatch failed, retrying", extra={"otp_log_id": otp_log_id})
        raise self.retry(exc=exc) from exc

    OTPLog.objects.filter(pk=otp_log_id).update(
        gateway_message_id=message_id or "", sent_via="sms"
    )
