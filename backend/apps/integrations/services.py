"""Applying Indent Easy goods-issue events to Mait stock (SRS §6.6.3)."""

from __future__ import annotations

import logging
from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.core.services import record_audit
from apps.indents.models import IndentRequest
from apps.inventory.models import MaitInventoryLedger, ProductType, SemenBatch
from apps.inventory.services import credit_stock

logger = logging.getLogger(__name__)


@transaction.atomic
def apply_grn(*, indent: IndentRequest, grn: dict[str, Any], source: str) -> bool:
    """
    Credit a Mait's stock from an Indent Easy goods issue.

    Returns True if stock was credited, False if this GRN was already applied.

    Idempotent by design, because it is reachable from two paths that can both fire for the
    same delivery: the webhook (fast) and the reconciliation poll (guaranteed). Whichever
    arrives second must be a no-op — double-crediting would hand a Mait straws they do not
    physically hold, which is the same class of error as losing them.
    """
    # Re-read under a row lock so a webhook and a reconciliation run racing on the same
    # indent serialise here rather than both passing the already-issued check.
    indent = IndentRequest.objects.select_for_update().get(pk=indent.pk)

    if indent.status == IndentRequest.Status.ISSUED:
        logger.info("GRN for indent %s already applied; ignoring (%s)", indent.id, source)
        return False

    qty_issued = int(grn.get("quantity_issued") or 0)
    if qty_issued <= 0:
        logger.warning("GRN for indent %s carries no issued quantity", indent.id)
        return False

    straw_numbers: list[str] = grn.get("straw_numbers") or []

    if indent.product_type == ProductType.STRAW:
        _credit_straws(indent=indent, straw_numbers=straw_numbers, grn=grn)
    else:
        credit_stock(
            mait=indent.mait,
            product_type=indent.product_type,
            product_ref_id=indent.product_ref_id,
            qty=qty_issued,
            ref_type=MaitInventoryLedger.RefType.INDENT,
            ref_id=indent.id,
            note=f"GRN {grn.get('grn_no', '')} via {source}",
        )

    indent.qty_issued = qty_issued
    indent.status = IndentRequest.Status.ISSUED
    indent.issued_at = timezone.now()
    indent.save(update_fields=["qty_issued", "status", "issued_at", "updated_at"])

    record_audit(
        action="state_change",
        entity_type="indent_request",
        entity_id=indent.id,
        meta={"to": "issued", "qty_issued": qty_issued, "source": source,
              "grn_no": grn.get("grn_no", "")},
    )
    logger.info("Credited indent %s with %s units via %s", indent.id, qty_issued, source)
    return True


def _credit_straws(*, indent: IndentRequest, straw_numbers: list[str], grn: dict) -> None:
    """
    Credit individually-numbered straws.

    Straws are tracked per physical unit, so the GRN must name them — a bare count would
    leave the platform unable to validate a scan later (SRS §6.3 step 4). A GRN that omits
    them is a store-side data problem worth failing loudly on rather than guessing.
    """
    if not straw_numbers:
        raise ValueError(
            f"GRN for straw indent {indent.id} did not list straw numbers; "
            "cannot credit stock without them."
        )

    for straw_no in straw_numbers:
        batch, _ = SemenBatch.objects.get_or_create(
            unique_straw_no=straw_no,
            defaults={
                "breed": indent.breed or grn.get("breed", ""),
                "bull_id": grn.get("bull_id", ""),
                "semen_station": grn.get("semen_station", ""),
                "received_date": timezone.localdate(),
            },
        )
        if batch.is_consumed:
            # A straw already consumed cannot be re-issued. Skipping rather than failing
            # keeps the rest of the delivery usable; the mismatch is logged for the store.
            logger.error(
                "GRN re-issued an already-consumed straw",
                extra={"straw_no": straw_no, "indent_id": indent.id},
            )
            continue

        credit_stock(
            mait=indent.mait,
            product_type=ProductType.STRAW,
            product_ref_id=batch.id,
            qty=1,
            ref_type=MaitInventoryLedger.RefType.INDENT,
            ref_id=indent.id,
            note=f"GRN {grn.get('grn_no', '')} straw {straw_no}",
        )
