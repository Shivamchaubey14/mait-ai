"""
The detail behind every Exceptions card (W16).

A card can carry a count and three sampled lines. That is the right shape for a card and it
answers almost nothing: `Approved, not issued — 4 older than 3 days` says a number without
saying which four, whose they are, what they asked for or how long anybody has been waiting.
Every one of these queues had the same problem, and every one of them ended in an Open link
that took the operator off a screen showing six queues in order to answer one of them.

So each queue answers for itself here, in one shape, and the portal opens it over the card.

**One definition per queue.** The predicates below are what the summary counts *and* what the
detail lists. When a card and its detail screen each write their own filter, the card says
four and the screen shows eleven and nobody can tell which is lying — which is the bug
`stale_indent_q` was extracted to prevent between the card and the Indents screen, and the
same reasoning applies one level down.

**One row shape.** Every queue returns rows of the same shape, so there is one dialog rather
than six:

    id        stable within the queue, for expand/collapse
    title     who or what this row is about
    subtitle  the identifier under it — a code, a village
    detail    the middle column: what kind of thing it is
    state     {label, tone} — the pill
    metric    the one figure, right-aligned
    when      when it happened, or ""
    guidance  what to do about it, in a sentence
    facts     [{label, value, href}] — the expanded panel
    link      where to go to act on it, if there is anywhere

The columns differ in meaning between queues and that is fine: a payment's metric is an
amount, an indent's is a quantity, an overdue Mait's is a count of checks. What matters is
that the operator reads them in the same places every time.

**`guidance` is a column, not decoration.** These queues each have several causes wearing one
label, and the cause decides who gets rung. A pending payment waiting on a farmer's
authorisation and one waiting on a Mait's screenshot are the same row on the card and two
different phone calls.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db.models import Count, Sum
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.accounts.models import PortalSection
from apps.core.permissions import IsAdmin, in_section
from apps.indents.models import STALE_AFTER_DAYS, IndentRequest, stale_indent_q
from apps.inventory.models import Consumable, MaitInventory, ProductType
from apps.payments.models import Payment
from apps.pregnancy.models import PregnancyCheck

#: How far back the declined-checks queue looks. A working signal rather than a lifetime
#: total, and the same window the dashboard tile uses.
DECLINE_WINDOW_DAYS = 30

#: The ceiling on one dialog. Past this the honest answer is the screen the queue links to,
#: not a list nobody scrolls.
MAX_ROWS = 200


# --------------------------------------------------------------------------------------
# The queues, defined once
# --------------------------------------------------------------------------------------
def pending_payments():
    """Collections started and never finished. Nothing has been taken; nothing has closed."""
    return Payment.objects.filter(status=Payment.Status.PENDING)


def low_stock_maits():
    """
    Maits at or under the straw threshold, counted per Mait rather than per breed.

    Summed across breeds on purpose: a Mait holding two MURRAH and one JAFRABADI cannot serve
    a Gir cow either way, and three separate low-stock rows for one person is three times the
    noise for one restock.
    """
    return (
        MaitInventory.objects.filter(product_type=ProductType.STRAW)
        .values("mait_id", "mait__name", "mait__sahayak_vendor_code")
        .annotate(total=Sum("qty_available"))
        .filter(total__lte=settings.LOW_STOCK_THRESHOLD)
        .order_by("total", "mait__name")
    )


def stale_indents():
    """
    Requests nobody has moved, by the same query the Indents screen filters on.

    `stale_indent_q` rather than a cutoff spelled out here — when the two were written
    separately the count and the screen disagreed, and four stale indents opened onto an
    empty table.
    """
    return IndentRequest.objects.filter(stale_indent_q())


def overdue_checks():
    """Pregnancy checks past their due date that nobody has walked."""
    return PregnancyCheck.objects.filter(outcome="", due_on__lt=timezone.localdate())


def declined_checks(days: int = DECLINE_WINDOW_DAYS):
    """Visits an owner refused, inside the window."""
    return PregnancyCheck.objects.filter(
        outcome=PregnancyCheck.Outcome.DECLINED,
        checked_at__gte=timezone.now() - timedelta(days=days),
    )


# --------------------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------------------
def _row(**kwargs) -> dict:
    """One row, with every field present so the dialog never has to test for one."""
    row = {
        "id": "",
        "title": "",
        "subtitle": "",
        "detail": "",
        "state": {"label": "", "tone": None},
        "metric": "",
        "when": "",
        "guidance": "",
        "facts": [],
        "link": None,
    }
    row.update(kwargs)
    return row


def fact(label: str, value, href: str | None = None) -> dict:
    """
    One line of the expanded panel.

    An empty value is kept rather than dropped: on a row about a payment with no screenshot,
    an empty `Screenshot` is the answer, and a panel that silently omits the field makes the
    reader wonder whether it was ever asked for.
    """
    return {"label": label, "value": "" if value is None else str(value), "href": href}


def _days_old(moment) -> int:
    return max(0, (timezone.now() - moment).days)


def _owner_of(event):
    """The farmer on an event, whichever roster she is on."""
    owner = event.member or event.non_member
    if owner is None:
        return "Unknown farmer", ""
    name = getattr(owner, "member_name", None) or getattr(owner, "name", "")
    code = getattr(owner, "member_code", "") or "Non-member"
    return name, code


def _money(amount) -> str:
    return f"₹{amount:,.0f}"


# --------------------------------------------------------------------------------------
# Pending payments
# --------------------------------------------------------------------------------------
#: Why a payment is still open. The label is the card's word; the guidance is who to ring.
#:
#: Three quite different situations wearing one status, and the card cannot tell them apart.
#: A payment waiting on a farmer's authorisation is a call to her; one waiting on a Mait's
#: screenshot is a call to him; one that has everything and is still pending is a bug in this
#: platform and needs somebody looking at the record, not a phone.
NOT_AUTHORISED = "not_authorised"
AWAITING_PROOF = "awaiting_proof"
AWAITING_CASH = "awaiting_cash"
READY = "ready"

PAYMENT_BUCKETS = [
    (NOT_AUTHORISED, "Not authorised", "bad"),
    (AWAITING_PROOF, "No proof yet", "warn"),
    (AWAITING_CASH, "Cash not confirmed", "warn"),
    (READY, "Everything collected", "info"),
]

PAYMENT_GUIDANCE = {
    NOT_AUTHORISED: "The farmer has not entered her authorisation code, so nothing can move. "
    "Ring her, or ask the Mait to run the step again while he is with her.",
    AWAITING_PROOF: "She authorised it and the money was sent online, but the Mait has not "
    "uploaded the UTR and the screenshot. Until he does there is no proof it arrived.",
    AWAITING_CASH: "She authorised it and the Mait has not confirmed the cash was handed "
    "over. Either it was not, or the second code was never entered.",
    READY: "Everything this mode needs has been collected and it is still pending. That is "
    "this platform's fault rather than anybody's on the ground — look at the record.",
}


def _payment_bucket(payment) -> str:
    if payment.mode != Payment.Mode.DEDUCTION and not payment.member_otp_verified:
        return NOT_AUTHORISED
    if payment.mode == Payment.Mode.ONLINE and not (
        payment.utr_number and payment.payment_screenshot_url
    ):
        return AWAITING_PROOF
    if payment.mode == Payment.Mode.COD and not payment.cod_otp_verified:
        return AWAITING_CASH
    return READY


def _pending_payment_rows(queryset):
    queryset = queryset.select_related(
        "ai_event__mpp", "ai_event__mait", "ai_event__member", "ai_event__non_member"
    ).order_by("created_at")

    rows = []
    for payment in queryset[:MAX_ROWS]:
        event = payment.ai_event
        name, code = _owner_of(event)
        days = _days_old(payment.created_at)
        bucket = _payment_bucket(payment)
        label = next(entry[1] for entry in PAYMENT_BUCKETS if entry[0] == bucket)
        tone = next(entry[2] for entry in PAYMENT_BUCKETS if entry[0] == bucket)

        rows.append(
            _row(
                id=f"payment-{payment.id}",
                bucket=bucket,
                title=name,
                subtitle=f"{code} · {event.mpp.mpp_name}",
                detail=payment.get_mode_display(),
                state={"label": label, "tone": tone},
                metric=_money(payment.amount),
                when=payment.created_at.isoformat(),
                guidance=PAYMENT_GUIDANCE[bucket],
                facts=[
                    fact("Waiting", f"{days} day{'' if days == 1 else 's'}"),
                    fact("Mait", event.mait.name),
                    fact("Mait code", event.mait.sahayak_vendor_code),
                    fact("Farmer authorised", "Yes" if payment.member_otp_verified else "No"),
                    fact(
                        "Cash confirmed",
                        ("Yes" if payment.cod_otp_verified else "No")
                        if payment.mode == Payment.Mode.COD
                        else "Not applicable",
                    ),
                    fact("UTR", payment.utr_number),
                    fact("Screenshot", "On file" if payment.payment_screenshot_url else ""),
                ],
                link={"href": f"ai-event.html?id={event.id}", "label": f"AI event {event.id}"},
            )
        )
    return rows


# --------------------------------------------------------------------------------------
# Low stock
# --------------------------------------------------------------------------------------
AT_ZERO = "at_zero"
RUNNING_LOW = "running_low"

STOCK_BUCKETS = [
    (AT_ZERO, "At zero", "bad"),
    (RUNNING_LOW, "Running low", "warn"),
]


def _low_stock_rows(queryset):
    rows = []
    for entry in list(queryset)[:MAX_ROWS]:
        total = entry["total"] or 0
        zero = total == 0
        rows.append(
            _row(
                id=f"stock-{entry['mait_id']}",
                bucket=AT_ZERO if zero else RUNNING_LOW,
                title=entry["mait__name"],
                subtitle=entry["mait__sahayak_vendor_code"],
                detail="Semen straws",
                state={
                    "label": "At zero" if zero else "Running low",
                    "tone": "bad" if zero else "warn",
                },
                metric=f"{total} left",
                guidance=(
                    "Cannot record an insemination at all until they are restocked. Anything "
                    "they do in the field today is work this platform will have no record of."
                )
                if zero
                else (
                    f"Under the {settings.LOW_STOCK_THRESHOLD}-straw threshold and will run "
                    "out mid-round. Raise an indent before they do rather than after."
                ),
                facts=[
                    fact("Straws held", total),
                    fact("Threshold", settings.LOW_STOCK_THRESHOLD),
                    fact("Mait code", entry["mait__sahayak_vendor_code"]),
                ],
                link={
                    "href": f"inventory.html?mait={entry['mait_id']}",
                    "label": "Open their stock",
                },
            )
        )
    return rows


# --------------------------------------------------------------------------------------
# Stale indents
# --------------------------------------------------------------------------------------
NEVER_PUSHED = "never_pushed"
AWAITING_APPROVAL = "awaiting_approval"
APPROVED_NOT_ISSUED = "approved_not_issued"

INDENT_BUCKETS = [
    (NEVER_PUSHED, "Never reached Indent Easy", "bad"),
    (AWAITING_APPROVAL, "Awaiting approval", "warn"),
    (APPROVED_NOT_ISSUED, "Approved, not issued", "warn"),
]

INDENT_GUIDANCE = {
    NEVER_PUSHED: "The push to Indent Easy failed, so the request never left this platform. "
    "Nobody at the depot has seen it and nobody is going to — this one is ours to fix.",
    AWAITING_APPROVAL: "Sitting in this office, not at the depot. Approve or reject it; a "
    "Mait cannot chase what nobody has looked at.",
    APPROVED_NOT_ISSUED: "Approved here and not issued at the depot. This is the one to "
    "chase at the other end.",
}


def _indent_bucket(indent) -> str:
    if indent.sync_status == IndentRequest.SyncStatus.FAILED:
        return NEVER_PUSHED
    if indent.status == IndentRequest.Status.APPROVED:
        return APPROVED_NOT_ISSUED
    return AWAITING_APPROVAL


def _stale_indent_rows(queryset):
    queryset = queryset.select_related("mait").order_by("requested_at")
    indents = list(queryset[:MAX_ROWS])

    # One lookup for every consumable named on the page, so a request reads as "40 × Gloves"
    # rather than "40 × consumable#2" — which tells a depot nothing about what to pack.
    ref_ids = {i.product_ref_id for i in indents if i.product_ref_id}
    products = Consumable.objects.in_bulk(ref_ids) if ref_ids else {}

    rows = []
    for indent in indents:
        bucket = _indent_bucket(indent)
        label = next(entry[1] for entry in INDENT_BUCKETS if entry[0] == bucket)
        tone = next(entry[2] for entry in INDENT_BUCKETS if entry[0] == bucket)
        days = _days_old(indent.requested_at)
        # Named, or the fact that it is not. A request that says "25 × Consumable" tells a
        # depot nothing about what to pack, and collapsing an unnamed product into the word
        # "Consumable" hides a request nobody can actually fulfil behind one that reads fine.
        if indent.product_type == ProductType.STRAW:
            product = indent.breed or "Straws — breed not named"
        else:
            named = products.get(indent.product_ref_id)
            product = named.name if named else "Product not named"

        rows.append(
            _row(
                id=f"indent-{indent.id}",
                bucket=bucket,
                title=indent.mait.name,
                subtitle=indent.mait.sahayak_vendor_code,
                detail=f"{indent.qty_requested} × {product or 'Straws'}",
                state={"label": label, "tone": tone},
                metric=f"{days} day{'' if days == 1 else 's'}",
                when=indent.requested_at.isoformat(),
                guidance=INDENT_GUIDANCE[bucket],
                facts=[
                    fact("Asked for", f"{indent.qty_requested} × {product}"),
                    fact("Requested", f"{days} day{'' if days == 1 else 's'} ago"),
                    fact("Stale after", f"{STALE_AFTER_DAYS} days"),
                    fact("Status", indent.get_status_display()),
                    fact("Push to Indent Easy", indent.get_sync_status_display()),
                    fact("Indent Easy reference", indent.indent_easy_ref_no),
                    # The reason the push failed, where there is one. This is the field that
                    # turns "never reached Indent Easy" into something somebody can act on.
                    fact("Last push error", indent.last_sync_error),
                    fact("Note", indent.note),
                ],
                link={"href": "indents.html", "label": "Open Indents"},
            )
        )
    return rows


# --------------------------------------------------------------------------------------
# Overdue pregnancy checks
# --------------------------------------------------------------------------------------
def _overdue_rows(queryset):
    """
    Grouped by Mait, because that is the call to make.

    An individual animal is not the unit anybody acts on — a round is. One Mait carrying
    nineteen overdue checks is one conversation, and nineteen rows naming nineteen ear tags is
    a list somebody scrolls past.
    """
    grouped = (
        queryset.values("mait_id", "mait__name", "mait__sahayak_vendor_code")
        .annotate(n=Count("id"))
        .order_by("-n")
    )
    today = timezone.localdate()

    rows = []
    for entry in list(grouped)[:MAX_ROWS]:
        oldest = (
            queryset.filter(mait_id=entry["mait_id"]).order_by("due_on").values("due_on").first()
        )
        behind = (today - oldest["due_on"]).days if oldest else 0
        rows.append(
            _row(
                id=f"overdue-{entry['mait_id']}",
                bucket="worst" if behind >= 30 else "recent",
                title=entry["mait__name"],
                subtitle=entry["mait__sahayak_vendor_code"],
                detail="Pregnancy checks",
                state={
                    "label": f"{behind} days behind",
                    # Waiting, not blocked: the Mait can still work and the animal is carrying
                    # or not whatever anybody does today. Red only once it is a month adrift.
                    "tone": "bad" if behind >= 30 else "warn",
                },
                metric=f"{entry['n']} overdue",
                guidance=(
                    "Checks nobody has walked. Every one left undone is an insemination whose "
                    "outcome this platform will never know, and a conception rate computed "
                    "over the visits that happened to be convenient."
                ),
                facts=[
                    fact("Overdue checks", entry["n"]),
                    fact("Oldest due", oldest["due_on"].isoformat() if oldest else ""),
                    fact("Days behind", behind),
                    fact("Mait code", entry["mait__sahayak_vendor_code"]),
                ],
                link={
                    "href": f"pregnancy.html?mait={entry['mait_id']}",
                    "label": "Open their round",
                },
            )
        )
    return rows


# --------------------------------------------------------------------------------------
# Refused checks
# --------------------------------------------------------------------------------------
def _declined_rows(queryset):
    """
    Grouped by village, not by Mait and not by animal.

    One owner turning a Mait away on a wet morning is nobody's problem. The same village doing
    it repeatedly is, and it is an awareness conversation with that collection point rather
    than anything a Mait can fix on their own round — so naming the Mait here would point the
    conversation at the wrong person.
    """
    grouped = (
        queryset.values("ai_event__mpp__mpp_name", "ai_event__mpp__mpp_code")
        .annotate(n=Count("id"))
        .order_by("-n")
    )

    rows = []
    for entry in list(grouped)[:MAX_ROWS]:
        count = entry["n"]
        rows.append(
            _row(
                id=f"declined-{entry['ai_event__mpp__mpp_code'] or 'unknown'}",
                bucket="repeated" if count >= 3 else "occasional",
                title=entry["ai_event__mpp__mpp_name"] or "Unknown village",
                subtitle=entry["ai_event__mpp__mpp_code"] or "",
                detail="Owners declined a check",
                state={
                    "label": "Repeatedly" if count >= 3 else "Occasional",
                    "tone": "warn" if count >= 3 else None,
                },
                metric=f"{count} refused",
                guidance=(
                    "A refusal closes the check for good — nothing re-books it — so each one "
                    "is an insemination that will never get an answer. Repeated in one "
                    "village it is a conversation with that collection point, not something "
                    "the Mait can fix on their round."
                )
                if count >= 3
                else (
                    "One or two refusals in a village is ordinary. Worth knowing rather than "
                    "worth acting on — the check is closed either way and nothing re-books it."
                ),
                facts=[
                    fact("Refused", count),
                    fact("Window", f"Last {DECLINE_WINDOW_DAYS} days"),
                    fact("MPP code", entry["ai_event__mpp__mpp_code"]),
                    fact("Re-booked", "No — a refusal closes the check"),
                ],
                link={"href": "pregnancy.html", "label": "Open Pregnancy"},
            )
        )
    return rows


# --------------------------------------------------------------------------------------
# The registry
# --------------------------------------------------------------------------------------
def _queue_pending_payments(_filter, _days):
    queryset = pending_payments()
    rows = _pending_payment_rows(queryset)
    return {
        "title": "Pending payments",
        "subtitle": "Collections started and never finished",
        "count": queryset.count(),
        "buckets": PAYMENT_BUCKETS,
        "rows": rows,
    }


def _queue_low_stock(_filter, _days):
    queryset = low_stock_maits()
    rows = _low_stock_rows(queryset)
    return {
        "title": "Low stock",
        "subtitle": f"Maits at or under {settings.LOW_STOCK_THRESHOLD} straws",
        "count": len(rows),
        "buckets": STOCK_BUCKETS,
        "rows": rows,
    }


def _queue_stale_indents(_filter, _days):
    queryset = stale_indents()
    rows = _stale_indent_rows(queryset)
    return {
        "title": "Stale indents",
        "subtitle": f"Nobody has moved these in {STALE_AFTER_DAYS} days",
        "count": queryset.count(),
        "buckets": INDENT_BUCKETS,
        "rows": rows,
    }


def _queue_overdue_checks(_filter, _days):
    queryset = overdue_checks()
    rows = _overdue_rows(queryset)
    return {
        "title": "Overdue checks",
        "subtitle": "Pregnancy checks nobody has walked, by Mait",
        # Checks, not Maits: the card counts checks and this must agree with it.
        "count": queryset.count(),
        "buckets": [],
        "rows": rows,
    }


def _queue_declined_checks(_filter, days):
    queryset = declined_checks(days or DECLINE_WINDOW_DAYS)
    rows = _declined_rows(queryset)
    return {
        "title": "Owners who declined",
        "subtitle": "Refused checks, by village",
        "count": queryset.count(),
        "buckets": [],
        "rows": rows,
        "windowed": True,
    }


QUEUES = {
    "pending-payments": _queue_pending_payments,
    "low-stock": _queue_low_stock,
    "stale-indents": _queue_stale_indents,
    "overdue-checks": _queue_overdue_checks,
    "declined-checks": _queue_declined_checks,
}


@extend_schema(
    tags=["dashboard"],
    summary="The detail behind one Exceptions card",
    description=(
        "One row per thing needing a human, in a shape shared by every queue so the portal "
        "has one dialog rather than six: `title`, `subtitle`, `detail`, `state`, `metric`, "
        "`when`, `guidance`, `facts` and `link`.\n\n"
        "`queue` is one of `pending-payments`, `low-stock`, `stale-indents`, "
        "`overdue-checks`, `declined-checks`. Failed OTPs has its own endpoint — "
        "`/admin/otp-failures/` — because deciding *why* a code failed needs the attempt "
        "count, the expiry and the clock read together, which is more than a row builder.\n\n"
        "**The predicates are shared with `/dashboard/summary/`**, so a card cannot say four "
        "above a dialog showing eleven.\n\n"
        "`buckets` names the causes present in the queue, for the dialog's filter chips; each "
        "row carries the one it is in. They are causes rather than statuses: a payment "
        "waiting on a farmer's authorisation and one waiting on a Mait's screenshot are the "
        "same status and two different phone calls.\n\n"
        "`?days=` applies only where the queue declares `windowed`."
    ),
    parameters=[
        OpenApiParameter("days", description="Window, where the queue has one", type=int),
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin, in_section(PortalSection.EXCEPTIONS)])
def exception_detail(request, queue: str):
    builder = QUEUES.get(queue)
    if builder is None:
        raise NotFound(f"No such queue: {queue}")

    try:
        days = int(request.query_params.get("days", DECLINE_WINDOW_DAYS))
    except (TypeError, ValueError):
        days = DECLINE_WINDOW_DAYS
    days = min(365, max(1, days))

    chosen = request.query_params.get("filter") or ""
    built = builder(chosen, days)
    rows = built["rows"]

    # Counted before the chips narrow anything, so a chip can say how many it will show.
    tally = {}
    for row in rows:
        tally[row.get("bucket", "")] = tally.get(row.get("bucket", ""), 0) + 1

    # Narrowed after the tally, and after the rows are built rather than in SQL: a bucket is
    # a *cause*, worked out from several columns read together — which payment step is
    # missing, whether the push failed — and reproducing that as a queryset would be a second
    # definition of it to keep in step with the first.
    if chosen:
        rows = [row for row in rows if row.get("bucket") == chosen]

    return Response(
        {
            "queue": queue,
            "title": built["title"],
            "subtitle": built["subtitle"],
            "count": built["count"],
            "shown": len(rows),
            "filter": chosen,
            "truncated": len(rows) >= MAX_ROWS,
            "windowed": built.get("windowed", False),
            "window_days": days,
            "buckets": [
                {"key": key, "label": label, "tone": tone, "count": tally.get(key, 0)}
                for key, label, tone in built["buckets"]
            ],
            "results": rows,
        }
    )
