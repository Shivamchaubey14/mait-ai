"""
Who is stuck at an OTP, and why (W16 detail).

The Exceptions card counts failures and samples the numbers behind them, which is the right
shape for a card and answers almost nothing. `981234••••  3 failure(s) today` tells an admin
that somebody is stuck without saying who they are, what they were trying to do, or which of
the three quite different things went wrong — and those three need three different responses:

* **Attempts exhausted.** The code arrived and the wrong one was typed until the counter ran
  out. Whoever it is knows they are stuck and is probably on the phone already.
* **Expired unused.** The code was sent and never entered at all. That is almost always an SMS
  that never landed, which is a gateway problem, not a person problem — and it is invisible on
  the card, because the card only counts rows somebody typed into.
* **Still open.** A wrong code or two, inside the five-minute window. Nothing to do yet; it may
  well resolve itself before anybody reads the screen.

Until this existed the card's Open link went to the roster of Maits who had never activated,
on the reasoning that a Mait failing an OTP is usually one who never got in. Often true, and
useless when it is not: a farmer failing a payment OTP is not on that roster at all, and the
insemination she is failing to authorise is the one thing anybody actually needed to find.

**The queue is defined once, here.** `failed_otp_queue` is what the dashboard summary counts
and what this screen lists, so the number on the card and the number of rows behind it cannot
drift apart — which is exactly what happens when a card and its detail screen each write their
own filter.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.models import PortalSection
from apps.core.permissions import IsAdmin, in_section
from apps.masterdata.models import Mait, Member, NonMember
from apps.payments.models import OTPLog

#: How far back the Exceptions card looks. A working signal rather than a lifetime total: an
#: OTP somebody failed three weeks ago is history, and a queue that never empties is one people
#: stop reading.
WINDOW_DAYS = 1

#: The furthest back the detail screen will look. Triage sometimes needs last week — "this
#: started on Friday" — but not last quarter.
MAX_WINDOW_DAYS = 30

MAX_ROWS = 200


def failed_otp_queue(*, days: int = WINDOW_DAYS, include_unattempted: bool = False):
    """
    Every OTP that did not get somebody through, in the window.

    ``include_unattempted`` is off by default because that is the card's definition and the
    two must agree. It is worth turning on, though, and the screen offers it: an OTP with no
    attempts against it is one nobody ever typed, which usually means the message never
    arrived — the failure most likely to be a fault in this platform rather than in somebody's
    memory, and the one the card cannot see.
    """
    since = timezone.now() - timedelta(days=days)
    queryset = OTPLog.objects.filter(is_verified=False, created_at__gte=since)
    if not include_unattempted:
        queryset = queryset.filter(attempt_count__gte=1)
    return queryset


# --------------------------------------------------------------------------------------
# Why it failed
# --------------------------------------------------------------------------------------
#: The three states, in the words somebody triaging will use. `code` is for filtering and
#: colouring; `label` is what the screen says.
EXHAUSTED = "attempts_exhausted"
EXPIRED = "expired"
NEVER_ATTEMPTED = "never_attempted"
SUPERSEDED = "superseded"
OPEN = "open"


def superseded_ids(entries) -> set[int]:
    """
    The codes that were replaced by a newer one rather than failing.

    Asking for a second code expires the first: `payments.services` sets `expires_at` to the
    moment of the resend on every live unverified OTP for that number and purpose. So an
    ordinary "send me another one" leaves behind a row that expired with nothing typed into
    it — which on the columns alone is indistinguishable from a message that never arrived.

    Telling those apart is most of the value of this screen. `never_attempted` is the outcome
    that sends somebody to check the SMS gateway, and on the development database fifty-two of
    sixty-six rows are resends: labelling them undelivered would send an admin to debug a
    gateway that is working perfectly.

    Two conditions together, because either alone is guessable. **Cut short** — the code died
    before its five minutes were up, and the resend is the only thing in this codebase that
    does that. **Followed** — a later code exists for the same number and purpose. The first
    alone would mislabel if some other path ever began shortening expiries; the second alone
    would mislabel an ordinary expiry that happened to be followed by a fresh request an hour
    later.
    """
    keys = {(entry.mobile_no, entry.purpose) for entry in entries}
    if not keys:
        return set()

    # One query covering every code on the numbers involved, rather than a "does a later one
    # exist" per row.
    oldest = min(entry.created_at for entry in entries)
    timeline: dict[tuple[str, str], list] = {}
    rows = OTPLog.objects.filter(
        mobile_no__in={key[0] for key in keys}, created_at__gte=oldest
    ).values_list("mobile_no", "purpose", "created_at")
    for mobile, purpose, created in rows:
        timeline.setdefault((mobile, purpose), []).append(created)

    natural = timedelta(seconds=settings.OTP_EXPIRY_SECONDS)
    found = set()
    for entry in entries:
        # A second of slack: `expires_at` is written from a second `timezone.now()` a hair
        # after `created_at`, so a full-length code is always a shade under its nominal life.
        cut_short = entry.expires_at < entry.created_at + natural - timedelta(seconds=1)
        later = timeline.get((entry.mobile_no, entry.purpose), [])
        if cut_short and any(when > entry.created_at for when in later):
            found.add(entry.id)
    return found


def _outcome(entry: OTPLog, now, superseded: set[int]) -> tuple[str, str]:
    """
    What went wrong with this one, and what to call it.

    Order matters twice over. A code whose attempts ran out *and* then expired is an exhausted
    one — the person was locked out before the clock mattered, and telling them their code
    expired sends them off to re-request instead of explaining why the last three were refused.
    And a code that was replaced only counts as replaced if nothing was ever typed into it: a
    wrong entry followed by "send me another" is a real failure and stays one.
    """
    if entry.attempt_count >= settings.OTP_MAX_ATTEMPTS:
        return EXHAUSTED, "Attempts used up"
    if entry.expires_at > now:
        return OPEN, "Still open"
    if entry.attempt_count == 0:
        if entry.id in superseded:
            return SUPERSEDED, "Replaced by a newer code"
        return NEVER_ATTEMPTED, "Never entered"
    return EXPIRED, "Expired"


#: What each outcome means for the person reading it, said once rather than left to be
#: inferred from a status word.
GUIDANCE = {
    EXHAUSTED: "The code arrived and the wrong one was entered. They need a fresh code.",
    NEVER_ATTEMPTED: "Sent, and nothing was ever typed into it. Usually an SMS that did not "
    "arrive — check the gateway before the person.",
    EXPIRED: "Ran out of time part-way through. A fresh code is normally enough.",
    SUPERSEDED: "Not a failure. They asked for another code and this one was retired to make "
    "way for it.",
    OPEN: "Inside its window and may still succeed. Nothing to do yet.",
}


# --------------------------------------------------------------------------------------
# Who it belongs to
# --------------------------------------------------------------------------------------
def owners_by_mobile(entries) -> dict:
    """
    Look every number on the page up in one pass, per roster.

    A property doing this per row would be three queries a row; a page of fifty would be a
    hundred and fifty. The number is the only key available for login and farmer-verification
    OTPs, which carry no foreign key of their own.
    """
    numbers = {entry.mobile_no for entry in entries if entry.mobile_no}
    if not numbers:
        return {}

    found: dict[str, dict] = {}
    # Least specific first, so a number belonging to two rosters resolves to the more
    # meaningful one. In practice a Mait's number is also sometimes a member's.
    for non_member in NonMember.objects.filter(mobile_no__in=numbers):
        found[non_member.mobile_no] = {
            "kind": "non_member",
            "name": non_member.name,
            "detail": f"Non-member at {non_member.mpp.mpp_name}" if non_member.mpp_id else "",
        }
    for member in Member.objects.filter(mobile_no__in=numbers).select_related("mpp"):
        found[member.mobile_no] = {
            "kind": "member",
            "name": member.member_name,
            "detail": f"{member.member_code} · {member.mpp.mpp_name}",
        }
    for mait in Mait.objects.filter(mobile_no__in=numbers):
        found[mait.mobile_no] = {
            "kind": "mait",
            "name": mait.name,
            "detail": f"Mait {mait.sahayak_vendor_code}"
            + ("" if mait.user_id else " · never activated"),
        }
    return found


def _who(entry: OTPLog, by_mobile: dict) -> dict:
    """
    Whose OTP this is.

    Through the payment where there is one, because that is a foreign key and therefore an
    answer rather than a guess — two people can share a phone, and matching a number against
    three rosters cannot tell you which of them was standing there. The number is the fallback
    for login and farmer-verification codes, which have nothing else to go on.
    """
    payment = getattr(entry, "payment", None)
    if payment is not None:
        owner = payment.ai_event.member or payment.ai_event.non_member
        return {
            "kind": "member" if payment.ai_event.member_id else "non_member",
            "name": getattr(owner, "member_name", None) or getattr(owner, "name", "") or "—",
            "detail": f"{payment.ai_event.mpp.mpp_name}",
        }

    known = by_mobile.get(entry.mobile_no)
    if known:
        return known
    # Not a data error: a number can belong to somebody who has since been removed from a
    # roster, and saying so is more use than an empty cell that reads as a bug.
    return {"kind": "unknown", "name": "Not on any roster", "detail": ""}


def _blocking(entry: OTPLog) -> dict | None:
    """The insemination this OTP is holding up, where it is holding one up."""
    payment = getattr(entry, "payment", None)
    if payment is None:
        return None
    return {
        "ai_event_id": payment.ai_event_id,
        "amount": str(payment.amount),
        "mode": payment.get_mode_display(),
        "payment_status": payment.status,
    }


def describe(entry: OTPLog, by_mobile: dict, now, superseded=None) -> dict:
    """One failed OTP, with everything a person needs to act on it."""
    outcome, label = _outcome(entry, now, superseded or set())
    row = {
        "id": entry.id,
        # In full. Mobile numbers are not masked on admin endpoints anywhere in this platform —
        # the Maits roster and the member list both return them — and this screen exists to be
        # acted on, which usually means ringing the number.
        "mobile_no": entry.mobile_no,
        "purpose": entry.purpose,
        "purpose_display": entry.get_purpose_display(),
        "outcome": outcome,
        "outcome_display": label,
        "guidance": GUIDANCE[outcome],
        "attempt_count": entry.attempt_count,
        "max_attempts": settings.OTP_MAX_ATTEMPTS,
        "sent_at": entry.created_at.isoformat(),
        "expires_at": entry.expires_at.isoformat(),
        # How long they had, stated rather than left to be worked out from two timestamps.
        "valid_for_seconds": int((entry.expires_at - entry.created_at).total_seconds()),
        # Everything known about delivery. Empty where the gateway told us nothing, which is
        # itself worth seeing on the row that is about a message nobody received.
        "sent_via": entry.sent_via,
        "gateway_message_id": entry.gateway_message_id,
        "who": _who(entry, by_mobile),
        "blocking": _blocking(entry),
    }
    # The shape every other exception queue answers in, alongside this one's own fields, so
    # the portal has one dialog rather than two that drift. `exception_details` documents it.
    row.update(_as_common_row(entry, row))
    return row


#: The tone each outcome is drawn in. `superseded` is green because it is not a fault at all.
TONE = {
    EXHAUSTED: "bad",
    NEVER_ATTEMPTED: "warn",
    EXPIRED: None,
    SUPERSEDED: "good",
    OPEN: "info",
}

#: What the dialog's filter chips offer, in the order they read.
BUCKETS = [
    (EXHAUSTED, "Attempts used up", "bad"),
    (NEVER_ATTEMPTED, "Never entered", "warn"),
    (EXPIRED, "Ran out of time", None),
    (SUPERSEDED, "Replaced", "good"),
    (OPEN, "Still open", "info"),
]

#: The two that only exist among codes nobody typed into. Picking either has to widen the
#: query, or the chip answers empty and looks broken.
NEEDS_UNATTEMPTED = (NEVER_ATTEMPTED, SUPERSEDED)


def _valid_for(seconds: int) -> str:
    """Seconds as something a person reads."""
    if seconds < 60:
        return f"{seconds} s"
    minutes, rest = divmod(seconds, 60)
    return f"{minutes} min" + (f" {rest} s" if rest else "")


def _as_common_row(entry: OTPLog, row: dict) -> dict:
    blocking = row["blocking"]
    return {
        "bucket": row["outcome"],
        "title": row["who"]["name"],
        "subtitle": row["who"]["detail"] or row["mobile_no"],
        "detail": row["purpose_display"],
        "state": {"label": row["outcome_display"], "tone": TONE.get(row["outcome"])},
        "metric": f"{row['attempt_count']} of {row['max_attempts']}",
        "when": row["sent_at"],
        "facts": [
            {"label": "Number", "value": row["mobile_no"], "href": None},
            {"label": "Sent", "value": row["sent_at"], "href": None},
            {"label": "Expired", "value": row["expires_at"], "href": None},
            {"label": "Valid for", "value": _valid_for(row["valid_for_seconds"]), "href": None},
            {
                "label": "Attempts",
                "value": f"{row['attempt_count']} of {row['max_attempts']}",
                "href": None,
            },
            {"label": "Sent via", "value": row["sent_via"], "href": None},
            {"label": "Gateway reference", "value": row["gateway_message_id"], "href": None},
        ],
        "link": (
            {
                "href": f"ai-event.html?id={blocking['ai_event_id']}",
                "label": (
                    f"AI event {blocking['ai_event_id']} · "
                    f"₹{float(blocking['amount']):,.0f} {blocking['mode']}"
                ),
            }
            if blocking
            else None
        ),
    }


# --------------------------------------------------------------------------------------
# The endpoint
# --------------------------------------------------------------------------------------
def outcome_tally(days: int) -> dict:
    """
    How many codes each chip would show, counted over the widest set.

    Deliberately not counted over the rows being returned. The queue excludes codes nobody
    typed into by default — that is the Exceptions card's definition and the two have to agree
    — so counting the response would report zero `never_attempted` and zero `superseded` every
    time, and a chip showing zero is a chip a screen quite reasonably hides. The two outcomes
    that matter most would have been unreachable.

    A chip's number is what clicking it will yield, which means asking the wider question here
    regardless of what was asked for. Cheap: only the outcome is needed, so this skips the
    owner lookups and the row building entirely.
    """
    entries = list(
        failed_otp_queue(days=days, include_unattempted=True).order_by("-created_at", "-id")[
            :MAX_ROWS
        ]
    )
    now = timezone.now()
    replaced = superseded_ids(entries)
    tally = {key: 0 for key in (EXHAUSTED, NEVER_ATTEMPTED, EXPIRED, SUPERSEDED, OPEN)}
    for entry in entries:
        outcome, _label = _outcome(entry, now, replaced)
        tally[outcome] += 1
    return tally


@extend_schema(
    tags=["dashboard"],
    summary="Who is stuck at an OTP, and why",
    description=(
        "The detail behind the Exceptions card's Failed OTPs queue: one row per code that "
        "did not get somebody through, with who they are, what they were trying to do, why "
        "it failed and what it is holding up.\n\n"
        "**Three different failures, named apart** in `outcome`, because they need three "
        "different responses. `attempts_exhausted` — the code arrived and the wrong one was "
        "entered. `never_attempted` — sent and never typed into at all, which is usually an "
        "SMS that did not arrive and is a gateway problem rather than a person's. `expired` — "
        "ran out of time part-way through. `superseded` — **not a failure**: they asked "
        "for another code and this one was retired to make way for it, which is all a "
        "resend does. `open` — still inside its window and may yet succeed.\n\n"
        "`?days=` defaults to 1, matching the card, and is capped at 30. "
        "`?include_unattempted=true` widens the queue to codes nobody ever typed into; they "
        "are excluded by default because the card excludes them, and the two must agree.\n\n"
        "`?outcome=` filters to one of the four. `?purpose=` filters to `login`, "
        "`farmer_verify`, `payment_online` or `payment_cod`.\n\n"
        "Mobile numbers come back in full, as they do on every other admin endpoint — this "
        "screen exists to be acted on, and acting on it usually means ringing the number."
    ),
    parameters=[
        OpenApiParameter("days", description="1–30, default 1", required=False, type=int),
        OpenApiParameter(
            "include_unattempted",
            description="Include codes nobody ever entered. Default false.",
            required=False,
            type=bool,
        ),
        OpenApiParameter(
            "outcome",
            description="attempts_exhausted / never_attempted / expired / superseded / open",
            required=False,
            type=str,
        ),
        OpenApiParameter("purpose", description="OTPLog purpose", required=False, type=str),
        OpenApiParameter("limit", required=False, type=int),
        OpenApiParameter("offset", required=False, type=int),
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin, in_section(PortalSection.EXCEPTIONS)])
def otp_failures(request):
    params = request.query_params
    try:
        days = min(MAX_WINDOW_DAYS, max(1, int(params.get("days", WINDOW_DAYS))))
    except (TypeError, ValueError):
        days = WINDOW_DAYS
    unattempted = str(params.get("include_unattempted", "")).lower() in ("1", "true", "yes")

    # `filter` is what the portal sends to every exception queue; `outcome` is this endpoint's
    # own older name for the same thing and still works. Picking one of the two buckets that
    # only exist among untouched codes widens the query on its own — a chip that answers empty
    # because the caller forgot a second parameter is a chip that looks broken.
    chosen = params.get("filter") or params.get("outcome") or ""
    if chosen in NEEDS_UNATTEMPTED:
        unattempted = True

    queryset = failed_otp_queue(days=days, include_unattempted=unattempted).select_related(
        "payment__ai_event__mpp",
        "payment__ai_event__member",
        "payment__ai_event__non_member",
    )
    if params.get("purpose"):
        queryset = queryset.filter(purpose=params["purpose"])
    # Newest first: triage starts from what just broke, not from what broke yesterday.
    queryset = queryset.order_by("-created_at", "-id")[:MAX_ROWS]

    now = timezone.now()
    entries = list(queryset)
    owners = owners_by_mobile(entries)
    replaced = superseded_ids(entries)
    rows = [describe(entry, owners, now, replaced) for entry in entries]

    # Filtered after describing rather than in SQL. `outcome` is not a column — it is decided
    # from the attempt count, the expiry and the clock together, and reproducing that as a
    # queryset would be a second definition of it to keep in step with the first.
    if chosen:
        rows = [row for row in rows if row["outcome"] == chosen]

    tally = outcome_tally(days)

    try:
        limit = max(1, min(MAX_ROWS, int(params.get("limit", 25))))
        offset = max(0, int(params.get("offset", 0)))
    except (TypeError, ValueError):
        limit, offset = 25, 0

    return Response(
        {
            # Named the way every other exception queue names itself, so one dialog serves
            # all six.
            "queue": "failed-otps",
            "title": "Failed OTPs",
            "subtitle": "Who is stuck, and which of the four things went wrong",
            "buckets": [
                {"key": key, "label": label, "tone": tone, "count": tally.get(key, 0)}
                for key, label, tone in BUCKETS
            ],
            "windowed": True,
            "filter": chosen,
            "shown": len(rows),
            "count": len(rows),
            "window_days": days,
            "include_unattempted": unattempted,
            "max_attempts": settings.OTP_MAX_ATTEMPTS,
            "by_outcome": tally,
            # People, not codes. One number failing eleven times is eleven rows and one person
            # to ring, and the difference is what says whether this is a bad day or one Mait.
            "people": len({row["mobile_no"] for row in rows}),
            "truncated": len(entries) >= MAX_ROWS,
            "results": rows[offset : offset + limit],
        }
    )
