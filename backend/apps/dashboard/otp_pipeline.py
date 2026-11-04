"""
The OTP pipeline (W23): did the code reach the phone, and was the office right to be asked?

Every step that sends a code — signing in, the farmer check, her authorising an online or a
cash payment — writes an ``OTPLog`` row, and the row records each stage the code passed
through: it was made, the gateway accepted it (``sent_via``), somebody typed into it
(``attempt_count``), and it was used (``is_verified``). This screen reads those stages back as a
pipeline, one row per code, and sets the Super OTP asks beside them.

**What it can and cannot know.** The gateway answers "accepted", never "delivered" — smsfortius
sends no delivery report, and a submission it accepts can still be dropped by the operator's DLT
layer (``payments.services._send_via_smsfortius`` tells that story). So the screen never says
"delivered". It says what the trail proves:

* **Never left** — no gateway acceptance at all. A fault on our side or the gateway's.
* **Accepted** — the gateway took it; whether it landed is not yet known.
* **Arrived** — somebody typed into it, right or wrong. The only proof a code reached a handset.
* **Likely lost** — accepted, nothing ever typed, ran out of time, and not replaced by a resend.
  The failure ``otp_failures.superseded_ids`` exists to tell apart from an ordinary resend.

**The asks get a verdict, and only for information.** For each Super OTP ask, the SMS the same
number was sent for the same step in the hour before it says whether the ask was needed: the
SMS never left or looks lost (right to ask), it was still inside its five minutes (asked early),
it arrived and was typed wrong (a resend would do as well), or it had already got them through
(not needed). The office can still answer any of them — a verdict is a reason to ask a question
on the phone, not a rule, and nothing here blocks a code.

Built on ``otp_failures`` rather than beside it: who a number belongs to and which codes were
merely replaced are decided there once, and a second definition of either would drift.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.models import PortalSection, SuperOTP
from apps.core.permissions import IsAdmin, in_section
from apps.core.scoping import scope_of
from apps.masterdata.models import Mait, Member, NonMember
from apps.payments.models import OTPLog

from .otp_failures import _blocking, _who, owners_by_mobile, superseded_ids

#: The windows the screen offers. A week by default, as Failed OTPs uses: it survives a weekend.
WINDOWS = (1, 7, 30)
DEFAULT_DAYS = 7

#: The most codes described for one answer. The summary counts the same set, so the tiles and
#: the rows agree; the response says when the cap was reached.
MAX_ROWS = 500

#: How long a code can sit without the gateway's acceptance before it counts as never sent.
#: The send is a Celery task with three retries ten seconds apart, so a minute and a half is
#: the slowest an accepted send can be; two minutes leaves room for a busy worker.
SENDING_GRACE = timedelta(minutes=2)

#: How far back an ask looks for the SMS it replaces — the same hour the app requires before a
#: farmer step can be asked for at all (``super_otp.SMS_TRIED_WITHIN``).
ASK_LOOKBACK = timedelta(hours=1)

#: The SMS template a step uses, in the words the Super OTP screen already uses.
STEPS = {
    "login": "Sign-in",
    "farmer_verify": "Farmer check",
    "payment_online": "Online payment",
    "payment_cod": "Cash payment",
    "password_reset": "Password reset",
}

# --------------------------------------------------------------------------------------
# Where a code stands
# --------------------------------------------------------------------------------------
VERIFIED = "verified"
OFFICE = "office"
SENDING = "sending"
NOT_SENT = "not_sent"
AWAITING = "awaiting"
WRONG_CODE = "wrong_code"
LOCKED = "locked"
TIMED_OUT = "timed_out"
SUPERSEDED = "superseded"
LIKELY_LOST = "likely_lost"

#: In the order the chips read: the faults first, then the open, then the done.
STAGES = [
    (LIKELY_LOST, "Likely lost", "warn"),
    (NOT_SENT, "Never left", "bad"),
    (LOCKED, "Attempts used up", "bad"),
    (WRONG_CODE, "Wrong code typed", "warn"),
    (TIMED_OUT, "Ran out of time", None),
    (AWAITING, "Waiting to be typed", "info"),
    (SENDING, "Sending", "info"),
    (SUPERSEDED, "Replaced", None),
    (OFFICE, "Passed on office code", "info"),
    (VERIFIED, "Verified by SMS", "good"),
]
STAGE_LABEL = {key: label for key, label, _tone in STAGES}
STAGE_TONE = {key: tone for key, _label, tone in STAGES}

GUIDANCE = {
    VERIFIED: "Arrived and used. The pipeline worked end to end.",
    OFFICE: "Passed on a code the office read out. The SMS did not get them through.",
    SENDING: "Handed to the gateway moments ago. Give it a minute.",
    NOT_SENT: "The gateway never accepted it, so it never left. Check the gateway, not the person.",
    AWAITING: "Accepted by the gateway and inside its window. Nobody has typed it yet.",
    WRONG_CODE: "It arrived — a code was typed — but not the right one. Still open.",
    LOCKED: "It arrived, and the wrong code was typed until the tries ran out. A fresh code "
    "is needed, by SMS or from the office.",
    TIMED_OUT: "It arrived and somebody started typing, then the five minutes ran out.",
    SUPERSEDED: "Not a failure. They asked for another code and this one was retired for it.",
    LIKELY_LOST: "Accepted by the gateway and never typed into before it expired. Usually an SMS "
    "that never reached the handset — the case Super OTP exists for.",
}

#: Whether a stage proves the code reached the phone: yes, no, or not known.
ARRIVED = {
    VERIFIED: "yes",
    WRONG_CODE: "yes",
    LOCKED: "yes",
    TIMED_OUT: "yes",
    NOT_SENT: "no",
    LIKELY_LOST: "no",
}


def office_verified_ids(entries) -> set[int]:
    """
    The codes closed by an office code rather than by their own SMS.

    ``payments.services._verified_by_office`` marks the pending SMS row verified at the moment
    the office's code is used, without saying so on the row. The ``SuperOTP`` that was used
    does say so, at the same instant, for the same number and step — so a verified row with a
    used office code beside it, a few seconds either way, was passed on the office's code.
    """
    verified = [entry for entry in entries if entry.is_verified and entry.verified_at]
    if not verified:
        return set()
    used = SuperOTP.objects.filter(
        status=SuperOTP.Status.USED,
        mobile_no__in={entry.mobile_no for entry in verified},
        used_at__isnull=False,
    ).values_list("mobile_no", "purpose", "used_at")
    by_key: dict[tuple[str, str], list] = {}
    for mobile, purpose, used_at in used:
        by_key.setdefault((mobile, purpose), []).append(used_at)
    slack = timedelta(seconds=5)
    return {
        entry.id
        for entry in verified
        if any(
            abs(used_at - entry.verified_at) <= slack
            for used_at in by_key.get((entry.mobile_no, entry.purpose), [])
        )
    }


def stage_of(entry: OTPLog, now, superseded: set[int], by_office: set[int]) -> str:
    """
    Where one code stands. Order matters: a verified code is done whatever else is true of it,
    and a code nobody typed into can only be "lost" once it is neither replaced nor still open.
    """
    if entry.sent_via == "office" or entry.id in by_office:
        return OFFICE
    if entry.is_verified:
        return VERIFIED
    if not entry.sent_via:
        return SENDING if now - entry.created_at < SENDING_GRACE else NOT_SENT
    if entry.attempt_count >= settings.OTP_MAX_ATTEMPTS:
        return LOCKED
    if entry.attempt_count > 0:
        return WRONG_CODE if entry.expires_at > now else TIMED_OUT
    if entry.expires_at > now:
        return AWAITING
    if entry.id in superseded:
        return SUPERSEDED
    return LIKELY_LOST


def steps_of(entry: OTPLog, stage: str) -> list[dict]:
    """
    The four stations of the pipeline, each done, failed, waiting or skipped.

    What the screen draws as a row of dots: made, accepted by the gateway, typed in (the only
    proof it reached the phone), used.
    """

    def step(key, label, state, at=None):
        return {"key": key, "label": label, "state": state, "at": at.isoformat() if at else None}

    office_only = entry.sent_via == "office"
    gateway = (
        "skipped"
        if office_only
        else "done"
        if entry.sent_via
        else "waiting"
        if stage == SENDING
        else "failed"
    )
    typed = entry.attempt_count > 0 or stage == VERIFIED
    entered = (
        "done"
        if typed
        else "failed"
        if stage == LIKELY_LOST
        else "waiting"
        if stage in (AWAITING, SENDING)
        else "skipped"
    )
    used = (
        "done"
        if stage in (VERIFIED, OFFICE)
        else "waiting"
        if stage in (AWAITING, SENDING, WRONG_CODE)
        else "skipped"
        if stage == SUPERSEDED
        else "failed"
    )
    return [
        step("made", "Code made", "done", entry.created_at),
        step("gateway", "Gateway accepted", gateway),
        step("typed", "Typed in", entered),
        step(
            "used",
            "Passed on office code" if stage == OFFICE else "Verified",
            used,
            entry.verified_at if used == "done" else None,
        ),
    ]


def describe(entry: OTPLog, *, owners, now, superseded, by_office) -> dict:
    stage = stage_of(entry, now, superseded, by_office)
    return {
        "id": entry.id,
        "purpose": entry.purpose,
        "step": STEPS.get(entry.purpose, entry.get_purpose_display()),
        "mobile_no": entry.mobile_no,
        "who": _who(entry, owners),
        "stage": stage,
        "stage_display": STAGE_LABEL[stage],
        "tone": STAGE_TONE[stage],
        "guidance": GUIDANCE[stage],
        "arrived": ARRIVED.get(stage, "unknown"),
        "steps": steps_of(entry, stage),
        "attempt_count": entry.attempt_count,
        "max_attempts": settings.OTP_MAX_ATTEMPTS,
        "sent_at": entry.created_at.isoformat(),
        "expires_at": entry.expires_at.isoformat(),
        "verified_at": entry.verified_at.isoformat() if entry.verified_at else None,
        "sent_via": entry.sent_via,
        "gateway_message_id": entry.gateway_message_id,
        "blocking": _blocking(entry),
    }


# --------------------------------------------------------------------------------------
# Whether an ask was needed
# --------------------------------------------------------------------------------------
JUSTIFIED = "justified"
EARLY = "early"
ARRIVED_WRONG = "arrived"
NOT_NEEDED = "not_needed"
NOT_TRIED = "not_tried"

VERDICTS = [
    (JUSTIFIED, "Right to ask", "good"),
    (EARLY, "Asked early", "warn"),
    (ARRIVED_WRONG, "SMS arrived", "info"),
    (NOT_TRIED, "No SMS tried", "warn"),
    (NOT_NEEDED, "Already through", "bad"),
]
VERDICT_LABEL = {key: label for key, label, _tone in VERDICTS}
VERDICT_TONE = {key: tone for key, _label, tone in VERDICTS}


def verdict_of(ask: SuperOTP, sms: OTPLog | None, at, *, office: bool = False) -> dict:
    """
    Was the office right to be asked? Judged on the SMS this ask stands in for, as it stood
    when the ask was made — the latest code for the same number and step in the hour before.
    """
    if sms is None:
        key = NOT_TRIED
        detail = "No SMS was sent for this step in the hour before the ask."
    elif sms.is_verified and not office and sms.verified_at and sms.verified_at <= at:
        key = NOT_NEEDED
        detail = "The SMS had already got them through before they asked."
    elif not sms.sent_via:
        key = JUSTIFIED
        detail = "The SMS never left — the gateway did not accept it."
    elif sms.attempt_count > 0:
        key = ARRIVED_WRONG
        detail = (
            "The SMS arrived — a code was typed into it — but not the right one. A fresh SMS "
            "would serve as well as an office code."
        )
    elif sms.expires_at > at:
        minutes = max(0, int((at - sms.created_at).total_seconds() // 60))
        key = EARLY
        detail = (
            "Asked within a minute of the SMS being sent"
            if minutes < 1
            else f"Asked {minutes} min after the SMS was sent"
        ) + ", while it was still inside its window. It may simply have been slow."
    else:
        key = JUSTIFIED
        detail = "The SMS was accepted and never typed into before it expired — it looks lost."
    return {
        "key": key,
        "label": VERDICT_LABEL[key],
        "tone": VERDICT_TONE[key],
        "detail": detail,
        # Said every time, because the verdict is the kind of thing that hardens into a rule.
        "note": "For information. The office can still give them a code.",
    }


def describe_ask(
    ask: SuperOTP, sms: OTPLog | None, by_office: frozenset | set = frozenset()
) -> dict:
    at = ask.requested_at or ask.issued_at or ask.created_at
    # An office code marks the pending SMS verified as it is used, so a verified SMS is only
    # the SMS getting them through when no office code closed it.
    office = bool(sms and sms.id in by_office)
    later_through = bool(
        sms and sms.is_verified and not office and sms.verified_at and sms.verified_at > at
    )
    return {
        "id": ask.id,
        "purpose": ask.purpose,
        "step": STEPS.get(ask.purpose, ask.purpose),
        "for_farmer": ask.purpose != "login",
        "full_name": ask.user.full_name,
        "farmer_name": ask.farmer_name,
        "context": ask.context,
        "mobile_no": ask.mobile_no,
        "state": ask.state,
        "status_display": ask.get_status_display(),
        "asked_at": at.isoformat(),
        "phoned": ask.requested_at is None,
        "request_count": ask.request_count,
        "reason": ask.reason,
        "verdict": verdict_of(ask, sms, at, office=office),
        # Got through on the SMS after asking — the ask answered itself.
        "through_by_sms_after": later_through,
        "sms": (
            {
                "id": sms.id,
                "sent_at": sms.created_at.isoformat(),
                "accepted": bool(sms.sent_via) and sms.sent_via != "office",
                "attempt_count": sms.attempt_count,
                "verified": sms.is_verified and not office,
                "by_office": office,
                "minutes_before": max(0, int((at - sms.created_at).total_seconds() // 60)),
            }
            if sms
            else None
        ),
    }


def sms_for_asks(asks) -> dict[int, OTPLog | None]:
    """The SMS each ask stands in for, found in one query rather than one per ask."""
    if not asks:
        return {}
    numbers = {ask.mobile_no for ask in asks}
    times = [ask.requested_at or ask.issued_at or ask.created_at for ask in asks]
    codes = list(
        OTPLog.objects.filter(mobile_no__in=numbers, created_at__gte=min(times) - ASK_LOOKBACK)
        .exclude(sent_via="office")
        .order_by("-created_at")
    )
    found = {}
    for ask, at in zip(asks, times, strict=True):
        found[ask.id] = next(
            (
                code
                for code in codes
                if code.mobile_no == ask.mobile_no
                and code.purpose == ask.purpose
                and at - ASK_LOOKBACK <= code.created_at <= at
            ),
            None,
        )
    return found


# --------------------------------------------------------------------------------------
# Scope
# --------------------------------------------------------------------------------------
def _scoped_codes(queryset, request):
    """
    Narrow to a zone-scoped caller's own network.

    A payment code carries its insemination, and so its MPP. A sign-in or farmer-check code
    carries only a number, so it is kept when that number belongs to somebody in the zone.
    """
    codes = scope_of(request)
    if codes is None:
        return queryset
    numbers = (
        Q(mobile_no__in=Mait.objects.filter(mpps__plant_code__in=codes).values("mobile_no"))
        | Q(mobile_no__in=Member.objects.filter(mpp__plant_code__in=codes).values("mobile_no"))
        | Q(mobile_no__in=NonMember.objects.filter(mpp__plant_code__in=codes).values("mobile_no"))
    )
    return queryset.filter(Q(payment__ai_event__mpp__plant_code__in=codes) | numbers).distinct()


def _scoped_asks(queryset, request):
    codes = scope_of(request)
    if codes is None:
        return queryset
    return queryset.filter(
        Q(user__mait_profile__mpps__plant_code__in=codes)
        | Q(user__store__plants__plant_code__in=codes)
    ).distinct()


# --------------------------------------------------------------------------------------
# The endpoint
# --------------------------------------------------------------------------------------
def _funnel(rows) -> dict:
    """The four stations as counts — how many codes reached each."""
    sms = [row for row in rows if row["sent_via"] != "office"]
    return {
        "made": len(sms),
        "accepted": sum(1 for row in sms if row["steps"][1]["state"] == "done"),
        "arrived": sum(1 for row in sms if row["arrived"] == "yes"),
        "verified": sum(1 for row in sms if row["stage"] == VERIFIED),
    }


def _arrival_rate(rows) -> float | None:
    """
    Of the codes whose fate is known, the share proven to have reached a phone.

    Codes still open, still sending and merely replaced are left out of both sides — they
    have not had the chance to arrive or not, and counting them would make a busy morning
    look like a failing gateway.
    """
    settled = [row for row in rows if row["arrived"] in ("yes", "no")]
    if not settled:
        return None
    return round(100 * sum(1 for row in settled if row["arrived"] == "yes") / len(settled), 1)


def _gateway_health(rows) -> dict:
    """The last twenty sends old enough to have been accepted: how many were."""
    recent = [row for row in rows if row["sent_via"] != "office" and row["stage"] != SENDING][:20]
    accepted = sum(1 for row in recent if row["steps"][1]["state"] == "done")
    total = len(recent)
    tone = None if not total else "good" if accepted == total else "bad" if not accepted else "warn"
    return {
        "provider": settings.SMS_GATEWAY.get("PROVIDER", ""),
        "checked": total,
        "accepted": accepted,
        "tone": tone,
        "last_accepted_at": next(
            (row["sent_at"] for row in rows if row["steps"][1]["state"] == "done"), None
        ),
    }


@extend_schema(
    tags=["dashboard"],
    summary="The OTP pipeline",
    description=(
        "Every code sent in the window, each read back through the four stations of its "
        "pipeline — made, accepted by the gateway, typed in, used — with the Super OTP asks "
        "beside them and a verdict on whether each ask was needed.\n\n"
        "**Never says delivered.** The gateway reports acceptance only. A code is `arrived: "
        "yes` when somebody typed into it, `no` when it never left or expired untouched "
        "without being replaced, and `unknown` otherwise.\n\n"
        "The ask `verdict` is **for information only** — the office can give a code whatever "
        "it says.\n\n"
        "`days` is 1, 7 (default) or 30. `purpose` narrows to one step, `stage` to one stage, "
        "`verdict` the asks to one verdict, and `search` matches a number (three digits or "
        "more) or a name."
    ),
    parameters=[
        OpenApiParameter("days", type=int, description="1, 7 or 30"),
        OpenApiParameter("purpose", type=str),
        OpenApiParameter("stage", type=str),
        OpenApiParameter("verdict", type=str),
        OpenApiParameter("search", type=str),
        OpenApiParameter("limit", type=int),
        OpenApiParameter("offset", type=int),
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin, in_section(PortalSection.OTP_PIPELINE)])
def otp_pipeline(request):
    params = request.query_params
    try:
        days = int(params.get("days", DEFAULT_DAYS))
    except (TypeError, ValueError):
        days = DEFAULT_DAYS
    if days not in WINDOWS:
        days = DEFAULT_DAYS
    now = timezone.now()
    since = now - timedelta(days=days)
    purpose = params.get("purpose") or ""
    term = (params.get("search") or "").strip()
    digits = "".join(ch for ch in term if ch.isdigit())

    codes = _scoped_codes(OTPLog.objects.filter(created_at__gte=since), request).select_related(
        "payment__ai_event__mpp",
        "payment__ai_event__member",
        "payment__ai_event__non_member",
    )
    if purpose:
        codes = codes.filter(purpose=purpose)
    if len(digits) >= 3:
        codes = codes.filter(mobile_no__contains=digits)
    entries = list(codes.order_by("-created_at", "-id")[:MAX_ROWS])

    owners = owners_by_mobile(entries)
    replaced = superseded_ids(entries)
    by_office = office_verified_ids(entries)
    rows = [
        describe(entry, owners=owners, now=now, superseded=replaced, by_office=by_office)
        for entry in entries
    ]
    if term and len(digits) < 3:
        needle = term.lower()
        rows = [
            row
            for row in rows
            if needle in row["who"]["name"].lower()
            or needle in (row["who"]["detail"] or "").lower()
        ]

    # Counted before the stage filter, so each chip says what clicking it would show.
    tally = {key: 0 for key, _label, _tone in STAGES}
    for row in rows:
        tally[row["stage"]] += 1
    by_purpose = []
    for key, label in STEPS.items():
        mine = [row for row in rows if row["purpose"] == key]
        if mine:
            by_purpose.append(
                {"key": key, "label": label, **_funnel(mine), "arrival_rate": _arrival_rate(mine)}
            )

    stage = params.get("stage") or ""
    shown = [row for row in rows if row["stage"] == stage] if stage else rows

    asks_qs = _scoped_asks(
        SuperOTP.objects.filter(
            Q(requested_at__gte=since) | Q(requested_at__isnull=True, issued_at__gte=since)
        ).select_related("user"),
        request,
    )
    if purpose:
        asks_qs = asks_qs.filter(purpose=purpose)
    if len(digits) >= 3:
        asks_qs = asks_qs.filter(mobile_no__contains=digits)
    asks = list(asks_qs.order_by("-updated_at")[:MAX_ROWS])
    sms_by_ask = sms_for_asks(asks)
    office_closed = office_verified_ids([sms for sms in sms_by_ask.values() if sms])
    ask_rows = [describe_ask(ask, sms_by_ask.get(ask.id), office_closed) for ask in asks]
    if term and len(digits) < 3:
        needle = term.lower()
        ask_rows = [
            row
            for row in ask_rows
            if needle in row["full_name"].lower() or needle in (row["farmer_name"] or "").lower()
        ]
    verdicts = {key: 0 for key, _label, _tone in VERDICTS}
    for row in ask_rows:
        verdicts[row["verdict"]["key"]] += 1
    verdict = params.get("verdict") or ""
    shown_asks = (
        [row for row in ask_rows if row["verdict"]["key"] == verdict] if verdict else ask_rows
    )

    try:
        limit = max(1, min(100, int(params.get("limit", 25))))
        offset = max(0, int(params.get("offset", 0)))
    except (TypeError, ValueError):
        limit, offset = 25, 0

    return Response(
        {
            "window_days": days,
            "windows": list(WINDOWS),
            "truncated": len(entries) >= MAX_ROWS,
            "summary": {
                "funnel": _funnel(rows),
                "arrival_rate": _arrival_rate(rows),
                "likely_lost": tally[LIKELY_LOST],
                "never_left": tally[NOT_SENT],
                "office": tally[OFFICE],
                "asks": len(ask_rows),
                "asks_justified": verdicts[JUSTIFIED],
                "asks_waiting": sum(1 for row in ask_rows if row["state"] == "waiting"),
                "people": len({row["mobile_no"] for row in rows}),
            },
            "gateway": _gateway_health(rows),
            "by_purpose": by_purpose,
            "stages": [
                {"key": key, "label": label, "tone": tone, "count": tally[key]}
                for key, label, tone in STAGES
            ],
            "verdicts": [
                {"key": key, "label": label, "tone": tone, "count": verdicts[key]}
                for key, label, tone in VERDICTS
            ],
            "steps": [{"key": key, "label": label} for key, label in STEPS.items()],
            "count": len(shown),
            "offset": offset,
            "limit": limit,
            "results": shown[offset : offset + limit],
            "asks": shown_asks[:100],
            "asks_count": len(shown_asks),
        }
    )
