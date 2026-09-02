"""
What each Mait is owed for a month, and what the dairy takes back out of it (W18).

This is the sheet the office has always kept by hand: one row per Mait, the inseminations
they completed, the commission that earns, the retainer if the round was big enough, less
the cost of the straws and consumables issued to them — and the bank details to pay the
remainder into. It is built here from the records the platform already holds rather than
re-typed, which is the whole point: the hand-kept version drifts from the event log the
moment anybody miscounts a column.

**Every figure is derived, none is stored.** A payout row is a view of a month, and a month
keeps moving for a while after it ends — an insemination captured offline arrives late, a
disputed event is cancelled, a straw issue is corrected. Freezing the row when the report is
first opened would mean the file and the system disagreeing with no way to tell which is
right. So the report is recomputed on every read and the month it names is the only state.

**Three separate questions, deliberately not collapsed:**

* *What did they do?* Completed AI events in the month, counted by ``completed_at``. An
  unfinished capture has not earned anything: the animal may have been served, but the
  platform has no verified payment behind it and the event can still be cancelled.
* *What were they given?* Straws and consumables **issued** in the month, off the inventory
  ledger. Issued, not consumed — the dairy hands a Mait a flask and recovers what it cost,
  whether or not every straw in it went into an animal that month.
* *Who are they?* The Mait's own bank details, from the SAP master.

The first two do not have to agree, and reading them as though they should is a mistake this
report invites: a Mait issued 71 straws who performed 67 inseminations is a Mait carrying four
straws into next month, not a Mait who lost four.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from django.db.models import Count, Q, Sum

from apps.ai_events.models import AIEvent
from apps.core.timeframe import start_of_day
from apps.inventory.models import Consumable, MaitInventoryLedger, ProductType
from apps.masterdata.models import MPP, Mait
from apps.payments.models import MaitPayoutScheme, Payment

#: The consumables this report recovers, in the order the office's own sheet lists them, and
#: the catalogue code each one is. A code that is not in the catalogue simply contributes
#: nothing — the column stays, because a dairy that starts issuing ear tags next month should
#: find the figure appearing rather than have to ask for a new column.
CONSUMABLE_COLUMNS = [
    ("ln2", "LN2"),
    ("sheath", "SHEATH"),
    ("gloves", "GLOVES"),
    # Ear tags are the "Tagging" column, and it has been zero for as long as the office has
    # kept this sheet: tags are not issued through the indent system yet. Sourced rather than
    # hardcoded to zero so that the day they are, the report is already right.
    ("tagging", "EAR_TAG"),
]

#: Every material column, straws first — the order the sheet reads left to right.
MATERIAL_KEYS = ["semen"] + [key for key, _code in CONSUMABLE_COLUMNS]

ZERO = Decimal("0")


def month_bounds(year: int, month: int) -> tuple[date, date]:
    """The first day of the month, and the first day of the one after it."""
    first = date(year, month, 1)
    last = date(year + (month == 12), month % 12 + 1, 1)
    return first, last


@dataclass
class PayoutRow:
    """One Mait's month. Every rupee figure is a Decimal; every quantity is an int."""

    mait_id: int
    mcc_name: str
    mait_name: str
    vendor_code: str
    ai_performed: int = 0

    commission: Decimal = ZERO
    fixed_amount: Decimal = ZERO

    #: Quantities issued in the month, keyed as in `MATERIAL_KEYS`.
    quantities: dict = field(default_factory=dict)
    #: The rupee value of each of those, same keys.
    recoveries: dict = field(default_factory=dict)

    bank_account_no: str = ""
    ifsc_code: str = ""
    pan_no: str = ""

    @property
    def gross(self) -> Decimal:
        return self.commission + self.fixed_amount

    @property
    def deduction(self) -> Decimal:
        """Everything recovered except tagging, which the sheet subtracts a column later."""
        return sum((value for key, value in self.recoveries.items() if key != "tagging"), ZERO)

    @property
    def after_deduction(self) -> Decimal:
        return self.gross - self.deduction

    @property
    def tagging(self) -> Decimal:
        return self.recoveries.get("tagging", ZERO)

    @property
    def net_payable(self) -> Decimal:
        return self.after_deduction - self.tagging

    @property
    def is_overdrawn(self) -> bool:
        """
        More was issued than was earned.

        Not an error and not blocked — a Mait restocked at the end of a quiet month is exactly
        this — but it is the row somebody has to look at before the file goes to the bank, so
        it is reported rather than left to be spotted in a column of numbers.
        """
        return self.net_payable < 0


def _mcc_by_mait() -> dict[int, str]:
    """
    Which chilling centre each Mait is counted under.

    A Mait covers several MPPs and those can sit under more than one plant, but the office's
    sheet gives each of them exactly one MCC — so the answer is the plant most of their
    assigned MPPs belong to, with the name settling any tie so the report does not reorder
    itself between two runs on unchanged data.
    """
    counts: dict[int, dict[str, int]] = defaultdict(dict)
    rows = (
        MPP.objects.filter(mait__isnull=False)
        .exclude(plant_name="")
        .values("mait_id", "plant_name")
        .annotate(n=Count("id"))
    )
    for row in rows:
        counts[row["mait_id"]][row["plant_name"]] = row["n"]
    return {
        mait_id: sorted(plants.items(), key=lambda item: (-item[1], item[0]))[0][0]
        for mait_id, plants in counts.items()
    }


def _ai_counts(first: date, last: date) -> dict[int, int]:
    """
    Completed inseminations per Mait in the window, counted by when they completed.

    Bounded by instants rather than ``completed_at__date``, which compiles to a CONVERT_TZ
    that is NULL on a MySQL without timezone tables — see ``apps.core.timeframe``. On a payout
    report that failure mode pays everybody nothing and says nothing about why.
    """
    rows = (
        AIEvent.objects.filter(
            status=AIEvent.Status.COMPLETED,
            completed_at__gte=start_of_day(first),
            completed_at__lt=start_of_day(last),
        )
        .values("mait_id")
        .annotate(n=Count("id"))
    )
    return {row["mait_id"]: row["n"] for row in rows}


def _issued_quantities(first: date, last: date) -> dict[int, dict[str, int]]:
    """
    What each Mait was issued in the window, by report column.

    Straws are one row per physical straw, so the quantity is the summed ledger movement
    rather than a count of products. Returns are netted off: a flask handed back on the 30th
    was not consumed and must not be charged for.

    ``product_ref_id`` is a bare integer that means ``SemenBatch.id`` for a straw and
    ``Consumable.id`` for everything else, and the two id spaces overlap — so the product type
    is part of the key here, not an afterthought.
    """
    codes = {code: key for key, code in CONSUMABLE_COLUMNS}
    consumable_key = {
        row["id"]: codes[row["code"]]
        for row in Consumable.objects.filter(code__in=list(codes)).values("id", "code")
    }

    quantities: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    rows = (
        MaitInventoryLedger.objects.filter(
            txn_type__in=(
                MaitInventoryLedger.TxnType.ISSUE,
                MaitInventoryLedger.TxnType.RETURN,
            ),
            created_at__gte=start_of_day(first),
            created_at__lt=start_of_day(last),
        )
        .values("inventory__mait_id", "inventory__product_type", "inventory__product_ref_id")
        .annotate(qty=Sum("qty"))
    )
    for row in rows:
        if row["inventory__product_type"] == ProductType.STRAW:
            key = "semen"
        else:
            key = consumable_key.get(row["inventory__product_ref_id"])
            if key is None:
                continue
        quantities[row["inventory__mait_id"]][key] += row["qty"] or 0

    # A return is a negative movement, so the net is floored at zero — a Mait who handed back
    # more than they took this month is carrying stock from the last one, and a negative
    # recovery would pay them for returning it.
    return {
        mait_id: {key: max(0, qty) for key, qty in columns.items()}
        for mait_id, columns in quantities.items()
    }


def material_rates() -> dict[str, Decimal]:
    """
    The per-piece recovery rate for each material column.

    Straws from the payout scheme, everything else from the Products catalogue — one place
    per price. Zero where nobody has set one, which recovers nothing and is visible on the
    screen as an unpriced material rather than quietly costing the Mait nothing.
    """
    catalogue = {
        row["code"]: row["rate"]
        for row in Consumable.objects.filter(
            code__in=[code for _key, code in CONSUMABLE_COLUMNS]
        ).values("code", "rate")
    }
    rates = {"semen": MaitPayoutScheme.current().straw_rate or ZERO}
    for key, code in CONSUMABLE_COLUMNS:
        rates[key] = catalogue.get(code) or ZERO
    return rates


def _roster(ai_counts: dict, issued: dict) -> dict[int, Mait]:
    """
    Which Maits the report has a row for.

    Everybody who worked or was issued anything in the month, plus every activated Mait — the
    ones holding a login, which is what makes somebody a working technician rather than one of
    the several thousand Sahayaks the SAP master carries. That last group is why the sheet has
    rows reading zero all the way across: a Mait who did nothing in March is a fact the office
    needs on the page, not an absence it has to notice.
    """
    active = set(ai_counts) | set(issued)
    return {
        mait.id: mait
        for mait in Mait.objects.filter(
            Q(id__in=active) | Q(user__isnull=False, is_active=True)
        ).order_by("name")
    }


def build_payout(year: int, month: int) -> dict:
    """
    The whole report for one month: rows, totals, the rates that produced them, and the
    per-MCC deduction count that is the office sheet's second page.
    """
    first, last = month_bounds(year, month)
    scheme = MaitPayoutScheme.current()
    rates = material_rates()

    ai_counts = _ai_counts(first, last)
    issued = _issued_quantities(first, last)
    mcc = _mcc_by_mait()
    roster = _roster(ai_counts, issued)

    rows: list[PayoutRow] = []
    for mait in roster.values():
        count = ai_counts.get(mait.id, 0)
        given = issued.get(mait.id, {})
        quantities = {key: given.get(key, 0) for key in MATERIAL_KEYS}
        # "At least this many", so a Mait sitting exactly on the threshold earns it. A
        # threshold of zero means the dairy is not running a retainer at all, which is not the
        # same as every Mait qualifying for one.
        earned_fixed = bool(scheme.fixed_min_ai) and count >= scheme.fixed_min_ai
        rows.append(
            PayoutRow(
                mait_id=mait.id,
                mcc_name=mcc.get(mait.id, ""),
                mait_name=mait.name,
                vendor_code=mait.sahayak_vendor_code,
                ai_performed=count,
                commission=(scheme.commission_per_ai or ZERO) * count,
                fixed_amount=scheme.monthly_fixed_amount if earned_fixed else ZERO,
                quantities=quantities,
                recoveries={key: rates[key] * quantity for key, quantity in quantities.items()},
                bank_account_no=mait.bank_account_no or "",
                ifsc_code=mait.ifsc_code or "",
                pan_no=mait.pan_no or "",
            )
        )

    # By MCC then by name, which is how the office reads it: a chilling centre's manager wants
    # their own people together, and the sheet has always been ordered that way. A Mait with
    # no MPPs assigned yet has no centre to sit under and goes to the bottom rather than the
    # top — an empty first column sorts first, which would open the report on the people it
    # has the least to say about.
    rows.sort(key=lambda row: (not row.mcc_name, row.mcc_name, row.mait_name))

    return {
        "month": first,
        "scheme": scheme,
        "rates": rates,
        "rows": rows,
        "totals": totals_for(rows),
        "deductions": deductions_by_mcc(first, last),
    }


def totals_for(rows: list[PayoutRow]) -> dict:
    """The foot of the sheet, summed from the rows rather than queried a second time."""
    return {
        "maits": len(rows),
        "ai_performed": sum(row.ai_performed for row in rows),
        "commission": sum((row.commission for row in rows), ZERO),
        "fixed_amount": sum((row.fixed_amount for row in rows), ZERO),
        "gross": sum((row.gross for row in rows), ZERO),
        "quantities": {
            key: sum(row.quantities.get(key, 0) for row in rows) for key in MATERIAL_KEYS
        },
        "recoveries": {
            key: sum((row.recoveries.get(key, ZERO) for row in rows), ZERO) for key in MATERIAL_KEYS
        },
        "deduction": sum((row.deduction for row in rows), ZERO),
        "after_deduction": sum((row.after_deduction for row in rows), ZERO),
        "tagging": sum((row.tagging for row in rows), ZERO),
        "net_payable": sum((row.net_payable for row in rows), ZERO),
        "overdrawn": sum(1 for row in rows if row.is_overdrawn),
    }


def deductions_by_mcc(first: date, last: date) -> list[dict]:
    """
    How many inseminations the dairy is recovering from members' milk payments, per MCC.

    A different question from the payout above, and the office keeps it on a second page for
    that reason. This one is counted where the *work happened* — the chilling centre the MPP
    sits under — not where the Mait is posted, because it is handed to the people who settle
    milk payments and they settle them by collection point. A Mait posted at one centre who
    works an MPP under the next one puts the deduction on the neighbour's page, correctly.

    Only ``DEDUCT`` payments appear. A non-member paid the Mait in cash in the yard and a
    member who paid online has already paid; neither is coming out of a milk payout, and
    including them would ask finance to recover the same money twice.
    """
    rows = (
        AIEvent.objects.filter(
            status=AIEvent.Status.COMPLETED,
            completed_at__gte=start_of_day(first),
            completed_at__lt=start_of_day(last),
            payment__mode=Payment.Mode.DEDUCTION,
            payment__status=Payment.Status.VERIFIED,
        )
        .exclude(mpp__plant_name="")
        .values("mpp__plant_name")
        .annotate(ai_count=Count("id"))
        .order_by("mpp__plant_name")
    )
    return [{"mcc_name": row["mpp__plant_name"], "ai_count": row["ai_count"]} for row in rows]
