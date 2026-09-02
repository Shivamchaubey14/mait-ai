"""
The Mait payment report (W18).

Most of what follows is one test: **the rows the office's own March sheet holds, replayed
through this code, must come out as the numbers on that sheet.** That file is the specification
— it is what the dairy has been paying against for years — and the only way to know the
platform agrees with it is to put its inputs in and check its outputs come back.

The rest covers the three places a payout report can be quietly wrong and still look right: the
retainer threshold, which decides ₹2,500 on a boundary; what counts as an insemination, where
an unfinished capture must earn nothing; and the split between the two tabs, which are counted
on different keys and would agree by accident on a small dataset.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import PortalSection, Role, User
from apps.ai_events.models import AIEvent
from apps.animals.models import Animal
from apps.inventory.models import (
    Consumable,
    MaitInventory,
    MaitInventoryLedger,
    ProductType,
    SemenBatch,
)
from apps.masterdata.models import MPP
from apps.payments.models import MaitPayoutScheme, Payment
from apps.payments.payout import build_payout, material_rates
from apps.payments.payout_export import build_payout_workbook

pytestmark = pytest.mark.django_db

BASE = "/api/v1"

#: The month the report is built for throughout. Fixed rather than "last month" so a test run
#: on the first of a month does not quietly cover a different window than one run on the tenth.
YEAR, MONTH = 2026, 3


@pytest.fixture
def scheme(db):
    """The terms printed at the foot of the office's sheet."""
    scheme = MaitPayoutScheme.current()
    scheme.commission_per_ai = Decimal("220")
    scheme.monthly_fixed_amount = Decimal("2500")
    scheme.fixed_min_ai = 25
    scheme.straw_rate = Decimal("35")
    scheme.save()

    for code, name, rate in [
        ("LN2", "Liquid nitrogen", "20"),
        ("SHEATH", "AI sheaths", "3"),
        ("GLOVES", "Gloves", "3"),
    ]:
        Consumable.objects.update_or_create(
            code=code, defaults={"name": name, "rate": Decimal(rate)}
        )
    return scheme


def in_month(day: int = 15):
    """An instant inside the month under test."""
    return timezone.make_aware(timezone.datetime(YEAR, MONTH, day, 10, 0))


def an_animal(mpp):
    """One animal per MPP, reused. Which animal it is has no bearing on a payout."""
    from conftest import AnimalFactory, MemberFactory

    existing = Animal.objects.filter(member__mpp=mpp).first()
    return existing or AnimalFactory(member=MemberFactory(mpp=mpp))


def complete_events(mait, mpp, count, *, mode=Payment.Mode.DEDUCTION, when=None):
    """`count` completed inseminations by this Mait, each with a verified payment."""
    moment = when or in_month()
    animal = an_animal(mpp)
    for _ in range(count):
        # A completed event must carry the straw it consumed — the schema refuses one that
        # does not, because an insemination with nothing deducted is the leakage this
        # platform exists to stop.
        straw = SemenBatch.objects.create(
            unique_straw_no=uuid.uuid4().hex[:20], breed="MURRAH", is_consumed=True
        )
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=animal.member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=straw.unique_straw_no,
            status=AIEvent.Status.COMPLETED,
            performed_at=moment,
            completed_at=moment,
        )
        Payment.objects.create(
            ai_event=event,
            amount=Decimal("300"),
            mode=mode,
            member_otp_verified=True,
            utr_number="UTR1" if mode == Payment.Mode.ONLINE else "",
            payment_screenshot_url="/x.jpg" if mode == Payment.Mode.ONLINE else "",
            cod_otp_verified=mode == Payment.Mode.COD,
            status=Payment.Status.VERIFIED,
        )


def issue(mait, *, straws=0, ln2=0, sheath=0, gloves=0, when=None):
    """Put material on a Mait's ledger, the way an indent issue does."""
    moment = when or in_month()

    def movement(product_type, ref_id, qty):
        inventory, _ = MaitInventory.objects.get_or_create(
            mait=mait,
            product_type=product_type,
            product_ref_id=ref_id,
            defaults={"qty_available": 0},
        )
        inventory.qty_available += qty
        inventory.save(update_fields=["qty_available"])
        entry = MaitInventoryLedger.objects.create(
            inventory=inventory,
            txn_type=MaitInventoryLedger.TxnType.ISSUE,
            qty=qty,
            balance_after=inventory.qty_available,
            ref_type=MaitInventoryLedger.RefType.INDENT,
        )
        # `created_at` is auto_now_add, so the row lands today and has to be moved into the
        # month under test — the report filters on it.
        MaitInventoryLedger.objects.filter(pk=entry.pk).update(created_at=moment)

    for _ in range(straws):
        straw = SemenBatch.objects.create(unique_straw_no=uuid.uuid4().hex[:20], breed="MURRAH")
        movement(ProductType.STRAW, straw.id, 1)
    for code, qty in [("LN2", ln2), ("SHEATH", sheath), ("GLOVES", gloves)]:
        if qty:
            movement(ProductType.CONSUMABLE, Consumable.objects.get(code=code).id, qty)


def row_for(report, name):
    return next(row for row in report["rows"] if row.mait_name == name)


# --------------------------------------------------------------------------------------
# The office's own sheet, replayed
# --------------------------------------------------------------------------------------
#: Five rows lifted from `MAITS PAYMENT - MAR`, chosen to cover every branch the arithmetic
#: has: a plain row, one with all four materials, one with heavy sheath and glove counts, one
#: below the retainer threshold, and one sitting exactly on it.
#:
#: ``(name, ai, straws, ln2, sheath, gloves, commission, fixed, gross, deduction, net)``
SHEET_ROWS = [
    ("RANDHEER SINGH", 67, 71, 10, 0, 0, 14740, 2500, 17240, 2685, 14555),
    ("SARAVJEET SINGH", 38, 94, 9, 100, 100, 8360, 2500, 10860, 4070, 6790),
    ("SAHAB SARAN YADAV", 31, 50, 6, 200, 100, 6820, 2500, 9320, 2770, 6550),
    ("PAWAN YADAV", 10, 50, 0, 0, 0, 2200, 0, 2200, 1750, 450),
    ("RAJESH KUMAR", 25, 0, 0, 0, 0, 5500, 2500, 8000, 0, 8000),
]


@pytest.fixture
def sheet(db, scheme, mait_factory):
    """The five sheet rows, as real Maits with real events and real ledger movements."""
    for name, ai, straws, ln2, sheath, gloves, *_expected in SHEET_ROWS:
        mait, mpp = mait_factory(name)
        complete_events(mait, mpp, ai)
        issue(mait, straws=straws, ln2=ln2, sheath=sheath, gloves=gloves)
    return build_payout(YEAR, MONTH)


@pytest.fixture
def mait_factory(db):
    """A Mait with a login, one MPP under a named plant, and bank details on file."""
    from conftest import MaitFactory, MPPFactory

    def _make(name, plant="COLONELGANJ"):
        mait = MaitFactory(
            name=name,
            bank_account_no="36566473035",
            ifsc_code="SBIN0012497",
            pan_no="FNFPS6713H",
        )
        mpp = MPPFactory(mait=mait, plant_code="2006", plant_name=plant)
        return mait, mpp

    return _make


@pytest.mark.parametrize("expected", SHEET_ROWS, ids=[row[0] for row in SHEET_ROWS])
def test_reproduces_the_office_sheet(sheet, expected):
    """Every derived column matches the hand-kept file, rupee for rupee."""
    name, ai, straws, ln2, sheath, gloves, commission, fixed, gross, deduction, net = expected
    row = row_for(sheet, name)

    assert row.ai_performed == ai
    assert row.quantities == {
        "semen": straws,
        "ln2": ln2,
        "sheath": sheath,
        "gloves": gloves,
        "tagging": 0,
    }
    assert row.commission == Decimal(commission)
    assert row.fixed_amount == Decimal(fixed)
    assert row.gross == Decimal(gross)
    assert row.deduction == Decimal(deduction)
    assert row.after_deduction == Decimal(net)
    assert row.net_payable == Decimal(net)


def test_totals_are_the_sum_of_the_rows(sheet):
    assert sheet["totals"]["ai_performed"] == sum(row[1] for row in SHEET_ROWS)
    assert sheet["totals"]["net_payable"] == sum(Decimal(row[10]) for row in SHEET_ROWS)
    assert sheet["totals"]["quantities"]["semen"] == sum(row[2] for row in SHEET_ROWS)


# --------------------------------------------------------------------------------------
# The retainer boundary
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("ai", "earns_retainer"),
    [(24, False), (25, True), (26, True)],
)
def test_retainer_is_at_least_not_more_than(scheme, mait_factory, ai, earns_retainer):
    """
    "Above 25 AI in month" on the office sheet means *at least* 25 — its own March file pays
    the retainer to a Mait who performed exactly 25, and paying that person ₹2,500 less would
    be a pay cut delivered by a reading of an adverb.
    """
    mait, mpp = mait_factory("BOUNDARY")
    complete_events(mait, mpp, ai)

    row = row_for(build_payout(YEAR, MONTH), "BOUNDARY")
    assert (row.fixed_amount == Decimal("2500")) is earns_retainer


def test_a_zero_threshold_pays_no_retainer_at_all(scheme, mait_factory):
    """Not the same as everybody qualifying — it means the dairy is not running one."""
    scheme.fixed_min_ai = 0
    scheme.save()
    mait, mpp = mait_factory("NO SCHEME")
    complete_events(mait, mpp, 40)

    assert row_for(build_payout(YEAR, MONTH), "NO SCHEME").fixed_amount == Decimal("0")


# --------------------------------------------------------------------------------------
# What counts as work
# --------------------------------------------------------------------------------------
def test_unfinished_captures_earn_nothing(scheme, mait_factory):
    """
    An animal may have been served, but the platform has no verified payment behind the event
    and it can still be cancelled. Paying on it would pay for work that gets undone.
    """
    mait, mpp = mait_factory("UNFINISHED")
    animal = an_animal(mpp)
    for status in (AIEvent.Status.STRAW_VERIFIED, AIEvent.Status.PAYMENT_PENDING):
        AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=animal.member,
            animal=animal,
            status=status,
            performed_at=in_month(),
        )

    row = row_for(build_payout(YEAR, MONTH), "UNFINISHED")
    assert row.ai_performed == 0
    assert row.net_payable == Decimal("0")


def test_work_outside_the_month_is_not_counted(scheme, mait_factory):
    """The last day of the previous month and the first of the next both sit outside."""
    mait, mpp = mait_factory("BOUNDARY MONTH")
    first_instant = in_month(1).replace(hour=0, minute=0)
    complete_events(mait, mpp, 1, when=first_instant - timedelta(seconds=1))
    complete_events(
        mait, mpp, 1, when=in_month(31).replace(hour=23, minute=59) + timedelta(minutes=1)
    )
    # The first and last instants the month does own.
    complete_events(mait, mpp, 2, when=first_instant)
    complete_events(mait, mpp, 1, when=in_month(31).replace(hour=23, minute=59))

    assert row_for(build_payout(YEAR, MONTH), "BOUNDARY MONTH").ai_performed == 3


def test_returned_stock_is_not_charged_for(scheme, mait_factory):
    """A flask handed back on the 30th was not consumed."""
    mait, _mpp = mait_factory("RETURNER")
    issue(mait, straws=10)
    inventory = MaitInventory.objects.filter(mait=mait, product_type=ProductType.STRAW).first()
    entry = MaitInventoryLedger.objects.create(
        inventory=inventory,
        txn_type=MaitInventoryLedger.TxnType.RETURN,
        qty=-1,
        balance_after=0,
        ref_type=MaitInventoryLedger.RefType.MANUAL,
    )
    MaitInventoryLedger.objects.filter(pk=entry.pk).update(created_at=in_month(30))

    # Ten straws issued across ten inventory rows, one of them handed back.
    assert row_for(build_payout(YEAR, MONTH), "RETURNER").quantities["semen"] == 9


def test_more_issued_than_earned_is_flagged_not_hidden(scheme, mait_factory):
    """The row somebody has to look at before the file goes to the bank."""
    mait, mpp = mait_factory("OVERDRAWN")
    complete_events(mait, mpp, 2)
    issue(mait, straws=100)

    row = row_for(build_payout(YEAR, MONTH), "OVERDRAWN")
    assert row.net_payable < 0
    assert row.is_overdrawn
    assert build_payout(YEAR, MONTH)["totals"]["overdrawn"] == 1


# --------------------------------------------------------------------------------------
# The second tab
# --------------------------------------------------------------------------------------
def test_deduction_tab_counts_only_milk_payment_recoveries(scheme, mait_factory):
    """
    Cash and online payments are already settled. Including them would ask finance to recover
    the same money twice.
    """
    mait, mpp = mait_factory("MIXED", plant="BAHRAICH")
    complete_events(mait, mpp, 5, mode=Payment.Mode.DEDUCTION)
    complete_events(mait, mpp, 3, mode=Payment.Mode.COD)
    complete_events(mait, mpp, 2, mode=Payment.Mode.ONLINE)

    report = build_payout(YEAR, MONTH)
    assert row_for(report, "MIXED").ai_performed == 10
    assert report["deductions"] == [{"mcc_name": "BAHRAICH", "ai_count": 5}]


def test_deduction_tab_counts_where_the_work_happened(scheme, mait_factory):
    """
    Not where the Mait is posted. Finance settles milk payments by collection point, so a Mait
    working an MPP under the neighbouring centre puts the deduction on the neighbour's page.
    """
    mait, home = mait_factory("TRAVELLER", plant="NANPARA")
    away = MPP.objects.create(
        mpp_code="MPPAWAY01", mpp_name="Away", plant_code="2099", plant_name="MIHIPURWA"
    )
    complete_events(mait, home, 2)
    complete_events(mait, away, 3)

    report = build_payout(YEAR, MONTH)
    assert row_for(report, "TRAVELLER").mcc_name == "NANPARA"
    assert report["deductions"] == [
        {"mcc_name": "MIHIPURWA", "ai_count": 3},
        {"mcc_name": "NANPARA", "ai_count": 2},
    ]


# --------------------------------------------------------------------------------------
# The workbook and the endpoints
# --------------------------------------------------------------------------------------
def test_workbook_has_both_tabs_and_the_rate_legend(sheet, scheme):
    workbook, report = build_payout_workbook(YEAR, MONTH)
    payment, deduction = workbook["MAR-PAYMENT"], workbook["DEDUCTION"]

    # Row 1 is the column names, with nothing above them. A banner there made Excel guess the
    # wrong header row on every sort and filter.
    headers = [payment.cell(row=1, column=i).value for i in range(1, 20)]
    assert headers[:7] == [
        "S.No.",
        "MCC NAME",
        "MAITS NAME",
        "AI PERFORMED",
        "TOTAL AMOUNT",
        "FIXED AMOUNT",
        "TOTAL",
    ]
    assert headers[-4:] == ["Account No", "IFSC", "PANCARD", "VENDOR"]

    # Identifiers are written as text, or Excel eats the leading zeros and rounds the long
    # ones into scientific notation on the way back in.
    for column in (16, 17, 18, 19):
        assert payment.cell(row=2, column=column).number_format == "@"

    # What the banner used to say, where a sort cannot trip over it.
    assert "personal data" in workbook.properties.subject
    assert payment.freeze_panes == "D2"

    # The legend states the terms the rows above were actually built with.
    body = [cell.value for row in payment.iter_rows() for cell in row]
    assert "Rs 220 Per AI" in body
    assert "Rs 2500 (Fixed)" in body
    assert "RATE PER PIECE" in body

    assert deduction.cell(row=3, column=3).value == "MCC Name"
    assert deduction.cell(row=3, column=4).value == "DEDUCTION AI"


@pytest.fixture
def payout_client(db):
    user = User.objects.create_user(
        username="payroll",
        password="x",
        full_name="Payroll",
        role=Role.ADMIN,
        portal_sections=[PortalSection.MAIT_PAYMENT],
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def test_preview_masks_the_account_and_the_pan(sheet, payout_client):
    """A screen is read over a shoulder; only the file needs the whole number."""
    response = payout_client.get(f"{BASE}/reports/mait-payment/?month={YEAR}-{MONTH:02d}")
    assert response.status_code == 200

    row = next(r for r in response.data["rows"] if r["mait_name"] == "RANDHEER SINGH")
    assert row["bank_account_no"].endswith("3035")
    assert row["bank_account_no"].startswith("X")
    assert row["pan_no"].startswith("X")
    # The IFSC identifies a branch, not a person, and the office reads rows by it.
    assert row["ifsc_code"] == "SBIN0012497"
    assert row["net_payable"] == "14555.00"


def test_export_carries_them_in_full_and_is_audit_logged(sheet, payout_client):
    from apps.core.models import AuditLog

    response = payout_client.get(f"{BASE}/reports/mait-payment/export/?month={YEAR}-{MONTH:02d}")
    assert response.status_code == 200
    assert response["Content-Disposition"].endswith(f'mait-payment-{YEAR}-{MONTH:02d}.xlsx"')

    entry = AuditLog.objects.filter(entity_id="mait_payment_export").first()
    assert entry is not None
    assert entry.meta_json["month"] == f"{YEAR}-{MONTH:02d}"
    assert "bank_account_no" in entry.meta_json["carries"]


def test_a_bad_month_is_refused_rather_than_guessed(payout_client):
    assert payout_client.get(f"{BASE}/reports/mait-payment/?month=March").status_code == 400
    assert payout_client.get(f"{BASE}/reports/mait-payment/?month=2019-04").status_code == 400


def test_an_account_without_the_section_is_refused(sheet, db):
    user = User.objects.create_user(
        username="clerk",
        password="x",
        full_name="Rate clerk",
        role=Role.ADMIN,
        portal_sections=[PortalSection.PRODUCTS],
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")

    assert client.get(f"{BASE}/reports/mait-payment/").status_code == 403
    assert client.get(f"{BASE}/reports/mait-payment/export/").status_code == 403


def test_rates_come_from_the_catalogue_not_from_the_code(scheme):
    """A dairy that re-prices gloves re-prices this report, without a deploy."""
    Consumable.objects.filter(code="GLOVES").update(rate=Decimal("5"))
    assert material_rates()["gloves"] == Decimal("5")

    scheme.straw_rate = Decimal("40")
    scheme.save()
    assert material_rates()["semen"] == Decimal("40")


# --------------------------------------------------------------------------------------
# The scheme editor
# --------------------------------------------------------------------------------------
def test_scheme_can_be_renegotiated_without_a_deploy(scheme, mait_factory, payout_client):
    """A dairy that changes what it pays changes it here, and the report follows."""
    mait, mpp = mait_factory("RENEGOTIATED")
    complete_events(mait, mpp, 10)

    response = payout_client.patch(
        f"{BASE}/reports/mait-payment/scheme/",
        {"commission_per_ai": "250", "fixed_min_ai": 5},
        format="json",
    )
    assert response.status_code == 200

    row = row_for(build_payout(YEAR, MONTH), "RENEGOTIATED")
    assert row.commission == Decimal("2500")
    assert row.fixed_amount == Decimal("2500")


def test_a_change_of_pay_is_audit_logged_with_what_it_was(scheme, payout_client):
    from apps.core.models import AuditLog

    payout_client.patch(
        f"{BASE}/reports/mait-payment/scheme/", {"commission_per_ai": "199"}, format="json"
    )

    entry = AuditLog.objects.filter(entity_type="mait_payout_scheme").first()
    assert entry is not None
    assert entry.meta_json["before"]["commission_per_ai"] == "220.00"
    assert entry.meta_json["after"]["commission_per_ai"] == "199.00"


# --------------------------------------------------------------------------------------
# Which month the screen opens on
# --------------------------------------------------------------------------------------
def test_no_month_means_the_current_one(scheme, mait_factory, payout_client):
    """
    The month in progress, not the one just gone.

    A payment *run* is for a finished month, but the screen is opened far more often to watch
    a month accumulate — whether today's captures landed, whether a tester's account is
    producing rows at all. `in_progress` is what stops that being read as a settled figure.
    """
    today = timezone.localdate()
    mait, mpp = mait_factory("THIS MONTH")
    complete_events(mait, mpp, 3, when=timezone.now())

    response = payout_client.get(f"{BASE}/reports/mait-payment/")
    assert response.status_code == 200
    assert response.data["month"] == f"{today.year}-{today.month:02d}"
    assert response.data["in_progress"] is True

    row = next(r for r in response.data["rows"] if r["mait_name"] == "THIS MONTH")
    assert row["ai_performed"] == 3


def test_a_finished_month_does_not_claim_to_be_in_progress(sheet, payout_client):
    response = payout_client.get(f"{BASE}/reports/mait-payment/?month={YEAR}-{MONTH:02d}")
    assert response.data["in_progress"] is False
