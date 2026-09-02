"""
The terms the dairy is already paying on, as the starting scheme.

Taken from the rate legend at the foot of the office's own payment sheet, which is the only
written statement of them that exists — ₹220 an insemination, a ₹2,500 retainer once a Mait
reaches 25 in the month, and materials recovered at ₹35 a straw, ₹20 a litre of nitrogen and
₹3 apiece for sheaths and gloves.

**Fills gaps, never overwrites.** A rate an administrator has set is the current answer and
this migration is a stale one; the consumable rates are only written where the catalogue still
reads zero, which is the "unpriced, not free" state `Consumable.rate` documents. On a
deployment where somebody has already priced gloves, this leaves them alone.
"""

from decimal import Decimal

from django.db import migrations

COMMISSION_PER_AI = Decimal("220")
MONTHLY_FIXED_AMOUNT = Decimal("2500")
FIXED_MIN_AI = 25
STRAW_RATE = Decimal("35")

#: Catalogue code to per-piece recovery rate. Only applied to a product still reading zero.
CONSUMABLE_RATES = {
    "LN2": Decimal("20"),
    "SHEATH": Decimal("3"),
    "GLOVES": Decimal("3"),
}


def seed(apps, schema_editor):
    MaitPayoutScheme = apps.get_model("payments", "MaitPayoutScheme")
    Consumable = apps.get_model("inventory", "Consumable")

    MaitPayoutScheme.objects.get_or_create(
        scheme="ai",
        defaults={
            "commission_per_ai": COMMISSION_PER_AI,
            "monthly_fixed_amount": MONTHLY_FIXED_AMOUNT,
            "fixed_min_ai": FIXED_MIN_AI,
            "straw_rate": STRAW_RATE,
        },
    )

    for code, rate in CONSUMABLE_RATES.items():
        Consumable.objects.filter(code=code, rate=0).update(rate=rate)


def unseed(apps, schema_editor):
    # The scheme row goes with the table on the way back down; the consumable rates stay.
    # Reverting a migration should not silently un-price a catalogue an administrator may
    # have been maintaining by hand ever since.
    apps.get_model("payments", "MaitPayoutScheme").objects.filter(scheme="ai").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0004_mait_payout_scheme"),
        # Not `0001_initial`: this writes `Consumable.rate`, which arrives in 0005.
        ("inventory", "0005_consumable_rate"),
    ]

    operations = [migrations.RunPython(seed, unseed)]
