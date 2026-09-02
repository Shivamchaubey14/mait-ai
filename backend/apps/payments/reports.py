"""
The Mait payment report, as a preview and as a workbook (W18).

Two endpoints over one computation, in that order on purpose. The workbook is a payment
instruction — somebody reads it and money moves — so it is previewed on a screen first, by
the person who is about to send it, and the preview is built from the same
``payout.build_payout`` call the file is. There is no second definition of what a month owes.

The two differ in exactly one respect: **the preview masks the account number and the PAN,
the file carries them in full.** A screen is read over a shoulder in an open office and needs
only enough of the number to recognise the row; a bank file cannot be paid from a masked
account. See ``payout_export`` for why that exception is made and what holds it in place.
"""

from __future__ import annotations

from datetime import date

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.models import PortalSection
from apps.core.fields import mask
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin, in_section
from apps.core.services import record_audit
from apps.payments.models import MaitPayoutScheme
from apps.payments.payout import MATERIAL_KEYS, build_payout
from apps.payments.payout_export import payout_workbook_response

#: How far back a month can be asked for. Not a performance limit — the report is a few
#: hundred rows — but the platform has no events before it went live, and a date picker that
#: offers 2019 invites somebody to produce an empty file and wonder what broke.
EARLIEST = date(2026, 1, 1)


def _month(request) -> tuple[int, int]:
    """
    The month being asked for, as ``YYYY-MM``. Defaults to the current one.

    It used to default to the month just gone, on the reasoning that a payout is run for a
    month that has finished. That is true of the *payment run* and wrong for the screen: the
    people who open this most often are watching a month accumulate — checking that a day's
    captures landed, that a tester's account is producing rows — and a report that opens on
    last month answers a question they did not ask. `in_progress` on the response is what
    keeps it honest, so a running total is never mistaken for a settled one.
    """
    raw = (request.query_params.get("month") or "").strip()
    if not raw:
        today = timezone.localdate()
        return today.year, today.month

    try:
        year, month = raw.split("-")
        asked = date(int(year), int(month), 1)
    except (ValueError, TypeError) as exc:
        raise ValidationError({"month": "Expected YYYY-MM."}) from exc

    if asked < EARLIEST or asked > timezone.localdate():
        raise ValidationError({"month": "Outside the period this platform has records for."})
    return asked.year, asked.month


def _row(serial: int, row) -> dict:
    return {
        "serial": serial,
        "mait_id": row.mait_id,
        "mcc_name": row.mcc_name,
        "mait_name": row.mait_name,
        "vendor_code": row.vendor_code,
        "ai_performed": row.ai_performed,
        "commission": str(row.commission),
        "fixed_amount": str(row.fixed_amount),
        "gross": str(row.gross),
        "quantities": {key: row.quantities.get(key, 0) for key in MATERIAL_KEYS},
        "recoveries": {key: str(row.recoveries.get(key, 0)) for key in MATERIAL_KEYS},
        "deduction": str(row.deduction),
        "after_deduction": str(row.after_deduction),
        "tagging": str(row.tagging),
        "net_payable": str(row.net_payable),
        # Masked here and whole in the file. The last four digits are what an operator checks
        # a row by; the rest is what a payment needs and a screen does not.
        "bank_account_no": mask(row.bank_account_no),
        "ifsc_code": row.ifsc_code,
        "pan_no": mask(row.pan_no),
        "has_bank_details": bool(row.bank_account_no and row.ifsc_code),
        "overdrawn": row.is_overdrawn,
    }


@extend_schema(
    tags=["reports"],
    summary="Mait payment report for a month",
    description=(
        "One row per Mait: inseminations completed, the commission and retainer they earn, "
        "the straws and consumables issued to them recovered at catalogue rates, and what is "
        "left to pay.\n\n"
        "`?month=YYYY-MM`, defaulting to the current month. `in_progress` says whether the "
        "month is still accumulating, so a running total is never read as a settled one.\n\n"
        "**Counted three different ways on purpose.** Inseminations are *completed* events, "
        "by `completed_at`. Materials are what was *issued* in the month off the inventory "
        "ledger, net of returns — not what was consumed, because the dairy recovers the cost "
        "of a flask when it hands it over. `deductions` is a third figure again: the "
        "inseminations finance recovers from members' milk payments, counted at the MCC where "
        "the work happened rather than where the Mait is posted.\n\n"
        "Account numbers and PANs are masked here. The workbook at "
        "`/reports/mait-payment/export/` carries them in full, because it is a payment "
        "instruction."
    ),
    parameters=[
        OpenApiParameter("month", description="YYYY-MM", required=False, type=str),
    ],
    responses={200: dict},
)
@api_view(["GET"])
@permission_classes([IsAdmin, in_section(PortalSection.MAIT_PAYMENT, PortalSection.REPORTS)])
def mait_payment(request):
    year, month = _month(request)
    report = build_payout(year, month)
    scheme = report["scheme"]

    return Response(
        {
            "month": f"{report['month'].year}-{report['month'].month:02d}",
            # Whether the month is still accumulating. The screen says so rather than
            # presenting a running total in the same voice as a settled one — somebody
            # reading a figure they are about to pay against needs to know it can still move.
            "in_progress": report["month"] == timezone.localdate().replace(day=1),
            "scheme": {
                "commission_per_ai": str(scheme.commission_per_ai),
                "monthly_fixed_amount": str(scheme.monthly_fixed_amount),
                "fixed_min_ai": scheme.fixed_min_ai,
            },
            "rates": {key: str(value) for key, value in report["rates"].items()},
            "rows": [_row(serial, row) for serial, row in enumerate(report["rows"], start=1)],
            "totals": {
                "maits": report["totals"]["maits"],
                "ai_performed": report["totals"]["ai_performed"],
                "commission": str(report["totals"]["commission"]),
                "fixed_amount": str(report["totals"]["fixed_amount"]),
                "gross": str(report["totals"]["gross"]),
                "quantities": report["totals"]["quantities"],
                "deduction": str(report["totals"]["deduction"]),
                "after_deduction": str(report["totals"]["after_deduction"]),
                "tagging": str(report["totals"]["tagging"]),
                "net_payable": str(report["totals"]["net_payable"]),
                "overdrawn": report["totals"]["overdrawn"],
            },
            "deductions": report["deductions"],
            "deduction_total": sum(entry["ai_count"] for entry in report["deductions"]),
        }
    )


@extend_schema(
    tags=["reports"],
    summary="Export the Mait payment report as a workbook",
    description=(
        "The same month as the preview, in the two-tab shape the office already reads: the "
        "payment sheet with its rate legend, and the per-MCC AI deduction tab.\n\n"
        "**This file carries full bank account numbers, IFSC codes and PANs**, and is the "
        "second place in the platform that carries unmasked personal data — the first being "
        "the non-member roster. It is a payment instruction and a masked account cannot be "
        "paid into. Admin only, behind the Mait payment section, and every export is "
        "audit-logged "
        "as `pii_access` with the month it covered. The workbook's first row states what it "
        "holds, so whoever opens it later knows how it has to be handled."
    ),
    parameters=[
        OpenApiParameter("month", description="YYYY-MM", required=False, type=str),
    ],
    responses={200: bytes},
)
@api_view(["GET"])
@permission_classes([IsAdmin, in_section(PortalSection.MAIT_PAYMENT, PortalSection.REPORTS)])
def mait_payment_export(request):
    year, month = _month(request)
    response, report = payout_workbook_response(year, month)

    record_audit(
        action=AuditLog.Action.PII_ACCESS,
        entity_type="report",
        entity_id="mait_payment_export",
        request=request,
        meta={
            "month": f"{year}-{month:02d}",
            "maits": report["totals"]["maits"],
            "net_payable": str(report["totals"]["net_payable"]),
            "carries": ["bank_account_no", "ifsc_code", "pan_no"],
        },
    )
    return response


class PayoutSchemeSerializer(serializers.ModelSerializer):
    """
    The four figures the payout is computed from, editable from the report's own screen.

    Not a constant in a build, for the reason `payments.pricing` gives about the insemination
    rate: these are the terms of a field agent's engagement and they change by negotiation.
    A dairy that renegotiates should not have to ask an engineer to change somebody's pay.

    The consumable rates are deliberately absent — they belong to `Consumable.rate` and are
    maintained on Products, so there is one place per price.
    """

    class Meta:
        model = MaitPayoutScheme
        fields = ["commission_per_ai", "monthly_fixed_amount", "fixed_min_ai", "straw_rate"]


@extend_schema(
    tags=["reports"],
    summary="Read or change the Mait payout scheme",
    description=(
        "The commission per insemination, the monthly retainer and the number of "
        "inseminations that earns it, and what a straw is recovered at.\n\n"
        "Changing these changes every month the report is asked for, past ones included — "
        "the report is computed on read and nothing is frozen. That is deliberate: a "
        "correction to a rate should reach the months it was wrong for. A month already paid "
        "is settled by the workbook that was downloaded and audit-logged at the time.\n\n"
        "Consumable rates are not here. They live on `Consumable.rate` and are maintained on "
        "the Products screen, so a glove costs one thing across the whole platform."
    ),
    request=PayoutSchemeSerializer,
    responses={200: PayoutSchemeSerializer},
)
@api_view(["GET", "PATCH"])
@permission_classes([IsAdmin, in_section(PortalSection.MAIT_PAYMENT)])
def payout_scheme(request):
    scheme = MaitPayoutScheme.current()
    if request.method == "GET":
        return Response(PayoutSchemeSerializer(scheme).data)

    serializer = PayoutSchemeSerializer(scheme, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    before = PayoutSchemeSerializer(scheme).data
    serializer.save()

    # Somebody's pay just changed. Who did it and what it was before is the whole point of
    # recording it — a rate that moved with no trail is indistinguishable from one that was
    # always wrong.
    record_audit(
        action=AuditLog.Action.UPDATE,
        entity_type="mait_payout_scheme",
        entity_id=scheme.pk,
        request=request,
        meta={"before": before, "after": serializer.data},
    )
    return Response(serializer.data)
