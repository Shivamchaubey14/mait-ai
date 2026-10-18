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
    demonstrated without a live SMS gateway. ``*`` in that list means every number, which is
    what makes the farmer-verification step demonstrable at all: a Mait testing the flow works
    through a 105,000-row member master, and the code is sent to whichever farmer they picked,
    on a phone nobody in the room is holding.

    That list is empty everywhere but development, and ``config/settings/production.py``
    refuses to start if it is set to anything — the wildcard included, since the guard tests
    the list rather than its contents.

    The substitution happens *here*, at generation, on purpose. Verification, expiry, the
    attempt limit and the audit log all behave exactly as they do for a real code — there is
    no bypass branch anywhere in the path that checks a submitted OTP, so there is nothing
    that could be left enabled by accident.
    """
    fixed_numbers = getattr(settings, "DEV_FIXED_OTP_NUMBERS", [])
    if mobile_no and ("*" in fixed_numbers or mobile_no in fixed_numbers):
        logger.warning(
            "Issuing the fixed development OTP — this number is not secured",
            extra={"mobile_no": mobile_no},
        )
        return settings.DEV_FIXED_OTP_CODE

    # The admin's per-account training / SMS-outage switch. Checked the same place and the same
    # way as the development fixed code — at generation, so verification, expiry, the attempt
    # limit and the audit log behave exactly as for a real OTP, and there is no bypass branch in
    # the path that checks a submitted code. Scoped by the account's own number, so only the
    # Mait (or keeper / zonal manager) an admin flipped it on for gets the fixed code; a farmer's
    # verification OTP, which goes to the farmer's number, is untouched.
    if mobile_no and _fixed_login_enabled(mobile_no):
        logger.warning(
            "Issuing the admin-enabled fixed login code for this account",
            extra={"mobile_no": mobile_no},
        )
        return settings.FIXED_LOGIN_OTP_CODE

    length = settings.OTP_LENGTH
    return "".join(secrets.choice("0123456789") for _ in range(length))


def _fixed_login_enabled(mobile_no: str) -> bool:
    """Whether an admin has turned the fixed login code on for the account at this number."""
    # Imported here rather than at module scope: accounts reaches into payments, and naming the
    # model at the top would risk closing the import loop at startup.
    from apps.accounts.models import User

    return User.objects.filter(
        mobile_no=mobile_no, fixed_otp_enabled=True, is_active=True
    ).exists()


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
    Verify a submitted code for one step — the SMS code, or the office's code standing in for it.

    Every step that sends a code checks it here: sign-in, the farmer check, and both payment
    confirmations. So this is where a code generated on the portal for an SMS that never arrived
    (``accounts.SuperOTP``) is accepted, and every step takes it without knowing it exists. It
    is checked first, for this number and this step only; with none live, the SMS code is checked
    exactly as before.

    The returned log carries ``via_office`` so a caller that records *how* — the sign-in audit
    entry — can say so.
    """
    from apps.accounts.super_otp import consume

    office = consume(mobile_no=mobile_no, purpose=purpose, code=code)
    if office.matched:
        return _verified_by_office(mobile_no=mobile_no, purpose=purpose)

    try:
        otp = _verify_sms(mobile_no=mobile_no, purpose=purpose, code=code)
    except (OTPInvalid, OTPExpired, OTPAttemptsExceeded) as exc:
        # The code being typed is the office's — say so in its terms, not the SMS's. "No OTP is
        # pending, request a new one" would send them to ask for another SMS, which is the one
        # thing that is not arriving.
        if office.active:
            if office.remaining <= 0:
                raise OTPAttemptsExceeded(
                    "Too many wrong tries at the office's code. Ask the office for a new one."
                ) from exc
            raise OTPInvalid(
                f"That is not the code the office read out. {office.remaining} attempt(s) left."
            ) from exc
        raise
    otp.via_office = False
    return otp


def _verified_by_office(*, mobile_no: str, purpose: str) -> OTPLog:
    """
    Close the SMS code the office's code stood in for, so it cannot be used as well.

    The step's pending SMS code is marked verified — one step, one code, whichever arrived. With
    none pending (the send itself failed before a row was written), a row is written to say the
    step was passed on a code from the office, so the SMS log still answers "how was this
    verified" for every step that ever was.
    """
    now = timezone.now()
    otp = (
        OTPLog.objects.filter(mobile_no=mobile_no, purpose=purpose, is_verified=False)
        .order_by("-created_at")
        .first()
    )
    if otp is None:
        otp = OTPLog.objects.create(
            purpose=purpose,
            mobile_no=mobile_no,
            otp_code_hash="",
            is_verified=True,
            verified_at=now,
            expires_at=now,
            sent_via="office",
        )
    else:
        otp.is_verified = True
        otp.verified_at = now
        otp.save(update_fields=["is_verified", "verified_at"])
    otp.via_office = True
    return otp


def _verify_sms(*, mobile_no: str, purpose: str, code: str) -> OTPLog:
    """
    Verify a submitted SMS code (SRS §6.5.1).

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
        # Flushed, because stdout is block-buffered whenever the server is not attached to a
        # terminal — which is how it runs under a task runner or a supervisor. Unflushed, the
        # one thing this provider exists to do never appears.
        print(f"[SMS to {mobile_no}] Mait AI OTP for {purpose}: {code}", flush=True)
        return "console"

    if provider == "smsfortius":
        return _send_via_smsfortius(mobile_no=mobile_no, code=code, purpose=purpose)

    raise NotImplementedError(
        f"SMS provider '{provider}' is not implemented yet. Configure the vendor confirmed "
        "in SRS §18.2 item 3 before Phase 4 (docs/ROADMAP.md)."
    )


def _smsfortius_template(purpose: str) -> dict:
    """
    The DLT template for this step. The dairy registered two: one for sign-in, and one the
    farmer reads back for every identity check and payment confirmation — so anything that is
    not a login takes the farmer-facing template.
    """
    templates = settings.SMS_GATEWAY["TEMPLATES"]
    return templates["login"] if purpose == OTPLog.Purpose.LOGIN else templates["verify"]


def _send_via_smsfortius(*, mobile_no: str, code: str, purpose: str) -> str:
    """
    Send one OTP through smsfortius (Shwetdhara's DLT account).

    A GET to the vendor's `apikey.php` with the sender id, the registered template id and the
    message that template produces with its one variable filled. The message must still match
    the DLT-registered text exactly, which is why the text lives in configuration beside the id
    rather than being assembled here. Any transport or HTTP error propagates so `dispatch_otp`
    retries with backoff; the office's own code (Super OTP) is the fallback when it keeps
    failing, so a down gateway never strands a sign-in or a payment.
    """
    import requests

    cfg = settings.SMS_GATEWAY
    template = _smsfortius_template(purpose)
    params = {
        "apikey": cfg["API_KEY"],
        "senderid": cfg["SENDER_ID"],
        "templateid": template["template_id"],
        "number": mobile_no,
        "message": template["text"].replace("{#var#}", code),
        # Both DLT templates are Devanagari, so the body must go as Unicode (UCS-2). `unicode=2`
        # is the gateway's flag for that — it is in both of the dairy's own registered URLs.
        # Without it the message is submitted as GSM-7: the gateway still answers "submitted
        # successfully" (submission is not delivery), but the operator's DLT layer sees a body
        # that does not match the Unicode-registered template and silently drops it, so nothing
        # ever reaches the handset. That is the whole failure — an accepted send that never lands.
        "unicode": "2",
    }
    response = requests.get(cfg["BASE_URL"], params=params, timeout=10)
    response.raise_for_status()
    # The vendor answers with a short status/message-id body. Kept as the gateway message id for
    # the audit trail; never the code, which is not in the response and must not be logged.
    #
    # Truncated to the column's own width, not a guessed 255. smsfortius answers with a status
    # line that runs past 64 characters (and, on a bad request, with a longer page still), and a
    # value wider than the column raises a 1406 DataError when the row is saved — which, because
    # the send runs inside issue_otp's transaction, 500s the request and rolls the whole OTP back,
    # so a code the gateway actually sent can never be verified. The failure read as "the gateway
    # is down" when it was the record of success that would not fit.
    max_len = OTPLog._meta.get_field("gateway_message_id").max_length
    return (response.text or "").strip()[:max_len] or "sent"
