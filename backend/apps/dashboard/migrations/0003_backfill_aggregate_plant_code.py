"""
Fill in the plant on aggregate rows written before the column existed.

Without this every historical row carries a blank plant, and a zone dashboard would answer
zero for everything up to the day this shipped while the network total went on including it
— the most confusing shape a wrong number can take, because both figures look plausible.

Set from the MPP each row already points at, one UPDATE per plant rather than per row: there
are nineteen plants and the aggregate grows without bound, so the alternative is a Python
loop over the whole table for an answer SQL already holds.
"""

from django.db import migrations


def fill(apps, schema_editor):
    DailyAIAggregate = apps.get_model("dashboard", "DailyAIAggregate")
    MPP = apps.get_model("masterdata", "MPP")

    for code in MPP.objects.values_list("plant_code", flat=True).distinct():
        if not code:
            continue
        DailyAIAggregate.objects.filter(plant_code="", mpp__plant_code=code).update(
            plant_code=code
        )


def unfill(apps, schema_editor):
    # Reversible on purpose: the column is derived, so putting it back to blank loses nothing
    # that the forward migration cannot rebuild.
    apps.get_model("dashboard", "DailyAIAggregate").objects.update(plant_code="")


class Migration(migrations.Migration):
    dependencies = [
        ("dashboard", "0002_dailyaiaggregate_plant_code_and_more"),
        ("masterdata", "0011_zone_zoneplant"),
    ]

    operations = [migrations.RunPython(fill, unfill)]
