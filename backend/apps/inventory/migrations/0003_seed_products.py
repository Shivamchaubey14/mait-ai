"""
The catalogue a Mait can ask for (SRS §6.6.1).

Seeded as data rather than left to an admin screen because a request form with an empty
product list is a Mait who cannot restock, and the list is the same at every MPP. Codes are
stable; names and order can be changed from the admin without a migration.

Straws are not here. They are asked for by breed, and the breed list is its own config.
"""

from django.db import migrations

CONSUMABLES = [
    ("SHEATH", "AI sheaths", "box of 50", 10),
    ("GLOVES", "Gloves", "pair", 20),
    ("LN2", "Liquid nitrogen", "litre", 30),
]

ASSETS = [
    ("AI_GUN", "AI gun", "piece", 10),
    ("EAR_TAG_APPLICATOR", "Ear tag applicator", "piece", 20),
    ("THAWING_TRAY", "Thawing tray", "piece", 30),
    ("THERMO_MONITOR", "Thermo monitor", "piece", 40),
]


def seed(apps, schema_editor):
    Consumable = apps.get_model("inventory", "Consumable")

    for code, name, unit, order in CONSUMABLES:
        Consumable.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "unit": unit,
                "category": "consumable",
                "display_order": order,
                "is_active": True,
            },
        )

    for code, name, unit, order in ASSETS:
        Consumable.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "unit": unit,
                "category": "asset",
                "display_order": order,
                "is_active": True,
            },
        )


def unseed(apps, schema_editor):
    """
    Deactivated rather than deleted.

    A Mait's inventory rows point at these by id, and deleting a row an indent references
    would break the history that indent is evidence of.
    """
    Consumable = apps.get_model("inventory", "Consumable")
    codes = [code for code, *_ in CONSUMABLES + ASSETS]
    Consumable.objects.filter(code__in=codes).update(is_active=False)


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0002_alter_consumable_options_consumable_category_and_more"),
    ]

    operations = [migrations.RunPython(seed, unseed)]
