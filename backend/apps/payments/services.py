"""
OTP issuance and verification, and the payment state transitions (SRS §6.5).

The OTP is the only thing standing between a Mait and recording a payment the farmer never
authorised, so the rules here are strict and uniform: 5-minute expiry, 3 attempts, every
send and every attempt logged.
"""

from __future__ import annotations

import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.core.exceptions import (
    DomainError,
    OTPAttemptsExceeded,
    OTPExpired,
    OTPInvalid,
)
from apps.core.services import record_audit

from .models import OTPLog, Payment

logger = logging.getLogger(__name__)


def generate_code(mobile_no: str = "") -> str:
    """
    Cryptographically random numeric OTP. ``secrets``, never ``random``.

    Numbers listed in ``DEV_FIXED_OTP_NUMBERS`` get a known code instead, so the app can be
    demonstrated without a live SMS gateway. That list is empty everywhere but development,
    and ``config/settings/production.py`` refuses to start if it is not.

    The substitution happens *here*, at generation, on purpose. Verification, expiry, the
    attempt limit and the audit log all behave exactly as they do for a real code — there is
    no bypass branch anywhere in the path that checks a submitted OTP, so there is nothing
    that could be left enabled by accident.
    """
    fixed_numbers = getattr(settings, "DEV_FIXED_OTP_NUMBERS", [])
    if mobile_no and mobile_no in fixed_numbers:
        logger.warning(
            "Issuing the fixed development OTP — this number is not secured",
            extra={"mobile_no": mobile_no},
        )
        return settings.DEV_FIXED_OTP_CODE

    length = settings.OTP_LENGTH
    return "".join(secrets.choice("0123456789") for _ in range(length))


@transaction.atomic
def issue_otp(*, mobile_no: str, purpose: str, payment: Payment | None = None) -> OTPLog:
    """
    Create and dispatch an OTP.

    Any earlier unverified OTP for the same number and purpose is expired first, so a
    resend genuinely invalidates the previous code rather than leaving two valid at once.
    """
    OTPLog.objects.filter(
        mobile_no=mobile_no, purpose=purpose, is_verified=False, expires_at__gt=timezone.now()
    ).update(expires_at=timezone.now())

    code = generate_code(mobile_no)
    otp = OTPLog.objects.create(
        purpose=purpose,
        mobile_no=mobile_no,
        otp_code_hash=OTPLog.hash_code(code, mobile_no),
        payment=payment,
        expires_at=timezone.now() + timedelta(seconds=settings.OTP_EXPIRY_SECONDS),
    )

    # Dispatched out of band so a slow gateway never blocks the waiting request.
    from .tasks import dispatch_otp

    dispatch_otp.delay(otp.id, code)

    # Note what was sent, never the code itself.
    logger.info("OTP issued", extra={"otp_log_id": otp.id, "purpose": purpose})
    return otp


def verify_otp(*, mobile_no: str, purpose: str, code: str) -> OTPLog:
    """
    Verify a submitted OTP (SRS §6.5.1).

    Failure modes are distinguished deliberately — expired, wrong, and out of attempts each
    need a different action from the Mait standing in the field.

    **Deliberately not wrapped in a transaction.** It used to be, and that silently disabled
    the attempt limit entirely: the counter was incremented and saved, then the function
    raised on the wrong code, and the rollback took the increment with it. Every guess was
    the first guess, so a six-digit OTP could be brute-forced at will.

    The counter is therefore bumped with an ``F()`` expression that commits on its own,
    before the code is compared. It is a security control, so it must survive the failure
    path — that is the whole point of it.
    """
    otp = (
        OTPLog.objects.filter(mobile_no=mobile_no, purpose=purpose, is_verified=False)
        .order_by("-created_at")
        .first()
    )
    if otp is None:
        raise OTPInvalid("No OTP is pending for this number. Request a new one.")

    if otp.is_expired:
        raise OTPExpired()

    if otp.attempts_exhausted:
        raise OTPAttemptsExceeded()

    # Count the attempt before judging it. F() makes the increment atomic at the database,
    # so two simultaneous guesses cannot both read the same starting count.
    OTPLog.objects.filter(pk=otp.pk).update(attempt_count=F("attempt_count") + 1)
    otp.refresh_from_db(fields=["attempt_count"])

    if not otp.matches(code):
        remaining = settings.OTP_MAX_ATTEMPTS - otp.attempt_count
        if remaining <= 0:
            raise OTPAttemptsExceeded()
        raise OTPInvalid(f"Incorrect OTP. {remaining} attempt(s) remaining.")

    otp.is_verified = True
    otp.verified_at = timezone.now()
    otp.save(update_fields=["is_verified", "verified_at"])
    return otp


@transaction.atomic
def initiate_payment(*, ai_event, mode: str, amount, actor=None) -> Payment:
    """
    Create the payment record and send the member authorisation OTP (SRS §6.5 step 2).

    The OTP goes to the member's own registered mobile, not to a number the Mait supplies —
    that is the whole point of the authorisation step.
    """
    from apps.ai_events.services import mark_payment_pending

    owner = ai_event.owner
    mobile_no = getattr(owner, "mobile_no", "")
    if not mobile_no:
        raise DomainError(
            "This member has no registered mobile number, so payment cannot be "
            "authorised. Ask the back office to update their record."
        )

    payment, created = Payment.objects.get_or_create(
        ai_event=ai_event, defaults={"mode": mode, "amount": amount}
    )
    if not created and payment.is_verified:
        return payment
    if not created:
        payment.mode = mode
        payment.amount = amount
        payment.save(update_fields=["mode", "amount", "updated_at"])

    purpose = (
        OTPLog.Purpose.PAYMENT_ONLINE if mode == Payment.Mode.ONLINE else OTPLog.Purpose.PAYMENT_COD
    )
    issue_otp(mobile_no=mobile_no, purpose=purpose, payment=payment)

    if ai_event.can_transition_to(ai_event.Status.PAYMENT_PENDING):
        mark_payment_pending(ai_event, actor=actor)

    return payment


@transaction.atomic
def finalise_payment(payment: Payment, *, actor=None) -> Payment:
    """
    Mark a payment verified once its mode's requirements are all met (SRS §6.5.6).

    Does not complete the AI event — that is a separate, explicitly-requested step, so the
    inventory deduction is never a side effect of a payment callback.
    """
    if payment.is_verified:
        return payment

    if not payment.requirements_met:
        missing = _missing_requirements(payment)
        raise DomainError(f"Payment is not complete: {', '.join(missing)}.")

    payment.status = Payment.Status.VERIFIED
    payment.save(update_fields=["status", "updated_at"])

    record_audit(
        action="state_change",
        entity_type="payment",
        entity_id=payment.id,
        actor=actor,
        meta={"to": "verified", "mode": payment.mode, "amount": str(payment.amount)},
    )
    return payment


def _missing_requirements(payment: Payment) -> list[str]:
    missing = []
    if not payment.member_otp_verified:
        missing.append("member authorisation OTP")
    if payment.mode == Payment.Mode.ONLINE:
        if not payment.utr_number:
            missing.append("UTR number")
        if not payment.payment_screenshot_url:
            missing.append("payment screenshot")
    elif not payment.cod_otp_verified:
        missing.append("COD confirmation OTP")
    return missing


def send_sms(*, mobile_no: str, code: str, purpose: str) -> str | None:
    """
    Dispatch an OTP through the configured gateway.

    The vendor is still an open item (SRS §18.2 item 3), so the provider is selected by
    configuration. ``console`` prints in development; ``dummy`` is silent for tests.
    Swapping in MSG91 or Twilio means adding a branch here and nothing else.
    """
    provider = settings.SMS_GATEWAY["PROVIDER"]

    if provider == "dummy":
        return None

    if provider == "console":
        # ASCII only. A Windows console runs on a legacy codepage that cannot encode
        # characters like "→", and the UnicodeEncodeError surfaces as a 500 on the OTP
        # endpoint — a long way from anything that looks like a printing problem.
        print(f"[SMS to {mobile_no}] Mait AI OTP for {purpose}: {code}")
        return "console"

    raise NotImplementedError(
        f"SMS provider '{provider}' is not implemented yet. Configure the vendor confirmed "
        "in SRS §18.2 item 3 before Phase 4 (docs/ROADMAP.md)."
    )
