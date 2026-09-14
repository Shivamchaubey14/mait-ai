"""
Codes generated on the portal, for when the SMS does not arrive — at every step (``SuperOTP``).

Read the model's docstring first; this module is the rules it describes.

The steps a code can stand in for are the SMS templates themselves (``OTPLog.Purpose``):
signing in, checking a farmer, and her authorising an online or a cash payment. Three moves:

1. **Ask** — from the app, at the step that is stuck. Sign-in is asked for without an account
   (``request_login_code``), and answered identically whether or not the number is registered.
   A farmer step is asked for by the signed-in Mait (``request_farmer_code``), against the farmer
   or payment already on their screen, and only once the SMS has actually been tried.
2. **Generate** — an admin on the portal. The code is returned once, in that response.
3. **Use** — typed into the step's own boxes. ``consume`` is called by ``verify_otp`` before the
   SMS code is checked, so every step accepts it without knowing it exists.

**Deliberately not one transaction around the use.** The attempt counter is bumped with an
``F()`` expression that commits on its own, before the code is compared — the same reason
``verify_otp`` gives: a counter that a failed attempt rolls back is no counter at all.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.core.exceptions import DomainError, InvalidStateTransition
from apps.core.models import AuditLog
from apps.core.services import record_audit
from apps.payments.models import OTPLog

from .models import Role, SuperOTP, User

logger = logging.getLogger(__name__)

LOGIN = OTPLog.Purpose.LOGIN
FARMER_STEPS = (
    OTPLog.Purpose.FARMER_VERIFY,
    OTPLog.Purpose.PAYMENT_ONLINE,
    OTPLog.Purpose.PAYMENT_COD,
)

#: How recently the SMS must have been tried for a farmer step to be asked for. The office code
#: replaces an SMS that did not arrive; it is not a way to skip sending one.
SMS_TRIED_WITHIN = timedelta(hours=1)


def _field_user(mobile_no: str) -> User | None:
    """The active Mait or store keeper behind a number — the same lookup sign-in uses."""
    from .views import OTPSendView

    return OTPSendView._resolve_field_user(mobile_no)


def _hash(code: str, mobile_no: str) -> str:
    # The SMS code's own salted hash, so the two kinds of code are stored the same way.
    return OTPLog.hash_code(code, mobile_no)


def _open_code(mobile_no: str, purpose: str) -> SuperOTP | None:
    """A code given for this number and this step, still usable."""
    return (
        SuperOTP.objects.filter(
            mobile_no=mobile_no,
            purpose=purpose,
            status=SuperOTP.Status.ISSUED,
            expires_at__gt=timezone.now(),
            attempt_count__lt=settings.SUPER_OTP_MAX_ATTEMPTS,
        )
        .order_by("-issued_at")
        .first()
    )


def _active(user: User) -> bool:
    """A Mait or an open store's keeper, active — somebody who may use the app at all."""
    if not user.is_active:
        return False
    if user.role == Role.MAIT:
        mait = getattr(user, "mait_profile", None)
        return mait is None or mait.is_active
    return user.role == Role.STORE and bool(user.store_id) and user.store.is_active


def _record_ask(*, user, mobile_no, purpose, reason, request, **context) -> SuperOTP:
    """
    One open ask per person, per step, per number.

    Asking twice — the natural thing to do after five minutes of nobody calling — bumps the
    count and the time on the same row rather than stacking a second one, so the office sees
    "asked 3 times, last 2 minutes ago" instead of three rows.
    """
    reason = (reason or "").strip()[:200]
    now = timezone.now()
    with transaction.atomic():
        row = (
            SuperOTP.objects.select_for_update()
            .filter(
                user=user,
                purpose=purpose,
                mobile_no=mobile_no,
                status=SuperOTP.Status.REQUESTED,
            )
            .order_by("-requested_at")
            .first()
        )
        if row is not None and row.state == "lapsed":
            row = None
        if row is None:
            row = SuperOTP.objects.create(
                user=user,
                purpose=purpose,
                mobile_no=mobile_no,
                status=SuperOTP.Status.REQUESTED,
                requested_at=now,
                request_count=1,
                reason=reason,
                **context,
            )
        else:
            row.request_count += 1
            row.requested_at = now
            if reason:
                row.reason = reason
            for field, value in context.items():
                setattr(row, field, value)
            row.save()

    record_audit(
        action=AuditLog.Action.CREATE if row.request_count == 1 else AuditLog.Action.UPDATE,
        entity_type="super_otp",
        entity_id=row.id,
        actor=user,
        request=request,
        meta={"step": purpose, "asked": row.request_count, "reason": reason},
    )
    return row


# --------------------------------------------------------------------------------------
# Ask
# --------------------------------------------------------------------------------------
def request_login_code(*, mobile_no: str, reason: str = "", request=None) -> SuperOTP | None:
    """
    Ask for a sign-in code. Silent for a number nobody signs in with — nothing is written, and
    the caller answers exactly as it does for a registered one.
    """
    user = _field_user(mobile_no)
    if user is None:
        logger.info("Super OTP asked for an unregistered number")
        return None
    return _record_ask(
        user=user, mobile_no=mobile_no, purpose=LOGIN, reason=reason, request=request
    )


# The name the sign-in view has always called.
request_code = request_login_code


def request_farmer_code(
    *,
    requester: User,
    mobile_no: str,
    purpose: str,
    farmer_name: str,
    context: str = "",
    ai_event_id: int | None = None,
    reason: str = "",
    request=None,
) -> SuperOTP:
    """
    Ask the office to phone the farmer with the code the SMS was meant to bring her.

    ``mobile_no`` comes off her record, never from the request — the callers resolve it the same
    way their own send does. And the SMS must have been tried for this number and step within
    the hour: the office replaces a text that did not arrive, it does not replace sending one.
    """
    if purpose not in FARMER_STEPS:
        raise DomainError("That step does not send the farmer a code.")
    tried = OTPLog.objects.filter(
        mobile_no=mobile_no, purpose=purpose, created_at__gte=timezone.now() - SMS_TRIED_WITHIN
    ).exists()
    if not tried:
        raise DomainError(
            "Send her the SMS code first. Ask the office only if it does not reach her."
        )
    return _record_ask(
        user=requester,
        mobile_no=mobile_no,
        purpose=purpose,
        reason=reason,
        request=request,
        farmer_name=(farmer_name or "")[:150],
        context=(context or "")[:160],
        ai_event_id=ai_event_id,
    )


# --------------------------------------------------------------------------------------
# Generate
# --------------------------------------------------------------------------------------
def issue_code(*, row: SuperOTP | None = None, mobile_no: str = "", actor, request=None):
    """
    Generate the code, and return it — the only time it exists outside a hash.

    From an ask (``row``, any step), or a sign-in code for somebody who phoned without asking
    (``mobile_no``). A farmer step always comes from an ask: the office needs to know which
    farmer and which payment it is reading a code for, and only the app knows that.

    Any earlier code for the same number and step is revoked first.
    """
    user = None
    purpose = LOGIN
    if row is None:
        mobile_no = (mobile_no or "").strip()
        user = _field_user(mobile_no)
        if user is None:
            raise InvalidStateTransition(
                "Nobody signs in to the app with that number. Check it against the Maits or "
                "Stores screen."
            )

    with transaction.atomic():
        if row is not None:
            row = SuperOTP.objects.select_for_update().get(pk=row.pk)
            if row.status != SuperOTP.Status.REQUESTED:
                raise InvalidStateTransition(
                    f"This ask is already {row.get_status_display().lower()}."
                )
            user, purpose, mobile_no = row.user, row.purpose, row.mobile_no

        # Checked now rather than when they asked: an account deactivated in between must not
        # be handed a way in, nor a way to record a payment.
        if not _active(user):
            raise InvalidStateTransition(
                f"{user.full_name} can no longer use the app, so no code can be given."
            )

        SuperOTP.objects.filter(
            mobile_no=mobile_no, purpose=purpose, status=SuperOTP.Status.ISSUED
        ).update(status=SuperOTP.Status.REVOKED, updated_at=timezone.now())

        code = "".join(secrets.choice("0123456789") for _ in range(settings.OTP_LENGTH))
        now = timezone.now()
        if row is None:
            row = SuperOTP(user=user, purpose=purpose, mobile_no=mobile_no)
        row.status = SuperOTP.Status.ISSUED
        row.code_hash = _hash(code, mobile_no)
        row.issued_by = actor
        row.issued_at = now
        row.expires_at = now + timedelta(seconds=settings.SUPER_OTP_EXPIRY_SECONDS)
        row.attempt_count = 0
        row.save()

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="super_otp",
        entity_id=row.id,
        actor=actor,
        request=request,
        # Who asked, which step, and who gave it. Never the code.
        meta={
            "to": "issued",
            "step": purpose,
            "asked_by": user.id,
            "ai_event": row.ai_event_id,
            "asked": bool(row.requested_at),
        },
    )
    logger.info("Super OTP issued", extra={"super_otp_id": row.id, "step": purpose})
    return row, code


def decline(*, row: SuperOTP, reason: str = "", actor, request=None) -> SuperOTP:
    """Refuse an ask — the office could not reach them, or it was not them asking."""
    with transaction.atomic():
        row = SuperOTP.objects.select_for_update().get(pk=row.pk)
        if row.status != SuperOTP.Status.REQUESTED:
            raise InvalidStateTransition(f"This ask is already {row.get_status_display().lower()}.")
        row.status = SuperOTP.Status.DECLINED
        row.decided_by = actor
        row.decline_reason = (reason or "").strip()[:200]
        row.save(update_fields=["status", "decided_by", "decline_reason", "updated_at"])
    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="super_otp",
        entity_id=row.id,
        actor=actor,
        request=request,
        meta={"to": "declined", "step": row.purpose, "reason": row.decline_reason},
    )
    return row


# --------------------------------------------------------------------------------------
# Use
# --------------------------------------------------------------------------------------
@dataclass
class Outcome:
    """What a typed code did against the office's code for that number and step."""

    matched: bool = False
    #: A code from the office was live for this number and step, whatever the answer.
    active: bool = False
    remaining: int = 0
    row: SuperOTP | None = None


def consume(*, mobile_no: str, purpose: str, code: str) -> Outcome:
    """
    Accept the office's code for this number and step, if that is what was typed.

    Says nothing when no office code is live — ``verify_otp`` then checks the SMS code exactly
    as it always has. Knows nothing of who is signing in or what is being paid: the step that
    called ``verify_otp`` carries on as though its own SMS code had been right.
    """
    row = _open_code(mobile_no, purpose)
    if row is None:
        return Outcome()

    # Counted before it is judged, and committed on its own (see the module docstring).
    SuperOTP.objects.filter(pk=row.pk).update(attempt_count=F("attempt_count") + 1)
    row.refresh_from_db(fields=["attempt_count"])
    remaining = max(settings.SUPER_OTP_MAX_ATTEMPTS - row.attempt_count, 0)

    if not secrets.compare_digest(row.code_hash, _hash(code, row.mobile_no)):
        return Outcome(active=True, remaining=remaining, row=row)

    # Used once. The status is the guard, so two devices typing the same code at the same
    # moment cannot both get through.
    claimed = SuperOTP.objects.filter(pk=row.pk, status=SuperOTP.Status.ISSUED).update(
        status=SuperOTP.Status.USED, used_at=timezone.now(), updated_at=timezone.now()
    )
    if not claimed:
        return Outcome(active=True, remaining=remaining, row=row)

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="super_otp",
        entity_id=row.id,
        actor=row.user,
        meta={"to": "used", "step": purpose, "ai_event": row.ai_event_id},
    )
    return Outcome(matched=True, active=True, remaining=remaining, row=row)


def last_sms(mobile_no: str, purpose: str = LOGIN) -> dict | None:
    """
    The last SMS for this step to this number, and whether the gateway said it went.

    What the office looks at before generating anything. ``sent_via`` is written only once the
    gateway accepts the message, so an empty one on a code minutes old is the SMS that never
    left — the case this whole feature exists for. A delivered one is a reason to ask them to
    look at their messages first. Codes the office itself gave are left out.
    """
    sms = OTPLog.objects.filter(mobile_no=mobile_no, purpose=purpose).exclude(sent_via="office")
    otp = sms.order_by("-created_at").first()
    if otp is None:
        return None
    return {
        "sent_at": otp.created_at,
        "delivered": bool(otp.sent_via),
        "verified": otp.is_verified,
        "sent_last_hour": sms.filter(created_at__gte=timezone.now() - timedelta(hours=1)).count(),
    }
