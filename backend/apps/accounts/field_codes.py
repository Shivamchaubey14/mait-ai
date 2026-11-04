"""
Office codes for a farmer check with no signal at all — checked on the phone, proved on sync.

The office code (``super_otp``) covers an SMS that did not arrive. It does nothing for a Mait
standing in a yard with no data: asking for it, and checking what she reads out, are both
requests to the server. A voice call still goes through where data does not, so this is the
same office code with the server taken out of the yard:

1. **The phone carries a key.** Each Mait gets one key per day, derived here from the
   server's secret and never stored, and handed to the phone in the offline pack for the week
   ahead (``keys_for``). A key is good for one Mait and one day.
2. **The office generates the code.** The Mait phones the office; an admin picks the Mait and
   the farmer on the portal and gets a code (``issue_field_code``). It is the key run over the
   farmer's number, so the phone can work out the same six digits without asking anybody.
   The admin calls **her** on the number on her record and reads it to her, as for every
   farmer code, and she tells the Mait. The row written is what proves the office gave it.
3. **The phone checks it.** Against the code it works out itself from that day's key and her
   number. Right, and the capture carries on; the event carries the code with it.
4. **The server proves it** (``record_office_check``), when the event arrives: was this code
   given by the office, to this Mait, for this farmer, on that day? Yes, and the office's row is
   marked used. No, and the event is still recorded — the insemination happened, refusing it
   would only lose it — but it is marked as checked against a code nobody issued, which is
   what a Mait who lifted the key off a rooted phone would leave behind.

The key is the weak point and is treated as one: it opens nothing on its own, every use of it
is matched against a row only the office can write, and a day's key is useless the next day.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.core.models import AuditLog
from apps.core.services import record_audit
from apps.payments.models import OTPLog

from .models import SuperOTP

logger = logging.getLogger(__name__)

FARMER_VERIFY = OTPLog.Purpose.FARMER_VERIFY

#: Days of keys the phone carries, today included. A Mait out of signal for a week can still
#: check farmers on the last day of it; one out for longer refreshes the pack before going.
KEY_DAYS = 7

#: The version in the key's label, so the derivation can change without old keys verifying.
_LABEL = "maitai.field-code.v1"


def _digits(mobile_no: str) -> str:
    """The ten digits of an Indian mobile number, however it was written down."""
    only = "".join(ch for ch in (mobile_no or "") if ch.isdigit())
    return only[-10:]


def day_key(mait_id: int, day: date) -> bytes:
    """One Mait's key for one day. Derived, never stored: the secret is the only thing kept."""
    message = f"{_LABEL}|{mait_id}|{day.isoformat()}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).digest()


def code_for(key: bytes, mobile_no: str) -> str:
    """
    The code for the farmer on this number, under a day's key.

    The first four bytes of an HMAC, big-endian, modulo a million — written so the phone's copy
    (``mobile/src/api/fieldCode.ts``) is the same handful of lines. The tests pin one value
    both sides must agree on.
    """
    digest = hmac.new(key, f"farmer_verify|{_digits(mobile_no)}".encode(), hashlib.sha256).digest()
    number = int.from_bytes(digest[:4], "big") % (10**settings.OTP_LENGTH)
    return str(number).zfill(settings.OTP_LENGTH)


def keys_for(mait_id: int, *, start: date | None = None) -> list[dict]:
    """The keys the phone takes away, today first."""
    start = start or timezone.localdate()
    return [
        {
            "day": (start + timedelta(days=offset)).isoformat(),
            "key": base64.b64encode(day_key(mait_id, start + timedelta(days=offset))).decode(),
        }
        for offset in range(KEY_DAYS)
    ]


def _end_of(day: date) -> datetime:
    return timezone.make_aware(datetime.combine(day + timedelta(days=1), time.min))


def issue_field_code(
    *, mait, mobile_no: str, farmer_name: str = "", actor, request=None
) -> tuple[SuperOTP, str]:
    """
    Generate today's code for one farmer and one Mait, and write down that the office gave it.

    Asked for twice — the call dropped, the farmer did not catch it — the same code comes back
    and the same row is touched, because it is the same day's key over the same number.
    """
    mobile_no = _digits(mobile_no)
    day = timezone.localdate()
    code = code_for(day_key(mait.id, day), mobile_no)
    now = timezone.now()
    with transaction.atomic():
        row = (
            SuperOTP.objects.select_for_update()
            .filter(user=mait.user, purpose=FARMER_VERIFY, mobile_no=mobile_no, offline_day=day)
            .first()
        )
        if row is None:
            row = SuperOTP(
                user=mait.user, purpose=FARMER_VERIFY, mobile_no=mobile_no, offline_day=day
            )
        row.status = SuperOTP.Status.ISSUED if row.status != SuperOTP.Status.USED else row.status
        row.farmer_name = (farmer_name or "")[:150]
        row.context = "No signal — checked on the Mait's phone"
        row.code_hash = OTPLog.hash_code(code, mobile_no)
        row.issued_by = actor
        row.issued_at = now
        row.expires_at = _end_of(day)
        row.save()

    record_audit(
        action=AuditLog.Action.STATE_CHANGE,
        entity_type="super_otp",
        entity_id=row.id,
        actor=actor,
        request=request,
        # Who it was for and who gave it. Never the code.
        meta={"to": "issued", "step": FARMER_VERIFY, "asked_by": mait.user_id, "no_signal": True},
    )
    logger.info("No-signal farmer code issued", extra={"super_otp_id": row.id})
    return row, code


def record_office_check(*, event, code: str, day: date, actor=None) -> str:
    """
    Prove a farmer check the phone did on its own, and write the answer on the event.

    Matched against what the office wrote, not against the key: the key is on the phone, and a
    code worked out from it proves only that somebody had the phone. Returns the event's
    ``farmer_check``.
    """
    from apps.ai_events.models import AIEvent

    owner = event.member or event.non_member
    mobile_no = _digits(getattr(owner, "mobile_no", "") or "")
    rows = SuperOTP.objects.filter(
        user=event.mait.user,
        purpose=FARMER_VERIFY,
        mobile_no=mobile_no,
        offline_day=day,
        issued_at__isnull=False,
    )
    expected = OTPLog.hash_code(code, mobile_no)
    row = next((r for r in rows if hmac.compare_digest(r.code_hash, expected)), None)

    if row is None:
        event.farmer_check = AIEvent.FarmerCheck.OFFICE_CALL_UNMATCHED
        event.farmer_check_otp = None
    else:
        event.farmer_check = AIEvent.FarmerCheck.OFFICE_CALL
        event.farmer_check_otp = row
        # Two animals of the same farmer on the same visit share her check, so a used row
        # stays used rather than being refused the second time.
        SuperOTP.objects.filter(pk=row.pk, status=SuperOTP.Status.ISSUED).update(
            status=SuperOTP.Status.USED, used_at=timezone.now(), updated_at=timezone.now()
        )
    event.save(update_fields=["farmer_check", "farmer_check_otp", "updated_at"])

    record_audit(
        action=AuditLog.Action.UPDATE,
        entity_type="ai_event",
        entity_id=event.id,
        actor=actor,
        meta={"farmer_check": event.farmer_check, "day": day.isoformat()},
    )
    if row is None:
        logger.warning(
            "No-signal farmer check carried a code the office never gave",
            extra={"ai_event_id": event.id},
        )
    return event.farmer_check
