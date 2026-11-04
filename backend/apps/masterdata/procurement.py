"""
Milk procurement and the insemination-code eligibility it gates.

An AI charge is not paid in cash by a member: the dairy deducts it from the milk payment it
already owes her (``animals.BreedConfig.rate``). So a member can only be sent an insemination
code once she has poured enough milk to cover that charge — otherwise the dairy books a service
it has no payout to recover against. This module is that rule, in one place, so the mobile
picker's pill, the Mait's code request, the no-signal field check and the office's Super OTP
panel all answer eligibility the same way.

**The gate fails open until the feature is in use.** Eligibility is only enforced once there is
procurement data to enforce it against — the first uploaded report switches it on. Before that,
and for a dairy that never uploads one, every member is eligible, so the app is never bricked by
a rule whose inputs have not arrived.

**The threshold is the standard member AI rate** — the cheapest priced insemination on the
active breed list (today ₹100; sex-sorted semen at ₹500 is dearer and breed-specific, decided at
the step where a breed is chosen, not here). It follows ``BreedConfig`` so a rate change needs no
code change. If nothing is priced the threshold is zero and the amount check cannot exclude
anyone — a missing price must not read as "nobody qualifies".
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db.models import Min

from apps.animals.models import BreedConfig

from .models import MemberProcurement


def standard_ai_rate() -> Decimal:
    """
    The eligibility threshold: the cheapest priced, active member insemination rate.

    ``rate = 0`` means *not priced* (see ``BreedConfig.rate``), so priced rates only are
    considered. Zero when nothing is priced — a floor that excludes nobody.
    """
    lowest = (
        BreedConfig.objects.filter(is_active=True, rate__gt=0).aggregate(low=Min("rate"))["low"]
    )
    return lowest or Decimal("0")


def gate_active() -> bool:
    """Is the eligibility gate switched on? It is, once any procurement has been uploaded."""
    return MemberProcurement.objects.exists()


def latest_for(member) -> MemberProcurement | None:
    """A member's most recent procurement period, or ``None`` if none has been uploaded."""
    return member.procurements.order_by("-to_date", "-from_date").first()


def cycle_periods(periods: list) -> list:
    """
    The windows that belong to the member's latest reporting cycle, newest first.

    A SAP MemberWiseProcurementReport covers a month, and the office may upload it in pieces — a
    corrected 3rd–4th sitting beside an already-uploaded 1st–2nd and 5th–10th
    (``_import_procurement_fast``). Each piece is its own ``(member, from_date, to_date)`` row, so
    reading only the newest row would judge eligibility on a fragment of the month's pour. The
    cycle is the whole month of the latest window's ``to_date``; a month split across several
    uploads sums back together here.

    ``periods`` is expected newest-first (the model's Meta ordering / the serializer prefetch), so
    ``periods[0]`` is the latest window and names the cycle. Empty in, empty out.
    """
    if not periods:
        return []
    latest = periods[0]
    key = (latest.to_date.year, latest.to_date.month)
    return [p for p in periods if (p.to_date.year, p.to_date.month) == key]


def cycle_amount(periods: list) -> Decimal | None:
    """
    What the member poured across her latest cycle, or ``None`` if she has no procurement.

    The sum eligibility reads instead of a single window's amount, so two partial uploads of one
    month count together. ``None`` (not zero) when there is nothing on record, which is the state
    ``decide`` reads as "not on the latest roll".
    """
    rows = cycle_periods(periods)
    if not rows:
        return None
    return sum((p.amount for p in rows), Decimal("0"))


@dataclass(frozen=True)
class Eligibility:
    """Whether a member may be sent an insemination code, and the figures behind it."""

    eligible: bool
    #: False when the gate is off (no procurement data yet) — then ``eligible`` is True for all.
    gated: bool
    threshold: Decimal
    #: Her latest *cycle*'s amount — the sum of that month's windows — or None if she has none.
    amount: Decimal | None
    latest: MemberProcurement | None = None


def decide(
    *, amount: Decimal | None, threshold: Decimal, gated: bool, latest=None
) -> Eligibility:
    """
    Apply the rule to figures already in hand (no queries), so a list can decide a page at once.

    - Gate off → eligible (the feature is not live).
    - Gate on, no procurement for her → not eligible (she is not on the latest roll).
    - Gate on, has procurement → eligible when her amount ≥ the threshold.
    """
    if not gated:
        return Eligibility(True, False, threshold, amount, latest)
    if amount is None:
        return Eligibility(False, True, threshold, None, latest)
    return Eligibility(amount >= threshold, True, threshold, amount, latest)


def decide_from_periods(*, periods: list, threshold: Decimal, gated: bool) -> Eligibility:
    """
    Decide from a member's prefetched periods, summing her latest cycle (``cycle_amount``).

    The one path both the member serializers and the AI-event row take, so the pill, the milk
    panel and the office all read a month split across uploads the same way. ``periods`` is
    newest-first; ``periods[0]`` is the latest window kept as ``latest`` for the detail, while the
    amount eligibility compares is the whole cycle's sum.
    """
    return decide(
        amount=cycle_amount(periods),
        threshold=threshold,
        gated=gated,
        latest=periods[0] if periods else None,
    )


def code_block_reason(farmer) -> str | None:
    """
    Why this farmer may not be sent an insemination code, or ``None`` if she may.

    Only **members** are gated. A non-member pays the Mait in cash on the spot — there is no
    milk payout to recover an AI charge from — so eligibility does not apply to her, and this
    returns ``None`` for a non-member, for a member who clears the bar, and whenever the gate is
    not yet live (no procurement uploaded). The message names the figures so the office or the
    Mait can see exactly why, and what would change it.
    """
    from .models import Member

    if not isinstance(farmer, Member):
        return None
    decision = eligibility_for(farmer)
    if decision.eligible:
        return None
    name = farmer.member_name or "This member"
    need = f"₹{decision.threshold:.0f}"
    if decision.amount is None:
        return (
            f"{name} has no milk procurement on record yet, so no insemination code can be "
            f"sent. She qualifies once she has poured at least {need}."
        )
    return (
        f"{name} has poured ₹{decision.amount:.0f}, below the {need} needed before an "
        "insemination code can be sent."
    )


def serializer_context() -> dict:
    """
    The two values the member serializers need to decide eligibility for a whole page at once.

    Computed once per request (two small queries) and handed into the serializer context, so the
    per-row decision reads them instead of re-querying the breed list and the procurement table
    for every member in the page.
    """
    return {"procurement_gated": gate_active(), "procurement_threshold": standard_ai_rate()}


def eligibility_for(member) -> Eligibility:
    """Decide for one member, reading what it needs. For single-member paths (code request)."""
    periods = list(member.procurements.order_by("-to_date", "-from_date"))
    return decide_from_periods(
        periods=periods,
        threshold=standard_ai_rate(),
        gated=gate_active(),
    )
